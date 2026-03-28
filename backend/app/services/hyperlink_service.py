import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.core.config import settings


def _hyperlinks_file(pdf_hash: str) -> Path:
    cache_dir = Path(settings.cache_dir) / pdf_hash
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / "hyperlinks.json"


def _read_hyperlinks(pdf_hash: str) -> list[dict]:
    path = _hyperlinks_file(pdf_hash)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def _write_hyperlinks(pdf_hash: str, data: list[dict]) -> None:
    path = _hyperlinks_file(pdf_hash)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp_position(value: float) -> float:
    return max(0.02, min(0.94, value))


def add_hyperlink(
    pdf_hash: str,
    page_number: int,
    target_type: str,
    target_id: str,
    display_text: str,
    position_x: float,
    position_y: float,
) -> dict:
    data = _read_hyperlinks(pdf_hash)
    for record in data:
        if (
            record.get("page_number") == page_number
            and record.get("target_type") == target_type
            and record.get("target_id") == target_id
        ):
            return dict(record)

    now = _now_iso()
    record = {
        "id": uuid4().hex[:12],
        "page_number": page_number,
        "target_type": target_type,
        "target_id": target_id,
        "display_text": display_text,
        "position_x": _clamp_position(position_x),
        "position_y": _clamp_position(position_y),
        "created_at": now,
        "updated_at": now,
    }
    data.append(record)
    _write_hyperlinks(pdf_hash, data)
    return dict(record)


def get_hyperlinks_for_pdf(pdf_hash: str) -> list[dict]:
    data = _read_hyperlinks(pdf_hash)
    results = [dict(record) for record in data if isinstance(record, dict)]
    return sorted(results, key=lambda item: (int(item.get("page_number", 0)), item.get("created_at", "")))


def update_hyperlink_position(pdf_hash: str, hyperlink_id: str, position_x: float, position_y: float) -> dict:
    data = _read_hyperlinks(pdf_hash)
    for record in data:
        if record.get("id") != hyperlink_id:
            continue
        record["position_x"] = _clamp_position(position_x)
        record["position_y"] = _clamp_position(position_y)
        record["updated_at"] = _now_iso()
        _write_hyperlinks(pdf_hash, data)
        return dict(record)
    raise KeyError(f"Hyperlink {hyperlink_id} not found")


def update_hyperlink_text(pdf_hash: str, hyperlink_id: str, display_text: str) -> dict:
    data = _read_hyperlinks(pdf_hash)
    for record in data:
        if record.get("id") != hyperlink_id:
            continue
        record["display_text"] = display_text
        record["updated_at"] = _now_iso()
        _write_hyperlinks(pdf_hash, data)
        return dict(record)
    raise KeyError(f"Hyperlink {hyperlink_id} not found")


def delete_hyperlink(pdf_hash: str, hyperlink_id: str) -> bool:
    data = _read_hyperlinks(pdf_hash)
    next_records = [record for record in data if record.get("id") != hyperlink_id]
    if len(next_records) == len(data):
        return False
    _write_hyperlinks(pdf_hash, next_records)
    return True


def delete_hyperlinks_for_target(pdf_hash: str, page_number: int, target_type: str, target_id: str) -> int:
    data = _read_hyperlinks(pdf_hash)
    next_records = [
        record
        for record in data
        if not (
            record.get("page_number") == page_number
            and record.get("target_type") == target_type
            and record.get("target_id") == target_id
        )
    ]
    removed = len(data) - len(next_records)
    if removed > 0:
        _write_hyperlinks(pdf_hash, next_records)
    return removed
