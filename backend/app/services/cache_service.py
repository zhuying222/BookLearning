import hashlib
import json
from pathlib import Path

from app.core.config import settings


def _cache_key(pdf_hash: str, page_number: int, model_name: str, prompt_hash: str) -> Path:
    dir_path = Path(settings.cache_dir) / pdf_hash
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
    prompt_hash = _hash_prompt(system_prompt, user_prompt)
    path = _cache_key(pdf_hash, page_number, model_name, prompt_hash)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("explanation")


def save_cached_result(
    pdf_hash: str,
    page_number: int,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    explanation: str,
) -> None:
    prompt_hash = _hash_prompt(system_prompt, user_prompt)
    path = _cache_key(pdf_hash, page_number, model_name, prompt_hash)
    data = {
        "pdf_hash": pdf_hash,
        "page_number": page_number,
        "model_name": model_name,
        "prompt_hash": prompt_hash,
        "explanation": explanation,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def invalidate_cache(pdf_hash: str, page_number: int | None = None) -> int:
    cache_dir = Path(settings.cache_dir) / pdf_hash
    if not cache_dir.exists():
        return 0
    count = 0
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
    cache_dir = Path(settings.cache_dir) / pdf_hash
    cache_dir.mkdir(parents=True, exist_ok=True)
    files = list(cache_dir.glob(f"page_{page_number}_*.json"))
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
    cache_dir = Path(settings.cache_dir) / pdf_hash
    if not cache_dir.exists():
        return None
    for f in cache_dir.glob(f"page_{page_number}_*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        return data.get("explanation")
    return None


def get_page_summary(pdf_hash: str, page_number: int) -> str | None:
    """获取某页的任意已缓存讲解结果（用于上下文连贯）。"""
    cache_dir = Path(settings.cache_dir) / pdf_hash
    if not cache_dir.exists():
        return None
    for f in cache_dir.glob(f"page_{page_number}_*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        explanation = data.get("explanation", "")
        if len(explanation) > 500:
            return explanation[:500] + "..."
        return explanation
    return None
