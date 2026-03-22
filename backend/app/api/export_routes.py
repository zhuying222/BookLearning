import io
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.redaction import redact_sensitive_text
from app.models.export import ExportPdfRequest
from app.services.activity_service import get_recent_activities
from app.services.activity_service import log_activity
from app.services.pdf_export_service import generate_study_pdf

router = APIRouter(tags=["Activity"])


@router.get("/activity-log")
async def list_activities(limit: int = 50):
    return get_recent_activities(limit=limit)


@router.post("/export/pdf")
async def export_pdf(req: ExportPdfRequest):
    try:
        pdf_bytes, filename = generate_study_pdf(
            pdf_file_name=req.pdf_file_name,
            pages=req.pages,
            page_images_base64=req.page_images_base64,
            explanations=req.explanations,
        )
    except ValueError as exc:
        log_activity(
            "export_pdf_failed",
            {"file": req.pdf_file_name, "pages": len(req.pages), "error": redact_sensitive_text(str(exc))},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        sanitized_error = redact_sensitive_text(str(exc))
        log_activity(
            "export_pdf_failed",
            {"file": req.pdf_file_name, "pages": len(req.pages), "error": sanitized_error},
        )
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {sanitized_error}") from exc

    log_activity(
        "export_pdf",
        {"file": req.pdf_file_name, "pages": len(req.pages)},
    )

    ascii_fallback = "BookLearning-export.pdf"
    content_disposition = (
        f'attachment; filename="{ascii_fallback}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": content_disposition},
    )
