import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.api.ai_config_routes import router as ai_config_router
from app.api.prompt_routes import router as prompt_router
from app.api.parse_routes import router as parse_router
from app.api.export_routes import router as export_router
from app.api.document_routes import router as document_router
from app.api.annotation_routes import router as annotation_router
from app.core.config import settings
from app.core.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. See backend logs for details."},
        headers=headers,
    )


app.include_router(router, prefix=settings.api_prefix)
app.include_router(ai_config_router, prefix=settings.api_prefix)
app.include_router(prompt_router, prefix=settings.api_prefix)
app.include_router(parse_router, prefix=settings.api_prefix)
app.include_router(export_router, prefix=settings.api_prefix)
app.include_router(document_router, prefix=settings.api_prefix)
app.include_router(annotation_router, prefix=settings.api_prefix)
