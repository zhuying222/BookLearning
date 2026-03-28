from collections import defaultdict
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import logging
import os
from pathlib import Path
import re
import shutil
from typing import Iterable
import uuid

from fastapi import UploadFile
from pypdf import PdfReader
from pydantic import ValidationError

from app.core.config import settings
from app.models.document import DocumentRecord, DocumentSummary, FolderRecord, FolderSummary, LibraryIndex, LibrarySnapshot
from app.services import cache_service

logger = logging.getLogger(__name__)

MAX_FOLDER_DEPTH = 5
_INDEX_VERSION = 3
_SUPPORTED_LEGACY_INDEX_VERSIONS = {2}
_INVALID_FILE_NAME_CHARS = re.compile(r'[\\/:*?"<>|]+')
_WINDOWS_RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _library_index_path() -> Path:
    return Path(settings.library_index_path)


def _library_root() -> Path:
    return Path(settings.library_root_dir)


def _legacy_index_path() -> Path:
    return Path(settings.documents_index_path)


def _legacy_documents_root() -> Path:
    return Path(settings.documents_dir)


def _normalize_base_name(value: str, fallback: str) -> str:
    sanitized = _INVALID_FILE_NAME_CHARS.sub("_", value).replace("\x00", " ").strip().rstrip(". ")
    sanitized = re.sub(r"\s+", " ", sanitized)
    if not sanitized:
        sanitized = fallback
    if sanitized.lower() in _WINDOWS_RESERVED_NAMES:
        sanitized = f"{sanitized}_"
    return sanitized


def _normalize_folder_name(value: str) -> str:
    return _normalize_base_name(value, "新建文件夹")


def _normalize_document_file_name(value: str) -> str:
    raw = value.strip() or "未命名书籍.pdf"
    stem = raw[:-4] if raw.lower().endswith(".pdf") else raw
    return f"{_normalize_base_name(stem, '未命名书籍')}.pdf"


def _name_key(value: str) -> str:
    return value.casefold()


def _dedupe_name(desired: str, existing_names: Iterable[str]) -> str:
    existing = {_name_key(name) for name in existing_names}
    if _name_key(desired) not in existing:
        return desired

    suffix = Path(desired).suffix
    stem = desired[: -len(suffix)] if suffix else desired
    counter = 2
    while True:
        candidate = f"{stem} ({counter}){suffix}"
        if _name_key(candidate) not in existing:
            return candidate
        counter += 1


def _make_unique_folder_name(
    folders: Iterable[FolderRecord],
    parent_id: str | None,
    desired_name: str,
    exclude_id: str | None = None,
) -> str:
    normalized = _normalize_folder_name(desired_name)
    sibling_names = [
        folder.name
        for folder in folders
        if folder.parent_id == parent_id and folder.id != exclude_id
    ]
    return _dedupe_name(normalized, sibling_names)


def _make_unique_document_file_name(
    documents: Iterable[DocumentRecord],
    parent_folder_id: str | None,
    desired_name: str,
    exclude_id: str | None = None,
) -> str:
    normalized = _normalize_document_file_name(desired_name)
    sibling_names = [
        document.storage_file_name
        for document in documents
        if document.parent_folder_id == parent_folder_id and document.id != exclude_id
    ]
    return _dedupe_name(normalized, sibling_names)


def _folder_children_map(folders: Iterable[FolderRecord]) -> dict[str | None, list[FolderRecord]]:
    mapping: dict[str | None, list[FolderRecord]] = defaultdict(list)
    for folder in folders:
        mapping[folder.parent_id].append(folder)
    return mapping


def _document_children_map(documents: Iterable[DocumentRecord]) -> dict[str | None, list[DocumentRecord]]:
    mapping: dict[str | None, list[DocumentRecord]] = defaultdict(list)
    for document in documents:
        mapping[document.parent_folder_id].append(document)
    return mapping


def _folder_depth(folder: FolderRecord, folders_by_id: dict[str, FolderRecord]) -> int:
    depth = 1
    parent_id = folder.parent_id
    seen = {folder.id}
    while parent_id is not None:
        if parent_id in seen:
            raise ValueError("Folder tree contains a cycle.")
        parent = folders_by_id.get(parent_id)
        if parent is None:
            raise ValueError(f"Folder parent {parent_id} is missing.")
        seen.add(parent_id)
        depth += 1
        parent_id = parent.parent_id
    return depth


