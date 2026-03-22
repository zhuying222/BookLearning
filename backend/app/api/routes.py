from fastapi import APIRouter

from app.core.config import settings
from app.schemas.bootstrap import BootstrapResponse

router = APIRouter()


@router.get("/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
    }


@router.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap() -> BootstrapResponse:
    return BootstrapResponse(
        app_name=settings.app_name,
        version=settings.app_version,
        frontend_stack="React + TypeScript + Vite",
        backend_stack="FastAPI + Python 3.12",
        next_focus=[
            "Add automated smoke tests for parse and export flows",
            "Package the local launcher and release checklist",
            "Explore OCR support for scanned PDFs",
        ],
    )
