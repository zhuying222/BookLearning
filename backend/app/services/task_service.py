import asyncio
import logging
import uuid

from app.core.redaction import redact_sensitive_text
from app.models.ai_config import AiConfig
from app.services.activity_service import log_activity
from app.services.ai_service import call_vision_model
from app.services.cache_service import get_cached_result, get_page_summary, save_cached_result
from app.services.prompt_service import get_prompt_config

logger = logging.getLogger(__name__)


class ParseTask:
    def __init__(
        self,
        pdf_hash: str,
        pages: list[int],
        images_base64: dict[int, str],
        config: AiConfig,
        page_prompts: dict[int, str] | None = None,
        force: bool = False,
        context_pages: int = 2,
    ):
        self.task_id = uuid.uuid4().hex[:12]
        self.pdf_hash = pdf_hash
        self.pages = pages
        self.images_base64 = images_base64
        self.config = config
        self.page_prompts = page_prompts or {}
        self.force = force
        self.context_pages = context_pages

        self.status = "pending"
        self.completed_pages = 0
        self.current_page: int | None = None
        self.results: dict[int, str] = {}
        self.error: str | None = None

        self._cancel_event = asyncio.Event()
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # not paused initially
        self._task: asyncio.Task | None = None

    @property
    def total_pages(self) -> int:
        return len(self.pages)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "total_pages": self.total_pages,
            "completed_pages": self.completed_pages,
            "current_page": self.current_page,
            "results": self.results,
            "error": self.error,
        }

    async def run(self) -> None:
        self.status = "running"
        logger.info("Task %s started: %d pages, pdf=%s", self.task_id, self.total_pages, self.pdf_hash[:8])
        log_activity("task_started", {"task_id": self.task_id, "pdf_hash": self.pdf_hash[:8], "pages": self.total_pages})
        prompt_config = get_prompt_config()

        try:
            for page_num in self.pages:
                if self._cancel_event.is_set():
                    self.status = "cancelled"
                    log_activity("task_cancelled", {"task_id": self.task_id, "pdf_hash": self.pdf_hash[:8]})
                    return

                await self._pause_event.wait()

                self.current_page = page_num
                user_prompt = self.page_prompts.get(page_num, prompt_config.user_prompt_template)

                if not self.force:
                    cached = get_cached_result(
                        self.pdf_hash,
                        page_num,
                        self.config.model_name,
                        prompt_config.system_prompt,
                        user_prompt,
                    )
                    if cached is not None:
                        self.results[page_num] = cached
                        self.completed_pages += 1
                        continue

                context_summary = self._build_context(page_num)

                image_b64 = self.images_base64.get(page_num, "")
                if not image_b64:
                    self.results[page_num] = "[错误] 未提供该页图像"
                    self.completed_pages += 1
                    continue

                explanation = await call_vision_model(
                    config=self.config,
                    image_base64=image_b64,
                    page_prompt=user_prompt if user_prompt != prompt_config.user_prompt_template else None,
                    context_summary=context_summary,
                )

                save_cached_result(
                    self.pdf_hash,
                    page_num,
                    self.config.model_name,
                    prompt_config.system_prompt,
                    user_prompt,
                    explanation,
                )

                self.results[page_num] = explanation
                self.completed_pages += 1

            self.status = "completed"
            logger.info("Task %s completed: %d/%d pages", self.task_id, self.completed_pages, self.total_pages)
            log_activity(
                "task_completed",
                {
                    "task_id": self.task_id,
                    "pdf_hash": self.pdf_hash[:8],
                    "completed_pages": self.completed_pages,
                    "total_pages": self.total_pages,
                },
            )
        except Exception as e:
            self.status = "failed"
            sanitized_error = redact_sensitive_text(str(e))
            self.error = sanitized_error
            logger.exception("Task %s failed", self.task_id)
            log_activity(
                "task_failed",
                {
                    "task_id": self.task_id,
                    "pdf_hash": self.pdf_hash[:8],
                    "error": sanitized_error,
                },
            )

    def _build_context(self, current_page: int) -> str | None:
        summaries = []
        for offset in range(self.context_pages, 0, -1):
            prev_page = current_page - offset
            if prev_page < 1:
                continue
            if prev_page in self.results:
                text = self.results[prev_page]
                if len(text) > 300:
                    text = text[:300] + "..."
                summaries.append(f"第{prev_page}页：{text}")
            else:
                cached = get_page_summary(self.pdf_hash, prev_page)
                if cached:
                    summaries.append(f"第{prev_page}页：{cached}")
        return "\n".join(summaries) if summaries else None

    def pause(self) -> None:
        self._pause_event.clear()
        if self.status == "running":
            self.status = "paused"

    def resume(self) -> None:
        self._pause_event.set()
        if self.status == "paused":
            self.status = "running"

    def cancel(self) -> None:
        self._cancel_event.set()
        self._pause_event.set()  # unblock if paused


_tasks: dict[str, ParseTask] = {}


def create_task(
    pdf_hash: str,
    pages: list[int],
    images_base64: dict[int, str],
    config: AiConfig,
    page_prompts: dict[int, str] | None = None,
    force: bool = False,
) -> ParseTask:
    task = ParseTask(
        pdf_hash=pdf_hash,
        pages=pages,
        images_base64=images_base64,
        config=config,
        page_prompts=page_prompts,
        force=force,
    )
    _tasks[task.task_id] = task
    task._task = asyncio.create_task(task.run())
    return task


def get_task(task_id: str) -> ParseTask | None:
    return _tasks.get(task_id)


def list_tasks() -> list[dict]:
    return [t.to_dict() for t in _tasks.values()]
