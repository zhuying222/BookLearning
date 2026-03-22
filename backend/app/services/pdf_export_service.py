import base64
import io
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

from app.core.config import settings

PAGE_SIZE = landscape(A4)
PAGE_WIDTH, PAGE_HEIGHT = PAGE_SIZE
PAGE_MARGIN_X = 10 * mm
PAGE_MARGIN_Y = 9 * mm
COLUMN_GAP = 5 * mm
COLUMN_WIDTH = (PAGE_WIDTH - 2 * PAGE_MARGIN_X - COLUMN_GAP) / 2
COLUMN_HEIGHT = PAGE_HEIGHT - 2 * PAGE_MARGIN_Y
LABEL_HEIGHT = 7 * mm
TEXT_PADDING_X = 5 * mm
TEXT_PADDING_Y = 4 * mm
TEXT_WIDTH = COLUMN_WIDTH - 2 * TEXT_PADDING_X
TEXT_HEIGHT = COLUMN_HEIGHT - 2 * TEXT_PADDING_Y
CONTINUATION_HEADER_HEIGHT = 7 * mm

FONT_CJK = "STSong-Light"
FONT_LATIN = "Helvetica"
FONT_LATIN_BOLD = "Helvetica-Bold"
FONT_SIZE_BODY = 10.2
FONT_SIZE_META = 9.0
FONT_SIZE_TITLE = 11.4
LEADING_BODY = 14.5
LEADING_META = 12.0
PARAGRAPH_GAP = 5.5


@dataclass
class LineEntry:
    text: str
    font_name: str
    font_size: float
    leading: float
    indent: float = 0
    color: tuple[float, float, float] = (0.2, 0.2, 0.2)
    gap_before: float = 0


def generate_study_pdf(
    pdf_file_name: str,
    pages: list[int],
    page_images_base64: dict[str, str],
    explanations: dict[str, str],
) -> tuple[bytes, str]:
    _ensure_fonts()

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=PAGE_SIZE, pageCompression=1)
    pdf.setTitle(f"{pdf_file_name} - BookLearning 讲解")

    normalized_images = {int(key): value for key, value in page_images_base64.items()}
    normalized_explanations = {
        int(key): value for key, value in explanations.items() if value is not None
    }

    for page_number in pages:
        image_base64 = normalized_images.get(page_number)
        if not image_base64:
            raise ValueError(f"Missing rendered image for page {page_number}.")

        image_bytes = base64.b64decode(image_base64)
        explanation = normalized_explanations.get(page_number, "").strip()
        line_entries = build_line_entries(explanation) if explanation else []

        line_index = draw_source_page(
            pdf=pdf,
            page_number=page_number,
            image_bytes=image_bytes,
            lines=line_entries,
            has_explanation=bool(explanation),
        )

        while line_index < len(line_entries):
            line_index = draw_continuation_page(
                pdf=pdf,
                page_number=page_number,
                lines=line_entries,
                start_index=line_index,
            )

    pdf.save()
    pdf_bytes = buffer.getvalue()

    output_name = f"{pdf_file_name} - BookLearning 讲解.pdf"
    output_path = Path(settings.exports_dir) / output_name
    output_path.write_bytes(pdf_bytes)
    return pdf_bytes, output_name


def draw_source_page(
    pdf: canvas.Canvas,
    page_number: int,
    image_bytes: bytes,
    lines: list[LineEntry],
    has_explanation: bool,
) -> int:
    _draw_sheet_background(pdf)
    _draw_column_boxes(pdf)
    _draw_page_label(pdf, page_number, PAGE_MARGIN_X, PAGE_HEIGHT - PAGE_MARGIN_Y)
    _draw_pdf_image(
        pdf,
        image_bytes,
        PAGE_MARGIN_X,
        PAGE_MARGIN_Y,
        COLUMN_WIDTH,
        COLUMN_HEIGHT,
    )

    if not has_explanation:
        _draw_placeholder(
            pdf,
            text="暂无讲解",
            box_x=PAGE_MARGIN_X + COLUMN_WIDTH + COLUMN_GAP,
            box_y=PAGE_MARGIN_Y,
            box_w=COLUMN_WIDTH,
            box_h=COLUMN_HEIGHT,
        )
        pdf.showPage()
        return 0

    next_index = _draw_text_column(
        pdf,
        lines,
        0,
        box_x=PAGE_MARGIN_X + COLUMN_WIDTH + COLUMN_GAP,
        box_y=PAGE_MARGIN_Y,
        box_w=COLUMN_WIDTH,
        box_h=COLUMN_HEIGHT,
    )
    pdf.showPage()
    return next_index


