from fastapi import APIRouter, HTTPException

from app.models.ai_config import AiConfig, AiConfigCreate, AiConfigUpdate
from app.services import ai_config_service

router = APIRouter(prefix="/ai-configs", tags=["AI Config"])


@router.get("/", response_model=list[AiConfig])
def list_configs():
    return ai_config_service.list_configs()


@router.get("/default", response_model=AiConfig)
def get_default():
    config = ai_config_service.get_default_config()
    if config is None:
        raise HTTPException(status_code=404, detail="No AI config found. Please create one first.")
    return config


@router.get("/{config_id}", response_model=AiConfig)
def get_config(config_id: str):
    config = ai_config_service.get_config(config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found")
    return config


@router.post("/", response_model=AiConfig, status_code=201)
def create_config(data: AiConfigCreate):
    return ai_config_service.create_config(data)


@router.put("/{config_id}", response_model=AiConfig)
def update_config(config_id: str, data: AiConfigUpdate):
    config = ai_config_service.update_config(config_id, data)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found")
    return config


@router.delete("/{config_id}")
def delete_config(config_id: str):
    if not ai_config_service.delete_config(config_id):
        raise HTTPException(status_code=404, detail="Config not found")
    return {"ok": True}
