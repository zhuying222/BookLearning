import json
from datetime import datetime, timezone

from app.core.config import settings


def log_activity(event: str, detail: dict | None = None) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "detail": detail or {},
    }
    with open(settings.activity_log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def get_recent_activities(limit: int = 50) -> list[dict]:
    from pathlib import Path

    path = Path(settings.activity_log_path)
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    result = []
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            result.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(result) >= limit:
            break
    return result
