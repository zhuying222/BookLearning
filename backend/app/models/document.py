from datetime import datetime
import uuid

from pydantic import BaseModel, Field


class DocumentRecord(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    pdf_hash: str
    title: str
    original_file_name: str
    storage_file_name: str = "source.pdf"
    file_size_bytes: int
    page_count: int | None = None
    imported_at: datetime
    updated_at: datetime
    last_opened_at: datetime | None = None
    last_read_page: int = 1


class DocumentSummary(DocumentRecord):
    cached_pages: int = 0


class DocumentImportResponse(BaseModel):
    created: bool
    document: DocumentSummary


class DocumentProgressUpdate(BaseModel):
    last_read_page: int