def _document_folder_depth(document: DocumentRecord, folders_by_id: dict[str, FolderRecord]) -> int:
    if document.parent_folder_id is None:
        return 0
    parent = folders_by_id.get(document.parent_folder_id)
    if parent is None:
        raise ValueError(f"Parent folder {document.parent_folder_id} is missing.")
    return _folder_depth(parent, folders_by_id)


def _folder_path(folder: FolderRecord, folders_by_id: dict[str, FolderRecord]) -> Path:
    parts = [folder.name]
    parent_id = folder.parent_id
    seen = {folder.id}
    while parent_id is not None:
        if parent_id in seen:
            raise ValueError("Folder tree contains a cycle.")
        parent = folders_by_id.get(parent_id)
        if parent is None:
            raise ValueError(f"Folder parent {parent_id} is missing.")
        parts.append(parent.name)
        seen.add(parent_id)
        parent_id = parent.parent_id
    return _library_root().joinpath(*reversed(parts))


def _parent_path(parent_folder_id: str | None, folders_by_id: dict[str, FolderRecord]) -> Path:
    if parent_folder_id is None:
        return _library_root()
    parent = folders_by_id.get(parent_folder_id)
    if parent is None:
        raise ValueError(f"Folder {parent_folder_id} does not exist.")
    return _folder_path(parent, folders_by_id)


def _document_path(document: DocumentRecord, folders_by_id: dict[str, FolderRecord]) -> Path:
    return _parent_path(document.parent_folder_id, folders_by_id) / document.storage_file_name


def _ensure_parent_folder(parent_folder_id: str | None, folders_by_id: dict[str, FolderRecord]) -> FolderRecord | None:
    if parent_folder_id is None:
        return None
    parent = folders_by_id.get(parent_folder_id)
    if parent is None:
        raise ValueError("Folder not found.")
    return parent


def _subtree_height(folder_id: str, child_map: dict[str | None, list[FolderRecord]]) -> int:
    children = child_map.get(folder_id, [])
    if not children:
        return 1
    return 1 + max(_subtree_height(child.id, child_map) for child in children)


def _descendant_folder_ids(folder_id: str, child_map: dict[str | None, list[FolderRecord]]) -> set[str]:
    descendants: set[str] = set()
    stack = [folder_id]
    while stack:
        current = stack.pop()
        for child in child_map.get(current, []):
            if child.id in descendants:
                continue
            descendants.add(child.id)
            stack.append(child.id)
    return descendants


def _sort_key_for_folder(folder: FolderRecord, folders_by_id: dict[str, FolderRecord]) -> tuple[str, str]:
    return (_folder_path(folder, folders_by_id).as_posix().casefold(), folder.id)


def _sort_key_for_document(document: DocumentRecord, folders_by_id: dict[str, FolderRecord]) -> tuple[str, str]:
    return (_document_path(document, folders_by_id).as_posix().casefold(), document.id)


def _index_backup_path(path: Path, suffix_label: str = "backup") -> Path:
    timestamp = _utc_now().strftime("%Y%m%d-%H%M%S")
    return path.with_name(f"{path.stem}.{suffix_label}-{timestamp}{path.suffix}")


def _save_library(index: LibraryIndex) -> None:
    path = _library_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(index.model_dump(mode="json"), ensure_ascii=False, indent=2)
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(payload, encoding="utf-8")
    temp_path.replace(path)


def _legacy_pdf_path(document: DocumentRecord) -> Path:
    return _legacy_documents_root() / document.id / (document.storage_file_name or "source.pdf")


def _recover_legacy_documents_from_storage() -> list[DocumentRecord]:
    root = _legacy_documents_root()
    if not root.exists():
        return []

    recovered: list[DocumentRecord] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if not entry.is_dir():
            continue

        pdf_path = entry / "source.pdf"
        if not pdf_path.exists():
            logger.warning("Skipping legacy document directory without source.pdf: %s", entry)
            continue

        try:
            pdf_bytes = pdf_path.read_bytes()
            stat = pdf_path.stat()
            reader = PdfReader(BytesIO(pdf_bytes))
            recovered.append(
                DocumentRecord(
                    id=entry.name,
                    pdf_hash=compute_pdf_hash(pdf_bytes),
                    title=pdf_path.stem,
                    original_file_name=f"{entry.name}.pdf",
                    storage_file_name="source.pdf",
                    file_size_bytes=stat.st_size,
                    page_count=len(reader.pages),
                    imported_at=datetime.fromtimestamp(getattr(stat, "st_ctime", stat.st_mtime), tz=timezone.utc),
                    updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                    last_opened_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                )
            )
        except Exception as exc:
            logger.exception("Failed to recover legacy document from %s: %s", pdf_path, exc)

    return recovered


