from pydantic import BaseModel


class ParsePageRequest(BaseModel):
    pdf_hash: str
    page_number: int
    image_base64: str
    config_id: str | None = None
    page_prompt: str | None = None
    force: bool = False


class ParseRangeRequest(BaseModel):
    pdf_hash: str
    pages: list[int]
    images_base64: dict[int, str]
    config_id: str | None = None
    page_prompts: dict[int, str] | None = None
    force: bool = False


class ParsePageResponse(BaseModel):
    pdf_hash: str
    page_number: int
    explanation: str
    model_name: str
    cached: bool = False


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, running, paused, completed, cancelled, failed
    total_pages: int
    completed_pages: int
    current_page: int | None = None
    results: dict[int, str] = {}
    error: str | None = None
