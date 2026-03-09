"""PDF generation pipeline for document exports with accurate page sizing."""

from __future__ import annotations

from dataclasses import dataclass
import base64
import hashlib
import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Tuple, Optional, Any, cast

from django.conf import settings
from django.template.loader import render_to_string

from .pdf_metadata import build_pdf_metadata, build_pdf_info

try:
    from pypdf import PdfReader, PdfWriter, Transformation
except ImportError:  # pragma: no cover - handled by caller
    PdfReader = None
    PdfWriter = None
    Transformation = None

try:  # Optional; used for annotation overlays only
    from pypdf.annotations import AnnotationBuilder
except ImportError:  # pragma: no cover - optional dependency
    AnnotationBuilder = None

try:  # Optional; used for text-protection encryption
    from cryptography.fernet import Fernet
except ImportError:  # pragma: no cover - optional dependency
    Fernet = None

try:  # Optional; used for rasterizing PDF pages to images
    import fitz
except ImportError:  # pragma: no cover - optional dependency
    fitz = None


def detect_pdf_header_footer_heights(file_path: str, page: int = 1, blank_row_threshold: int = 36) -> Tuple[float, float]:
    """
    Detect header and footer heights (in points) from a PDF page.

    Algorithm
    ---------
    1. Render the page at 72 DPI (1 px ≈ 1 pt).
    2. Scan rows from the TOP.  Track first and last non-white rows within
       the header content band.  The band ends when ``blank_row_threshold``
       consecutive nearly-white rows are found (default 36 ≈ 0.5 in).
    3. Same scan from the BOTTOM for the footer band.
    4. Height = distance from page edge to last ink row + 8 pt padding.
    5. Cap each region at 25 % of page height.
    6. If bands overlap, assume full-bleed page and return (0, 0).

    A pixel is considered "white" if every channel is >= 250 (tolerates
    JPEG artifacts and slightly off-white letterhead backgrounds).

    Returns (header_height_pts, footer_height_pts).
    """
    if fitz is None:
        return 0.0, 0.0
    try:
        doc = fitz.open(file_path)
        page_index = max(int(page) - 1, 0)
        if page_index >= doc.page_count:
            page_index = 0
        p = doc.load_page(page_index)
        pix = p.get_pixmap(alpha=False)
        w = pix.width
        h = pix.height
        n = pix.n
        samples = pix.samples

        row_stride = w * n
        MAX_REGION_RATIO = 0.25
        PADDING = 8.0
        # Near-white threshold — channels >= this are treated as white
        WHITE_THRESH = 250

        def is_row_white(y: int) -> bool:
            """Check if a row is essentially white (sample every 4th pixel for speed)."""
            base = y * row_stride
            # Sample every 4th pixel across the row for speed
            step = max(n, n * 4)
            for offset in range(0, row_stride, step):
                idx = base + offset
                if n >= 3:
                    if samples[idx] < WHITE_THRESH or samples[idx + 1] < WHITE_THRESH or samples[idx + 2] < WHITE_THRESH:
                        return False
                else:
                    if samples[idx] < WHITE_THRESH:
                        return False
            return True

        # ── Header: scan top → down ──
        header_last_ink = -1
        consec_white = 0
        found_ink = False
        for y in range(h):
            if is_row_white(y):
                if found_ink:
                    consec_white += 1
                    if consec_white >= blank_row_threshold:
                        break
            else:
                found_ink = True
                header_last_ink = y
                consec_white = 0

        # ── Footer: scan bottom → up ──
        footer_first_ink = -1  # topmost ink row in footer band
        consec_white = 0
        found_ink = False
        for y in range(h - 1, -1, -1):
            if is_row_white(y):
                if found_ink:
                    consec_white += 1
                    if consec_white >= blank_row_threshold:
                        break
            else:
                found_ink = True
                footer_first_ink = y
                consec_white = 0

        # Compute heights
        header_height = (float(header_last_ink) + PADDING) if header_last_ink > 0 else 0.0
        footer_height = (float(h - footer_first_ink) + PADDING) if 0 <= footer_first_ink < h else 0.0

        # Overlap check
        if header_height > 0 and footer_height > 0:
            if header_last_ink + blank_row_threshold >= (footer_first_ink if footer_first_ink >= 0 else h):
                doc.close()
                return 0.0, 0.0

        # Cap
        max_region = h * MAX_REGION_RATIO
        header_height = min(header_height, max_region)
        footer_height = min(footer_height, max_region)

        doc.close()
        print(
            f"DEBUG: detect_pdf_header_footer_heights — page {page}, "
            f"header_last_ink={header_last_ink}, footer_first_ink={footer_first_ink}, "
            f"page_h={h} → header={header_height:.0f}pt, footer={footer_height:.0f}pt"
        )
        return header_height, footer_height
    except Exception:
        return 0.0, 0.0


def get_pdf_page_info(file_path: str, page: int = 1) -> Optional[Dict[str, Any]]:
    """
    Return metadata about a PDF page: dimensions, page count.

    Used by the manual-selection UI to know the coordinate space of the page
    before the user draws a crop rectangle.

    Returns::

        {
            "page_count": 3,
            "page_number": 1,
            "width_pts": 595.28,
            "height_pts": 841.89,
            "width_px_72dpi": 595,
            "height_px_72dpi": 842,
        }
    """
    if fitz is None:
        return None
    try:
        doc = fitz.open(file_path)
        page_index = max(int(page) - 1, 0)
        if page_index >= doc.page_count:
            page_index = 0
        p = doc.load_page(page_index)
        info = {
            "page_count": doc.page_count,
            "page_number": page_index + 1,
            "width_pts": round(p.rect.width, 2),
            "height_pts": round(p.rect.height, 2),
            "width_px_72dpi": int(p.rect.width),
            "height_px_72dpi": int(p.rect.height),
        }
        doc.close()
        return info
    except Exception:
        return None


def render_pdf_page_preview(file_path: str, page: int = 1, dpi: int = 150) -> Optional[bytes]:
    """
    Render a single PDF page as a PNG image for the selection UI.

    Returns PNG bytes or None on failure.
    """
    if fitz is None:
        return None
    try:
        doc = fitz.open(file_path)
        page_index = max(int(page) - 1, 0)
        if page_index >= doc.page_count:
            page_index = 0
        p = doc.load_page(page_index)
        zoom = max(float(dpi) / 72.0, 1.0)
        pix = p.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes("png")
        doc.close()
        return png_bytes
    except Exception:
        return None


def crop_pdf_region(
    source_path: str,
    page: int = 1,
    crop_top_offset: float = 0.0,
    crop_height: float = 100.0,
    region_type: str = "header",
) -> Optional[bytes]:
    """
    Crop a horizontal strip from a PDF page and return it as PDF bytes.

    Parameters
    ----------
    source_path : str
        Path to the source PDF file.
    page : int
        1-based page number.
    crop_top_offset : float
        Distance in **points** from the TOP edge of the page to the TOP of
        the crop rectangle.
    crop_height : float
        Height of the crop rectangle in points.
    region_type : str
        ``"header"`` or ``"footer"`` — used for logging only; the actual crop
        is always driven by ``crop_top_offset`` + ``crop_height``.

    Returns
    -------
    bytes or None
        PDF bytes of a single-page document whose page size matches the
        source page, with only the cropped strip visible — positioned at
        the **original** location on the page (top for header, bottom for
        footer).  Returns None on failure.
    """
    if fitz is None:
        return None
    try:
        doc = fitz.open(source_path)
        page_index = max(int(page) - 1, 0)
        if page_index >= doc.page_count:
            page_index = 0
        src_page = doc.load_page(page_index)
        src_w = src_page.rect.width
        src_h = src_page.rect.height

        # Clamp crop rectangle to page bounds
        top = max(0.0, min(crop_top_offset, src_h))
        bottom = min(top + max(crop_height, 1.0), src_h)
        clip = fitz.Rect(0, top, src_w, bottom)

        # Create output PDF at same page size, place the strip at its original y position
        out_doc = fitz.open()
        new_page = out_doc.new_page(width=src_w, height=src_h)
        dest_rect = fitz.Rect(0, top, src_w, bottom)
        new_page.show_pdf_page(dest_rect, doc, page_index, clip=clip)

        pdf_bytes = out_doc.tobytes()
        out_doc.close()
        doc.close()
        print(
            f"DEBUG: crop_pdf_region({region_type}) — page={page}, "
            f"top={top:.0f}, height={bottom - top:.0f}, "
            f"src={src_w:.0f}×{src_h:.0f}"
        )
        return pdf_bytes
    except Exception as exc:
        print(f"WARNING: crop_pdf_region failed: {exc}")
        return None


# Page dimensions in pixels at 96 DPI (CSS reference)
PAGE_SIZE_MAP: Dict[str, Tuple[str, str]] = {
    "a3": ("297mm", "420mm"),
    "a4": ("210mm", "297mm"),
    "a5": ("148mm", "210mm"),
    "a6": ("105mm", "148mm"),
    "letter": ("8.5in", "11in"),
    "legal": ("8.5in", "14in"),
    "tabloid": ("11in", "17in"),
}

# Page dimensions in points (1pt = 1/72 inch) for PDF
PAGE_SIZE_POINTS: Dict[str, Tuple[float, float]] = {
    "a3": (841.89, 1190.55),
    "a4": (595.28, 841.89),
    "a5": (419.53, 595.28),
    "a6": (297.64, 419.53),
    "letter": (612.0, 792.0),
    "legal": (612.0, 1008.0),
    "tabloid": (792.0, 1224.0),
}

MARGIN_MAP = {
    "none": "0mm",
    "narrow": "12.7mm",
    "normal": "25mm",
    "moderate": "19mm",
    "wide": "50mm",
}

LINE_HEIGHT_MAP = {
    "single": "1.0",
    "1.15": "1.15",
    "1.5": "1.5",
    "double": "2.0",
}

IMAGE_SIZE_MAP = {
    "small": "50%",
    "medium": "75%",
    "large": "100%",
}

# Unprintable area around page edges (typical printer margins)
UNPRINTABLE_AREA_MAP = {
    "none": "0mm",           # No unprintable area (ideal PDF viewer)
    "minimal": "3mm",        # High-quality printers (~0.12in)
    "standard": "6.35mm",    # Most printers (0.25in)
    "legacy": "12.7mm",      # Older printers (0.5in)
}


