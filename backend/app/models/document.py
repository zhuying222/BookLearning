from datetime import datetime
from typing import Literal
import uuid

from pydantic import BaseModel, Field


class FolderRecord(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    parent_id: str | None = None
    created_at: datetime
    updated_at: datetime


class FolderSummary(FolderRecord):
    depth: int = 1
    child_folder_count: int = 0
    child_document_count: int = 0
    total_document_count: int = 0


class DocumentRecord(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    pdf_hash: str
    title: str
    original_file_name: str
    storage_file_name: str
    file_size_bytes: int
    page_count: int | None = None
    imported_at: datetime
    updated_at: datetime
    last_opened_at: datetime | None = None
    last_read_page: int = 1
    parent_folder_id: str | None = None


class DocumentSummary(DocumentRecord):
    cached_pages: int = 0
    folder_depth: int = 0


class LibraryIndex(BaseModel):
    version: int = 2
    folders: list[FolderRecord] = Field(default_factory=list)
    documents: list[DocumentRecord] = Field(default_factory=list)


class LibrarySnapshot(BaseModel):
    folders: list[FolderSummary]
    documents: list[DocumentSummary]
    max_folder_depth: int = 5


class DocumentImportResponse(BaseModel):
    created: bool
    document: DocumentSummary


class DocumentProgressUpdate(BaseModel):
    last_read_page: int


class FolderCreateRequest(BaseModel):
    name: str
    parent_folder_id: str | None = None


class FolderRenameRequest(BaseModel):
    name: str


class FolderMoveRequest(BaseModel):
    target_folder_id: str | None = None


class DocumentRenameRequest(BaseModel):
    name: str


class DocumentMoveRequest(BaseModel):
    target_folder_id: str | None = None


class NodeDeleteResponse(BaseModel):
    ok: bool
    removed_id: str
    removed_type: Literal["document", "folder"]
