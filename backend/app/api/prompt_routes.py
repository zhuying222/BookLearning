from fastapi import APIRouter

from app.models.prompt import PromptConfig, PromptConfigUpdate
from app.services import prompt_service

router = APIRouter(prefix="/prompts", tags=["Prompts"])


@router.get("/", response_model=PromptConfig)
def get_prompts():
    return prompt_service.get_prompt_config()


@router.put("/", response_model=PromptConfig)
def update_prompts(data: PromptConfigUpdate):
    return prompt_service.update_prompt_config(data)


@router.post("/reset", response_model=PromptConfig)
def reset_prompts():
    return prompt_service.reset_prompt_config()
