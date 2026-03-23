from pydantic import BaseModel, Field


class ExportPdfRequest(BaseModel):
    pdf_file_name: str
    pages: list[int] = Field(min_length=1)
    page_images_base64: dict[str, str]
    explanations: dict[str, str] = Field(default_factory=dict)
    sheet_images_base64: list[str] = Field(default_factory=list)
    sheet_page_sizes: list[dict[str, float]] = Field(default_factory=list)