def _load_legacy_documents() -> list[DocumentRecord]:
    path = _legacy_index_path()
    if not path.exists():
        return _recover_legacy_documents_from_storage()

    raw = path.read_text(encoding="utf-8")
    if raw.replace("\x00", "").strip() == "":
        return _recover_legacy_documents_from_storage()

    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("legacy documents index root must be a list")
        return [DocumentRecord(**item) for item in data]
    except (json.JSONDecodeError, ValidationError, ValueError):
        return _recover_legacy_documents_from_storage()


def _has_legacy_library_data() -> bool:
    if _legacy_index_path().exists():
        return True
    root = _legacy_documents_root()
    return root.exists() and any(root.iterdir())


def _move_path(old_path: Path, new_path: Path) -> None:
    if not old_path.exists():
        raise FileNotFoundError(f"Missing stored file or folder: {old_path}")

    new_path.parent.mkdir(parents=True, exist_ok=True)
    if os.path.normcase(str(old_path)) == os.path.normcase(str(new_path)):
        if old_path.name == new_path.name:
            return
        temp_path = old_path.with_name(f".rename-{uuid.uuid4().hex}{old_path.suffix}")
        old_path.rename(temp_path)
        temp_path.rename(new_path)
        return
    old_path.rename(new_path)


def _migrate_legacy_library() -> LibraryIndex:
    legacy_documents = _load_legacy_documents()
    index = LibraryIndex(version=_INDEX_VERSION, folders=[], documents=[])
    _library_root().mkdir(parents=True, exist_ok=True)

    for legacy_document in legacy_documents:
        source_path = _legacy_pdf_path(legacy_document)
        if not source_path.exists():
            logger.warning("Skipping missing legacy PDF: %s", source_path)
            continue

        target_name = _make_unique_document_file_name(index.documents, None, legacy_document.original_file_name or legacy_document.title)
        target_path = _library_root() / target_name
        shutil.move(str(source_path), str(target_path))

        index.documents.append(
            legacy_document.model_copy(
                update={
                    "title": Path(target_name).stem,
                    "original_file_name": target_name,
                    "storage_file_name": target_name,
                    "parent_folder_id": None,
                    "updated_at": _utc_now(),
                }
            )
        )

        legacy_dir = _legacy_documents_root() / legacy_document.id
        if legacy_dir.exists():
            shutil.rmtree(legacy_dir, ignore_errors=True)

    _save_library(index)
    logger.warning("Migrated legacy library storage to %s", _library_root())
    return index


def _recover_library_from_storage() -> LibraryIndex:
    root = _library_root()
    root.mkdir(parents=True, exist_ok=True)

    folders: list[FolderRecord] = []
    documents: list[DocumentRecord] = []

    def walk_directory(current_path: Path, parent_id: str | None, depth: int) -> None:
        if depth > MAX_FOLDER_DEPTH:
            logger.warning("Skipping directories deeper than %s levels under %s", MAX_FOLDER_DEPTH, current_path)
            return

        for entry in sorted(current_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold())):
            if entry.is_dir():
                stat = entry.stat()
                now = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                folder = FolderRecord(
                    name=_normalize_folder_name(entry.name),
                    parent_id=parent_id,
                    created_at=datetime.fromtimestamp(getattr(stat, "st_ctime", stat.st_mtime), tz=timezone.utc),
                    updated_at=now,
                )
                folders.append(folder)
                walk_directory(entry, folder.id, depth + 1)
                continue

            if entry.suffix.lower() != ".pdf":
                logger.warning("Skipping non-PDF file in library root: %s", entry)
                continue

            try:
                pdf_bytes = entry.read_bytes()
                stat = entry.stat()
                reader = PdfReader(BytesIO(pdf_bytes))
                documents.append(
                    DocumentRecord(
                        pdf_hash=compute_pdf_hash(pdf_bytes),
                        title=entry.stem,
                        original_file_name=entry.name,
                        storage_file_name=entry.name,
                        file_size_bytes=stat.st_size,
                        page_count=len(reader.pages),
                        imported_at=datetime.fromtimestamp(getattr(stat, "st_ctime", stat.st_mtime), tz=timezone.utc),
                        updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                        last_opened_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                        parent_folder_id=parent_id,
                    )
                )
            except Exception as exc:
                logger.exception("Failed to recover library PDF %s: %s", entry, exc)

    walk_directory(root, None, 1)
    return LibraryIndex(version=_INDEX_VERSION, folders=folders, documents=documents)


