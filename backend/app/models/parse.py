from pydantic import BaseModel


class ParseCostInfo(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cost_amount: float | None = None
    cost_unit: str | None = None
    cost_display: str | None = None


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
    cost_info: ParseCostInfo | None = None


class FollowUpRecord(BaseModel):
    id: str
    question: str
    answer: str
    created_at: str
    updated_at: str


class FollowUpRequest(BaseModel):
    pdf_hash: str
    page_number: int
    image_base64: str
    question: str
    current_explanation: str
    config_id: str | None = None


class FollowUpResponse(BaseModel):
    pdf_hash: str
    page_number: int
    follow_up: FollowUpRecord
    model_name: str
    cost_info: ParseCostInfo | None = None


class UpdateFollowUpRequest(BaseModel):
    question: str
    answer: str


class FollowUpPagesResponse(BaseModel):
    pdf_hash: str
    pages: dict[int, list[FollowUpRecord]] = {}


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str  # pending, running, paused, completed, cancelled, failed
    total_pages: int
    completed_pages: int
    current_page: int | None = None
    results: dict[int, str] = {}
    page_costs: dict[int, ParseCostInfo] = {}
    error: str | None = None