def draw_continuation_page(
    pdf: canvas.Canvas,
    page_number: int,
    lines: list[LineEntry],
    start_index: int,
) -> int:
    _draw_sheet_background(pdf)
    _draw_text_column_box(pdf, PAGE_MARGIN_X, PAGE_MARGIN_Y, COLUMN_WIDTH, COLUMN_HEIGHT)
    _draw_text_column_box(
        pdf,
        PAGE_MARGIN_X + COLUMN_WIDTH + COLUMN_GAP,
        PAGE_MARGIN_Y,
        COLUMN_WIDTH,
        COLUMN_HEIGHT,
    )

    header_y = PAGE_HEIGHT - PAGE_MARGIN_Y - TEXT_PADDING_Y
    pdf.setFont(FONT_CJK, FONT_SIZE_META)
    pdf.setFillColor(colors.HexColor("#8a6d52"))
    pdf.drawString(PAGE_MARGIN_X + TEXT_PADDING_X, header_y, f"第 {page_number} 页讲解续页")

    left_index = _draw_text_column(
        pdf,
        lines,
        start_index,
        box_x=PAGE_MARGIN_X,
        box_y=PAGE_MARGIN_Y,
        box_w=COLUMN_WIDTH,
        box_h=COLUMN_HEIGHT - CONTINUATION_HEADER_HEIGHT,
        top_offset=CONTINUATION_HEADER_HEIGHT,
    )

    right_index = _draw_text_column(
        pdf,
        lines,
        left_index,
        box_x=PAGE_MARGIN_X + COLUMN_WIDTH + COLUMN_GAP,
        box_y=PAGE_MARGIN_Y,
        box_w=COLUMN_WIDTH,
        box_h=COLUMN_HEIGHT,
    )

    pdf.showPage()
    return right_index


def build_line_entries(markdown_text: str) -> list[LineEntry]:
    text = markdown_text.replace("\r\n", "\n")
    entries: list[LineEntry] = []

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            entries.append(
                LineEntry(
                    text="",
                    font_name=FONT_CJK,
                    font_size=FONT_SIZE_BODY,
                    leading=PARAGRAPH_GAP,
                )
            )
            continue

        line_text = _strip_markdown(stripped)
        if not line_text:
            continue

        if stripped.startswith("###"):
            entries.extend(
                _wrap_line(
                    line_text,
                    font_name=FONT_CJK,
                    font_size=FONT_SIZE_BODY,
                    leading=LEADING_BODY,
                    gap_before=PARAGRAPH_GAP * 0.8,
                )
            )
        elif stripped.startswith("##") or stripped.startswith("#"):
            entries.extend(
                _wrap_line(
                    line_text,
                    font_name=FONT_CJK,
                    font_size=FONT_SIZE_TITLE,
                    leading=LEADING_BODY + 1.0,
                    gap_before=PARAGRAPH_GAP,
                )
            )
        elif re.match(r"^(\*|-|\+)\s+", stripped) or re.match(r"^\d+\.\s+", stripped):
            entries.extend(
                _wrap_line(
                    f"• {line_text}",
                    font_name=FONT_CJK,
                    font_size=FONT_SIZE_BODY,
                    leading=LEADING_BODY,
                    indent=4 * mm,
                    gap_before=1.5,
                )
            )
        else:
            entries.extend(
                _wrap_line(
                    line_text,
                    font_name=FONT_CJK,
                    font_size=FONT_SIZE_BODY,
                    leading=LEADING_BODY,
                    gap_before=1.5,
                )
            )

    while entries and not entries[-1].text:
        entries.pop()

    return entries


def _wrap_line(
    text: str,
    font_name: str,
    font_size: float,
    leading: float,
    indent: float = 0,
    gap_before: float = 0,
) -> list[LineEntry]:
    clean_text = re.sub(r"\s+", " ", text).strip()
    if not clean_text:
        return []

    tokens = re.findall(r"[A-Za-z0-9_./:+-]+|.", clean_text)
    lines: list[str] = []
    current = ""
    available_width = TEXT_WIDTH - indent

    for token in tokens:
        candidate = f"{current}{token}"
        if current and pdfmetrics.stringWidth(candidate, font_name, font_size) > available_width:
            lines.append(current.rstrip())
            current = token.lstrip()
        else:
            current = candidate

    if current.strip():
        lines.append(current.rstrip())

    result: list[LineEntry] = []
    for index, line in enumerate(lines):
        result.append(
            LineEntry(
                text=line,
                font_name=font_name,
                font_size=font_size,
                leading=leading,
                indent=indent,
                gap_before=gap_before if index == 0 else 0,
            )
        )
    return result