def _upgrade_library_index(data: dict) -> tuple[LibraryIndex, bool]:
    raw_version = data.get("version", _INDEX_VERSION)
    if not isinstance(raw_version, int):
        raise ValueError("library index version must be an integer")

    index = LibraryIndex(**data)
    if raw_version == _INDEX_VERSION:
        return index, False

    if raw_version in _SUPPORTED_LEGACY_INDEX_VERSIONS:
        logger.info("Upgrading library index from version %s to %s.", raw_version, _INDEX_VERSION)
        return index.model_copy(update={"version": _INDEX_VERSION}), True

    if raw_version < _INDEX_VERSION:
        logger.warning(
            "Unsupported legacy library index version %s. Attempting best-effort upgrade to %s.",
            raw_version,
            _INDEX_VERSION,
        )
        return index.model_copy(update={"version": _INDEX_VERSION}), True

    logger.warning(
        "Library index version %s is newer than supported version %s. Continuing with best-effort load.",
        raw_version,
        _INDEX_VERSION,
    )
    return index, False


def _load_library() -> LibraryIndex:
    path = _library_index_path()
    if not path.exists():
        if _has_legacy_library_data():
            return _migrate_legacy_library()
        recovered = _recover_library_from_storage()
        _save_library(recovered)
        return recovered

    raw = path.read_text(encoding="utf-8")
    if raw.replace("\x00", "").strip() == "":
        backup_path = _index_backup_path(path, "corrupt")
        shutil.copy2(path, backup_path)
        recovered = _recover_library_from_storage()
        _save_library(recovered)
        logger.warning("Recovered empty library index. Backup saved to %s", backup_path)
        return recovered

    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("library index root must be an object")
        index, upgraded = _upgrade_library_index(data)
        if upgraded:
            _save_library(index)
        return index
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        backup_path = _index_backup_path(path, "corrupt")
        shutil.copy2(path, backup_path)
        if _has_legacy_library_data():
            logger.warning("Library index invalid, falling back to legacy migration: %s", exc)
            return _migrate_legacy_library()
        recovered = _recover_library_from_storage()
        _save_library(recovered)
        logger.warning("Recovered invalid library index. Backup saved to %s", backup_path)
        return recovered


def _summarize_document(document: DocumentRecord, folders_by_id: dict[str, FolderRecord]) -> DocumentSummary:
    return DocumentSummary(
        **document.model_dump(),
        cached_pages=cache_service.count_cached_pages(document.pdf_hash),
        folder_depth=_document_folder_depth(document, folders_by_id),
    )


def _build_library_snapshot(index: LibraryIndex) -> LibrarySnapshot:
    folders_by_id = {folder.id: folder for folder in index.folders}
    folder_children = _folder_children_map(index.folders)
    document_children = _document_children_map(index.documents)
    total_documents_cache: dict[str, int] = {}

    def count_total_documents(folder_id: str) -> int:
        if folder_id in total_documents_cache:
            return total_documents_cache[folder_id]
        total = len(document_children.get(folder_id, []))
        total += sum(count_total_documents(child.id) for child in folder_children.get(folder_id, []))
        total_documents_cache[folder_id] = total
        return total

    folder_summaries = [
        FolderSummary(
            **folder.model_dump(),
            depth=_folder_depth(folder, folders_by_id),
            child_folder_count=len(folder_children.get(folder.id, [])),
            child_document_count=len(document_children.get(folder.id, [])),
            total_document_count=count_total_documents(folder.id),
        )
        for folder in sorted(index.folders, key=lambda folder: _sort_key_for_folder(folder, folders_by_id))
    ]
    document_summaries = [
        _summarize_document(document, folders_by_id)
        for document in sorted(index.documents, key=lambda document: _sort_key_for_document(document, folders_by_id))
    ]
    return LibrarySnapshot(folders=folder_summaries, documents=document_summaries, max_folder_depth=MAX_FOLDER_DEPTH)


