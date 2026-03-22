from pydantic import BaseModel, Field
import uuid


class AiConfig(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    base_url: str
    api_key: str
    model_name: str
    max_tokens: int = 4096
    temperature: float = 0.7
    is_default: bool = False


class AiConfigCreate(BaseModel):
    name: str
    base_url: str
    api_key: str
    model_name: str
    max_tokens: int = 4096
    temperature: float = 0.7
    is_default: bool = False


class AiConfigUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model_name: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    is_default: bool | None = None
