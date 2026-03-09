"""PDF rendering helpers for converting PDFs into simple HTML."""

from __future__ import annotations

import base64
import io
from typing import Iterable, List, Optional

import fitz  # PyMuPDF


def _parse_page_range(page_range: Optional[str], total_pages: int) -> List[int]:
    if not page_range:
        return list(range(total_pages))

    pages: List[int] = []
    for part in page_range.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_str, end_str = part.split("-", 1)
            start = max(int(start_str.strip()) - 1, 0)
            end = min(int(end_str.strip()) - 1, total_pages - 1)
            pages.extend(range(start, end + 1))
        else:
            index = int(part) - 1
            if 0 <= index < total_pages:
                pages.append(index)

    return sorted(set(pages))


def _render_text_html(doc: fitz.Document, pages: Iterable[int]) -> str:
    html_parts: List[str] = []
    for page_number in pages:
        page = doc.load_page(page_number)
        html = str(page.get_text("html") or "")
        if html.strip():
            html_parts.append(f"<div class=\"pdf-page\" data-page=\"{page_number + 1}\">{html}</div>")
    return "\n".join(html_parts)


def _render_images_html(doc: fitz.Document, pages: Iterable[int]) -> str:
    html_parts: List[str] = []
    for page_number in pages:
        page = doc.load_page(page_number)
        pix = page.get_pixmap()
        png_bytes = pix.tobytes("png")
        encoded = base64.b64encode(png_bytes).decode("ascii")
        html_parts.append(
            "<div class=\"pdf-page\" data-page=\"{}\"><img src=\"data:image/png;base64,{}\" alt=\"PDF page {}\"/></div>".format(
                page_number + 1,
                encoded,
                page_number + 1,
            )
        )
    return "\n".join(html_parts)


def safe_render_pdf_to_html(
    pdf_path: str,
    render_mode: str = "auto",
    page_range: Optional[str] = None,
) -> str:
    """
    Render a PDF to HTML safely.

    render_mode:
        - "text": extract text as HTML
        - "images": render pages to images
        - "auto": prefer text output, fallback to images
    """
    try:
        with fitz.open(pdf_path) as doc:
            pages = _parse_page_range(page_range, doc.page_count)
            if not pages:
                return ""

            if render_mode == "images":
                return _render_images_html(doc, pages)

            html = _render_text_html(doc, pages)
            if render_mode == "text" or html.strip():
                return html

            return _render_images_html(doc, pages)
    except Exception:
        return ""
