import hashlib
import json
from pathlib import Path

from app.core.config import settings
from app.models.parse import ParseCostInfo


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


def _cache_key(pdf_hash: str, page_number: int, model_name: str, prompt_hash: str) -> Path:
    dir_path = _primary_cache_dir(pdf_hash)
    dir_path.mkdir(parents=True, exist_ok=True)
    safe_model = model_name.replace("/", "_").replace("\\", "_")
    filename = f"page_{page_number}_{safe_model}_{prompt_hash}.json"
    return dir_path / filename


def _hash_prompt(system_prompt: str, user_prompt: str) -> str:
    combined = f"{system_prompt}|{user_prompt}"
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def get_cached_result(
    pdf_hash: str, page_number: int, model_name: str, system_prompt: str, user_prompt: str
) -> str | None:
    record = get_cached_record(pdf_hash, page_number, model_name, system_prompt, user_prompt)
    return record["explanation"] if record else None


def get_cached_record(
    pdf_hash: str, page_number: int, model_name: str, system_prompt: str, user_prompt: str
) -> dict | None:
    prompt_hash = _hash_prompt(system_prompt, user_prompt)
    safe_model = model_name.replace("/", "_").replace("\\", "_")
    filename = f"page_{page_number}_{safe_model}_{prompt_hash}.json"

    primary = _primary_cache_dir(pdf_hash) / filename
    if primary.exists():
        return json.loads(primary.read_text(encoding="utf-8"))

    legacy = _legacy_cache_dir(pdf_hash) / filename
    if legacy.exists():
        return json.loads(legacy.read_text(encoding="utf-8"))

    return None


def save_cached_result(
    pdf_hash: str,
    page_number: int,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    explanation: str,
    cost_info: ParseCostInfo | None = None,
) -> None:
    prompt_hash = _hash_prompt(system_prompt, user_prompt)
    path = _cache_key(pdf_hash, page_number, model_name, prompt_hash)
    data = {
        "pdf_hash": pdf_hash,
        "page_number": page_number,
        "model_name": model_name,
        "prompt_hash": prompt_hash,
        "explanation": explanation,
        "cost_info": cost_info.model_dump() if cost_info else None,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def invalidate_cache(pdf_hash: str, page_number: int | None = None) -> int:
    count = 0
    for cache_dir in _existing_cache_dirs(pdf_hash):
        if page_number is not None:
            for f in cache_dir.glob(f"page_{page_number}_*.json"):
                f.unlink()
                count += 1
        else:
            for f in cache_dir.glob("*.json"):
                f.unlink()
                count += 1
    return count


def save_edited_result(pdf_hash: str, page_number: int, explanation: str) -> None:
    """保存用户手动编辑的讲解结果，覆盖该页所有缓存版本。"""
    cache_dir = _primary_cache_dir(pdf_hash)
    cache_dir.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for existing_dir in _existing_cache_dirs(pdf_hash):
        files.extend(existing_dir.glob(f"page_{page_number}_*.json"))
    if files:
        for f in files:
            data = json.loads(f.read_text(encoding="utf-8"))
            data["explanation"] = explanation
            data["edited"] = True
            f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        path = cache_dir / f"page_{page_number}_edited_manual.json"
        data = {
            "pdf_hash": pdf_hash,
            "page_number": page_number,
            "model_name": "edited",
            "prompt_hash": "manual",
            "explanation": explanation,
            "edited": True,
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_full_explanation(pdf_hash: str, page_number: int) -> str | None:
    """获取某页的完整讲解结果（不截断）。"""
    for cache_dir in _existing_cache_dirs(pdf_hash):
        for f in cache_dir.glob(f"page_{page_number}_*.json"):
            data = json.loads(f.read_text(encoding="utf-8"))
            return data.get("explanation")
    return None


def get_full_record(pdf_hash: str, page_number: int) -> dict | None:
    for cache_dir in _existing_cache_dirs(pdf_hash):
        for f in cache_dir.glob(f"page_{page_number}_*.json"):
            return json.loads(f.read_text(encoding="utf-8"))
    return None


def get_page_summary(pdf_hash: str, page_number: int) -> str | None:
    """获取某页的任意已缓存讲解结果（用于上下文连贯）。"""
    for cache_dir in _existing_cache_dirs(pdf_hash):
        for f in cache_dir.glob(f"page_{page_number}_*.json"):
            data = json.loads(f.read_text(encoding="utf-8"))
            explanation = data.get("explanation", "")
            if len(explanation) > 500:
                return explanation[:500] + "..."
            return explanation
    return None


def get_all_cached_pages(pdf_hash: str) -> tuple[dict[int, str], dict[int, dict]]:
    results: dict[int, str] = {}
    page_costs: dict[int, dict] = {}

    for cache_dir in _existing_cache_dirs(pdf_hash):
        for file_path in sorted(cache_dir.glob("page_*.json")):
            data = json.loads(file_path.read_text(encoding="utf-8"))
            page_num = data.get("page_number")
            if page_num is None or page_num in results:
                continue
            results[page_num] = data.get("explanation", "")
            if isinstance(data.get("cost_info"), dict):
                page_costs[page_num] = data["cost_info"]

    return results, page_costs


def count_cached_pages(pdf_hash: str) -> int:
    pages, _ = get_all_cached_pages(pdf_hash)
    return len(pages)
