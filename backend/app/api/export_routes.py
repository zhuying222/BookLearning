import io
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.redaction import redact_sensitive_text
from app.models.export import (
    ExportPdfChunkRequest,
    ExportPdfRequest,
    ExportPdfSessionCreateRequest,
    ExportPdfSessionCreateResponse,
)
from app.services.activity_service import get_recent_activities
from app.services.activity_service import log_activity
from app.services.pdf_export_service import (
    append_pdf_export_chunk,
    create_pdf_export_session,
    finalize_pdf_export_session,
    generate_study_pdf,
)

router = APIRouter(tags=["Activity"])


@router.get("/activity-log")
async def list_activities(limit: int = 50):
    return get_recent_activities(limit=limit)


@router.post("/export/pdf/session", response_model=ExportPdfSessionCreateResponse)
async def create_export_pdf_session(req: ExportPdfSessionCreateRequest):
    try:
        session_id = create_pdf_export_session(req.pdf_file_name)
    except Exception as exc:
        sanitized_error = redact_sensitive_text(str(exc))
        log_activity(
            "export_pdf_session_failed",
            {"file": req.pdf_file_name, "error": sanitized_error},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create export session: {sanitized_error}",
        ) from exc

    log_activity("export_pdf_session_created", {"file": req.pdf_file_name})
    return ExportPdfSessionCreateResponse(session_id=session_id)


@router.post("/export/pdf/session/{session_id}/chunk")
async def upload_export_pdf_chunk(session_id: str, req: ExportPdfChunkRequest):
    try:
        sheet_count = append_pdf_export_chunk(
            session_id=session_id,
            chunk_index=req.chunk_index,
            sheet_images_base64=req.sheet_images_base64,
            sheet_page_sizes=req.sheet_page_sizes,
        )
    except ValueError as exc:
        log_activity(
            "export_pdf_chunk_failed",
            {"session": session_id, "chunk": req.chunk_index, "error": redact_sensitive_text(str(exc))},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        sanitized_error = redact_sensitive_text(str(exc))
        log_activity(
            "export_pdf_chunk_failed",
            {"session": session_id, "chunk": req.chunk_index, "error": sanitized_error},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload export chunk: {sanitized_error}",
        ) from exc

    return {"ok": True, "sheet_count": sheet_count}


@router.post("/export/pdf/session/{session_id}/finalize")
async def finalize_export_pdf_session(session_id: str):
    try:
        pdf_bytes, filename, sheet_count = finalize_pdf_export_session(session_id)
    except ValueError as exc:
        log_activity(
            "export_pdf_finalize_failed",
            {"session": session_id, "error": redact_sensitive_text(str(exc))},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        sanitized_error = redact_sensitive_text(str(exc))
        log_activity(
            "export_pdf_finalize_failed",
            {"session": session_id, "error": sanitized_error},
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to finalize PDF export: {sanitized_error}",
        ) from exc

    log_activity(
        "export_pdf_finalize",
        {"session": session_id, "sheets": sheet_count},
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


@router.post("/export/pdf")
async def export_pdf(req: ExportPdfRequest):
    try:
        pdf_bytes, filename = generate_study_pdf(
            pdf_file_name=req.pdf_file_name,
            pages=req.pages,
            page_images_base64=req.page_images_base64,
            explanations=req.explanations,
            sheet_images_base64=req.sheet_images_base64,
            sheet_page_sizes=req.sheet_page_sizes,
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
