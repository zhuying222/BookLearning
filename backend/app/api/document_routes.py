from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.models.document import DocumentImportResponse, DocumentProgressUpdate, DocumentSummary
from app.services import document_service

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.get("/", response_model=list[DocumentSummary])
def list_documents():
    return document_service.list_documents()


@router.post("/import", response_model=DocumentImportResponse, status_code=201)
async def import_document(file: UploadFile = File(...)):
    try:
        document, created = await document_service.import_uploaded_document(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import PDF: {exc}") from exc

    return DocumentImportResponse(created=created, document=document)


@router.get("/{document_id}", response_model=DocumentSummary)
def get_document(document_id: str):
    document = document_service.get_document_summary(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.get("/{document_id}/file")
def get_document_file(document_id: str):
    try:
        result = document_service.get_document_file(document_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")

    document, file_path = result
    document_service.mark_document_opened(document_id)
    return FileResponse(path=file_path, media_type="application/pdf", filename=document.original_file_name)


@router.patch("/{document_id}/progress", response_model=DocumentSummary)
def update_progress(document_id: str, body: DocumentProgressUpdate):
    document = document_service.update_reading_progress(document_id, body.last_read_page)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.delete("/{document_id}")
def delete_document(document_id: str, remove_cache: bool = Query(True)):
    deleted = document_service.delete_document(document_id, remove_cache=remove_cache)
    if deleted is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True, "document_id": document_id, "remove_cache": remove_cache}
