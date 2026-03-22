import logging
import os
from pathlib import Path

from app.core.config import PROJECT_ROOT

LOGS_DIR = PROJECT_ROOT / "logs"


def setup_logging() -> None:
    os.makedirs(LOGS_DIR, exist_ok=True)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # 避免重复添加 handler
    if root_logger.handlers:
        return

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    # 控制台
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(fmt)
    root_logger.addHandler(console)

    # 文件
    file_handler = logging.FileHandler(
        LOGS_DIR / "app.log", encoding="utf-8"
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(fmt)
    root_logger.addHandler(file_handler)
