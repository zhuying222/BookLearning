import logging
import hashlib

from fastapi import APIRouter, HTTPException

from app.core.redaction import redact_sensitive_text
from app.models.parse import (
    FollowUpPagesResponse,
    FollowUpRecord,
    FollowUpRequest,
    FollowUpResponse,
    ParseCostInfo,
    ParsePageRequest,
    ParsePageResponse,
    ParseRangeRequest,
    TaskStatusResponse,
    UpdateFollowUpRequest,
)
from app.services import ai_config_service, cache_service, followup_service, hyperlink_service, task_service
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
    attachment_signature = _build_attachment_signature(req.extra_images_base64)
    cache_prompt = (
        f"{user_prompt}\n\n[extra_images:{attachment_signature}]"
        if attachment_signature
        else user_prompt
    )

    if not req.force:
        cached = cache_service.get_cached_record(
            req.pdf_hash, req.page_number, config.model_name,
            prompt_cfg.system_prompt, cache_prompt,
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
            extra_images_base64=req.extra_images_base64,
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
        prompt_cfg.system_prompt, cache_prompt, explanation,
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


@router.post("/follow-up", response_model=FollowUpResponse)
async def follow_up_page(req: FollowUpRequest):
    config = (
        ai_config_service.get_config(req.config_id)
        if req.config_id
        else ai_config_service.get_default_config()
    )
    if config is None:
        raise HTTPException(status_code=400, detail="No AI config available. Please add one in AI Config panel.")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    context_summary = _build_context_for_page(req.pdf_hash, req.page_number)
    if req.current_explanation.strip():
        extra_system_prompt = (
            "当前页面已经有一份基础讲解。你现在处于追问模式。\n"
            "请优先回答用户这一次追问，不要整页重写。\n"
            "如果已有讲解与图片内容冲突，以图片内容为准并直接指出修正。\n"
            f"当前页已有讲解如下：\n{req.current_explanation.strip()}"
        )
    else:
        extra_system_prompt = (
            "当前页面还没有基础讲解。你现在处于直接提问模式。\n"
            "请根据当前页图片直接回答用户问题，必要时自行补足背景说明。\n"
            "不要假设已有讲解存在。"
        )
    user_text = (
        f"请结合当前页图片和已有讲解，回答这次追问：\n{req.question.strip()}"
        if req.current_explanation.strip()
        else f"请根据当前页图片直接回答这个问题：\n{req.question.strip()}"
    )

    try:
        answer, cost_info = await call_vision_model(
            config=config,
            image_base64=req.image_base64,
            extra_images_base64=req.extra_images_base64,
            context_summary=context_summary,
            extra_system_prompt=extra_system_prompt,
            user_text_override=user_text,
        )
    except Exception as e:
        sanitized_error = redact_sensitive_text(str(e))
        logger.exception("Follow-up failed for pdf=%s page=%d", req.pdf_hash[:8], req.page_number)
        log_activity(
            "follow_up_failed",
            {"pdf_hash": req.pdf_hash[:8], "page": req.page_number, "error": sanitized_error},
        )
        raise HTTPException(status_code=502, detail=f"AI service error: {sanitized_error}") from e

    record = followup_service.add_followup(req.pdf_hash, req.page_number, req.question.strip(), answer)
    logger.info("Follow-up completed for pdf=%s page=%d", req.pdf_hash[:8], req.page_number)
    log_activity("follow_up", {"pdf_hash": req.pdf_hash[:8], "page": req.page_number, "model": config.model_name})
    return FollowUpResponse(
        pdf_hash=req.pdf_hash,
        page_number=req.page_number,
        follow_up=FollowUpRecord(**record),
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


@router.get("/follow-up/{pdf_hash}", response_model=FollowUpPagesResponse)
async def get_all_followups(pdf_hash: str):
    pages = {
        page_number: [FollowUpRecord(**record) for record in records]
        for page_number, records in followup_service.get_followups_for_pdf(pdf_hash).items()
    }
    return FollowUpPagesResponse(pdf_hash=pdf_hash, pages=pages)


@router.put("/follow-up/{pdf_hash}/{page_number}/{followup_id}", response_model=FollowUpRecord)
async def update_followup(pdf_hash: str, page_number: int, followup_id: str, body: UpdateFollowUpRequest):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    if not body.answer.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty")
    try:
        updated = followup_service.update_followup(
            pdf_hash,
            page_number,
            followup_id,
            body.question.strip(),
            body.answer.strip(),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Follow-up not found") from exc
    return FollowUpRecord(**updated)


@router.delete("/follow-up/{pdf_hash}/{page_number}/{followup_id}")
async def delete_followup(pdf_hash: str, page_number: int, followup_id: str):
    deleted = followup_service.delete_followup(pdf_hash, page_number, followup_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    hyperlink_service.delete_hyperlinks_for_target(pdf_hash, page_number, "followup", followup_id)
    return {"ok": True, "pdf_hash": pdf_hash, "page_number": page_number, "followup_id": followup_id}


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


def _build_attachment_signature(images_base64: list[str]) -> str | None:
    if not images_base64:
        return None

    digest = hashlib.sha256()
    for image_base64 in images_base64:
        digest.update(hashlib.sha256(image_base64.encode("utf-8")).digest())
    return digest.hexdigest()[:16]
