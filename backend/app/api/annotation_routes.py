from fastapi import APIRouter, HTTPException

from app.models.annotation import (
    CreateHyperlinkRequest,
    CreateNoteRequest,
    HyperlinkListResponse,
    HyperlinkRecord,
    NotePagesResponse,
    NoteRecord,
    UpdateHyperlinkPositionRequest,
    UpdateHyperlinkTextRequest,
    UpdateNoteRequest,
)
from app.services import followup_service, hyperlink_service, note_service

router = APIRouter(prefix="/annotations", tags=["Annotations"])


def _target_exists(pdf_hash: str, page_number: int, target_type: str, target_id: str) -> bool:
    if target_type == "followup":
        page_followups = followup_service.get_followups_for_pdf(pdf_hash).get(page_number, [])
        return any(record.get("id") == target_id for record in page_followups)
    if target_type == "note":
        return note_service.note_exists(pdf_hash, page_number, target_id)
    return False


@router.get("/notes/{pdf_hash}", response_model=NotePagesResponse)
def get_all_notes(pdf_hash: str):
    pages = {
        page_number: [NoteRecord(**record) for record in records]
        for page_number, records in note_service.get_notes_for_pdf(pdf_hash).items()
    }
    return NotePagesResponse(pdf_hash=pdf_hash, pages=pages)


@router.post("/notes", response_model=NoteRecord)
def create_note(body: CreateNoteRequest):
    if body.page_number < 1:
        raise HTTPException(status_code=400, detail="Page number must be at least 1")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Note content cannot be empty")
    created = note_service.add_note(body.pdf_hash, body.page_number, body.content.strip())
    return NoteRecord(**created)


@router.put("/notes/{pdf_hash}/{page_number}/{note_id}", response_model=NoteRecord)
def update_note(pdf_hash: str, page_number: int, note_id: str, body: UpdateNoteRequest):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Note content cannot be empty")
    try:
        updated = note_service.update_note(pdf_hash, page_number, note_id, body.content.strip())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Note not found") from exc
    return NoteRecord(**updated)


@router.delete("/notes/{pdf_hash}/{page_number}/{note_id}")
def delete_note(pdf_hash: str, page_number: int, note_id: str):
    deleted = note_service.delete_note(pdf_hash, page_number, note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
    hyperlink_service.delete_hyperlinks_for_target(pdf_hash, page_number, "note", note_id)
    return {"ok": True, "pdf_hash": pdf_hash, "page_number": page_number, "note_id": note_id}


@router.get("/hyperlinks/{pdf_hash}", response_model=HyperlinkListResponse)
def get_all_hyperlinks(pdf_hash: str):
    hyperlinks = [HyperlinkRecord(**record) for record in hyperlink_service.get_hyperlinks_for_pdf(pdf_hash)]
    return HyperlinkListResponse(pdf_hash=pdf_hash, hyperlinks=hyperlinks)


@router.post("/hyperlinks", response_model=HyperlinkRecord)
def create_hyperlink(body: CreateHyperlinkRequest):
    if body.page_number < 1:
        raise HTTPException(status_code=400, detail="Page number must be at least 1")
    if not body.display_text.strip():
        raise HTTPException(status_code=400, detail="Hyperlink text cannot be empty")
    if not _target_exists(body.pdf_hash, body.page_number, body.target_type, body.target_id):
        raise HTTPException(status_code=404, detail="Hyperlink target not found")
    created = hyperlink_service.add_hyperlink(
        body.pdf_hash,
        body.page_number,
        body.target_type,
        body.target_id,
        body.display_text.strip(),
        body.position_x,
        body.position_y,
    )
    return HyperlinkRecord(**created)


@router.put("/hyperlinks/{pdf_hash}/{hyperlink_id}/position", response_model=HyperlinkRecord)
def update_hyperlink_position(pdf_hash: str, hyperlink_id: str, body: UpdateHyperlinkPositionRequest):
    try:
        updated = hyperlink_service.update_hyperlink_position(
            pdf_hash,
            hyperlink_id,
            body.position_x,
            body.position_y,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Hyperlink not found") from exc
    return HyperlinkRecord(**updated)


@router.put("/hyperlinks/{pdf_hash}/{hyperlink_id}/text", response_model=HyperlinkRecord)
def update_hyperlink_text(pdf_hash: str, hyperlink_id: str, body: UpdateHyperlinkTextRequest):
    if not body.display_text.strip():
        raise HTTPException(status_code=400, detail="Hyperlink text cannot be empty")
    try:
        updated = hyperlink_service.update_hyperlink_text(pdf_hash, hyperlink_id, body.display_text.strip())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Hyperlink not found") from exc
    return HyperlinkRecord(**updated)


@router.delete("/hyperlinks/{pdf_hash}/{hyperlink_id}")
def delete_hyperlink(pdf_hash: str, hyperlink_id: str):
    deleted = hyperlink_service.delete_hyperlink(pdf_hash, hyperlink_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Hyperlink not found")
    return {"ok": True, "pdf_hash": pdf_hash, "hyperlink_id": hyperlink_id}