def compute_pdf_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()[:24]


def list_library() -> LibrarySnapshot:
    return _build_library_snapshot(_load_library())


def list_documents() -> list[DocumentSummary]:
    return list_library().documents


def get_document(document_id: str) -> DocumentRecord | None:
    index = _load_library()
    return next((document for document in index.documents if document.id == document_id), None)


def get_document_summary(document_id: str) -> DocumentSummary | None:
    index = _load_library()
    document = next((item for item in index.documents if item.id == document_id), None)
    if document is None:
        return None
    folders_by_id = {folder.id: folder for folder in index.folders}
    return _summarize_document(document, folders_by_id)


def get_folder_summary(folder_id: str) -> FolderSummary | None:
    snapshot = list_library()
    return next((folder for folder in snapshot.folders if folder.id == folder_id), None)


def import_document(file_name: str, pdf_bytes: bytes, parent_folder_id: str | None = None) -> tuple[DocumentSummary, bool]:
    if not file_name.lower().endswith(".pdf"):
        raise ValueError("Only PDF files are supported.")

    index = _load_library()
    folders_by_id = {folder.id: folder for folder in index.folders}
    parent_folder = _ensure_parent_folder(parent_folder_id, folders_by_id)
    if parent_folder is not None and _folder_depth(parent_folder, folders_by_id) > MAX_FOLDER_DEPTH:
        raise ValueError(f"Folders can be nested at most {MAX_FOLDER_DEPTH} levels.")

    pdf_hash = compute_pdf_hash(pdf_bytes)
    existing_document = next((document for document in index.documents if document.pdf_hash == pdf_hash), None)
    if existing_document is not None:
        return _summarize_document(existing_document, folders_by_id), False

    page_count = len(PdfReader(BytesIO(pdf_bytes)).pages)
    now = _utc_now()
    storage_file_name = _make_unique_document_file_name(index.documents, parent_folder_id, file_name)
    document = DocumentRecord(
        pdf_hash=pdf_hash,
        title=Path(storage_file_name).stem,
        original_file_name=storage_file_name,
        storage_file_name=storage_file_name,
        file_size_bytes=len(pdf_bytes),
        page_count=page_count,
        imported_at=now,
        updated_at=now,
        parent_folder_id=parent_folder_id,
    )

    file_path = _parent_path(parent_folder_id, folders_by_id) / storage_file_name
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(pdf_bytes)

    index.documents.append(document)
    _save_library(index)
    return _summarize_document(document, folders_by_id), True


async def import_uploaded_document(file: UploadFile, parent_folder_id: str | None = None) -> tuple[DocumentSummary, bool]:
    pdf_bytes = await file.read()
    return import_document(file.filename or "document.pdf", pdf_bytes, parent_folder_id=parent_folder_id)


def create_folder(name: str, parent_folder_id: str | None = None) -> FolderSummary:
    index = _load_library()
    folders_by_id = {folder.id: folder for folder in index.folders}
    parent_folder = _ensure_parent_folder(parent_folder_id, folders_by_id)
    if parent_folder is not None and _folder_depth(parent_folder, folders_by_id) >= MAX_FOLDER_DEPTH:
        raise ValueError(f"Folders can be nested at most {MAX_FOLDER_DEPTH} levels.")

    folder_name = _make_unique_folder_name(index.folders, parent_folder_id, name)
    now = _utc_now()
    folder = FolderRecord(name=folder_name, parent_id=parent_folder_id, created_at=now, updated_at=now)
    folder_path = _parent_path(parent_folder_id, folders_by_id) / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)

    index.folders.append(folder)
    _save_library(index)
    summary = get_folder_summary(folder.id)
    if summary is None:
        raise RuntimeError("Failed to create folder.")
    return summary


def rename_folder(folder_id: str, next_name: str) -> FolderSummary | None:
    index = _load_library()
    folders_by_id = {folder.id: folder for folder in index.folders}
    folder = folders_by_id.get(folder_id)
    if folder is None:
        return None

    current_path = _folder_path(folder, folders_by_id)
    unique_name = _make_unique_folder_name(index.folders, folder.parent_id, next_name, exclude_id=folder.id)
    if unique_name == folder.name:
        return get_folder_summary(folder.id)

    _move_path(current_path, current_path.with_name(unique_name))
    updated_folder = folder.model_copy(update={"name": unique_name, "updated_at": _utc_now()})
    index.folders = [updated_folder if item.id == folder_id else item for item in index.folders]
    _save_library(index)
    return get_folder_summary(folder.id)


