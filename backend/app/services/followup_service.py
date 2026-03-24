import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.config import settings


def _followup_file(pdf_hash: str) -> Path:
    cache_dir = Path(settings.cache_dir) / pdf_hash
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / "followups.json"


def _read_followups(pdf_hash: str) -> dict[str, list[dict]]:
    path = _followup_file(pdf_hash)
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _write_followups(pdf_hash: str, data: dict[str, list[dict]]) -> None:
    path = _followup_file(pdf_hash)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_followup(pdf_hash: str, page_number: int, question: str, answer: str) -> dict:
    data = _read_followups(pdf_hash)
    page_key = str(page_number)
    now = _now_iso()
    record = {
        "id": uuid4().hex[:12],
        "question": question,
        "answer": answer,
        "created_at": now,
        "updated_at": now,
    }
    data.setdefault(page_key, []).append(record)
    _write_followups(pdf_hash, data)
    return dict(record)


def get_followups_for_pdf(pdf_hash: str) -> dict[int, list[dict]]:
    data = _read_followups(pdf_hash)
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


def update_followup(pdf_hash: str, page_number: int, followup_id: str, question: str, answer: str) -> dict:
    data = _read_followups(pdf_hash)
    page_key = str(page_number)
    records = data.get(page_key, [])
    for record in records:
        if record.get("id") != followup_id:
            continue
        record["question"] = question
        record["answer"] = answer
        record["updated_at"] = _now_iso()
        _write_followups(pdf_hash, data)
        return dict(record)
    raise KeyError(f"Follow-up {followup_id} not found")


def delete_followup(pdf_hash: str, page_number: int, followup_id: str) -> bool:
    data = _read_followups(pdf_hash)
    page_key = str(page_number)
    records = data.get(page_key, [])
    next_records = [record for record in records if record.get("id") != followup_id]
    if len(next_records) == len(records):
        return False

    if next_records:
        data[page_key] = next_records
    else:
        data.pop(page_key, None)
    _write_followups(pdf_hash, data)
    return True
