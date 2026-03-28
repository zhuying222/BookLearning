from typing import Literal

from pydantic import BaseModel, Field


HyperlinkTargetType = Literal["followup", "note"]


class NoteRecord(BaseModel):
    id: str
    content: str
    created_at: str
    updated_at: str


class CreateNoteRequest(BaseModel):
    pdf_hash: str
    page_number: int
    content: str


class UpdateNoteRequest(BaseModel):
    content: str


class NotePagesResponse(BaseModel):
    pdf_hash: str
    pages: dict[int, list[NoteRecord]] = Field(default_factory=dict)


class HyperlinkRecord(BaseModel):
    id: str
    page_number: int
    target_type: HyperlinkTargetType
    target_id: str
    display_text: str
    position_x: float
    position_y: float
    created_at: str
    updated_at: str


class CreateHyperlinkRequest(BaseModel):
    pdf_hash: str
    page_number: int
    target_type: HyperlinkTargetType
    target_id: str
    display_text: str
    position_x: float = 0.08
    position_y: float = 0.12


class UpdateHyperlinkPositionRequest(BaseModel):
    position_x: float
    position_y: float


class UpdateHyperlinkTextRequest(BaseModel):
    display_text: str


class HyperlinkListResponse(BaseModel):
    pdf_hash: str
    hyperlinks: list[HyperlinkRecord] = Field(default_factory=list)
