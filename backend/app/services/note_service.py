import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.config import settings


def _notes_file(pdf_hash: str) -> Path:
    cache_dir = Path(settings.cache_dir) / pdf_hash
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / "notes.json"


def _read_notes(pdf_hash: str) -> dict[str, list[dict]]:
    path = _notes_file(pdf_hash)
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _write_notes(pdf_hash: str, data: dict[str, list[dict]]) -> None:
    path = _notes_file(pdf_hash)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_note(pdf_hash: str, page_number: int, content: str) -> dict:
    data = _read_notes(pdf_hash)
    page_key = str(page_number)
    now = _now_iso()
    record = {
        "id": uuid4().hex[:12],
        "content": content,
        "created_at": now,
        "updated_at": now,
    }
    data.setdefault(page_key, []).append(record)
    _write_notes(pdf_hash, data)
    return dict(record)


def get_notes_for_pdf(pdf_hash: str) -> dict[int, list[dict]]:
    data = _read_notes(pdf_hash)
    results: dict[int, list[dict]] = {}
    for page_key, records in data.items():
        try:
            page_number = int(page_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(records, list):
            continue
        results[page_number] = [dict(record) for record in records if isinstance(record, dict)]
    return results


def note_exists(pdf_hash: str, page_number: int, note_id: str) -> bool:
    page_notes = get_notes_for_pdf(pdf_hash).get(page_number, [])
    return any(record.get("id") == note_id for record in page_notes)


def update_note(pdf_hash: str, page_number: int, note_id: str, content: str) -> dict:
    data = _read_notes(pdf_hash)
    page_key = str(page_number)
    records = data.get(page_key, [])
    for record in records:
        if record.get("id") != note_id:
            continue
        record["content"] = content
        record["updated_at"] = _now_iso()
        _write_notes(pdf_hash, data)
        return dict(record)
    raise KeyError(f"Note {note_id} not found")


def delete_note(pdf_hash: str, page_number: int, note_id: str) -> bool:
    data = _read_notes(pdf_hash)
    page_key = str(page_number)
    records = data.get(page_key, [])
    next_records = [record for record in records if record.get("id") != note_id]
    if len(next_records) == len(records):
        return False

    if next_records:
        data[page_key] = next_records
    else:
        data.pop(page_key, None)
    _write_notes(pdf_hash, data)
    return True