@dataclass
class PDFLayoutOptions:
    """Configuration for PDF rendering."""

    page_size: str = "a4"
    font_family: str = "serif"
    font_size: str = "12pt"
    line_spacing: str = "1.5"
    margin_size: str = "normal"
    image_size: str = "medium"
    caption_alignment: str = "center"
    show_unprintable_area: bool = True
    unprintable_area: str = "standard"

    @classmethod
    def from_request(cls, request, document=None) -> "PDFLayoutOptions":
        defaults = cls().to_metadata_dict()
        metadata_layout = cls._extract_metadata_layout(document)
        if isinstance(metadata_layout, dict):
            defaults.update({key: value for key, value in metadata_layout.items() if value is not None})

        param_map = {
            "page_size": "pageSize",
            "font_family": "font",
            "font_size": "fontSize",
            "line_spacing": "lineSpacing",
            "margin_size": "margin",
            "image_size": "imageSize",
            "caption_alignment": "captionAlign",
            "show_unprintable_area": "showUnprintable",
            "unprintable_area": "unprintableArea",
        }

        if request is not None:
            for key, param in param_map.items():
                if param in request.GET:
                    defaults[key] = request.GET.get(param)

        return cls(
            page_size=cls._coerce_str(defaults.get("page_size"), "a4"),
            font_family=cls._coerce_str(defaults.get("font_family"), "serif"),
            font_size=cls._coerce_str(defaults.get("font_size"), "12pt"),
            line_spacing=cls._coerce_str(defaults.get("line_spacing"), "1.5"),
            margin_size=cls._coerce_str(defaults.get("margin_size"), "normal"),
            image_size=cls._coerce_str(defaults.get("image_size"), "medium"),
            caption_alignment=cls._coerce_str(defaults.get("caption_alignment"), "center"),
            show_unprintable_area=cls._coerce_bool(defaults.get("show_unprintable_area"), True),
            unprintable_area=cls._coerce_str(defaults.get("unprintable_area"), "standard"),
        )

    @staticmethod
    def _coerce_str(value: Any, default: str) -> str:
        if value is None:
            return default
        if isinstance(value, str):
            value = value.strip()
            return value or default
        return str(value)

    @staticmethod
    def _coerce_bool(value: Any, default: bool) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"0", "false", "no", "off"}:
                return False
            if normalized in {"1", "true", "yes", "on"}:
                return True
        return default

    @staticmethod
    def _extract_metadata_layout(document) -> Dict[str, Any]:
        if not document:
            return {}
        custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
        processing_settings = custom_metadata.get("processing_settings")
        if not isinstance(processing_settings, dict):
            return {}
        pdf_layout = processing_settings.get("pdf_layout")
        return pdf_layout if isinstance(pdf_layout, dict) else {}

    def to_metadata_dict(self) -> Dict[str, Any]:
        return {
            "page_size": self.page_size,
            "font_family": self.font_family,
            "font_size": self.font_size,
            "line_spacing": self.line_spacing,
            "margin_size": self.margin_size,
            "image_size": self.image_size,
            "caption_alignment": self.caption_alignment,
            "show_unprintable_area": self.show_unprintable_area,
            "unprintable_area": self.unprintable_area,
        }

    def to_template_context(self) -> Dict[str, Any]:
        page_width, page_height = PAGE_SIZE_MAP.get(self.page_size, PAGE_SIZE_MAP["a4"])
        page_width_pt, page_height_pt = PAGE_SIZE_POINTS.get(self.page_size, PAGE_SIZE_POINTS["a4"])
        
        return {
            "page_size": self.page_size,
            "page_width": page_width,
            "page_height": page_height,
            "page_width_pt": f"{page_width_pt}pt",
            "page_height_pt": f"{page_height_pt}pt",
            "font_family": self.font_family,
            "font_size": self.font_size,
            "line_spacing": self.line_spacing,
            "line_height": LINE_HEIGHT_MAP.get(self.line_spacing, "1.5"),
            "margin_size": self.margin_size,
            "page_margin": MARGIN_MAP.get(self.margin_size, "25mm"),
            "image_size": self.image_size,
            "image_max_width": IMAGE_SIZE_MAP.get(self.image_size, "75%"),
            "show_unprintable_area": self.show_unprintable_area,
            "unprintable_area": self.unprintable_area,
            "unprintable_margin": UNPRINTABLE_AREA_MAP.get(self.unprintable_area, "6.35mm"),
        }
    
    def get_unprintable_margin_mm(self) -> float:
        """Get unprintable area in mm for visual indicators."""
        area_map_mm = {
            "none": 0.0,
            "minimal": 3.0,
            "standard": 6.35,
            "legacy": 12.7,
        }
        return area_map_mm.get(self.unprintable_area, 6.35)


def _resolve_image_placeholders_in_text(text: str, document) -> str:
    """
    Replace ``[[image:UUID]]`` placeholders in *text* with ``<img>`` tags
    pointing at the resolved media URL.  Named (non-UUID) slots like
    ``[[image:company_logo]]`` are stripped to just the name in brackets.
    """
    import re
    from documents.models import DocumentImage

    _UUID_RE = re.compile(
        r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
        r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    )

    # Collect all UUIDs referenced in the text
    matches = re.findall(r'\[\[image:([^\]]+)\]\]', text)
    if not matches:
        return text

    uuid_ids = [m for m in matches if _UUID_RE.match(m)]
    url_map = {}
    if uuid_ids:
        for img in DocumentImage.objects.filter(id__in=uuid_ids):
            url = img.get_url()
            if url:
                # Build absolute path for reportlab
                full_path = os.path.join(settings.BASE_DIR, url.lstrip('/'))
                if os.path.isfile(full_path):
                    url_map[str(img.id)] = full_path
                else:
                    url_map[str(img.id)] = url

    def _replace(match):
        identifier = match.group(1).strip()
        if _UUID_RE.match(identifier):
            path = url_map.get(identifier)
            if path:
                return f'<img src="{path}" width="300" />'
            return f'[Image: {identifier[:8]}…]'
        # Named slot — show as text
        return f'[Image: {identifier}]'

    return re.sub(r'\[\[image:([^\]]+)\]\]', _replace, text)


def _resolve_pdf_passwords(document, request) -> Dict[str, Optional[str]]:
    """Resolve PDF password settings from processing settings or request params."""
    user_password = None
    owner_password = None
    enabled = None

    if request is not None:
        is_download_request = request.GET.get("download") == "1"
        if not is_download_request:
            return {
                "user_password": None,
                "owner_password": None,
            }

    custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
    processing_settings = custom_metadata.get("processing_settings")
    if isinstance(processing_settings, dict):
        security = processing_settings.get("pdf_security")
        if isinstance(security, dict):
            if isinstance(security.get("enabled"), bool):
                enabled = security.get("enabled")
            user_password = security.get("user_password") or user_password
            owner_password = security.get("owner_password") or owner_password

    if request is not None:
        if request.GET.get("pdfPasswordEnabled") is not None:
            enabled = request.GET.get("pdfPasswordEnabled") == "1"
        user_password = request.GET.get("pdfPassword") or user_password
        owner_password = request.GET.get("pdfOwnerPassword") or owner_password

    if isinstance(user_password, str):
        user_password = user_password.strip()
    if isinstance(owner_password, str):
        owner_password = owner_password.strip()

    if enabled is False:
        return {
            "user_password": None,
            "owner_password": None,
        }

    if not user_password:
        return {
            "user_password": None,
            "owner_password": None,
        }

    owner_password = owner_password or user_password

    return {
        "user_password": user_password,
        "owner_password": owner_password,
    }


def _derive_fernet_key(key: str) -> bytes:
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_document_plain_text(document) -> str:
    if getattr(document, "is_latex_code", False):
        latex_code = getattr(document, "latex_code", None)
        if isinstance(latex_code, str) and latex_code.strip():
            return latex_code
    for attr in ("current_text", "raw_text"):
        value = getattr(document, attr, None)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _resolve_xelatex_binary() -> Optional[str]:
    configured = os.environ.get("XELATEX_PATH") or getattr(settings, "XELATEX_PATH", None)
    if configured and os.path.isfile(configured):
        return configured

    extra_paths = [
        "/Library/TeX/texbin",
        "/usr/texbin",
        "/usr/local/texlive/2025/bin/universal-darwin",
        "/usr/local/texlive/2025basic/bin/universal-darwin",
    ]
    search_path = os.pathsep.join([os.environ.get("PATH", "")] + extra_paths)
    return shutil.which("xelatex", path=search_path)


PGFPLOTS_OPTIMIZATION_SETTINGS = """\\pgfplotsset{
    /pgfplots/samples=40,
    /pgfplots/samples y=40,
    /pgfplots/mesh/rows=40,
    /pgfplots/mesh/cols=40,
    /pgfplots/shader=flat,
}"""


def _is_tex_memory_error(output: str) -> bool:
        lowered = output.lower()
        return "tex capacity exceeded" in lowered or "main memory size" in lowered


def _build_latex_document(
    latex_code: str,
    preamble: Optional[str] = None,
    optimize_graphs: bool = False,
) -> str:
    if "\\begin{document}" in latex_code:
        return latex_code

    preamble_block = preamble.strip() if preamble else "\\usepackage{amsmath}\n\\usepackage{amssymb}"
    # If TikZ is used, ensure tikz package is loaded
    if "\\begin{tikzpicture}" in latex_code and "\\usepackage{tikz}" not in preamble_block:
        preamble_block = f"{preamble_block}\n\\usepackage{{tikz}}"
    # If pgfplots axis environment is used, include pgfplots package
    if "\\begin{axis}" in latex_code:
        if "\\usepackage{pgfplots}" not in preamble_block:
            # pgfplots typically depends on tikz; loading pgfplots will load tikz as needed
            preamble_block = f"{preamble_block}\n\\usepackage{{pgfplots}}"
        if "\\pgfplotsset{compat=" not in preamble_block:
            preamble_block = f"{preamble_block}\n\\pgfplotsset{{compat=1.18}}"
        if optimize_graphs:
            preamble_block = f"{preamble_block}\n{PGFPLOTS_OPTIMIZATION_SETTINGS}"
    return (
        "\\documentclass[varwidth]{standalone}\n"
        f"{preamble_block}\n"
        "\\begin{document}\n"
        f"{latex_code}\n"
        "\\end{document}\n"
    )


