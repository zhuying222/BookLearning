import logging

from fastapi import APIRouter, HTTPException

from app.core.redaction import redact_sensitive_text
from app.models.parse import ParseCostInfo, ParsePageRequest, ParsePageResponse, ParseRangeRequest, TaskStatusResponse
from app.services import ai_config_service, cache_service, task_service
from app.services.activity_service import log_activity
from app.services.ai_service import call_vision_model
from app.services.prompt_service import get_prompt_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/parse", tags=["Parse"])


@router.post("/page", response_model=ParsePageResponse)
async def parse_single_page(req: ParsePageRequest):
    config = (
        ai_config_service.get_config(req.config_id)
        if req.config_id
        else ai_config_service.get_default_config()
    )
    if config is None:
        raise HTTPException(status_code=400, detail="No AI config available. Please add one in AI Config panel.")

    prompt_cfg = get_prompt_config()
    user_prompt = req.page_prompt or prompt_cfg.user_prompt_template

    if not req.force:
        cached = cache_service.get_cached_record(
            req.pdf_hash, req.page_number, config.model_name,
            prompt_cfg.system_prompt, user_prompt,
        )
        if cached is not None:
            cost_info = cached.get("cost_info")
            return ParsePageResponse(
                pdf_hash=req.pdf_hash,
                page_number=req.page_number,
                explanation=cached.get("explanation", ""),
                model_name=config.model_name,
                cached=True,
                cost_info=ParseCostInfo(**cost_info) if isinstance(cost_info, dict) else None,
            )

    context_summary = _build_context_for_page(req.pdf_hash, req.page_number)

    try:
        explanation, cost_info = await call_vision_model(
            config=config,
            image_base64=req.image_base64,
            page_prompt=req.page_prompt,
            context_summary=context_summary,
        )
    except Exception as e:
        sanitized_error = redact_sensitive_text(str(e))
        logger.exception("Parse page failed for pdf=%s page=%d", req.pdf_hash[:8], req.page_number)
        log_activity(
            "parse_page_failed",
            {"pdf_hash": req.pdf_hash[:8], "page": req.page_number, "error": sanitized_error},
        )
        raise HTTPException(status_code=502, detail=f"AI service error: {sanitized_error}") from e

    cache_service.save_cached_result(
        req.pdf_hash, req.page_number, config.model_name,
        prompt_cfg.system_prompt, user_prompt, explanation,
        ParseCostInfo(**cost_info.__dict__) if cost_info else None,
    )

    logger.info("Parsed page %d for pdf=%s (model=%s)", req.page_number, req.pdf_hash[:8], config.model_name)
    log_activity("parse_page", {"pdf_hash": req.pdf_hash[:8], "page": req.page_number, "model": config.model_name})
    return ParsePageResponse(
        pdf_hash=req.pdf_hash,
        page_number=req.page_number,
        explanation=explanation,
        model_name=config.model_name,
        cost_info=ParseCostInfo(**cost_info.__dict__) if cost_info else None,
    )


@router.post("/range", response_model=TaskStatusResponse)
async def parse_range(req: ParseRangeRequest):
    config = (
        ai_config_service.get_config(req.config_id)
        if req.config_id
        else ai_config_service.get_default_config()
    )
    if config is None:
        raise HTTPException(status_code=400, detail="No AI config available")

    task = task_service.create_task(
        pdf_hash=req.pdf_hash,
        pages=req.pages,
        images_base64=req.images_base64,
        config=config,
        page_prompts=req.page_prompts,
        force=req.force,
    )

    logger.info("Range task created: id=%s pages=%d pdf=%s", task.task_id, len(req.pages), req.pdf_hash[:8])
    log_activity("parse_range", {"pdf_hash": req.pdf_hash[:8], "pages": len(req.pages), "task_id": task.task_id})
    return TaskStatusResponse(**task.to_dict())


@router.get("/task/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    task = task_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskStatusResponse(**task.to_dict())


@router.post("/task/{task_id}/pause")
async def pause_task(task_id: str):
    task = task_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.pause()
    return {"ok": True, "status": task.status}


@router.post("/task/{task_id}/resume")
async def resume_task(task_id: str):
    task = task_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.resume()
    return {"ok": True, "status": task.status}


@router.post("/task/{task_id}/cancel")
async def cancel_task(task_id: str):
    task = task_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.cancel()
    return {"ok": True, "status": task.status}


@router.get("/tasks")
async def list_tasks():
    return task_service.list_tasks()


@router.get("/cache/{pdf_hash}/{page_number}")
async def get_cached(pdf_hash: str, page_number: int):
    result = cache_service.get_full_record(pdf_hash, page_number)
    if result is None:
        raise HTTPException(status_code=404, detail="No cached result")
    return {
        "pdf_hash": pdf_hash,
        "page_number": page_number,
        "explanation": result.get("explanation"),
        "cost_info": result.get("cost_info"),
    }


@router.put("/cache/{pdf_hash}/{page_number}")
async def save_edited(pdf_hash: str, page_number: int, body: dict):
    explanation = body.get("explanation", "")
    if not explanation.strip():
        raise HTTPException(status_code=400, detail="Explanation cannot be empty")
    cache_service.save_edited_result(pdf_hash, page_number, explanation)
    return {"ok": True, "pdf_hash": pdf_hash, "page_number": page_number}


@router.get("/cache/{pdf_hash}")
async def get_all_cached(pdf_hash: str):
    results, page_costs = cache_service.get_all_cached_pages(pdf_hash)
    return {"pdf_hash": pdf_hash, "pages": results, "page_costs": page_costs}


def _build_context_for_page(pdf_hash: str, page_number: int, context_pages: int = 2) -> str | None:
    summaries = []
    for offset in range(context_pages, 0, -1):
        prev_page = page_number - offset
        if prev_page < 1:
            continue
        cached = cache_service.get_page_summary(pdf_hash, prev_page)
        if cached:
            summaries.append(f"第{prev_page}页：{cached}")
    return "\n".join(summaries) if summaries else None