def move_folder(folder_id: str, target_folder_id: str | None) -> FolderSummary | None:
    index = _load_library()
    folders_by_id = {folder.id: folder for folder in index.folders}
    folder = folders_by_id.get(folder_id)
    if folder is None:
        return None
    if target_folder_id == folder.id:
        raise ValueError("A folder cannot be moved into itself.")

    target_folder = _ensure_parent_folder(target_folder_id, folders_by_id)
    child_map = _folder_children_map(index.folders)
    descendants = _descendant_folder_ids(folder.id, child_map)
    if target_folder_id in descendants:
        raise ValueError("A folder cannot be moved into its own descendant.")

    target_depth = 0 if target_folder is None else _folder_depth(target_folder, folders_by_id)
    if target_depth + _subtree_height(folder.id, child_map) > MAX_FOLDER_DEPTH:
        raise ValueError(f"Folders can be nested at most {MAX_FOLDER_DEPTH} levels.")

    unique_name = _make_unique_folder_name(index.folders, target_folder_id, folder.name, exclude_id=folder.id)
    if folder.parent_id == target_folder_id and unique_name == folder.name:
        return get_folder_summary(folder.id)

    current_path = _folder_path(folder, folders_by_id)
    target_path = _parent_path(target_folder_id, folders_by_id) / unique_name
    _move_path(current_path, target_path)

    updated_folder = folder.model_copy(
        update={
            "parent_id": target_folder_id,
            "name": unique_name,
            "updated_at": _utc_now(),
        }
    )
    index.folders = [updated_folder if item.id == folder_id else item for item in index.folders]
    _save_library(index)
    return get_folder_summary(folder.id)


def delete_folder(folder_id: str, remove_cache: bool = False) -> bool:
    index = _load_library()
    folders_by_id = {folder.id: folder for folder in index.folders}
    folder = folders_by_id.get(folder_id)
    if folder is None:
        return False

    child_map = _folder_children_map(index.folders)
    folder_ids_to_remove = _descendant_folder_ids(folder.id, child_map) | {folder.id}
    documents_to_remove = [document for document in index.documents if document.parent_folder_id in folder_ids_to_remove]

    folder_path = _folder_path(folder, folders_by_id)
    if folder_path.exists():
        shutil.rmtree(folder_path, ignore_errors=True)

    if remove_cache:
        for document in documents_to_remove:
            cache_service.invalidate_cache(document.pdf_hash)

    index.folders = [item for item in index.folders if item.id not in folder_ids_to_remove]
    index.documents = [item for item in index.documents if item.parent_folder_id not in folder_ids_to_remove]
    _save_library(index)
    return True


def rename_document(document_id: str, next_name: str) -> DocumentSummary | None:
    index = _load_library()
    document = next((item for item in index.documents if item.id == document_id), None)
    if document is None:
        return None

    folders_by_id = {folder.id: folder for folder in index.folders}
    unique_name = _make_unique_document_file_name(index.documents, document.parent_folder_id, next_name, exclude_id=document.id)
    updated_document = document.model_copy(
        update={
            "title": Path(unique_name).stem,
            "original_file_name": unique_name,
            "storage_file_name": unique_name,
            "updated_at": _utc_now(),
        }
    )

    if unique_name != document.storage_file_name:
        _move_path(_document_path(document, folders_by_id), _document_path(updated_document, folders_by_id))

    index.documents = [updated_document if item.id == document_id else item for item in index.documents]
    _save_library(index)
    return _summarize_document(updated_document, folders_by_id)


def move_document(document_id: str, target_folder_id: str | None) -> DocumentSummary | None:
    index = _load_library()
    document = next((item for item in index.documents if item.id == document_id), None)
    if document is None:
        return None

    folders_by_id = {folder.id: folder for folder in index.folders}
    _ensure_parent_folder(target_folder_id, folders_by_id)
    if document.parent_folder_id == target_folder_id:
        return _summarize_document(document, folders_by_id)

    unique_name = _make_unique_document_file_name(index.documents, target_folder_id, document.storage_file_name, exclude_id=document.id)
    updated_document = document.model_copy(
        update={
            "parent_folder_id": target_folder_id,
            "title": Path(unique_name).stem,
            "original_file_name": unique_name,
            "storage_file_name": unique_name,
            "updated_at": _utc_now(),
        }
    )
    _move_path(_document_path(document, folders_by_id), _document_path(updated_document, folders_by_id))

    index.documents = [updated_document if item.id == document_id else item for item in index.documents]
    _save_library(index)
    return _summarize_document(updated_document, folders_by_id)