def _render_latex_to_png(
    latex_code: str,
    preamble: Optional[str] = None,
    dpi: int = 200,
) -> Optional[bytes]:
    if not latex_code or not latex_code.strip():
        return None

    xelatex = _resolve_xelatex_binary()
    if not xelatex or fitz is None:
        return None

    document_text = _build_latex_document(latex_code, preamble=preamble, optimize_graphs=False)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        tex_path = tmp_dir_path / "document.tex"
        tex_path.write_text(document_text, encoding="utf-8")

        command = [
            xelatex,
            "-interaction=nonstopmode",
            "-halt-on-error",
            f"-output-directory={tmp_dir_path}",
            str(tex_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            combined_output = result.stderr or result.stdout or ""
            if _is_tex_memory_error(combined_output):
                document_text = _build_latex_document(
                    latex_code,
                    preamble=preamble,
                    optimize_graphs=True,
                )
                tex_path.write_text(document_text, encoding="utf-8")
                result = subprocess.run(command, capture_output=True, text=True)
                if result.returncode != 0:
                    return None
            else:
                return None

        pdf_path = tmp_dir_path / "document.pdf"
        if not pdf_path.exists():
            return None

        pdf_bytes = pdf_path.read_bytes()
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if not pdf_doc.page_count:
            pdf_doc.close()
            return None

        page = pdf_doc.load_page(0)
        zoom = max(float(dpi) / 72.0, 1.0)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes("png")
        pdf_doc.close()
        return png_bytes


def _render_latex_to_pdf_bytes(
    latex_code: str,
    preamble: Optional[str] = None,
) -> Optional[bytes]:
    if not latex_code or not latex_code.strip():
        return None

    xelatex = _resolve_xelatex_binary()
    if not xelatex:
        return None

    document_text = _build_latex_document(latex_code, preamble=preamble, optimize_graphs=False)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        tex_path = tmp_dir_path / "document.tex"
        tex_path.write_text(document_text, encoding="utf-8")

        command = [
            xelatex,
            "-interaction=nonstopmode",
            "-halt-on-error",
            f"-output-directory={tmp_dir_path}",
            str(tex_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            combined_output = result.stderr or result.stdout or ""
            if _is_tex_memory_error(combined_output):
                document_text = _build_latex_document(
                    latex_code,
                    preamble=preamble,
                    optimize_graphs=True,
                )
                tex_path.write_text(document_text, encoding="utf-8")
                result = subprocess.run(command, capture_output=True, text=True)
                if result.returncode != 0:
                    return None
            else:
                return None

        pdf_path = tmp_dir_path / "document.pdf"
        if not pdf_path.exists():
            return None

        return pdf_path.read_bytes()


def _merge_latex_pages(
    base_pdf: bytes,
    latex_refs: list[dict],
    page_width: float,
    page_height: float,
    content_width: float,
    content_height: float,
    left_margin: float,
    bottom_margin: float,
) -> bytes:
    if not latex_refs or PdfReader is None or PdfWriter is None or Transformation is None:
        return base_pdf

    latex_map: Dict[int, list[dict]] = {}
    for ref in latex_refs:
        page_num = ref.get("page")
        if not page_num:
            continue
        latex_map.setdefault(page_num, []).append(ref)
    reader = PdfReader(io.BytesIO(base_pdf))
    writer = PdfWriter()

    for index, page in enumerate(reader.pages, start=1):
        latex_items = latex_map.get(index)
        if latex_items:
            for ref in latex_items:
                latex_bytes = ref.get("pdf_bytes")
                if not latex_bytes:
                    continue
                try:
                    latex_reader = PdfReader(io.BytesIO(latex_bytes))
                    if not latex_reader.pages:
                        continue
                    latex_page = latex_reader.pages[0]
                    latex_width = float(latex_page.mediabox.width)
                    latex_height = float(latex_page.mediabox.height)
                    if latex_width <= 0 or latex_height <= 0:
                        continue

                    target_width = float(ref.get("width") or 0) or latex_width
                    target_height = float(ref.get("height") or 0) or latex_height
                    scale = min(target_width / latex_width, target_height / latex_height, 1.0)
                    translate_x = float(ref.get("x") or left_margin)
                    translate_y = float(ref.get("y") or bottom_margin)
                    transform = (
                        Transformation()
                        .scale(scale)
                        .translate(translate_x, translate_y)
                    )
                    page.merge_transformed_page(latex_page, transform)
                except Exception as exc:
                    print(f"Warning: Failed to merge LaTeX PDF inline: {exc}")
        writer.add_page(page)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _resolve_text_protection(document, request) -> Dict[str, Any]:
    """Resolve text protection settings for rasterized PDFs."""
    settings = {
        "enabled": False,
        "mode": "rasterize",
        "remove_metadata": True,
        "dpi": 200,
        "encryption_key": None,
    }

    if request is not None:
        is_download_request = (
            request.GET.get("download") == "1"
            or "/download-pdf" in (request.path or "")
        )
        if not is_download_request:
            return settings

    custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
    processing_settings = custom_metadata.get("processing_settings")
    if isinstance(processing_settings, dict):
        protection = processing_settings.get("pdf_text_protection")
        if isinstance(protection, dict):
            if isinstance(protection.get("enabled"), bool):
                settings["enabled"] = protection.get("enabled")
            if protection.get("mode"):
                settings["mode"] = protection.get("mode")
            if isinstance(protection.get("remove_metadata"), bool):
                settings["remove_metadata"] = protection.get("remove_metadata")
            if protection.get("dpi"):
                settings["dpi"] = protection.get("dpi")
            if protection.get("encryption_key"):
                settings["encryption_key"] = protection.get("encryption_key")

    if request is not None:
        if request.GET.get("textProtection") is not None:
            settings["enabled"] = request.GET.get("textProtection") == "1"
        if request.GET.get("textProtectionMode"):
            settings["mode"] = request.GET.get("textProtectionMode")
        if request.GET.get("textProtectionRemoveMetadata") is not None:
            settings["remove_metadata"] = request.GET.get("textProtectionRemoveMetadata") == "1"
        if request.GET.get("textProtectionDpi"):
            settings["dpi"] = request.GET.get("textProtectionDpi")
        if request.GET.get("textProtectionKey"):
            settings["encryption_key"] = request.GET.get("textProtectionKey")

    return settings


def _rasterize_pdf_bytes(pdf_bytes: bytes, dpi: int) -> bytes:
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is required for text protection rasterization")
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import ImageReader
    except ImportError:
        raise RuntimeError("reportlab is required to compose rasterized PDF pages")

    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    zoom = max(float(dpi) / 72.0, 1.0)
    matrix = fitz.Matrix(zoom, zoom)

    out_buf = io.BytesIO()
    c = None
    page_count = 0
    for page in src:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        img_bytes = pix.tobytes("png")

        # Calculate page size in points so PDF displays at intended physical size
        page_pts_w = pix.width * 72.0 / float(dpi)
        page_pts_h = pix.height * 72.0 / float(dpi)

        if c is None:
            c = canvas.Canvas(out_buf, pagesize=(page_pts_w, page_pts_h))

        img = ImageReader(io.BytesIO(img_bytes))
        c.setPageSize((page_pts_w, page_pts_h))
        c.drawImage(img, 0, 0, width=page_pts_w, height=page_pts_h)
        c.showPage()
        page_count += 1

    if c is None:
        # empty source
        return b""
    c.save()
    out_buf.seek(0)
    print(f"DEBUG: rasterized {page_count} pages at {dpi} DPI")
    return out_buf.getvalue()


def _crop_pdf_page_to_region(
    source_path: str,
    page_index: int,
    region: str,
    region_height_pts: float,
    target_page_width: float,
    target_page_height: float,
) -> Optional[bytes]:
    """
    Extract a header or footer region from a PDF page as a standalone single-page PDF.

    Uses PyMuPDF (fitz) to crop the source page to just the header/footer region,
    then scales it to fit the target page width and produces a full-size PDF page
    where the cropped region is positioned at the top (header) or bottom (footer).

    Returns PDF bytes of a single page with the region content at the correct position,
    or None on failure.
    """
    if fitz is None or PdfReader is None or PdfWriter is None:
        return None
    try:
        src_doc = fitz.open(source_path)
        if page_index >= src_doc.page_count:
            page_index = 0
        src_page = src_doc.load_page(page_index)
        src_w = src_page.rect.width
        src_h = src_page.rect.height

        if region == "header":
            clip = fitz.Rect(0, 0, src_w, min(region_height_pts, src_h))
        elif region == "footer":
            clip = fitz.Rect(0, max(src_h - region_height_pts, 0), src_w, src_h)
        else:
            src_doc.close()
            return None

        # Create a new single-page PDF at the target page dimensions
        out_doc = fitz.open()
        new_page = out_doc.new_page(width=target_page_width, height=target_page_height)

        # Calculate scale to fit source width to target width
        scale = target_page_width / src_w if src_w > 0 else 1.0
        scaled_height = region_height_pts * scale

        if region == "header":
            # Place at top of page
            dest_rect = fitz.Rect(0, 0, target_page_width, scaled_height)
        else:
            # Place at bottom of page
            dest_rect = fitz.Rect(0, target_page_height - scaled_height, target_page_width, target_page_height)

        # Insert the cropped region from source page into the new page
        new_page.show_pdf_page(dest_rect, src_doc, page_index, clip=clip)

        region_pdf_bytes = out_doc.tobytes()
        out_doc.close()
        src_doc.close()
        return region_pdf_bytes
    except Exception as exc:
        print(f"WARNING: _crop_pdf_page_to_region failed ({region}): {exc}")
        return None


def _overlay_header_footer_pdf(
    body_pdf_bytes: bytes,
    header_pdf_path: Optional[str] = None,
    footer_pdf_path: Optional[str] = None,
    header_height_pts: float = 0,
    footer_height_pts: float = 0,
    header_page_index: int = 0,
    footer_page_index: int = 0,
    header_config: Optional[dict] = None,
    footer_config: Optional[dict] = None,
) -> bytes:
    """
    Overlay header/footer PDF regions onto each page of the body PDF using pypdf.

    Instead of rasterizing the header/footer to images (which destroys text
    selectability), this function:
    1. Crops the header region from the source PDF page (top N points)
    2. Crops the footer region from the source PDF page (bottom N points)
    3. Creates full-size overlay pages with just those regions positioned correctly
    4. Merges the overlay pages UNDER each body page so header/footer text is
       selectable and body content sits on top

    The body PDF should already have appropriate top/bottom margins to leave
    space for the header/footer content.
    """
    if PdfReader is None or PdfWriter is None:
        return body_pdf_bytes
    if not header_pdf_path and not footer_pdf_path:
        return body_pdf_bytes

    header_config = header_config or {}
    footer_config = footer_config or {}

    body_reader = PdfReader(io.BytesIO(body_pdf_bytes))
    writer = PdfWriter()

    # Helper to check if overlay should apply to a given page number
    def _should_apply(config, page_number, prefix=""):
        show_pages = config.get(f"{prefix}show_pages") or config.get("show_pages")
        if isinstance(show_pages, str):
            show_pages = [p.strip() for p in show_pages.split(",") if p.strip()]
        if isinstance(show_pages, (list, tuple)) and show_pages:
            page_set = set()
            for p in show_pages:
                try:
                    page_set.add(int(p))
                except (TypeError, ValueError):
                    continue
            return page_number in page_set

        show_first = config.get(f"{prefix}show_on_first_page")
        if show_first is None:
            show_first = config.get("show_on_first_page", True)
        show_all = config.get(f"{prefix}show_on_all_pages")
        if show_all is None:
            show_all = config.get("show_on_all_pages", True)
        if show_all:
            return True
        if page_number == 1:
            return bool(show_first)
        return False

    # Pre-generate the header/footer overlay pages (one each, reused for all pages)
    # We use the first body page dimensions as reference
    if body_reader.pages:
        ref_page = body_reader.pages[0]
        target_w = float(ref_page.mediabox.width)
        target_h = float(ref_page.mediabox.height)
    else:
        return body_pdf_bytes

    header_overlay_reader = None
    footer_overlay_reader = None

    if header_pdf_path and header_height_pts > 0:
        header_region_bytes = _crop_pdf_page_to_region(
            header_pdf_path, header_page_index, "header",
            header_height_pts, target_w, target_h,
        )
        if header_region_bytes:
            header_overlay_reader = PdfReader(io.BytesIO(header_region_bytes))

    if footer_pdf_path and footer_height_pts > 0:
        footer_region_bytes = _crop_pdf_page_to_region(
            footer_pdf_path, footer_page_index, "footer",
            footer_height_pts, target_w, target_h,
        )
        if footer_region_bytes:
            footer_overlay_reader = PdfReader(io.BytesIO(footer_region_bytes))

    for page_num_0, body_page in enumerate(body_reader.pages):
        page_number = page_num_0 + 1  # 1-based for config checks

        apply_header = header_overlay_reader and _should_apply(header_config, page_number)
        apply_footer = footer_overlay_reader and _should_apply(
            footer_config if footer_config.get("file_id") else header_config,
            page_number,
            prefix="footer_" if not footer_config.get("file_id") else "",
        )

        if apply_header or apply_footer:
            # Create a composite background page by merging header + footer overlays
            # Start with a blank page at the same size, then merge overlays, then merge body on top
            from copy import deepcopy

            if apply_header and header_overlay_reader.pages:
                overlay_page = deepcopy(header_overlay_reader.pages[0])
                if apply_footer and footer_overlay_reader.pages:
                    overlay_page.merge_page(footer_overlay_reader.pages[0])
            elif apply_footer and footer_overlay_reader.pages:
                overlay_page = deepcopy(footer_overlay_reader.pages[0])
            else:
                writer.add_page(body_page)
                continue

            # Merge the body content ON TOP of the header/footer background
            overlay_page.merge_page(body_page)
            writer.add_page(overlay_page)
        else:
            writer.add_page(body_page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def render_document_pdf(document, request, options: PDFLayoutOptions) -> bytes:
    """Render the document to PDF bytes using reportlab."""
    try:
        from reportlab.lib.pagesizes import A3, A4, A5, A6, LETTER, LEGAL, TABLOID
        from reportlab.platypus import SimpleDocTemplate, Paragraph as RLParagraph, Spacer, PageBreak, Image as RLImage, Preformatted, Flowable
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
        from reportlab.lib import colors
        from reportlab.lib.utils import ImageReader
    except ImportError as exc:
        raise RuntimeError("reportlab is required for PDF rendering. Run: pip install reportlab") from exc

    print(f"DEBUG: render_document_pdf called")
    print(f"  Options: {options}")
    
    # Map page sizes
    page_size_map = {
        "a3": A3,
        "a4": A4,
        "a5": A5,
        "a6": A6,
        "letter": LETTER,
        "legal": LEGAL,
        "tabloid": TABLOID,
    }
    
    page_size = page_size_map.get(options.page_size, A4)
    
    # Convert margin to points
    margin_map_pt = {
        "none": 0,
        "narrow": 12.7 * mm,
        "moderate": 19 * mm,
        "normal": 25 * mm,
        "wide": 50 * mm,
    }
    margin = margin_map_pt.get(options.margin_size, 25 * mm)
    
    def _parse_size(value, default):
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        raw = str(value).strip().lower()
        try:
            if raw.endswith("mm"):
                return float(raw[:-2]) * mm
            if raw.endswith("pt"):
                return float(raw[:-2])
            if raw.endswith("px"):
                return float(raw[:-2]) * 0.75
            if raw.endswith("in"):
                return float(raw[:-2]) * 72
            return float(raw)
        except ValueError:
            return default

    def _parse_color(value, fallback):
        if not value:
            return fallback
        if isinstance(value, colors.Color):
            return value
        raw = str(value).strip()
        try:
            if raw.startswith("#"):
                return colors.HexColor(raw)
            if raw.startswith("rgb"):
                parts = raw.replace("rgb(", "").replace(")", "").split(",")
                r, g, b = [int(p.strip()) / 255.0 for p in parts[:3]]
                return colors.Color(r, g, b)
        except Exception:
            return fallback
        return fallback

    def _extract_color(value, fallback):
        if not value:
            return fallback
        raw = str(value).strip()
        if "#" in raw:
            idx = raw.find("#")
            return _parse_color(raw[idx:idx + 7], fallback)
        if raw.startswith("rgb"):
            return _parse_color(raw, fallback)
        return _parse_color(raw, fallback)

    def _font_name(value):
        mapping = {
            "arial": "Helvetica",
            "helvetica": "Helvetica",
            "times": "Times-Roman",
            "times new roman": "Times-Roman",
            "courier": "Courier",
            "serif": "Times-Roman",
            "sans": "Helvetica",
            "mono": "Courier",
        }
        if not value:
            return "Helvetica"
        return mapping.get(str(value).strip().lower(), "Helvetica")

    def _draw_icons(canvas, config, page_width, page_height, y_origin, area_height):
        icons = config.get("icons") or []
        if not icons:
            return

        size_map = {"small": 18, "medium": 28, "large": 40}
        for icon in icons:
            image_id = icon.get("image_id")
            if not image_id:
                continue
            try:
                from documents.models import DocumentImage
                image_obj = DocumentImage.objects.get(id=image_id)
                if not image_obj.image:
                    continue
                image_path = image_obj.image.path
            except Exception:
                continue

            size = size_map.get(icon.get("size"), 24)
            position = icon.get("position", "left")
            x = margin
            if position == "center":
                x = (page_width - size) / 2
            elif position == "right":
                x = page_width - margin - size

            y = y_origin + (area_height - size) / 2
            try:
                canvas.drawImage(ImageReader(image_path), x, y, width=size, height=size, mask="auto")
            except Exception:
                continue

    processing_defaults = {}
    if hasattr(document, "get_processing_defaults"):
        try:
            processing_defaults = document.get_processing_defaults() or {}
        except Exception:
            processing_defaults = {}

    pdf_info = build_pdf_info(document)

    def _get_image_path(image_obj):
        if not image_obj:
            return None
        image_field = getattr(image_obj, "image", None)
        if not image_field:
            return None
        try:
            return image_field.path
        except Exception:
            return None

    def _get_default_image_path(default_key):
        defaults = processing_defaults.get("pdf_images") if isinstance(processing_defaults, dict) else {}
        if not isinstance(defaults, dict):
            return None
        image_id = defaults.get(f"{default_key}_image_id")
        if not image_id:
            return None
        try:
            from documents.models import DocumentImage
            image_obj = DocumentImage.objects.get(id=image_id)
            return _get_image_path(image_obj)
        except Exception:
            return None

    def _draw_page_images(canvas, doc_obj):
        page_width, page_height = doc_obj.pagesize

        background_path = _get_image_path(getattr(document, "background_image", None))
        if not background_path:
            background_path = _get_default_image_path("background")
        if background_path:
            try:
                canvas.saveState()
                canvas.drawImage(
                    ImageReader(background_path),
                    0,
                    0,
                    width=page_width,
                    height=page_height,
                    mask="auto",
                    preserveAspectRatio=True,
                    anchor="c",
                )
                canvas.restoreState()
            except Exception:
                canvas.restoreState()

        watermark_path = _get_image_path(getattr(document, "watermark_image", None))
        if not watermark_path:
            watermark_path = _get_default_image_path("watermark")
        if watermark_path:
            try:
                watermark_reader = ImageReader(watermark_path)
                image_width, image_height = watermark_reader.getSize()
                max_width = page_width * 0.6
                max_height = page_height * 0.6
                scale = min(max_width / image_width, max_height / image_height)
                target_width = image_width * scale
                target_height = image_height * scale
                x = (page_width - target_width) / 2
                y = (page_height - target_height) / 2
                canvas.saveState()
                if hasattr(canvas, "setFillAlpha"):
                    canvas.setFillAlpha(0.15)
                canvas.drawImage(
                    watermark_reader,
                    x,
                    y,
                    width=target_width,
                    height=target_height,
                    mask="auto",
                    preserveAspectRatio=True,
                    anchor="c",
                )
                canvas.restoreState()
            except Exception:
                canvas.restoreState()

    header_pdf_config = {}
    if isinstance(processing_defaults, dict):
        header_pdf_config = processing_defaults.get("header_pdf") if isinstance(processing_defaults.get("header_pdf"), dict) else {}
    if not isinstance(header_pdf_config, dict):
        header_pdf_config = {}

    footer_pdf_config = {}
    if isinstance(processing_defaults, dict):
        footer_pdf_config = processing_defaults.get("footer_pdf") if isinstance(processing_defaults.get("footer_pdf"), dict) else {}
    if not isinstance(footer_pdf_config, dict):
        footer_pdf_config = {}

    header_pdf_height = _parse_size(header_pdf_config.get("height"), 0) if header_pdf_config else 0
    footer_pdf_height = _parse_size(header_pdf_config.get("footer_height"), 0) if header_pdf_config else 0
    # Also check dedicated footer_pdf config
    if not footer_pdf_height and footer_pdf_config:
        footer_pdf_height = _parse_size(footer_pdf_config.get("height"), 0)
    header_pdf_file_id = header_pdf_config.get("file_id") if isinstance(header_pdf_config, dict) else None
    footer_pdf_file_id = footer_pdf_config.get("file_id") if isinstance(footer_pdf_config, dict) else None

    def _resolve_header_pdf_height(page_width):
        return header_pdf_height if header_pdf_height > 0 else 0

    def _resolve_footer_pdf_height(page_width):
        return footer_pdf_height if footer_pdf_height > 0 else 0

    def _draw_header_logo(canvas, header_config, header_y, header_height, page_width, page_number):
        position = (header_config or {}).get("logo_position") or "none"
        if position == "none":
            return None
        if (header_config or {}).get("logo_first_page_only") and page_number != 1:
            return None

        logo_path = _get_image_path(getattr(document, "logo_image", None))
        if not logo_path:
            logo_path = _get_default_image_path("logo")
        if not logo_path:
            return None

        size_map = {
            "small": 0.4,
            "medium": 0.55,
            "large": 0.7,
        }
        size_key = (header_config or {}).get("logo_size") or "medium"
        size_factor = size_map.get(size_key, 0.55)

        try:
            logo_reader = ImageReader(logo_path)
            image_width, image_height = logo_reader.getSize()
            max_height = max(12, header_height * size_factor)
            max_width = page_width * 0.25
            scale = min(max_width / image_width, max_height / image_height)
            target_width = image_width * scale
            target_height = image_height * scale

            if position == "center":
                x = (page_width - target_width) / 2
            elif position == "right":
                x = page_width - margin - target_width
            else:
                x = margin
            y = header_y + (header_height - target_height) / 2

            canvas.saveState()
            canvas.drawImage(
                logo_reader,
                x,
                y,
                width=target_width,
                height=target_height,
                mask="auto",
                preserveAspectRatio=True,
                anchor="w",
            )
            canvas.restoreState()
            return {"position": position, "width": target_width}
        except Exception:
            canvas.restoreState()
            return None

    def _draw_header_footer(canvas, doc_obj):
        page_number = canvas.getPageNumber()
        page_width, page_height = doc_obj.pagesize

        current_header_height = _parse_size(
            (document.get_effective_header_config() or {}).get("style", {}).get("height", "48px"),
            48,
        )
        _draw_page_images(canvas, doc_obj)

        header_config = document.get_rendered_header_config(page_number=page_number)
        footer_config = document.get_rendered_footer_config(page_number=page_number)

        def _should_render(config):
            if not config:
                return False
            show_pages = config.get("show_pages")
            if isinstance(show_pages, str):
                show_pages = [p.strip() for p in show_pages.split(",") if p.strip()]
            if isinstance(show_pages, (list, tuple)) and show_pages:
                normalized = set()
                for page in show_pages:
                    try:
                        normalized.add(int(page))
                    except (TypeError, ValueError):
                        continue
                return page_number in normalized
            show_first = config.get("show_on_first_page", True)
            show_all = config.get("show_on_all_pages", True)
            if show_all:
                return True
            if page_number == 1:
                return show_first
            return False

        def _should_render_pdf(config, prefix=""):
            if not config:
                return False
            show_pages = config.get(f"{prefix}show_pages")
            if show_pages is None:
                show_pages = config.get("show_pages")
            if isinstance(show_pages, str):
                show_pages = [p.strip() for p in show_pages.split(",") if p.strip()]
            if isinstance(show_pages, (list, tuple)) and show_pages:
                normalized = set()
                for page in show_pages:
                    try:
                        normalized.add(int(page))
                    except (TypeError, ValueError):
                        continue
                return page_number in normalized
            show_first = config.get(f"{prefix}show_on_first_page")
            if show_first is None:
                show_first = config.get("show_on_first_page", True)
            show_all = config.get(f"{prefix}show_on_all_pages")
            if show_all is None:
                show_all = config.get("show_on_all_pages", True)
            if show_all:
                return True
            if page_number == 1:
                return bool(show_first)
            return False

        header_pdf_active = _should_render_pdf(header_pdf_config)
        footer_pdf_active = (_should_render_pdf(header_pdf_config, prefix="footer_") or _should_render_pdf(footer_pdf_config)) and footer_pdf_height_resolved > 0

        # NOTE: Header/footer PDF overlay is applied as a post-processing step
        # using pypdf after doc.build() — NOT as rasterized images on the canvas.
        # This preserves text selectability in header/footer content.
        # The canvas-based header/footer template drawing below is only used
        # when NO header/footer PDF is active.

        if not header_pdf_active and _should_render(header_config):
            header_style = header_config.get("style") or {}
            header_height = _parse_size(header_style.get("height", "48px"), 48)
            header_y = page_height - header_height
            canvas.saveState()
            canvas.setFillColor(_parse_color(header_style.get("background_color"), colors.transparent))
            if header_style.get("background_color"):
                canvas.rect(0, header_y, page_width, header_height, fill=1, stroke=0)

            border_color = _extract_color(header_style.get("border_bottom", ""), None)
            if border_color:
                canvas.setStrokeColor(border_color)
                canvas.line(0, header_y, page_width, header_y)

            font_size = _parse_size(header_style.get("font_size", "10pt"), 10)
            text_color = _extract_color(
                header_style.get("text_color")
                or header_style.get("color")
                or header_style.get("font_color"),
                colors.black,
            )
            canvas.setFont(_font_name(header_style.get("font_family")), font_size)
            canvas.setFillColor(text_color)
            text = header_config.get("text") or {}
            line_height = font_size * 1.2
            logo_info = _draw_header_logo(
                canvas,
                header_config,
                header_y,
                header_height,
                page_width,
                page_number,
            )
            left_offset = margin
            if logo_info and logo_info.get("position") == "left":
                left_offset = margin + logo_info.get("width", 0) + 8

            def _draw_multiline_text(value, align):
                if not value:
                    return
                lines = [line.strip() for line in str(value).split("\n") if line.strip()]
                if not lines:
                    return
                block_height = line_height * len(lines)
                start_y = header_y + (header_height - block_height) / 2 + (len(lines) - 1) * line_height
                for index, line in enumerate(lines):
                    y = start_y - (index * line_height)
                    if align == "left":
                        canvas.drawString(left_offset, y, line)
                    elif align == "center":
                        canvas.drawCentredString(page_width / 2, y, line)
                    else:
                        canvas.drawRightString(page_width - margin, y, line)

            _draw_multiline_text(text.get("left"), "left")
            _draw_multiline_text(text.get("center"), "center")
            _draw_multiline_text(text.get("right"), "right")

            _draw_icons(canvas, header_config, page_width, page_height, header_y, header_height)
            canvas.restoreState()

        if not footer_pdf_active and _should_render(footer_config):
            footer_style = footer_config.get("style") or {}
            footer_height = _parse_size(footer_style.get("height", "36px"), 36)
            footer_y = 0
            canvas.saveState()
            canvas.setFillColor(_parse_color(footer_style.get("background_color"), colors.transparent))
            if footer_style.get("background_color"):
                canvas.rect(0, footer_y, page_width, footer_height, fill=1, stroke=0)

            border_color = _extract_color(footer_style.get("border_top", ""), None)
            if border_color:
                canvas.setStrokeColor(border_color)
                canvas.line(0, footer_height, page_width, footer_height)

            font_size = _parse_size(footer_style.get("font_size", "9pt"), 9)
            text_color = _extract_color(
                footer_style.get("text_color")
                or footer_style.get("color")
                or footer_style.get("font_color"),
                colors.black,
            )
            canvas.setFont(_font_name(footer_style.get("font_family")), font_size)
            canvas.setFillColor(text_color)
            text = footer_config.get("text") or {}
            line_height = font_size * 1.2

            def _draw_multiline_footer(value, align):
                if not value:
                    return
                lines = [line.strip() for line in str(value).split("\n") if line.strip()]
                if not lines:
                    return
                block_height = line_height * len(lines)
                start_y = footer_y + (footer_height - block_height) / 2 + (len(lines) - 1) * line_height
                for index, line in enumerate(lines):
                    y = start_y - (index * line_height)
                    if align == "left":
                        canvas.drawString(margin, y, line)
                    elif align == "center":
                        canvas.drawCentredString(page_width / 2, y, line)
                    else:
                        canvas.drawRightString(page_width - margin, y, line)

            _draw_multiline_footer(text.get("left"), "left")
            _draw_multiline_footer(text.get("center"), "center")
            _draw_multiline_footer(text.get("right"), "right")

            _draw_icons(canvas, footer_config, page_width, page_height, footer_y, footer_height)
            canvas.restoreState()

    header_config_effective = document.get_effective_header_config() or {}
    header_style_effective = header_config_effective.get("style", {}) if isinstance(header_config_effective, dict) else {}
    header_height = _parse_size(
        header_style_effective.get("height", "48px"),
        48,
    )
    header_spacing = _parse_size(
        header_style_effective.get("content_spacing", 0),
        0,
    )
    header_overlap = _parse_size(
        header_style_effective.get("content_offset", "0px"),
        0,
    )
    header_pdf_height_resolved = _resolve_header_pdf_height(page_size[0])
    footer_pdf_height_resolved = _resolve_footer_pdf_height(page_size[0])
    footer_height = _parse_size(
        (document.get_effective_footer_config() or {}).get("style", {}).get("height", "36px"),
        36,
    )

    # Create PDF
    output = io.BytesIO()
    latex_inline_refs: list[dict] = []

    class LatexPdfFlowable(Flowable):
        def __init__(
            self,
            pdf_bytes: bytes,
            width: float,
            height: float,
            refs: list[dict],
            align: str = "LEFT",
        ):
            super().__init__()
            self.pdf_bytes = pdf_bytes
            self.width = width
            self.height = height
            self._refs = refs
            self._align = (align or "LEFT").upper()
            self._avail_width = None

        def wrap(self, avail_width, avail_height):
            self._avail_width = avail_width
            return self.width, self.height

        def drawOn(self, canvas, x, y, _sW=0):
            if self._align == "CENTER" and self._avail_width:
                extra = (self._avail_width - self.width) / 2
                if extra > 0:
                    x += extra
            if self._refs is not None:
                self._refs.append(
                    {
                        "page": canvas.getPageNumber(),
                        "x": x,
                        "y": y,
                        "width": self.width,
                        "height": self.height,
                        "pdf_bytes": self.pdf_bytes,
                    }
                )
            super().drawOn(canvas, x, y)

        def draw(self):
            return

    header_content_height = max(header_height, header_pdf_height_resolved)
    footer_content_height = max(footer_height, footer_pdf_height_resolved)

    # ── Smart margin calculation ──
    # The body frame height = page_height - top_margin - bottom_margin.
    # We must guarantee enough room for body text.
    #
    # KEY INSIGHT: When a header/footer PDF overlay is active, the detected
    # height already includes the letterhead's own internal whitespace (the
    # distance from the page edge to the bottom of the ink band).  Adding the
    # user's page margin again would double-count that whitespace, creating
    # a large empty gap between the header artwork and the first line of text.
    #
    # Strategy:
    #   • header_pdf active  → top_margin  = detected_height + small gap (6pt)
    #   • footer_pdf active  → bottom_margin = detected_height + small gap (6pt)
    #   • text-only header   → top_margin = margin + header_height + spacing
    #   • If combined margins leave < 40% for body, scale proportionally.
    #   • The overlay cropping still uses the *original* detected heights.
    page_height_pts = page_size[1]
    base_font_size = _parse_size(getattr(options, "font_size", "12pt"), 12)
    line_height_factor = float(LINE_HEIGHT_MAP.get(options.line_spacing, "1.5"))
    leading = base_font_size * line_height_factor
    # Minimum body area: at least 8 lines or 40 % of page, whichever is larger
    min_body_height = max(leading * 8, page_height_pts * 0.40)

    # Gap between header/footer art and first/last line of body text
    PDF_OVERLAY_GAP = 6.0  # pts ≈ 2 mm — just enough to breathe

    if header_pdf_height_resolved > 0:
        # PDF overlay is active — detected height already includes the letterhead's
        # own top margin, so we only add a small gap for the body to start after.
        ideal_top = header_pdf_height_resolved + PDF_OVERLAY_GAP
    else:
        # Text-only header — use the traditional formula
        ideal_top = max(0, margin + header_content_height + header_spacing - header_overlap)

    if footer_pdf_height_resolved > 0:
        ideal_bottom = footer_pdf_height_resolved + PDF_OVERLAY_GAP
    else:
        ideal_bottom = margin + footer_content_height

    available_for_margins = page_height_pts - min_body_height
    if ideal_top + ideal_bottom > available_for_margins and available_for_margins > 0:
        # Scale proportionally
        total = ideal_top + ideal_bottom
        ratio = available_for_margins / total
        top_margin = ideal_top * ratio
        bottom_margin = ideal_bottom * ratio
        print(
            f"DEBUG: Header/footer margins scaled to fit — "
            f"ideal top={ideal_top:.0f} bottom={ideal_bottom:.0f}, "
            f"scaled top={top_margin:.0f} bottom={bottom_margin:.0f} "
            f"(page={page_height_pts:.0f}, min body={min_body_height:.0f})"
        )
    elif available_for_margins <= 0:
        # Extreme case: even the page margin alone is too large
        top_margin = max(margin, 18)
        bottom_margin = max(margin, 18)
        print(
            f"WARNING: Page too small for any header/footer; using minimal margins "
            f"top={top_margin:.0f} bottom={bottom_margin:.0f}"
        )
    else:
        top_margin = ideal_top
        bottom_margin = ideal_bottom
    
    print(
        f"DEBUG: Margin calc — header_pdf_h={header_pdf_height_resolved:.0f} "
        f"footer_pdf_h={footer_pdf_height_resolved:.0f} "
        f"text_header_h={header_height:.0f} text_footer_h={footer_height:.0f} "
        f"→ top_margin={top_margin:.0f} bottom_margin={bottom_margin:.0f} "
        f"body_area={page_height_pts - top_margin - bottom_margin:.0f}pt"
    )

    doc = SimpleDocTemplate(
        output,
        pagesize=page_size,
        rightMargin=margin,
        leftMargin=margin,
        topMargin=top_margin,
        bottomMargin=bottom_margin,
    )

    if pdf_info.get("title"):
        doc.title = pdf_info["title"]
    if pdf_info.get("author"):
        doc.author = pdf_info["author"]
    if pdf_info.get("subject"):
        doc.subject = pdf_info["subject"]
    if pdf_info.get("creator"):
        doc.creator = pdf_info["creator"]
    if pdf_info.get("producer"):
        doc.producer = pdf_info["producer"]
    if pdf_info.get("keywords"):
        doc.keywords = [value.strip() for value in pdf_info["keywords"].split(",") if value.strip()]
    
    # Build content
    story = []
    styles = getSampleStyleSheet()
    alignment_map = {
        "left": TA_LEFT,
        "right": TA_RIGHT,
        "center": TA_CENTER,
        "centre": TA_CENTER,
    }
    caption_alignment_value = alignment_map.get(
        (options.caption_alignment or "center").strip().lower(),
        TA_CENTER,
    )
    caption_style = ParagraphStyle(
        "CaptionText",
        parent=styles["BodyText"],
        alignment=cast(Any, caption_alignment_value),
    )
    code_style = ParagraphStyle(
        "LatexCode",
        parent=styles["BodyText"],
        fontName="Courier",
        fontSize=10,
        leading=12,
    )
    is_latex_doc = bool(getattr(document, "is_latex_code", False) and getattr(document, "latex_code", None))
    if is_latex_doc:
        story.append(Preformatted(document.latex_code or "", code_style))
    content_width = page_size[0] - (margin * 2)
    table_style_presets = {
        "standard": {
            "header_bg": colors.grey,
            "header_text": colors.whitesmoke,
            "row_bg": colors.beige,
            "grid": colors.black,
        },
        "clean": {
            "header_bg": colors.HexColor("#f3f4f6"),
            "header_text": colors.HexColor("#111827"),
            "row_bg": colors.white,
            "grid": colors.HexColor("#d1d5db"),
        },
        "dark": {
            "header_bg": colors.HexColor("#111827"),
            "header_text": colors.white,
            "row_bg": colors.HexColor("#1f2937"),
            "grid": colors.HexColor("#374151"),
        },
        "minimal": {
            "header_bg": colors.white,
            "header_text": colors.HexColor("#111827"),
            "row_bg": colors.white,
            "grid": colors.HexColor("#e5e7eb"),
        },
    }
    class RotatedTableFlowable:
        def __init__(self, table):
            self.table = table

        def wrap(self, avail_width, avail_height):
            width, height = self.table.wrap(avail_height, avail_width)
            return height, width

        def drawOn(self, canvas, x, y, _sW=0):
            canvas.saveState()
            canvas.translate(x, y)
            canvas.rotate(90)
            canvas.translate(0, -self.table._width)
            self.table.drawOn(canvas, 0, 0)
            canvas.restoreState()

    def _parse_page_range(value, total_pages):
        if not value:
            return list(range(total_pages))
        pages = set()
        parts = [part.strip() for part in str(value).split(',') if part.strip()]
        for part in parts:
            if '-' in part:
                start, end = part.split('-', 1)
                try:
                    start_i = int(start)
                    end_i = int(end)
                except ValueError:
                    continue
                for page in range(start_i, end_i + 1):
                    if 1 <= page <= total_pages:
                        pages.add(page - 1)
            else:
                try:
                    page = int(part)
                except ValueError:
                    continue
                if 1 <= page <= total_pages:
                    pages.add(page - 1)
        return sorted(pages)

    def _fit_image_in_frame(image_flowable, max_width, max_height):
        if not image_flowable:
            return
        try:
            base_width = float(getattr(image_flowable, "imageWidth", 0) or 0)
            base_height = float(getattr(image_flowable, "imageHeight", 0) or 0)
            if base_width <= 0 or base_height <= 0:
                return
            aspect = base_height / base_width
            target_width = max_width or base_width
            target_height = target_width * aspect

            if max_height and target_height > max_height:
                target_height = max_height
                target_width = target_height / aspect

            current_width = float(getattr(image_flowable, "drawWidth", 0) or 0)
            current_height = float(getattr(image_flowable, "drawHeight", 0) or 0)
            if current_width and current_height and max_height and current_height > max_height:
                scale = max_height / current_height
                target_width = current_width * scale
                target_height = current_height * scale

            image_flowable.drawWidth = target_width
            image_flowable.drawHeight = target_height
        except Exception:
            return
    
    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=12,
    )
    story.append(RLParagraph(document.title or "Untitled Document", title_style))
    story.append(Spacer(1, 12))
    
    # Add sections recursively
    def add_section_content(section, level=0):
        """Add section and its content to the story."""
        # Section title
        if section.title:
            heading_style = styles[f'Heading{min(level + 2, 6)}']
            story.append(RLParagraph(section.title, heading_style))
            story.append(Spacer(1, 6))
        
        # Get all content in order (paragraphs, latex, tables, images, files)
        paragraphs = list(section.paragraphs.all().order_by('order'))
        latex_codes = list(section.latex_codes.all().order_by('order'))
        tables = list(section.tables.all().order_by('order'))
        images = list(section.image_components.all().order_by('order'))
        files = list(section.file_components.all().order_by('order'))
        
        # Combine and sort by order
        all_content = []
        for para in paragraphs:
            all_content.append(('paragraph', para.order, para))
        for code in latex_codes:
            all_content.append(('latex_code', code.order, code))
        for table in tables:
            all_content.append(('table', table.order, table))
        for image_component in images:
            all_content.append(('image', image_component.order, image_component))
        for file_component in files:
            all_content.append(('file', file_component.order, file_component))
        
        all_content.sort(key=lambda x: x[1])
        
        # Add content in order
        for content_type, _, content in all_content:
            if content_type == 'paragraph':
                # Get effective content and render with metadata to resolve placeholders
                text = content.get_effective_content()
                
                # Render with metadata to resolve placeholders like [[id.field]]
                if text and hasattr(content, 'render_with_metadata'):
                    text = content.render_with_metadata(text=text)
                
                # Resolve [[image:UUID]] placeholders to <img> tags
                if text and '[[image:' in text:
                    text = _resolve_image_placeholders_in_text(text, document)
                
                if text:
                    # Clean and normalize HTML for reportlab
                    # Reportlab supports: b, i, u, strong, em, font, br, a, super, sub
                    
                    # Fix self-closing tags
                    text = text.replace('<br>', '<br/>')
                    text = text.replace('<BR>', '<br/>')
                    text = text.replace('<hr>', '<br/>')
                    text = text.replace('<HR>', '<br/>')
                    
                    # Remove outer para tags (reportlab adds them)
                    text = text.strip()
                    if text.startswith('<para>') and text.endswith('</para>'):
                        text = text[6:-7]
                    if text.startswith('<PARA>') and text.endswith('</PARA>'):
                        text = text[6:-7]
                    
                    # Convert common HTML tags to reportlab-compatible format
                    # Normalize heading tags to bold
                    import re
                    text = re.sub(r'<h[1-6][^>]*>(.*?)</h[1-6]>', r'<b>\1</b><br/>', text, flags=re.IGNORECASE | re.DOTALL)
                    
                    # Convert div/span/p to breaks (simple approach)
                    text = re.sub(r'</?div[^>]*>', '<br/>', text, flags=re.IGNORECASE)
                    text = re.sub(r'</?p[^>]*>', '<br/>', text, flags=re.IGNORECASE)
                    text = re.sub(r'</?span[^>]*>', '', text, flags=re.IGNORECASE)
                    
                    # Remove unsupported HTML attributes from supported tags
                    text = re.sub(r'<(b|i|u|strong|em)\s+[^>]*>', r'<\1>', text, flags=re.IGNORECASE)
                    
                    # Normalize strong/em to b/i (case-insensitive)
                    text = re.sub(r'<strong>', '<b>', text, flags=re.IGNORECASE)
                    text = re.sub(r'</strong>', '</b>', text, flags=re.IGNORECASE)
                    text = re.sub(r'<em>', '<i>', text, flags=re.IGNORECASE)
                    text = re.sub(r'</em>', '</i>', text, flags=re.IGNORECASE)
                    
                    # Normalize all supported tags to lowercase
                    text = re.sub(r'<([/]?)(B|I|U)([^>]*)>', lambda m: f'<{m.group(1)}{m.group(2).lower()}{m.group(3)}>', text)
                    
                    # Clean up multiple br tags
                    text = re.sub(r'(<br\s*/?>)+', '<br/>', text, flags=re.IGNORECASE)
                    
                    # Remove leading/trailing breaks
                    text = re.sub(r'^(<br\s*/?>)+', '', text, flags=re.IGNORECASE)
                    text = re.sub(r'(<br\s*/?>)+$', '', text, flags=re.IGNORECASE)
                    
                    if not text.strip():
                        continue
                    
                    try:
                        story.append(RLParagraph(text, styles['BodyText']))
                        story.append(Spacer(1, 6))
                    except Exception as e:
                        # If HTML parsing still fails, add as plain text
                        print(f"Warning: Failed to parse paragraph HTML: {e}")
                        print(f"  Content: {text[:100]}...")
                        # Strip all HTML tags and add as plain text
                        plain_text = re.sub(r'<[^>]+>', '', text)
                        if plain_text.strip():
                            story.append(RLParagraph(plain_text, styles['BodyText']))
                            story.append(Spacer(1, 6))

            elif content_type == 'latex_code':
                code_text = content.get_effective_content()
                if code_text:
                    preamble = None
                    if isinstance(getattr(content, "custom_metadata", None), dict):
                        preamble = (
                            content.custom_metadata.get("preamble")
                            or content.custom_metadata.get("latex_preamble")
                        )

                    pdf_bytes = _render_latex_to_pdf_bytes(code_text, preamble=preamble)
                    if pdf_bytes and PdfReader is not None:
                        latex_reader = PdfReader(io.BytesIO(pdf_bytes))
                        if latex_reader.pages:
                            latex_page = latex_reader.pages[0]
                            latex_width = float(latex_page.mediabox.width)
                            latex_height = float(latex_page.mediabox.height)
                            if latex_width > 0 and latex_height > 0:
                                scale = min(content_width / latex_width, 1.0)
                                target_width = latex_width * scale
                                target_height = latex_height * scale
                                story.append(
                                    LatexPdfFlowable(
                                        pdf_bytes,
                                        target_width,
                                        target_height,
                                        latex_inline_refs,
                                        align="CENTER",
                                    )
                                )
                                story.append(Spacer(1, 6))
                                continue
                    else:
                        story.append(Preformatted(code_text, code_style))
                        story.append(Spacer(1, 6))
            
            elif content_type == 'table':
                # Add table
                try:
                    from reportlab.platypus import Table as RLTable, TableStyle
                    from reportlab.lib import colors

                    # Build table data
                    column_headers = content.column_headers or []
                    header_ids = []
                    headers = []
                    rows = []

                    if column_headers:
                        if isinstance(column_headers[0], dict):
                            header_ids = [col.get('id', '') for col in column_headers]
                            headers = [col.get('label') or col.get('id', '') for col in column_headers]
                        else:
                            header_ids = [str(col) for col in column_headers]
                            headers = [str(col) for col in column_headers]

                    raw_table_data = content.table_data
                    if isinstance(raw_table_data, dict):
                        raw_table_data = (
                            raw_table_data.get('rows')
                            or raw_table_data.get('data')
                            or raw_table_data.get('table_data')
                            or []
                        )
                    if not isinstance(raw_table_data, (list, tuple)):
                        raw_table_data = []

                    if raw_table_data:
                        for row in raw_table_data:
                            row_data = []
                            if isinstance(row, dict):
                                # Support {'cells': {col_id: val}} or flat {'col_id': val}
                                cells = row.get('cells') or row.get('values')
                                if cells is None:
                                    # row IS the cell dict (flat format)
                                    cells = row
                                if isinstance(cells, dict):
                                    if header_ids:
                                        row_data = [cells.get(str(col_id), '') for col_id in header_ids]
                                    else:
                                        row_data = list(cells.values())
                                elif isinstance(cells, (list, tuple)):
                                    row_data = list(cells)
                                else:
                                    row_data = [str(cells)]
                            elif isinstance(row, (list, tuple)):
                                row_data = list(row)
                            else:
                                row_data = [str(row) if row is not None else '']
                            rows.append(row_data)

                    rows = [
                        ["" if cell is None else str(cell) for cell in row]
                        for row in rows
                    ]
                    max_cols = max([len(row) for row in rows], default=len(headers))
                    if not header_ids and max_cols:
                        header_ids = list(range(max_cols))
                        if not headers:
                            headers = [f"Column {i + 1}" for i in range(max_cols)]
                    if max_cols and headers and len(headers) < max_cols:
                        headers = headers + [""] * (max_cols - len(headers))
                    if max_cols:
                        rows = [row + [""] * (max_cols - len(row)) for row in rows]

                    # Compute column widths to fit content_width
                    num_cols = max_cols or len(headers) or 1
                    col_width = content_width / num_cols if num_cols > 0 else content_width

                    table_config = content.table_config or {}
                    if not table_config and isinstance(processing_defaults, dict):
                        table_defaults = processing_defaults.get("table_config")
                        if isinstance(table_defaults, dict):
                            table_config = table_defaults
                    elif isinstance(processing_defaults, dict):
                        table_defaults = processing_defaults.get("table_config")
                        if isinstance(table_defaults, dict):
                            merged = table_defaults.copy()
                            merged.update(table_config)
                            table_config = merged
                    style_name = table_config.get("style_preset", "clean")
                    style = table_style_presets.get(style_name, table_style_presets["clean"])
                    overflow_mode = table_config.get("overflow_mode", "split_columns")
                    split_columns = int(table_config.get("split_column_count", 6) or 6)

                    def _build_rl_table(tbl_headers, rows_data, col_width_pt):
                        table_rows = []
                        if tbl_headers:
                            table_rows.append(tbl_headers)
                        table_rows.extend(rows_data)
                        if not table_rows:
                            return None
                        num_c = len(table_rows[0]) if table_rows else 1
                        col_widths = [col_width_pt] * num_c
                        t = RLTable(table_rows, colWidths=col_widths, repeatRows=1 if tbl_headers else 0)
                        t.setStyle(TableStyle([
                            ('BACKGROUND', (0, 0), (-1, 0), style["header_bg"]),
                            ('TEXTCOLOR', (0, 0), (-1, 0), style["header_text"]),
                            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                            ('FONTSIZE', (0, 0), (-1, 0), 9),
                            ('FONTSIZE', (0, 1), (-1, -1), 8),
                            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
                            ('TOPPADDING', (0, 0), (-1, -1), 4),
                            ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
                            ('BACKGROUND', (0, 1), (-1, -1), style["row_bg"]),
                            ('GRID', (0, 0), (-1, -1), 0.5, style["grid"]),
                            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                            ('WORDWRAP', (0, 0), (-1, -1), True),
                        ]))
                        return t

                    # Add table caption/title above the table
                    if content.title:
                        story.append(RLParagraph(f"<b>{content.title}</b>", caption_style))
                        story.append(Spacer(1, 4))

                    if headers and split_columns > 0 and len(headers) > split_columns:
                        # Split wide tables into column chunks
                        chunks_indices = [list(range(i, min(i + split_columns, len(header_ids))))
                                          for i in range(0, len(header_ids), split_columns)]
                        for chunk_num, chunk_idx in enumerate(chunks_indices):
                            chunk_headers = [headers[i] for i in chunk_idx if i < len(headers)]
                            chunk_rows = [
                                [row[i] for i in chunk_idx if i < len(row)]
                                for row in rows
                            ]
                            chunk_col_width = content_width / len(chunk_headers) if chunk_headers else col_width
                            t = _build_rl_table(chunk_headers, chunk_rows, chunk_col_width)
                            if t:
                                if overflow_mode in {"split_columns", "separate_page"} and chunk_num > 0:
                                    story.append(PageBreak())
                                story.append(t)
                                story.append(Spacer(1, 12))
                    else:
                        t = _build_rl_table(headers, rows, col_width)
                        if t:
                            if overflow_mode == "rotate_page":
                                story.append(PageBreak())
                                story.append(RotatedTableFlowable(t))
                                story.append(PageBreak())
                            elif overflow_mode == "separate_page":
                                story.append(PageBreak())
                                story.append(t)
                                story.append(PageBreak())
                            else:
                                story.append(t)
                                story.append(Spacer(1, 12))
                except Exception as e:
                    print(f"Warning: Failed to add table: {e}")
                    story.append(RLParagraph(f"[Table: {content.title or 'Untitled'}]", styles['BodyText']))
                    story.append(Spacer(1, 6))

            elif content_type == 'image':
                if not content.is_visible:
                    continue
                image_ref = content.image_reference
                image_path = None
                if image_ref and getattr(image_ref, 'image', None):
                    try:
                        image_path = image_ref.image.path
                    except Exception:
                        image_path = None

                if not image_path:
                    story.append(RLParagraph("[Image missing]", styles['BodyText']))
                    story.append(Spacer(1, 6))
                    continue

                size_mode = getattr(content, 'size_mode', 'medium') or 'medium'
                width_pt = None
                height_pt = None
                if size_mode == 'small':
                    width_pt = content_width * 0.25
                elif size_mode == 'large':
                    width_pt = content_width * 0.75
                elif size_mode == 'full':
                    width_pt = content_width
                elif size_mode == 'custom':
                    if content.custom_width_percent:
                        width_pt = content_width * (content.custom_width_percent / 100.0)
                    elif content.custom_width_pixels:
                        width_pt = content.custom_width_pixels * 0.75
                    if content.custom_height_pixels:
                        height_pt = content.custom_height_pixels * 0.75
                else:
                    width_pt = content_width * 0.5

                try:
                    image_flowable = RLImage(image_path)
                    if width_pt:
                        if height_pt:
                            image_flowable.drawWidth = width_pt
                            image_flowable.drawHeight = height_pt
                        else:
                            aspect = image_flowable.imageHeight / float(image_flowable.imageWidth or 1)
                            image_flowable.drawWidth = width_pt
                            image_flowable.drawHeight = width_pt * aspect
                    _fit_image_in_frame(image_flowable, width_pt or content_width, doc.height)
                    alignment = getattr(content, 'alignment', 'center') or 'center'
                    if alignment == 'left':
                        image_flowable.hAlign = 'LEFT'
                    elif alignment == 'right':
                        image_flowable.hAlign = 'RIGHT'
                    else:
                        image_flowable.hAlign = 'CENTER'

                    story.append(Spacer(1, max(0, (content.margin_top or 0) * 0.75)))
                    story.append(image_flowable)
                    if content.show_caption and (content.caption or content.title):
                        caption_text = content.caption or content.title
                        story.append(Spacer(1, 4))
                        story.append(RLParagraph(caption_text, caption_style))
                    story.append(Spacer(1, max(0, (content.margin_bottom or 0) * 0.75)))
                except Exception as e:
                    print(f"Warning: Failed to render image: {e}")
                    story.append(RLParagraph("[Image failed to render]", styles['BodyText']))
                    story.append(Spacer(1, 6))

            elif content_type == 'file':
                if not content.is_visible:
                    continue
                file_ref = content.file_reference
                if not file_ref:
                    continue

                file_metadata = content.custom_metadata if isinstance(content.custom_metadata, dict) else {}
                defaults_file = processing_defaults.get("file_config") if isinstance(processing_defaults, dict) else {}
                if not isinstance(defaults_file, dict):
                    defaults_file = {}
                show_border = file_metadata.get('show_border')
                if show_border is None:
                    show_border = defaults_file.get('show_border', True)
                show_caption_metadata = file_metadata.get('show_caption_metadata')
                if show_caption_metadata is None:
                    show_caption_metadata = defaults_file.get('show_caption_metadata', False)

                story.append(Spacer(1, max(0, (content.margin_top or 0) * 0.75)))
                label = content.label or content.reference_number or "Attachment"
                filename = getattr(file_ref, 'name', '') or getattr(file_ref, 'file', None)
                file_type = (getattr(file_ref, 'file_type', '') or '').lower()
                file_size = getattr(file_ref, 'file_size', None)
                details = []
                if file_type:
                    details.append(file_type.upper())
                if file_size:
                    details.append(f"{file_size} bytes")
                page_range = content.page_range or defaults_file.get('page_range')
                if page_range:
                    details.append(f"Pages {page_range}")
                detail_text = " | ".join(details)

                if show_caption_metadata:
                    story.append(RLParagraph(f"<b>{label}</b>", caption_style))
                    if filename:
                        story.append(RLParagraph(f"{filename}", caption_style))
                    if detail_text:
                        story.append(RLParagraph(detail_text, caption_style))

                file_path = None
                try:
                    if file_ref.file:
                        file_path = file_ref.file.path
                except Exception:
                    file_path = None

                if file_path and file_type == "pdf":
                    try:
                        import fitz
                        from io import BytesIO
                        from reportlab.platypus import Table as RLTable, TableStyle

                        pdf_doc = fitz.open(file_path)
                        scale_percent = content.width_percent or defaults_file.get('width_percent') or 80
                        if scale_percent < 60:
                            scale_percent = 60
                        if scale_percent > 100:
                            scale_percent = 100
                        max_width = content_width * (scale_percent / 100.0)
                        pages_to_render = _parse_page_range(page_range, pdf_doc.page_count)
                        for page_index in pages_to_render:
                            page = pdf_doc.load_page(page_index)
                            pix = page.get_pixmap(dpi=150)
                            img_bytes = pix.tobytes("png")
                            pdf_image = RLImage(BytesIO(img_bytes))
                            aspect = pdf_image.imageHeight / float(pdf_image.imageWidth or 1)
                            pdf_image.drawWidth = max_width
                            pdf_image.drawHeight = max_width * aspect
                            _fit_image_in_frame(pdf_image, max_width, doc.height)
                            pdf_image.hAlign = "CENTER"

                            if story:
                                story.append(PageBreak())
                            if show_border:
                                border_table = RLTable([[pdf_image]])
                                border_table.setStyle(TableStyle([
                                    ('BOX', (0, 0), (-1, -1), 1, colors.black),
                                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                                ]))
                                story.append(border_table)
                            else:
                                story.append(pdf_image)

                            if show_caption_metadata:
                                caption_text = f"{label} — Page {page_index + 1}"
                                story.append(Spacer(1, 6))
                                story.append(RLParagraph(caption_text, caption_style))
                        pdf_doc.close()
                    except Exception as e:
                        print(f"Warning: Failed to render PDF file: {e}")
                elif file_path and file_type in {"png", "jpg", "jpeg", "gif", "webp"}:
                    try:
                        file_image = RLImage(file_path)
                        width_pt = content_width * 0.7
                        if content.width_percent:
                            width_pt = content_width * (content.width_percent / 100.0)
                        aspect = file_image.imageHeight / float(file_image.imageWidth or 1)
                        file_image.drawWidth = width_pt
                        file_image.drawHeight = width_pt * aspect
                        _fit_image_in_frame(file_image, width_pt, doc.height)
                        file_image.hAlign = "CENTER" if content.alignment == "center" else "LEFT"
                        story.append(Spacer(1, 6))
                        story.append(file_image)
                    except Exception as e:
                        print(f"Warning: Failed to render file image: {e}")

                story.append(Spacer(1, max(0, (content.margin_bottom or 0) * 0.75)))
        
        # Subsections
        subsections = section.children.all().order_by('order')
        for subsection in subsections:
            add_section_content(subsection, level + 1)
    
    # Add root sections
    if not is_latex_doc:
        root_sections = document.sections.filter(parent__isnull=True).order_by('order')
        for section in root_sections:
            add_section_content(section)
    
    # Build PDF — with LayoutError resilience
    from reportlab.platypus.doctemplate import LayoutError
    import copy as _copy

    # Deep-copy story so the retry has a pristine list if the first build mutates flowables
    story_backup = _copy.deepcopy(story)

    try:
        doc.build(story, onFirstPage=_draw_header_footer, onLaterPages=_draw_header_footer)
    except LayoutError as layout_exc:
        # A flowable was still too large for the frame (e.g. extreme header/footer
        # heights left almost no body area).  Retry with minimal margins so the
        # document always renders rather than returning a 500 error.
        print(
            f"WARNING: LayoutError on first build attempt — retrying with minimal "
            f"margins.  Original error: {layout_exc}"
        )
        output.seek(0)
        output.truncate()
        fallback_v_margin = max(margin, 18)  # keep at least 18pt (¼ in) top/bottom
        doc_retry = SimpleDocTemplate(
            output,
            pagesize=page_size,
            rightMargin=margin,
            leftMargin=margin,
            topMargin=fallback_v_margin,
            bottomMargin=fallback_v_margin,
        )
        # Re-assign so downstream latex-merge uses correct margins
        top_margin = fallback_v_margin
        bottom_margin = fallback_v_margin
        doc_retry.build(story_backup, onFirstPage=_draw_header_footer, onLaterPages=_draw_header_footer)
    
    pdf_bytes = output.getvalue()
    if latex_inline_refs:
        content_height = page_size[1] - top_margin - bottom_margin
        pdf_bytes = _merge_latex_pages(
            pdf_bytes,
            latex_inline_refs,
            page_size[0],
            page_size[1],
            content_width,
            content_height,
            margin,
            bottom_margin,
        )
    print(f"DEBUG: PDF generated, size: {len(pdf_bytes)} bytes")

    # ── Header/Footer PDF overlay (pypdf-based, preserves selectable text) ──
    if PdfReader is not None and PdfWriter is not None:
        _overlay_needed = False
        _header_overlay_path = None
        _footer_overlay_path = None
        _header_page_index = 0
        _footer_page_index = 0

        def _resolve_overlay_path(file_id, config):
            """Resolve file_id → filesystem path.

            Checks HeaderFooterPDF first (manual-crop model), then falls
            back to DocumentFile (legacy direct-upload model).
            Returns (path, page_index) or (None, 0).
            """
            if not file_id:
                return None, 0
            try:
                from documents.models import HeaderFooterPDF
                hf = HeaderFooterPDF.objects.get(id=file_id, is_active=True)
                if hf.cropped_file:
                    return hf.cropped_file.path, 0  # cropped files are always single-page
            except Exception:
                pass
            try:
                from documents.models import DocumentFile
                df = DocumentFile.objects.get(id=file_id)
                if df.file:
                    page_idx = max(int(config.get("page", 1)) - 1, 0) if config else 0
                    return df.file.path, page_idx
            except Exception:
                pass
            return None, 0

        if header_pdf_file_id and header_pdf_height > 0:
            _header_overlay_path, _header_page_index = _resolve_overlay_path(
                header_pdf_file_id, header_pdf_config,
            )
            if _header_overlay_path:
                _overlay_needed = True

        if footer_pdf_file_id and footer_pdf_height > 0:
            _footer_overlay_path, _footer_page_index = _resolve_overlay_path(
                footer_pdf_file_id, footer_pdf_config,
            )
            if _footer_overlay_path:
                _overlay_needed = True

        # Fallback: footer from same header_pdf file
        if not _footer_overlay_path and header_pdf_file_id and footer_pdf_height > 0:
            _footer_overlay_path = _header_overlay_path
            _footer_page_index = _header_page_index

        if _overlay_needed:
            try:
                pdf_bytes = _overlay_header_footer_pdf(
                    pdf_bytes,
                    header_pdf_path=_header_overlay_path,
                    footer_pdf_path=_footer_overlay_path,
                    header_height_pts=header_pdf_height,
                    footer_height_pts=footer_pdf_height,
                    header_page_index=_header_page_index,
                    footer_page_index=_footer_page_index,
                    header_config=header_pdf_config,
                    footer_config=footer_pdf_config,
                )
                print(f"DEBUG: Header/footer PDF overlay applied, new size: {len(pdf_bytes)} bytes")
            except Exception as exc:
                print(f"WARNING: Header/footer PDF overlay failed: {exc}")
                import traceback
                traceback.print_exc()

    # Text protection (rasterize to images + optional encrypted text attachment)
    text_protection = _resolve_text_protection(document, request)
    encrypted_text = None
    if text_protection.get("enabled"):
        if text_protection.get("mode") == "rasterize":
            if fitz is None:
                print("DEBUG: Skipping rasterize - PyMuPDF not available")
            else:
                pdf_bytes = _rasterize_pdf_bytes(pdf_bytes, int(text_protection.get("dpi") or 200))
        key = text_protection.get("encryption_key")
        if key:
            if Fernet is None:
                raise RuntimeError("cryptography is required for text-protection encryption")
            raw_text = _get_document_plain_text(document)
            if raw_text:
                fernet = Fernet(_derive_fernet_key(key))
                encrypted_text = fernet.encrypt(raw_text.encode("utf-8"))

    # Apply unprintable area annotations + metadata + encryption
    passwords = _resolve_pdf_passwords(document, request)
    if passwords.get("user_password") and (PdfReader is None or PdfWriter is None):
        raise RuntimeError("pypdf is required for PDF password encryption")
    return apply_pdf_layout(
        pdf_bytes,
        options,
        document,
        passwords,
        text_protection=text_protection,
        encrypted_text=encrypted_text,
    )


def apply_pdf_layout(
    pdf_bytes: bytes,
    options: PDFLayoutOptions,
    document,
    passwords: Optional[Dict[str, Optional[str]]] = None,
    text_protection: Optional[Dict[str, Any]] = None,
    encrypted_text: Optional[bytes] = None,
) -> bytes:
    """Apply layout enhancements (unprintable area indicators) using pypdf."""
    if not pdf_bytes or PdfReader is None or PdfWriter is None:
        print(f"DEBUG: Skipping PDF layout - pypdf not available or no bytes")
        return pdf_bytes

    print(f"DEBUG: apply_pdf_layout called")
    print(f"  show_unprintable_area: {options.show_unprintable_area}")
    print(f"  unprintable_area: {options.unprintable_area}")
    print(f"  margin_mm: {options.get_unprintable_margin_mm()}")

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()

    metadata = build_pdf_metadata(document)

    for page_num, page in enumerate(reader.pages):
        if options.show_unprintable_area and AnnotationBuilder is not None:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            
            print(f"  Page {page_num}: {width}pt x {height}pt")
            
            # Convert mm to points (1mm = 2.834645669 points)
            margin_mm = options.get_unprintable_margin_mm()
            margin_pt = margin_mm * 2.834645669
            
            print(f"  Adding border at {margin_pt}pt from edges")
            
            # Draw rectangle showing printable area boundary
            # This is INSIDE the unprintable margin
            printable_rect = AnnotationBuilder.rectangle(
                rect=(margin_pt, margin_pt, width - margin_pt, height - margin_pt),
                border_color=(0.9, 0.1, 0.1),  # Red to be very visible
                border_width=2.0,  # Thick border to be obvious
            )
            page.add_annotation(printable_rect)
            print(f"  Annotation added!")
        else:
            print(f"  Skipping page {page_num}: show={options.show_unprintable_area}, builder={AnnotationBuilder is not None}")
        writer.add_page(page)

    remove_metadata = bool(text_protection.get("remove_metadata")) if text_protection else False
    if metadata and not remove_metadata:
        writer.add_metadata(metadata)

    if encrypted_text:
        writer.add_attachment("document_text.enc", encrypted_text)

    if passwords:
        user_password = passwords.get("user_password")
        owner_password = passwords.get("owner_password")
        if user_password:
            writer.encrypt(user_password=user_password, owner_password=owner_password)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()