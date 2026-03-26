from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.models.document import (
    DocumentBookmarkUpdate,
    DocumentImportResponse,
    DocumentMoveRequest,
    DocumentProgressUpdate,
    DocumentRenameRequest,
    DocumentSummary,
    FolderCreateRequest,
    FolderMoveRequest,
    FolderRenameRequest,
    FolderSummary,
    LibrarySnapshot,
    NodeDeleteResponse,
)
from app.services import document_service

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.get("/", response_model=LibrarySnapshot)
def list_library():
    return document_service.list_library()


@router.post("/import", response_model=DocumentImportResponse, status_code=201)
async def import_document(
    file: UploadFile = File(...),
    parent_folder_id: str | None = Form(None),
):
    try:
        document, created = await document_service.import_uploaded_document(file, parent_folder_id=parent_folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to import PDF: {exc}") from exc

    return DocumentImportResponse(created=created, document=document)


@router.post("/folders", response_model=FolderSummary, status_code=201)
def create_folder(body: FolderCreateRequest):
    try:
        return document_service.create_folder(body.name, parent_folder_id=body.parent_folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/folders/{folder_id}/rename", response_model=FolderSummary)
def rename_folder(folder_id: str, body: FolderRenameRequest):
    try:
        folder = document_service.rename_folder(folder_id, body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


@router.patch("/folders/{folder_id}/move", response_model=FolderSummary)
def move_folder(folder_id: str, body: FolderMoveRequest):
    try:
        folder = document_service.move_folder(folder_id, body.target_folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


@router.delete("/folders/{folder_id}", response_model=NodeDeleteResponse)
def delete_folder(folder_id: str, remove_cache: bool = Query(False)):
    deleted = document_service.delete_folder(folder_id, remove_cache=remove_cache)
    if not deleted:
        raise HTTPException(status_code=404, detail="Folder not found")
    return NodeDeleteResponse(ok=True, removed_id=folder_id, removed_type="folder")


@router.patch("/{document_id}/rename", response_model=DocumentSummary)
def rename_document(document_id: str, body: DocumentRenameRequest):
    try:
        document = document_service.rename_document(document_id, body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.patch("/{document_id}/move", response_model=DocumentSummary)
def move_document(document_id: str, body: DocumentMoveRequest):
    try:
        document = document_service.move_document(document_id, body.target_folder_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


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


@router.patch("/{document_id}/bookmarks/{page_number}", response_model=DocumentSummary)
def update_bookmark(document_id: str, page_number: int, body: DocumentBookmarkUpdate):
    try:
        document = document_service.update_document_bookmark(document_id, page_number, body.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.delete("/{document_id}/bookmarks/{page_number}", response_model=DocumentSummary)
def delete_bookmark(document_id: str, page_number: int):
    try:
        document = document_service.delete_document_bookmark(document_id, page_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.delete("/{document_id}", response_model=NodeDeleteResponse)
def delete_document(document_id: str, remove_cache: bool = Query(True)):
    deleted = document_service.delete_document(document_id, remove_cache=remove_cache)
    if deleted is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return NodeDeleteResponse(ok=True, removed_id=document_id, removed_type="document")
