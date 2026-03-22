import json
from pathlib import Path

from app.core.config import settings
from app.models.prompt import PromptConfig, PromptConfigUpdate


def _load_prompt_config() -> PromptConfig:
    path = Path(settings.prompts_path)
    if not path.exists():
        return PromptConfig()
    data = json.loads(path.read_text(encoding="utf-8"))
    return PromptConfig(**data)


def _save_prompt_config(config: PromptConfig) -> None:
    path = Path(settings.prompts_path)
    path.write_text(
        json.dumps(config.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_prompt_config() -> PromptConfig:
    return _load_prompt_config()


def update_prompt_config(data: PromptConfigUpdate) -> PromptConfig:
    config = _load_prompt_config()
    update_data = data.model_dump(exclude_none=True)
    updated = config.model_copy(update=update_data)
    _save_prompt_config(updated)
    return updated


def reset_prompt_config() -> PromptConfig:
    config = PromptConfig()
    _save_prompt_config(config)
    return config
