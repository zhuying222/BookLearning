import json
import re
from pathlib import Path

from app.core.config import settings
from app.models.parse import ParseCostInfo

PAGE_FILE_RE = re.compile(r"^page_(\d+)(?:_.*)?\.json$")
FOLLOWUPS_FILE_NAME = "followups.json"


def _primary_cache_dir(pdf_hash: str) -> Path:
    return Path(settings.cache_dir) / pdf_hash


def _legacy_cache_dir(pdf_hash: str) -> Path:
    legacy_root = Path(settings.legacy_cache_dir)
    if legacy_root == Path(settings.cache_dir).parent:
        return legacy_root / pdf_hash
    return legacy_root / pdf_hash


def _existing_cache_dirs(pdf_hash: str) -> list[Path]:
    dirs: list[Path] = []
    primary = _primary_cache_dir(pdf_hash)
    if primary.exists():
        dirs.append(primary)

    legacy = _legacy_cache_dir(pdf_hash)
    if legacy.exists() and legacy != primary:
        dirs.append(legacy)

    return dirs


def _canonical_cache_path(pdf_hash: str, page_number: int) -> Path:
    cache_dir = _primary_cache_dir(pdf_hash)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"page_{page_number}_latest.json"


def _page_files(cache_dir: Path, page_number: int) -> list[Path]:
    canonical = cache_dir / f"page_{page_number}_latest.json"
    files: list[Path] = []
    if canonical.exists():
        files.append(canonical)

    others = sorted(
        (
            file_path
            for file_path in cache_dir.glob(f"page_{page_number}_*.json")
            if file_path != canonical
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    files.extend(others)
    return files


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _get_page_record(pdf_hash: str, page_number: int) -> dict | None:
    for cache_dir in _existing_cache_dirs(pdf_hash):
        files = _page_files(cache_dir, page_number)
        if files:
            return _read_json(files[0])
    return None


def _delete_page_files(pdf_hash: str, page_number: int) -> None:
    for cache_dir in _existing_cache_dirs(pdf_hash):
        for file_path in cache_dir.glob(f"page_{page_number}_*.json"):
            file_path.unlink()


def _iter_cached_page_numbers(pdf_hash: str) -> list[int]:
    page_numbers: set[int] = set()
    for cache_dir in _existing_cache_dirs(pdf_hash):
        for file_path in cache_dir.glob("page_*.json"):
            match = PAGE_FILE_RE.match(file_path.name)
            if not match:
                continue
            page_numbers.add(int(match.group(1)))
    return sorted(page_numbers)


def get_cached_result(
    pdf_hash: str, page_number: int, model_name: str, system_prompt: str, user_prompt: str
) -> str | None:
    record = get_cached_record(pdf_hash, page_number, model_name, system_prompt, user_prompt)
    return record["explanation"] if record else None


def get_cached_record(
    pdf_hash: str, page_number: int, model_name: str, system_prompt: str, user_prompt: str
) -> dict | None:
    del model_name, system_prompt, user_prompt
    return _get_page_record(pdf_hash, page_number)


def save_cached_result(
    pdf_hash: str,
    page_number: int,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    explanation: str,
    cost_info: ParseCostInfo | None = None,
) -> None:
    del system_prompt, user_prompt
    _delete_page_files(pdf_hash, page_number)
    path = _canonical_cache_path(pdf_hash, page_number)
    data = {
        "pdf_hash": pdf_hash,
        "page_number": page_number,
        "model_name": model_name,
        "explanation": explanation,
        "cost_info": cost_info.model_dump() if cost_info else None,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def invalidate_cache(pdf_hash: str, page_number: int | None = None) -> int:
    count = 0
    for cache_dir in _existing_cache_dirs(pdf_hash):
        if page_number is not None:
            for file_path in cache_dir.glob(f"page_{page_number}_*.json"):
                file_path.unlink()
                count += 1
            followups_path = cache_dir / FOLLOWUPS_FILE_NAME
            if followups_path.exists():
                data = json.loads(followups_path.read_text(encoding="utf-8"))
                if isinstance(data, dict) and str(page_number) in data:
                    del data[str(page_number)]
                    followups_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            for file_path in cache_dir.glob("page_*.json"):
                file_path.unlink()
                count += 1
            followups_path = cache_dir / FOLLOWUPS_FILE_NAME
            if followups_path.exists():
                followups_path.unlink()
                count += 1
    return count


def save_edited_result(pdf_hash: str, page_number: int, explanation: str) -> None:
    _delete_page_files(pdf_hash, page_number)
    path = _canonical_cache_path(pdf_hash, page_number)
    data = {
        "pdf_hash": pdf_hash,
        "page_number": page_number,
        "model_name": "edited",
        "explanation": explanation,
        "cost_info": None,
        "edited": True,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_full_explanation(pdf_hash: str, page_number: int) -> str | None:
    record = _get_page_record(pdf_hash, page_number)
    return record.get("explanation") if record else None


def get_full_record(pdf_hash: str, page_number: int) -> dict | None:
    return _get_page_record(pdf_hash, page_number)


def get_page_summary(pdf_hash: str, page_number: int) -> str | None:
    record = _get_page_record(pdf_hash, page_number)
    if record is None:
        return None

    explanation = record.get("explanation", "")
    if len(explanation) > 500:
        return explanation[:500] + "..."
    return explanation


def get_all_cached_pages(pdf_hash: str) -> tuple[dict[int, str], dict[int, dict]]:
    results: dict[int, str] = {}
    page_costs: dict[int, dict] = {}

    for page_number in _iter_cached_page_numbers(pdf_hash):
        record = _get_page_record(pdf_hash, page_number)
        if record is None:
            continue
        results[page_number] = record.get("explanation", "")
        if isinstance(record.get("cost_info"), dict):
            page_costs[page_number] = record["cost_info"]

    return results, page_costs


def count_cached_pages(pdf_hash: str) -> int:
    pages, _ = get_all_cached_pages(pdf_hash)
    return len(pages)
