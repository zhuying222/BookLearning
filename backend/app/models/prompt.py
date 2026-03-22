from pydantic import BaseModel, Field

DEFAULT_SYSTEM_PROMPT = (
    "你是一个专业的学术讲解助手。用户会给你一页 PDF 的截图，"
    "请你详细讲解这一页的内容，包括关键概念、公式推导、图表含义等。"
    "使用中文回答，条理清晰，适合学习者理解。"
)

DEFAULT_USER_TEMPLATE = "请讲解这一页 PDF 的内容。"


class PromptConfig(BaseModel):
    system_prompt: str = Field(default=DEFAULT_SYSTEM_PROMPT)
    user_prompt_template: str = Field(default=DEFAULT_USER_TEMPLATE)


class PromptConfigUpdate(BaseModel):
    system_prompt: str | None = None
    user_prompt_template: str | None = None