def get_document_file(document_id: str) -> tuple[DocumentRecord, Path] | None:
    index = _load_library()
    document = next((item for item in index.documents if item.id == document_id), None)
    if document is None:
        return None

    folders_by_id = {folder.id: folder for folder in index.folders}
    file_path = _document_path(document, folders_by_id)
    if not file_path.exists():
        raise FileNotFoundError(f"Missing stored file for document {document_id}")
    return document, file_path


def mark_document_opened(document_id: str) -> DocumentSummary | None:
    index = _load_library()
    updated_document: DocumentRecord | None = None
    now = _utc_now()
    for position, document in enumerate(index.documents):
        if document.id != document_id:
            continue
        updated_document = document.model_copy(update={"last_opened_at": now, "updated_at": now})
        index.documents[position] = updated_document
        break

    if updated_document is None:
        return None

    _save_library(index)
    folders_by_id = {folder.id: folder for folder in index.folders}
    return _summarize_document(updated_document, folders_by_id)


def update_reading_progress(document_id: str, last_read_page: int) -> DocumentSummary | None:
    index = _load_library()
    updated_document: DocumentRecord | None = None
    now = _utc_now()
    for position, document in enumerate(index.documents):
        if document.id != document_id:
            continue
        updated_document = document.model_copy(
            update={
                "last_read_page": max(1, last_read_page),
                "last_opened_at": now,
                "updated_at": now,
            }
        )
        index.documents[position] = updated_document
        break

    if updated_document is None:
        return None

    _save_library(index)
    folders_by_id = {folder.id: folder for folder in index.folders}
    return _summarize_document(updated_document, folders_by_id)


def update_document_bookmark(document_id: str, page_number: int, text: str) -> DocumentSummary | None:
    index = _load_library()
    updated_document: DocumentRecord | None = None
    now = _utc_now()

    for position, document in enumerate(index.documents):
        if document.id != document_id:
            continue
        if page_number < 1:
            raise ValueError("Bookmark page number must be at least 1.")
        if document.page_count is not None and page_number > document.page_count:
            raise ValueError("Bookmark page number exceeds the document page count.")

        next_bookmarks = dict(document.bookmarks)
        next_bookmarks[page_number] = text
        updated_document = document.model_copy(
            update={
                "bookmarks": next_bookmarks,
                "last_opened_at": now,
                "updated_at": now,
            }
        )
        index.documents[position] = updated_document
        break

    if updated_document is None:
        return None

    _save_library(index)
    folders_by_id = {folder.id: folder for folder in index.folders}
    return _summarize_document(updated_document, folders_by_id)


def delete_document_bookmark(document_id: str, page_number: int) -> DocumentSummary | None:
    index = _load_library()
    updated_document: DocumentRecord | None = None
    now = _utc_now()

    for position, document in enumerate(index.documents):
        if document.id != document_id:
            continue
        if page_number < 1:
            raise ValueError("Bookmark page number must be at least 1.")

        next_bookmarks = dict(document.bookmarks)
        next_bookmarks.pop(page_number, None)
        updated_document = document.model_copy(
            update={
                "bookmarks": next_bookmarks,
                "last_opened_at": now,
                "updated_at": now,
            }
        )
        index.documents[position] = updated_document
        break

    if updated_document is None:
        return None

    _save_library(index)
    folders_by_id = {folder.id: folder for folder in index.folders}
    return _summarize_document(updated_document, folders_by_id)


def delete_document(document_id: str, remove_cache: bool = True) -> DocumentRecord | None:
    index = _load_library()
    document = next((item for item in index.documents if item.id == document_id), None)
    if document is None:
        return None

    folders_by_id = {folder.id: folder for folder in index.folders}
    file_path = _document_path(document, folders_by_id)
    if file_path.exists():
        file_path.unlink()

    if remove_cache:
        cache_service.invalidate_cache(document.pdf_hash)

    index.documents = [item for item in index.documents if item.id != document_id]
    _save_library(index)
    return document
