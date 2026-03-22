import json
from pathlib import Path

from app.core.config import settings
from app.models.ai_config import AiConfig, AiConfigCreate, AiConfigUpdate


def _load_configs() -> list[AiConfig]:
    path = Path(settings.ai_configs_path)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [AiConfig(**item) for item in data]


def _save_configs(configs: list[AiConfig]) -> None:
    path = Path(settings.ai_configs_path)
    path.write_text(
        json.dumps([c.model_dump() for c in configs], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_configs() -> list[AiConfig]:
    return _load_configs()


def get_config(config_id: str) -> AiConfig | None:
    for c in _load_configs():
        if c.id == config_id:
            return c
    return None


def get_default_config() -> AiConfig | None:
    configs = _load_configs()
    for c in configs:
        if c.is_default:
            return c
    return configs[0] if configs else None


def create_config(data: AiConfigCreate) -> AiConfig:
    configs = _load_configs()
    new_config = AiConfig(**data.model_dump())
    if new_config.is_default:
        for c in configs:
            c.is_default = False
    configs.append(new_config)
    _save_configs(configs)
    return new_config


def update_config(config_id: str, data: AiConfigUpdate) -> AiConfig | None:
    configs = _load_configs()
    target = None
    for c in configs:
        if c.id == config_id:
            target = c
            break
    if target is None:
        return None

    update_data = data.model_dump(exclude_none=True)
    if update_data.get("is_default"):
        for c in configs:
            c.is_default = False

    updated = target.model_copy(update=update_data)
    configs = [updated if c.id == config_id else c for c in configs]
    _save_configs(configs)
    return updated


def delete_config(config_id: str) -> bool:
    configs = _load_configs()
    new_configs = [c for c in configs if c.id != config_id]
    if len(new_configs) == len(configs):
        return False
    _save_configs(new_configs)
    return True
