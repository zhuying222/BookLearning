from datetime import datetime, timezone
import hashlib
import json
from io import BytesIO
from pathlib import Path
import shutil

from fastapi import UploadFile
from pypdf import PdfReader

from app.core.config import settings
from app.models.document import DocumentRecord, DocumentSummary
from app.services import cache_service


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _index_path() -> Path:
    return Path(settings.documents_index_path)


def _load_documents() -> list[DocumentRecord]:
    path = _index_path()
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [DocumentRecord(**item) for item in data]


def _save_documents(documents: list[DocumentRecord]) -> None:
    path = _index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps([document.model_dump(mode="json") for document in documents], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _document_dir(document_id: str) -> Path:
    return Path(settings.documents_dir) / document_id


def _document_file_path(document: DocumentRecord) -> Path:
    return _document_dir(document.id) / document.storage_file_name


def _summarize(document: DocumentRecord) -> DocumentSummary:
    return DocumentSummary(**document.model_dump(), cached_pages=cache_service.count_cached_pages(document.pdf_hash))


def _sorted_documents(documents: list[DocumentRecord]) -> list[DocumentRecord]:
    return sorted(
        documents,
        key=lambda document: document.last_opened_at or document.updated_at,
        reverse=True,
    )


def compute_pdf_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()[:24]


def list_documents() -> list[DocumentSummary]:
    return [_summarize(document) for document in _sorted_documents(_load_documents())]


def get_document(document_id: str) -> DocumentRecord | None:
    for document in _load_documents():
        if document.id == document_id:
            return document
    return None


def get_document_summary(document_id: str) -> DocumentSummary | None:
    document = get_document(document_id)
    return _summarize(document) if document else None


def import_document(file_name: str, pdf_bytes: bytes) -> tuple[DocumentSummary, bool]:
    if not file_name.lower().endswith(".pdf"):
        raise ValueError("Only PDF files are supported.")

    pdf_hash = compute_pdf_hash(pdf_bytes)
    documents = _load_documents()
    for document in documents:
        if document.pdf_hash == pdf_hash:
            return _summarize(document), False

    page_count = len(PdfReader(BytesIO(pdf_bytes)).pages)
    now = _utc_now()
    document = DocumentRecord(
        pdf_hash=pdf_hash,
        title=Path(file_name).stem,
        original_file_name=file_name,
        file_size_bytes=len(pdf_bytes),
        page_count=page_count,
        imported_at=now,
        updated_at=now,
    )

    document_dir = _document_dir(document.id)
    document_dir.mkdir(parents=True, exist_ok=True)
    _document_file_path(document).write_bytes(pdf_bytes)

    documents.append(document)
    _save_documents(documents)
    return _summarize(document), True


async def import_uploaded_document(file: UploadFile) -> tuple[DocumentSummary, bool]:
    pdf_bytes = await file.read()
    return import_document(file.filename or "document.pdf", pdf_bytes)


def get_document_file(document_id: str) -> tuple[DocumentRecord, Path] | None:
    document = get_document(document_id)
    if document is None:
        return None

    file_path = _document_file_path(document)
    if not file_path.exists():
        raise FileNotFoundError(f"Missing stored file for document {document_id}")
    return document, file_path


def mark_document_opened(document_id: str) -> DocumentSummary | None:
    documents = _load_documents()
    updated_document: DocumentRecord | None = None
    now = _utc_now()

    for index, document in enumerate(documents):
        if document.id != document_id:
            continue
        updated_document = document.model_copy(update={"last_opened_at": now, "updated_at": now})
        documents[index] = updated_document
        break

    if updated_document is None:
        return None

    _save_documents(documents)
    return _summarize(updated_document)


def update_reading_progress(document_id: str, last_read_page: int) -> DocumentSummary | None:
    documents = _load_documents()
    updated_document: DocumentRecord | None = None
    now = _utc_now()

    for index, document in enumerate(documents):
        if document.id != document_id:
            continue
        normalized_page = max(1, last_read_page)
        updated_document = document.model_copy(
            update={
                "last_read_page": normalized_page,
                "last_opened_at": now,
                "updated_at": now,
            }
        )
        documents[index] = updated_document
        break

    if updated_document is None:
        return None

    _save_documents(documents)
    return _summarize(updated_document)


def delete_document(document_id: str, remove_cache: bool = True) -> DocumentRecord | None:
    documents = _load_documents()
    target = next((document for document in documents if document.id == document_id), None)
    if target is None:
        return None

    remaining_documents = [document for document in documents if document.id != document_id]
    _save_documents(remaining_documents)

    document_dir = _document_dir(document_id)
    if document_dir.exists():
        shutil.rmtree(document_dir)

    if remove_cache:
        cache_service.invalidate_cache(target.pdf_hash)

    return target
