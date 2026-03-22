import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = PROJECT_ROOT / "data"


EXPORTS_DIR = PROJECT_ROOT / "exports"
LOGS_DIR = PROJECT_ROOT / "logs"


@dataclass(frozen=True)
class AppConfig:
    app_name: str = "BookLearning API"
    app_version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    data_dir: str = str(DATA_DIR)
    cache_dir: str = str(DATA_DIR / "cache")
    ai_configs_path: str = str(DATA_DIR / "ai_configs.json")
    prompts_path: str = str(DATA_DIR / "prompts.json")
    activity_log_path: str = str(DATA_DIR / "activity_log.jsonl")
    exports_dir: str = str(EXPORTS_DIR)
    logs_dir: str = str(LOGS_DIR)


settings = AppConfig()

os.makedirs(settings.data_dir, exist_ok=True)
os.makedirs(settings.cache_dir, exist_ok=True)
os.makedirs(settings.exports_dir, exist_ok=True)
os.makedirs(settings.logs_dir, exist_ok=True)