def _draw_text_column(
    pdf: canvas.Canvas,
    lines: list[LineEntry],
    start_index: int,
    box_x: float,
    box_y: float,
    box_w: float,
    box_h: float,
    top_offset: float = 0,
) -> int:
    top_y = box_y + box_h - TEXT_PADDING_Y - top_offset
    bottom_y = box_y + TEXT_PADDING_Y
    current_y = top_y
    index = start_index

    while index < len(lines):
        line = lines[index]
        required = line.gap_before + max(line.leading, line.font_size)
        if current_y - required < bottom_y:
            break

        current_y -= line.gap_before

        if not line.text:
            current_y -= line.leading
            index += 1
            continue

        current_y -= line.leading
        pdf.setFont(line.font_name, line.font_size)
        pdf.setFillColorRGB(*line.color)
        pdf.drawString(box_x + TEXT_PADDING_X + line.indent, current_y, line.text)
        index += 1

    return index


def _draw_sheet_background(pdf: canvas.Canvas) -> None:
    pdf.setFillColor(colors.HexColor("#ffffff"))
    pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)


def _draw_column_boxes(pdf: canvas.Canvas) -> None:
    _draw_text_column_box(pdf, PAGE_MARGIN_X, PAGE_MARGIN_Y, COLUMN_WIDTH, COLUMN_HEIGHT)
    _draw_text_column_box(
        pdf,
        PAGE_MARGIN_X + COLUMN_WIDTH + COLUMN_GAP,
        PAGE_MARGIN_Y,
        COLUMN_WIDTH,
        COLUMN_HEIGHT,
    )


def _draw_text_column_box(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
) -> None:
    pdf.setStrokeColor(colors.HexColor("#e0d8cc"))
    pdf.setLineWidth(0.8)
    pdf.rect(x, y, width, height, stroke=1, fill=0)


def _draw_page_label(pdf: canvas.Canvas, page_number: int, x: float, top_y: float) -> None:
    label_w = 22 * mm
    label_h = 6 * mm
    pdf.setFillColor(colors.HexColor("#4a3520"))
    pdf.roundRect(x, top_y - label_h, label_w, label_h, 1.5 * mm, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont(FONT_CJK, FONT_SIZE_META)
    pdf.drawString(x + 2.4 * mm, top_y - label_h + 1.5 * mm, f"第 {page_number} 页")


def _draw_pdf_image(
    pdf: canvas.Canvas,
    image_bytes: bytes,
    box_x: float,
    box_y: float,
    box_w: float,
    box_h: float,
) -> None:
    image = ImageReader(io.BytesIO(image_bytes))
    img_w, img_h = image.getSize()
    scale = min((box_w - 2 * TEXT_PADDING_X) / img_w, (box_h - 2 * TEXT_PADDING_Y) / img_h)
    draw_w = img_w * scale
    draw_h = img_h * scale
    draw_x = box_x + (box_w - draw_w) / 2
    draw_y = box_y + (box_h - draw_h) / 2
    pdf.drawImage(image, draw_x, draw_y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask='auto')


def _draw_placeholder(
    pdf: canvas.Canvas,
    text: str,
    box_x: float,
    box_y: float,
    box_w: float,
    box_h: float,
) -> None:
    inner_x = box_x + TEXT_PADDING_X
    inner_y = box_y + TEXT_PADDING_Y
    inner_w = box_w - 2 * TEXT_PADDING_X
    inner_h = box_h - 2 * TEXT_PADDING_Y
    pdf.setStrokeColor(colors.HexColor("#dfd4c6"))
    pdf.setDash(4, 3)
    pdf.roundRect(inner_x, inner_y, inner_w, inner_h, 2 * mm, stroke=1, fill=0)
    pdf.setDash()
    pdf.setFillColor(colors.HexColor("#8d7e6d"))
    pdf.setFont(FONT_CJK, 14)
    text_width = pdfmetrics.stringWidth(text, FONT_CJK, 14)
    pdf.drawString(inner_x + (inner_w - text_width) / 2, inner_y + inner_h / 2, text)


def _strip_markdown(text: str) -> str:
    cleaned = text
    cleaned = re.sub(r"```.*?```", "", cleaned)
    cleaned = re.sub(r"`([^`]*)`", r"\1", cleaned)
    cleaned = re.sub(r"!\[[^\]]*]\([^)]*\)", "", cleaned)
    cleaned = re.sub(r"\[([^\]]+)]\([^)]*\)", r"\1", cleaned)
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned)
    cleaned = re.sub(r"^>\s*", "", cleaned)
    cleaned = re.sub(r"^(\*|-|\+)\s+", "", cleaned)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    cleaned = cleaned.replace("**", "").replace("__", "").replace("*", "").replace("_", "")
    cleaned = cleaned.replace("|", " ")
    return cleaned.strip()


def _ensure_fonts() -> None:
    if FONT_CJK not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(FONT_CJK))


def export_timestamp_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")
