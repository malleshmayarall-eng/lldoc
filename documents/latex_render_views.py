import base64
import io
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Document, DocumentImage

try:  # Optional dependency for raster preview
    import fitz
except ImportError:  # pragma: no cover
    fitz = None

try:  # HTML → PDF conversion
    from xhtml2pdf import pisa
except ImportError:  # pragma: no cover
    pisa = None

try:
    from exporter.pdf_system import (
        PDFLayoutOptions,
        _overlay_header_footer_pdf,
        apply_pdf_layout,
        _rasterize_pdf_bytes,
        _resolve_text_protection,
        _resolve_pdf_passwords,
    )
    from exporter.pdf_metadata import build_pdf_metadata
    _HAS_PDF_SYSTEM = True
except ImportError:
    _HAS_PDF_SYSTEM = False


PGFPLOTS_OPTIMIZATION_SETTINGS = """\\pgfplotsset{
  /pgfplots/samples=40,
  /pgfplots/samples y=40,
  /pgfplots/mesh/rows=40,
  /pgfplots/mesh/cols=40,
  /pgfplots/shader=flat,
}"""


def _parse_bool(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _is_tex_memory_error(output: str) -> bool:
    lowered = output.lower()
    return "tex capacity exceeded" in lowered or "main memory size" in lowered


# ── LaTeX error log parsing ──────────────────────────────────────────────

_LATEX_ERROR_RE = re.compile(r'^!\s+(.+)', re.MULTILINE)
_LATEX_LINE_RE = re.compile(r'l\.(\d+)\s+(.*)', re.MULTILINE)
_LATEX_MISSING_PKG_RE = re.compile(
    r"(?:File|Package)\s+[`']?(\w+)(?:\.sty)?[`']?\s+not\s+found",
    re.IGNORECASE,
)
_LATEX_UNDEFINED_CS_RE = re.compile(
    r'Undefined control sequence.*?\\(\w+)',
    re.IGNORECASE,
)
_LATEX_MISSING_ENV_RE = re.compile(
    r"(?:Environment\s+(\w+)\s+undefined|No counter '(\w+)' defined)",
    re.IGNORECASE,
)

# Map of common undefined control sequences to the package that defines them
_COMMAND_TO_PACKAGE = {
    'toprule': 'booktabs', 'midrule': 'booktabs', 'bottomrule': 'booktabs',
    'cmidrule': 'booktabs', 'addlinespace': 'booktabs',
    'multirow': 'multirow', 'multicolumn': None,
    'href': 'hyperref', 'url': 'hyperref', 'hyperlink': 'hyperref',
    'textcolor': 'xcolor', 'colorbox': 'xcolor', 'definecolor': 'xcolor',
    'rowcolor': 'xcolor', 'cellcolor': 'xcolor', 'columncolor': 'xcolor',
    'includegraphics': 'graphicx',
    'geometry': 'geometry', 'newgeometry': 'geometry',
    'lstlisting': 'listings', 'lstset': 'listings', 'lstinputlisting': 'listings',
    'mintinline': 'minted', 'inputminted': 'minted',
    'SI': 'siunitx', 'si': 'siunitx', 'num': 'siunitx',
    'cref': 'cleveref', 'Cref': 'cleveref',
    'subfigure': 'subcaption', 'subcaption': 'subcaption',
    'setstretch': 'setspace', 'doublespacing': 'setspace', 'singlespacing': 'setspace',
    'lipsum': 'lipsum', 'blindtext': 'blindtext',
    'adjustbox': 'adjustbox',
    'cancel': 'cancel', 'bcancel': 'cancel', 'xcancel': 'cancel',
    'FloatBarrier': 'placeins',
    'uline': 'ulem', 'sout': 'ulem',
    'tcolorbox': 'tcolorbox',
    'chemfig': 'chemfig',
    'tikz': 'tikz',
    'setmainfont': 'fontspec', 'setsansfont': 'fontspec', 'setmonofont': 'fontspec',
    'newfontfamily': 'fontspec', 'defaultfontfeatures': 'fontspec',
}

# Map environment names to their providing packages
_ENV_TO_PACKAGE = {
    'lstlisting': 'listings', 'minted': 'minted',
    'tikzpicture': 'tikz', 'axis': 'pgfplots',
    'longtable': 'longtable', 'supertabular': 'supertabular',
    'tabularx': 'tabularx', 'tabulary': 'tabulary',
    'multicols': 'multicol',
    'wrapfigure': 'wrapfig', 'wraptable': 'wrapfig',
    'subfigure': 'subcaption', 'subfloat': 'subfig',
    'adjustbox': 'adjustbox',
    'tcolorbox': 'tcolorbox',
    'algorithm': 'algorithm2e', 'algorithmic': 'algorithmicx',
    'forest': 'forest',
    'circuitikz': 'circuitikz',
}

# Friendly error messages for common LaTeX errors
_FRIENDLY_ERRORS = {
    'undefined control sequence': 'Unknown command found. This usually means a required package is missing.',
    'missing $ inserted': 'Math mode issue — a $ sign may be missing or mismatched.',
    'environment .* undefined': 'Unknown environment. The package that defines it may not be loaded.',
    'file .* not found': 'A required file or package could not be found.',
    'missing \\\\begin\\{document\\}': 'The document is missing \\begin{document}.',
    'misplaced alignment tab': 'A & character was used outside a table/alignment environment.',
    'extra alignment tab': 'Too many columns in a table row (extra &).',
    'package .* error': 'A LaTeX package reported an error.',
    'option clash': 'A package was loaded twice with different options.',
    'too many unprocessed floats': 'Too many figures/tables without enough text. Try adding \\clearpage.',
    'dimension too large': 'A measurement is too large for TeX to handle.',
    'illegal parameter number': 'Incorrect use of # in a macro definition.',
    'tex capacity exceeded': 'TeX ran out of memory. Simplify the document or reduce plot complexity.',
}

# Image formats XeLaTeX can handle natively.  Anything else (avif, webp,
# heic, tiff, bmp, svg …) must be converted to PNG before compilation.
_XELATEX_SUPPORTED_IMG_EXTS = frozenset({
    '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.bmp',
})


def _convert_image_for_latex(src_path: Path, dest_path: Path) -> bool:
    """Copy *src_path* to *dest_path*, converting to PNG if the format
    is not natively supported by XeLaTeX.

    Returns ``True`` on success, ``False`` on failure.
    """
    src_ext = src_path.suffix.lower()
    dest_ext = dest_path.suffix.lower()

    # If the destination is already a supported format and matches the
    # source, a simple copy is sufficient.
    if src_ext == dest_ext and src_ext in _XELATEX_SUPPORTED_IMG_EXTS:
        try:
            shutil.copy2(str(src_path), str(dest_path))
            return True
        except Exception:
            return False

    # Need conversion → use Pillow
    try:
        from PIL import Image as _PILImage
        with _PILImage.open(str(src_path)) as img:
            # Convert to RGB(A) so .save(format='PNG') always works.
            # Some formats (e.g. palette mode) need explicit conversion.
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGBA' if 'A' in (img.mode or '') else 'RGB')
            img.save(str(dest_path), format='PNG')
        return True
    except Exception:
        # Fallback: try a plain copy — XeLaTeX might handle it or will
        # report a clear error.
        try:
            shutil.copy2(str(src_path), str(dest_path))
        except Exception:
            pass
        return False


def _parse_latex_errors(log_output: str) -> dict:
    """Parse XeLaTeX log output and return structured error information.

    Returns:
        {
            'error_lines': [{'line': int|None, 'message': str, 'context': str}, ...],
            'error_summary': str,   # Human-friendly one-line summary
            'missing_packages': [str, ...],  # Packages that could fix the error
            'raw_errors': [str, ...],  # The raw ! Error lines
        }
    """
    if not log_output:
        return {
            'error_lines': [],
            'error_summary': 'Unknown compilation error',
            'missing_packages': [],
            'raw_errors': [],
        }

    raw_errors = _LATEX_ERROR_RE.findall(log_output)
    line_matches = _LATEX_LINE_RE.findall(log_output)

    error_lines = []
    seen_messages = set()
    for i, err_msg in enumerate(raw_errors):
        msg = err_msg.strip()
        if msg in seen_messages:
            continue
        seen_messages.add(msg)

        # Try to find the line number from a nearby l.NNN match
        line_num = None
        context = ''
        if i < len(line_matches):
            try:
                line_num = int(line_matches[i][0])
            except (ValueError, IndexError):
                pass
            context = line_matches[i][1] if len(line_matches[i]) > 1 else ''

        error_lines.append({
            'line': line_num,
            'message': msg,
            'context': context.strip(),
        })

    # Detect missing packages from the log
    missing_packages = set()
    for m in _LATEX_MISSING_PKG_RE.finditer(log_output):
        pkg = m.group(1).strip().lower()
        if pkg and pkg not in ('document', 'error'):
            missing_packages.add(pkg)

    # Detect missing packages from undefined control sequences
    for m in _LATEX_UNDEFINED_CS_RE.finditer(log_output):
        cmd = m.group(1).strip()
        pkg = _COMMAND_TO_PACKAGE.get(cmd)
        if pkg:
            missing_packages.add(pkg)

    # Detect missing packages from undefined environments
    for m in _LATEX_MISSING_ENV_RE.finditer(log_output):
        env = (m.group(1) or m.group(2) or '').strip()
        pkg = _ENV_TO_PACKAGE.get(env)
        if pkg:
            missing_packages.add(pkg)

    # Build friendly summary
    summary = 'LaTeX compilation failed'
    lowered = log_output.lower()
    for pattern, friendly in _FRIENDLY_ERRORS.items():
        if re.search(pattern, lowered):
            summary = friendly
            break

    # ── Special handling for "Emergency stop" ──
    # This is a very generic XeLaTeX error.  Try to extract more context
    # from the log around the emergency stop.
    if any('emergency stop' in e.lower() for e in raw_errors):
        # Look for the real error preceding the emergency stop
        preceding_errors = [
            e for e in raw_errors
            if 'emergency stop' not in e.lower()
        ]
        if preceding_errors:
            summary = preceding_errors[0].strip()
        else:
            # Try to find context from "! " lines in the raw log
            context_lines = re.findall(
                r'^!\s+(.+?)$|^l\.(\d+)\s+(.+?)$',
                log_output, re.MULTILINE,
            )
            context_msgs = [
                c[0] or c[2]
                for c in context_lines
                if (c[0] or c[2]).strip()
                and 'emergency stop' not in (c[0] or c[2]).lower()
            ]
            if context_msgs:
                summary = context_msgs[0].strip()
            else:
                # Check for common emergency-stop causes in the log
                if 'no \\begin{document}' in lowered:
                    summary = 'Missing \\begin{document} — the document structure is broken.'
                elif 'file ended' in lowered:
                    summary = 'Unexpected end of file — likely an unclosed brace or environment.'
                elif 'forbidden' in lowered or 'i can\'t find file' in lowered:
                    summary = 'A required file could not be found.'
                else:
                    summary = 'Emergency stop — the document has a fundamental structural error.'

    if missing_packages:
        summary += f" (missing: {', '.join(sorted(missing_packages))})"

    return {
        'error_lines': error_lines[:10],  # Cap at 10 errors
        'error_summary': summary,
        'missing_packages': sorted(missing_packages),
        'raw_errors': raw_errors[:10],
    }


# ── Metadata placeholder resolution ─────────────────────────────────────

def _latex_escape(val: str) -> str:
    """Escape special LaTeX characters in a metadata value."""
    replacements = [
        ('\\', r'\textbackslash{}'),
        ('&', r'\&'),
        ('%', r'\%'),
        ('$', r'\$'),
        ('#', r'\#'),
        ('_', r'\_'),
        ('{', r'\{'),
        ('}', r'\}'),
        ('~', r'\textasciitilde{}'),
        ('^', r'\textasciicircum{}'),
    ]
    for char, escaped in replacements:
        val = val.replace(char, escaped)
    return val


def _flatten_dict(data, parent_key='', sep='.'):
    items = {}
    for key, value in (data or {}).items():
        new_key = f"{parent_key}{sep}{key}" if parent_key else str(key)
        if isinstance(value, dict):
            items.update(_flatten_dict(value, new_key, sep=sep))
        else:
            items[new_key] = value
    return items


def _normalize(key: str) -> str:
    return re.sub(r'[^A-Za-z0-9]+', '_', key).strip('_').lower()


def _ensure_xcolor(latex_code: str) -> str:
    """Inject ``\\usepackage{xcolor}`` into the preamble when the resolved
    code contains ``\\textcolor`` (from red-highlighted unresolved
    placeholders) but doesn't already load xcolor.

    Works for documents that have a ``\\begin{document}`` marker.  For
    bare snippets that will be wrapped later, ``_prepare_latex_document``
    is responsible for including xcolor in the generated preamble.
    """
    if r'\textcolor' not in latex_code:
        return latex_code
    if r'\usepackage{xcolor}' in latex_code or (r'\usepackage[' in latex_code and 'xcolor' in latex_code):
        return latex_code
    # Inject right before \begin{document}
    marker = r'\begin{document}'
    idx = latex_code.find(marker)
    if idx == -1:
        return latex_code
    return latex_code[:idx] + '\\usepackage{xcolor}\n' + latex_code[idx:]


# ── Image placeholder resolution for LaTeX ───────────────────────────────

_IMAGE_PLACEHOLDER_RE = re.compile(r'\[\[image:([^\]]+)\]\]')
_UUID_RE = re.compile(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
    r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)


def resolve_image_placeholders_latex(latex_code, document):
    """Replace ``[[image:...]]`` placeholders in LaTeX source with
    ``\\includegraphics`` commands pointing to real image files.

    Respects ``%%img-opts:name:opts%%`` comments left by
    ``sanitize_ai_latex_code`` (which unwraps AI-generated
    ``\\includegraphics[opts]{[[image:name]]}``).  When present,
    the AI's original formatting options (width, height, etc.) are used
    instead of the default ``width=\\linewidth``.

    Returns:
        (resolved_latex_code: str, image_files: list[tuple[str, Path]])
        where each image_files entry is (filename_in_texdir, absolute_path).
        The caller must copy/symlink these files into the XeLaTeX temp
        directory before compilation.
    """
    if '[[image:' not in latex_code:
        return latex_code, []

    meta = document.document_metadata or {}
    img_map = meta.get('_image_placeholders', {})  # {name: uuid_or_None}

    # ── Parse %%img-opts:name:opts%% comments for AI-specified dimensions ──
    img_opts_map = {}  # {placeholder_name: "width=3cm, ..."}
    for m in re.finditer(r'%%img-opts:([^:]+):([^%]+)%%', latex_code):
        img_opts_map[m.group(1).strip()] = m.group(2).strip()
    # Remove the comments so they don't appear in the final output
    latex_code = re.sub(r'%%img-opts:[^%]+%%\n?', '', latex_code)

    # Collect all UUIDs we need to resolve
    tokens = _IMAGE_PLACEHOLDER_RE.findall(latex_code)
    if not tokens:
        return latex_code, []

    all_uuids = set()
    for token in tokens:
        token = token.strip()
        if _UUID_RE.match(token):
            all_uuids.add(token)
        else:
            # Named slot — check if mapped
            mapped = img_map.get(token)
            if mapped:
                all_uuids.add(str(mapped))

    # Fetch all DocumentImage objects in one query
    uuid_to_image = {}
    if all_uuids:
        for img_obj in DocumentImage.objects.filter(id__in=list(all_uuids)):
            uuid_to_image[str(img_obj.id)] = img_obj

        # Fallback: check Attachment table for any UUIDs not found in
        # DocumentImage (images uploaded via the centralised attachments
        # endpoint may only exist as Attachment records).
        missing_uuids = all_uuids - set(uuid_to_image.keys())
        if missing_uuids:
            try:
                from attachments.models import Attachment
                for att in Attachment.objects.filter(
                    id__in=list(missing_uuids), file_kind='image',
                ):
                    uuid_to_image[str(att.id)] = att  # duck-typed: has .file / .id
            except Exception:
                pass  # attachments app may not be installed

    image_files = []  # (filename, absolute_path) pairs
    seen_filenames = set()

    def _get_image_latex(img_obj, label='', options=''):
        r"""Build ``\includegraphics`` command for a DocumentImage (or
        Attachment) and register the file for copying into the temp dir.

        *options*: LaTeX options string from the code / AI (e.g.
        ``"width=3cm"``).  When the code specifies explicit sizing it
        is used verbatim — the image's native resolution is irrelevant.

        When *options* is empty (bare ``[[image:…]]`` placeholder) the
        default is ``max width=\linewidth,keepaspectratio`` which
        renders the image at its natural size but caps it at the text
        width so it never overflows the page.  This requires the
        ``adjustbox`` package with the ``export`` option (injected
        automatically alongside ``graphicx``).
        """
        # Duck-type: DocumentImage has .image, Attachment has .file
        file_field = getattr(img_obj, 'image', None) or getattr(img_obj, 'file', None)
        if not img_obj or not file_field:
            safe_label = _latex_escape(label or 'Image')
            return r'\textcolor{red}{\mbox{[' + safe_label + r']}}'

        abs_path = Path(file_field.path)
        if not abs_path.exists():
            safe_label = _latex_escape(label or 'Image')
            return r'\textcolor{red}{\mbox{[' + safe_label + r']}}'

        ext = abs_path.suffix.lower() or '.png'
        # XeLaTeX cannot handle AVIF, WebP, HEIC, etc. — these will be
        # converted to PNG when copied into the temp directory, so the
        # \includegraphics filename must reference the .png version.
        if ext not in _XELATEX_SUPPORTED_IMG_EXTS:
            ext = '.png'
        fname = f"img_{img_obj.id}{ext}"
        if fname not in seen_filenames:
            seen_filenames.add(fname)
            image_files.append((fname, abs_path))

        # Code-specified options take priority — image native resolution
        # is never used for sizing.  The fallback keeps the natural size
        # but caps at \linewidth to prevent overflow.
        if not options:
            options = r'max width=\linewidth,keepaspectratio'
        return r'\includegraphics[' + options + ']{' + fname + '}'

    def _replace_match(match):
        token = match.group(1).strip()

        # Look up AI-specified formatting options for this placeholder
        opts = img_opts_map.get(token, '')

        if _UUID_RE.match(token):
            img_obj = uuid_to_image.get(token)
            return _get_image_latex(img_obj, label=token[:8], options=opts)

        # Named slot
        mapped_uuid = img_map.get(token)
        if mapped_uuid:
            img_obj = uuid_to_image.get(str(mapped_uuid))
            return _get_image_latex(img_obj, label=token, options=opts)

        # Unmapped named slot — show red placeholder text
        safe_name = _latex_escape(token)
        return r'\textcolor{red}{\mbox{[Image: ' + safe_name + r']}}'

    resolved = _IMAGE_PLACEHOLDER_RE.sub(_replace_match, latex_code)

    # Ensure graphicx + adjustbox[export] are loaded.
    # adjustbox with 'export' adds 'max width' as a valid key for
    # \includegraphics so images render at their natural size but never
    # overflow the text width.
    if image_files:
        marker = r'\begin{document}'
        idx = resolved.find(marker)
        if idx != -1:
            pkgs = ''
            if r'\usepackage{graphicx}' not in resolved and r'\usepackage[export]{adjustbox}' not in resolved:
                pkgs += '\\usepackage{graphicx}\n'
            if 'adjustbox' not in resolved:
                pkgs += '\\usepackage[export]{adjustbox}\n'
            if pkgs:
                resolved = resolved[:idx] + pkgs + resolved[idx:]

    # Ensure xcolor is loaded for red placeholder text
    resolved = _ensure_xcolor(resolved)

    return resolved, image_files


def resolve_latex_metadata(latex_code: str, document, extra_metadata: dict | None = None) -> str:
    """
    Replace [[field_name]] placeholders in LaTeX source with values from
    document.document_metadata + document.custom_metadata + optional extra_metadata.
    Values are LaTeX-escaped to prevent compilation errors.
    extra_metadata (if provided) takes highest priority.
    """
    if '[[' not in latex_code:
        return latex_code

    metadata = {}
    try:
        if document.document_metadata:
            metadata = dict(document.document_metadata)
        if document.custom_metadata:
            for k, v in document.custom_metadata.items():
                if isinstance(v, dict) and isinstance(metadata.get(k), dict):
                    metadata[k].update(v)
                else:
                    metadata[k] = v
    except Exception:
        pass

    # Merge extra metadata with highest priority
    if extra_metadata and isinstance(extra_metadata, dict):
        for k, v in extra_metadata.items():
            if isinstance(v, dict) and isinstance(metadata.get(k), dict):
                metadata[k].update(v)
            else:
                metadata[k] = v

    if not metadata:
        return latex_code

    flat = _flatten_dict(metadata)
    lookup = {}
    for key, value in flat.items():
        if value is None:
            continue
        key_str = str(key)
        leaf = key_str.split('.')[-1]
        escaped = _latex_escape(str(value))
        lookup[_normalize(key_str)] = escaped
        lookup[_normalize(leaf)] = escaped

    if not lookup:
        return latex_code

    pattern = re.compile(r'\[\[([^\]]+)\]\]')

    def _replace(match):
        token = match.group(1).strip()
        value = lookup.get(_normalize(token))
        if value is None:
            return match.group(0)  # leave unresolved for later escaping
        # If the placeholder is directly preceded by a backslash-command
        # (e.g. \author[[name]]), wrap the value in braces so it becomes
        # \author{value} rather than \authorvalue (undefined control sequence).
        start = match.start()
        if start > 0:
            preceding = latex_code[:start]
            # Check if immediately preceded by a \command (letters only, no space/brace)
            if re.search(r'\\[A-Za-z]+$', preceding):
                return '{' + value + '}'
        return value

    resolved = pattern.sub(_replace, latex_code)

    # First, substitute preamble-specific defaults (font sizes, font names)
    # for unresolved placeholders in critical preamble commands.
    resolved = _sanitize_preamble_placeholders(resolved)

    # Then escape any remaining unresolved [[...]] so they render as visible
    # red text rather than being parsed as LaTeX commands (e.g. \[[X]] → \[ math).
    resolved = _escape_unresolved_placeholders(resolved)

    # If we injected \textcolor{red}{...}, ensure xcolor is loaded
    resolved = _ensure_xcolor(resolved)

    return resolved


# ── Preamble placeholder sanitization ──────────────────────────────────

# Default replacements for unresolved [[...]] in preamble commands
_PREAMBLE_DEFAULTS = {
    'font_size': '12pt',
    'font_family': 'Latin Modern Roman',
}


def _sanitize_preamble_placeholders(latex_code: str) -> str:
    """Replace unresolved [[...]] placeholders that appear inside preamble
    commands (\\documentclass, \\usepackage, \\geometry, etc.)
    with safe defaults so XeLaTeX doesn't crash.

    Font commands (\\setmainfont, \\setsansfont, \\setmonofont) are handled
    separately by ``sanitize_ai_latex_code`` which strips them entirely.

    Placeholders in the document body are left alone — they render as visible
    text which is acceptable.
    """
    # \documentclass[[[...]]]{...} → \documentclass[12pt]{...}
    latex_code = re.sub(
        r'(\\documentclass\[)\[\[([^\]]*)\]\](\]\{)',
        lambda m: m.group(1) + _PREAMBLE_DEFAULTS.get(
            m.group(2).rsplit('.', 1)[-1], '12pt'
        ) + m.group(3),
        latex_code,
    )

    return latex_code


def _escape_unresolved_placeholders(latex_code: str) -> str:
    """Escape any remaining ``[[...]]`` placeholders so they render as
    **red** visible text instead of being misinterpreted by LaTeX.

    Two problems this solves:
    1. ``\\[[X]]`` is parsed as ``\\[`` (display math opener) + ``X]]``
    2. Bare brackets inside ``\\multicolumn`` / tabular alignment can break
       brace counting and produce "Missing \\cr" errors.

    Strategy: replace ``[[key]]`` (with or without a preceding backslash)
    with ``\\textcolor{red}{\\mbox{[key]}}``.  The key text has LaTeX-special
    chars escaped.  ``\\mbox`` is inert in alignment contexts and prevents
    bracket / brace reinterpretation.  ``\\textcolor`` (from xcolor) highlights
    unfilled placeholders in red so they stand out in the rendered PDF.
    """
    def _safe_placeholder(match):
        key = match.group(1).strip()
        # Escape LaTeX-special characters in the key name
        safe = key.replace('_', r'\_').replace('&', r'\&').replace('#', r'\#').replace('%', r'\%')
        return r'\textcolor{red}{\mbox{[' + safe + r']}}'

    # Handle \[[key]] first (backslash before brackets), then bare [[key]]
    return re.sub(r'\\?\[\[([^\]]+)\]\]', _safe_placeholder, latex_code)


# ── AI-generated LaTeX sanitization ────────────────────────────────────

# Regex to detect \includegraphics wrapping an [[image:...]] or [[...]] placeholder.
# Captures: (1) options e.g. "width=3cm", (2) the full placeholder e.g. "[[image:logo]]"
# or "[[logo_image]]", (3) trailing text on the same line (e.g. \par\vspace{1cm}).
_INCLUDEGRAPHICS_PLACEHOLDER_RE = re.compile(
    r'\\includegraphics\s*'
    r'(?:\[([^\]]*)\])?\s*'       # group 1: optional [options]
    r'\{\s*(\[\[[^\]]+\]\])\s*\}'  # group 2: [[placeholder]] inside braces
    r'([^\n]*)',                    # group 3: rest of line (e.g. \par\vspace{...})
)


def _unwrap_includegraphics_placeholders(latex_code: str) -> str:
    r"""Unwrap ``\includegraphics[opts]{[[image:name]]}`` into bare
    ``[[image:name]]`` so that ``resolve_image_placeholders_latex`` can
    handle the placeholder and generate its own ``\includegraphics``.

    The AI's original formatting options (width, height, etc.) are preserved
    as a ``%%img-opts:name:opts%%`` comment on the line above, which
    ``resolve_image_placeholders_latex`` reads to honour the AI's intended
    dimensions.

    Also handles the case where the AI writes ``[[logo_image]]`` (no
    ``image:`` prefix) — these are normalised to ``[[image:logo_image]]``
    when they look like image-related placeholder names.
    """
    if '\\includegraphics' not in latex_code or '[[' not in latex_code:
        return latex_code

    def _replacement(m):
        opts = (m.group(1) or '').strip()        # e.g. "width=3cm"
        placeholder = m.group(2).strip()          # e.g. "[[image:logo]]" or "[[logo_image]]"
        trailing = (m.group(3) or '').strip()     # e.g. "\par\vspace{1cm}"

        # Normalise: if placeholder is [[some_name]] (no image: prefix) and
        # looks like an image name, convert to [[image:some_name]]
        inner = placeholder[2:-2]  # strip [[ and ]]
        if not inner.startswith('image:'):
            # Heuristic: name contains image-related keywords
            lower = inner.lower()
            image_keywords = ('logo', 'image', 'img', 'photo', 'picture',
                              'signature', 'stamp', 'seal', 'icon', 'badge',
                              'diagram', 'chart', 'figure', 'letterhead',
                              'header_bg', 'footer_bg', 'background', 'banner',
                              'watermark', 'avatar', 'thumbnail')
            if any(kw in lower for kw in image_keywords):
                placeholder = f'[[image:{inner}]]'

        # Extract the name for the opts comment
        ph_inner = placeholder[2:-2]  # e.g. "image:logo" or "some_field"
        name_part = ph_inner.split(':', 1)[-1] if ':' in ph_inner else ph_inner

        parts = []
        if opts:
            # Preserve the AI's intended formatting as a resolvable comment
            parts.append(f'%%img-opts:{name_part}:{opts}%%')
        parts.append(placeholder)
        if trailing:
            parts.append(trailing)
        return '\n'.join(parts)

    return _INCLUDEGRAPHICS_PLACEHOLDER_RE.sub(_replacement, latex_code)


def sanitize_ai_latex_code(latex_code: str) -> str:
    """Fix common errors in AI-generated LaTeX code that cause compilation
    failures.  This should be applied:
    1. Immediately after receiving code from the AI model.
    2. As a safety net before XeLaTeX compilation.

    Fixes applied:
    - ``\\includegraphics[opts]{[[image:name]]}``: unwrap so the image
      placeholder system can resolve it properly, preserving AI dimensions
    - ``\\includegraphics[...]{}``: empty path → remove the whole command
    - ``\\includegraphics[...]{http...}``: URL paths → remove
    - ``\\input{}``, ``\\include{}``: empty file references → remove
    - ``\\documentclass12pt]{article}`` → ``\\documentclass[12pt]{article}``
    - ``\\href{}{}``: empty URL → replace with just the link text
    - Duplicate ``\\begin{document}`` / ``\\end{document}`` → remove extras
    - Misplaced ``\\usepackage`` after ``\\begin{document}`` → move to preamble
    - Unclosed environments → auto-close
    - Common typos in LaTeX commands
    """
    if not latex_code:
        return latex_code

    # ── Unwrap \includegraphics{[[image:...]]} → bare [[image:...]] ──
    latex_code = _unwrap_includegraphics_placeholders(latex_code)

    # ── Fix \includegraphics with empty path ──
    latex_code = re.sub(
        r'\\includegraphics\s*(?:\[[^\]]*\])?\s*\{\s*\}[^\n]*',
        r'% [sanitized: removed \\includegraphics with empty path]',
        latex_code,
    )

    # ── Fix \includegraphics pointing to raw HTTP(S) URLs ──
    latex_code = re.sub(
        r'\\includegraphics\s*(?:\[[^\]]*\])?\s*\{\s*https?://[^}]*\}',
        r'% [sanitized: removed \\includegraphics with URL path — use [[image:name]] placeholders instead]',
        latex_code,
    )

    # ── Fix \input{} and \include{} with empty path ──
    latex_code = re.sub(
        r'\\(?:input|include)\s*\{\s*\}',
        r'% [sanitized: removed empty \\input/\\include]',
        latex_code,
    )

    # ── Fix \documentclass missing opening bracket ──
    latex_code = re.sub(
        r'\\documentclass(?!\[)(\d+\s*pt)\]',
        r'\\documentclass[\1]',
        latex_code,
    )

    # ── Fix \href with empty URL ──
    latex_code = re.sub(
        r'\\href\s*\{\s*\}\s*\{([^}]*)\}',
        r'\1',
        latex_code,
    )

    # ── Fix \url{} with empty URL ──
    latex_code = re.sub(
        r'\\url\s*\{\s*\}',
        r'% [sanitized: removed empty \\url]',
        latex_code,
    )

    # ── Strip fontspec font commands ─────────────────────────────────
    # AI frequently generates \setmainfont{Roboto}, \setsansfont{Helvetica}
    # etc. referencing system fonts that may not be installed on the
    # compilation server.  The default Latin Modern fonts bundled with
    # TeX Live are always available and produce professional output.
    # We comment these commands out (including optional [opts]) so the
    # document compiles reliably on any machine.
    latex_code = re.sub(
        r'^\s*\\(?:setmainfont|setsansfont|setmonofont|newfontfamily\s*\\[a-zA-Z]+)'
        r'\s*(?:\[[^\]]*\])?\s*\{[^}]*\}[^\n]*',
        r'% [sanitized: removed font command — system font may not be available]',
        latex_code,
        flags=re.MULTILINE,
    )
    # Also strip \defaultfontfeatures which is useless without font commands
    latex_code = re.sub(
        r'^\s*\\defaultfontfeatures\s*(?:\[[^\]]*\])?\s*\{[^}]*\}[^\n]*',
        r'% [sanitized: removed \\defaultfontfeatures]',
        latex_code,
        flags=re.MULTILINE,
    )
    # Strip \usepackage{fontspec} itself — XeLaTeX works fine without it
    # when no font commands are used (it uses Latin Modern by default).
    latex_code = re.sub(
        r'^\s*\\usepackage\s*(?:\[[^\]]*\])?\s*\{fontspec\}[^\n]*',
        r'% [sanitized: removed fontspec — using default Latin Modern fonts]',
        latex_code,
        flags=re.MULTILINE,
    )

    # ── Remove empty \begin{figure}...\end{figure} blocks ──
    latex_code = re.sub(
        r'\\begin\{figure\}\s*(?:\[[^\]]*\])?\s*'
        r'(?:\\centering\s*)?'
        r'(?:%\s*\[sanitized:[^\n]*\]\s*)*'
        r'(?:\\caption\{[^}]*\}\s*)?'
        r'(?:\\label\{[^}]*\}\s*)?'
        r'\\end\{figure\}',
        r'% [sanitized: removed empty figure environment]',
        latex_code,
    )

    # ── Fix duplicate \begin{document} ──
    # Keep only the first occurrence
    doc_begins = [m.start() for m in re.finditer(r'\\begin\{document\}', latex_code)]
    if len(doc_begins) > 1:
        # Remove all but the first
        for pos in reversed(doc_begins[1:]):
            end = pos + len('\\begin{document}')
            latex_code = latex_code[:pos] + '% [sanitized: removed duplicate \\begin{document}]' + latex_code[end:]

    # ── Fix duplicate \end{document} ──
    doc_ends = [m.start() for m in re.finditer(r'\\end\{document\}', latex_code)]
    if len(doc_ends) > 1:
        for pos in reversed(doc_ends[:-1]):
            end = pos + len('\\end{document}')
            latex_code = latex_code[:pos] + '% [sanitized: removed duplicate \\end{document}]' + latex_code[end:]

    # ── Move misplaced \usepackage after \begin{document} into preamble ──
    begin_doc_match = re.search(r'\\begin\{document\}', latex_code)
    if begin_doc_match:
        body_start = begin_doc_match.end()
        body = latex_code[body_start:]
        preamble_part = latex_code[:begin_doc_match.start()]

        # Find \usepackage lines in the body and move them to preamble
        misplaced = re.findall(r'(\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]+\})[^\n]*\n?', body)
        if misplaced:
            for pkg_line in misplaced:
                body = body.replace(pkg_line, '% [sanitized: moved to preamble] ' + pkg_line, 1)
                if pkg_line not in preamble_part:
                    preamble_part = preamble_part.rstrip() + '\n' + pkg_line + '\n'
            latex_code = preamble_part + '\\begin{document}' + body

    # ── Fix unclosed environments ──
    # Track \begin{env} and \end{env} to detect unclosed ones
    env_begins = re.findall(r'\\begin\{(\w+)\}', latex_code)
    env_ends = re.findall(r'\\end\{(\w+)\}', latex_code)
    # Simple stack-based check for common floating environments
    _closeable_envs = {
        'figure', 'table', 'tabular', 'tabularx', 'itemize', 'enumerate',
        'description', 'center', 'flushleft', 'flushright', 'minipage',
        'abstract', 'quote', 'quotation', 'verbatim', 'verse', 'multicols',
        'align', 'align*', 'equation', 'equation*', 'gather', 'gather*',
        'longtable', 'tcolorbox', 'lstlisting', 'minted',
    }
    begin_counts = {}
    end_counts = {}
    for env in env_begins:
        if env in _closeable_envs:
            begin_counts[env] = begin_counts.get(env, 0) + 1
    for env in env_ends:
        if env in _closeable_envs:
            end_counts[env] = end_counts.get(env, 0) + 1

    # Append missing \end{env} before \end{document} or at the end
    missing_ends = []
    for env, count in begin_counts.items():
        end_count = end_counts.get(env, 0)
        if count > end_count:
            missing_ends.extend([env] * (count - end_count))

    if missing_ends:
        end_doc_match = re.search(r'\\end\{document\}', latex_code)
        insert_point = end_doc_match.start() if end_doc_match else len(latex_code)
        fix = '\n'.join(f'\\end{{{env}}}  % [sanitized: auto-closed]' for env in reversed(missing_ends))
        latex_code = latex_code[:insert_point] + '\n' + fix + '\n' + latex_code[insert_point:]

    # ── Fix common command typos from AI ──
    _TYPO_FIXES = {
        r'\\being\{': r'\\begin{',
        r'\\ned\{': r'\\end{',
        r'\\itme\b': r'\\item',
        r'\\sectoin\b': r'\\section',
        r'\\subsectoin\b': r'\\subsection',
        r'\\tbextbf\b': r'\\textbf',
        r'\\texitit\b': r'\\textit',
        r'\\labael\b': r'\\label',
        r'\\captoin\b': r'\\caption',
    }
    for typo, fix in _TYPO_FIXES.items():
        latex_code = re.sub(typo, fix, latex_code)

    return latex_code


# ── Lightweight compilation verification for AI-generated code ──────────

def verify_latex_compilation(latex_code: str, max_retries: int = 1) -> dict:
    """Quick-compile *latex_code* to check for errors without producing a
    full PDF preview.  Returns a dict:

        {
            'compiled': bool,
            'fixed_code': str | None,   # non-None when auto-fix was applied
            'errors': { ... },          # output of _parse_latex_errors
        }

    The function:
    1. Wraps *latex_code* via ``_prepare_latex_document`` (minimal preamble).
    2. Runs XeLaTeX in a temp directory.
    3. On failure, sanitises the code again and retries (up to *max_retries*).
    4. If the sanitised version compiles, returns it as *fixed_code*.
    """
    import shutil as _shutil
    import subprocess as _subprocess
    import tempfile as _tempfile
    from pathlib import Path as _Path

    from django.conf import settings as _settings

    # Locate xelatex binary (same logic as LatexRenderView.post)
    configured = (
        os.environ.get('XELATEX_PATH')
        or getattr(_settings, 'XELATEX_PATH', None)
    )
    if configured and os.path.isfile(configured):
        xelatex_bin = configured
    else:
        search_path = os.environ.get('PATH', '') + ':/Library/TeX/texbin:/usr/local/bin:/opt/homebrew/bin'
        xelatex_bin = _shutil.which('xelatex', path=search_path)

    if not xelatex_bin:
        # Can't verify — assume OK so the flow doesn't block
        return {'compiled': True, 'fixed_code': None, 'errors': {}}

    def _run(code_text: str) -> tuple:
        """Compile and return (returncode, combined_output)."""
        with _tempfile.TemporaryDirectory() as tmp:
            tmp_path = _Path(tmp)
            doc_text = _prepare_latex_document(code_text, preamble=None, wrap_mode='auto', optimize_pgfplots=False)
            tex_path = tmp_path / 'document.tex'
            tex_path.write_text(doc_text, encoding='utf-8')
            cmd = [
                xelatex_bin,
                '-interaction=nonstopmode',
                '-halt-on-error',
                f'-output-directory={tmp_path}',
                str(tex_path),
            ]
            proc = _subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=str(tmp_path))
            # Combine stdout + stderr; XeLaTeX writes the log to stdout,
            # but some errors may appear on stderr.
            combined = (proc.stdout or '') + '\n' + (proc.stderr or '')
            # Also try reading the .log file — it contains the full log
            # even when the process output is truncated.
            log_file = tmp_path / 'document.log'
            if log_file.exists():
                try:
                    combined = log_file.read_text(encoding='utf-8', errors='replace')
                except Exception:
                    pass
            return proc.returncode, combined

    # First attempt
    try:
        rc, output = _run(latex_code)
    except Exception:
        return {'compiled': True, 'fixed_code': None, 'errors': {}}

    if rc == 0:
        return {'compiled': True, 'fixed_code': None, 'errors': {}}

    parsed = _parse_latex_errors(output)

    # Retry with re-sanitisation + missing-package injection
    for _ in range(max_retries):
        fixed = sanitize_ai_latex_code(latex_code)

        # Inject missing packages detected from the log
        missing = parsed.get('missing_packages', [])
        for pkg in missing:
            pkg_re = re.compile(
                r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{' + re.escape(pkg) + r'\}'
            )
            if not pkg_re.search(fixed):
                # Insert before \begin{document} or at the top
                bdoc = re.search(r'\\begin\{document\}', fixed)
                if bdoc:
                    fixed = fixed[:bdoc.start()] + f'\\usepackage{{{pkg}}}\n' + fixed[bdoc.start():]
                else:
                    fixed = f'\\usepackage{{{pkg}}}\n' + fixed

        if fixed == latex_code:
            break  # Nothing changed, don't bother retrying

        try:
            rc2, output2 = _run(fixed)
        except Exception:
            break

        if rc2 == 0:
            return {'compiled': True, 'fixed_code': fixed, 'errors': {}}

        # Update parsed errors for the caller
        parsed = _parse_latex_errors(output2)
        latex_code = fixed  # for next iteration

    return {
        'compiled': False,
        'fixed_code': None,
        'errors': parsed,
    }


def compile_latex_with_document(latex_code: str, document, max_retries: int = 1) -> dict:
    """Compile *latex_code* in the context of *document* — resolving
    ``[[image:…]]`` placeholders, copying/converting image files, and
    running XeLaTeX exactly as ``LatexRenderView.post`` does.

    This is the "real" compilation check used by AI generation endpoints
    to validate that the generated code actually compiles with the
    document's images and metadata.

    Returns::

        {
            'compiled': bool,
            'fixed_code': str | None,
            'errors': { ... },          # _parse_latex_errors output
        }
    """
    import shutil as _shutil
    import subprocess as _subprocess
    import tempfile as _tempfile
    from pathlib import Path as _Path

    from django.conf import settings as _settings

    # ── Locate xelatex binary ────────────────────────────────────────
    configured = (
        os.environ.get('XELATEX_PATH')
        or getattr(_settings, 'XELATEX_PATH', None)
    )
    if configured and os.path.isfile(configured):
        xelatex_bin = configured
    else:
        search_path = (
            os.environ.get('PATH', '')
            + ':/Library/TeX/texbin:/usr/local/bin:/opt/homebrew/bin'
        )
        xelatex_bin = _shutil.which('xelatex', path=search_path)

    if not xelatex_bin:
        return {'compiled': True, 'fixed_code': None, 'errors': {}}

    def _run(code_text: str) -> tuple:
        """Resolve placeholders, prepare document, copy images, compile.
        Returns (returncode, log_output, resolved_code)."""
        # Resolve [[image:…]] → \includegraphics + collect image files
        resolved_code, image_files = resolve_image_placeholders_latex(
            code_text, document,
        )
        # Resolve [[field_name]] metadata placeholders
        resolved_code = resolve_latex_metadata(resolved_code, document)

        with _tempfile.TemporaryDirectory() as tmp:
            tmp_path = _Path(tmp)

            # Copy / convert images into the temp dir
            for fname, abs_path in image_files:
                dest = tmp_path / fname
                _convert_image_for_latex(abs_path, dest)

            doc_text = _prepare_latex_document(
                resolved_code, preamble=None, wrap_mode='auto',
                optimize_pgfplots=False,
            )
            tex_path = tmp_path / 'document.tex'
            tex_path.write_text(doc_text, encoding='utf-8')

            cmd = [
                xelatex_bin,
                '-interaction=nonstopmode',
                '-halt-on-error',
                f'-output-directory={tmp_path}',
                str(tex_path),
            ]
            proc = _subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=90, cwd=str(tmp_path),
            )
            # Prefer the .log file — it has the full compilation log
            # even when stdout/stderr are truncated.
            combined = (proc.stdout or '') + '\n' + (proc.stderr or '')
            log_file = tmp_path / 'document.log'
            if log_file.exists():
                try:
                    combined = log_file.read_text(encoding='utf-8', errors='replace')
                except Exception:
                    pass
            return proc.returncode, combined, resolved_code

    # ── First attempt ────────────────────────────────────────────────
    try:
        rc, output, _ = _run(latex_code)
    except Exception:
        return {'compiled': True, 'fixed_code': None, 'errors': {}}

    if rc == 0:
        return {'compiled': True, 'fixed_code': None, 'errors': {}}

    parsed = _parse_latex_errors(output)

    # ── Retry with re-sanitisation + missing-package injection ───────
    for _ in range(max_retries):
        fixed = sanitize_ai_latex_code(latex_code)

        missing = parsed.get('missing_packages', [])
        for pkg in missing:
            pkg_re = re.compile(
                r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{' + re.escape(pkg) + r'\}'
            )
            if not pkg_re.search(fixed):
                bdoc = re.search(r'\\begin\{document\}', fixed)
                if bdoc:
                    fixed = (
                        fixed[:bdoc.start()]
                        + f'\\usepackage{{{pkg}}}\n'
                        + fixed[bdoc.start():]
                    )
                else:
                    fixed = f'\\usepackage{{{pkg}}}\n' + fixed

        if fixed == latex_code:
            break

        try:
            rc2, output2, _ = _run(fixed)
        except Exception:
            break

        if rc2 == 0:
            return {'compiled': True, 'fixed_code': fixed, 'errors': {}}

        parsed = _parse_latex_errors(output2)
        latex_code = fixed

    return {
        'compiled': False,
        'fixed_code': None,
        'errors': parsed,
    }


# ── Margin / page-size helpers for processing_settings ──────────────────

_PAGE_SIZE_MAP = {
    'a4': 'a4paper',
    'a3': 'a3paper',
    'a5': 'a5paper',
    'letter': 'letterpaper',
    'legal': 'legalpaper',
}

_MARGIN_PRESETS = {
    'narrow':  {'top': '1.27cm', 'bottom': '1.27cm', 'left': '1.27cm', 'right': '1.27cm'},
    'normal':  {'top': '2.54cm', 'bottom': '2.54cm', 'left': '2.54cm', 'right': '2.54cm'},
    'wide':    {'top': '2.54cm', 'bottom': '2.54cm', 'left': '3.18cm', 'right': '3.18cm'},
    'none':    {'top': '0cm', 'bottom': '0cm', 'left': '0cm', 'right': '0cm'},
}

_FONT_FAMILY_MAP = {
    'serif':     '',        # default LaTeX
    'sans':      '\\renewcommand{\\familydefault}{\\sfdefault}\n',
    'monospace': '\\renewcommand{\\familydefault}{\\ttdefault}\n',
}

_LINE_SPACING_MAP = {
    '1':    '\\renewcommand{\\baselinestretch}{1.0}\n',
    '1.15': '\\renewcommand{\\baselinestretch}{1.15}\n',
    '1.5':  '\\renewcommand{\\baselinestretch}{1.5}\n',
    '2':    '\\renewcommand{\\baselinestretch}{2.0}\n',
}


def _build_geometry_options(processing_settings: dict) -> str:
    """Return a \\usepackage[...]{geometry} line from processing_settings.pdf_layout.

    When a pdf_layout dict is present (indicating the user has opened
    Export Studio), we always emit a geometry line — falling back to
    sensible defaults (A4, normal margins) for any unset fields so that
    the rendered preview matches what the full exporter would produce.
    """
    pdf_layout = processing_settings.get('pdf_layout') or {}
    if not pdf_layout:
        return ''

    parts = []

    # Page size — default to A4 when Export Studio is active but no explicit choice
    page_size = (pdf_layout.get('page_size') or 'a4').lower()
    paper = _PAGE_SIZE_MAP.get(page_size, 'a4paper')
    parts.append(paper)

    # Margins — default to "normal" when Export Studio is active but no explicit choice
    margin_size = (pdf_layout.get('margin_size') or 'normal').lower()
    margins = _MARGIN_PRESETS.get(margin_size, _MARGIN_PRESETS['normal'])
    parts.append(f"top={margins['top']}")
    parts.append(f"bottom={margins['bottom']}")
    parts.append(f"left={margins['left']}")
    parts.append(f"right={margins['right']}")

    return f"\\usepackage[{','.join(parts)}]{{geometry}}\n"


# ── Preamble conflict removal helpers ────────────────────────────────────

# Regex patterns for packages/commands that Export Studio will inject and
# that cause "Option clash" or duplicate-definition errors when present twice.
_GEOMETRY_PKG_RE = re.compile(
    r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{geometry\}[^\n]*\n?'
)
_FANCYHDR_PKG_RE = re.compile(
    r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{fancyhdr\}[^\n]*\n?'
)
_BASELINESTRETCH_RE = re.compile(
    r'\\renewcommand\s*\{\\baselinestretch\}\s*\{[^}]*\}[^\n]*\n?'
)
_PAGESTYLE_FANCY_RE = re.compile(
    r'\\pagestyle\s*\{fancy\}[^\n]*\n?'
)
_FANCYHF_CLEAR_RE = re.compile(
    r'\\fancyhf\s*\{[^}]*\}[^\n]*\n?'
)
_FANCYHDR_FIELD_RE = re.compile(
    r'\\[lcr](?:head|foot)\s*\{[^}]*\}[^\n]*\n?'
)
_FAMILYDEFAULT_RE = re.compile(
    r'\\renewcommand\s*\{\\familydefault\}\s*\{[^}]*\}[^\n]*\n?'
)
_GEOMETRY_CMD_RE = re.compile(
    r'\\geometry\s*\{[^}]*\}[^\n]*\n?'
)
_NEWGEOMETRY_CMD_RE = re.compile(
    r'\\newgeometry\s*\{[^}]*\}[^\n]*\n?'
)


def _strip_conflicting_packages(latex_code: str, processing_settings: dict) -> str:
    """Remove existing geometry / fancyhdr / baselinestretch / familydefault
    declarations from the preamble of a full LaTeX document when Export Studio
    will inject its own versions.

    Only strips from the **preamble** (before ``\\begin{document}``).
    This prevents "Option clash for package geometry" and similar errors.
    """
    ps = processing_settings or {}
    has_pdf_layout = bool(ps.get('pdf_layout'))
    has_header_footer = bool(ps.get('header_footer'))

    if not has_pdf_layout and not has_header_footer:
        return latex_code  # nothing to inject, nothing to strip

    marker = '\\begin{document}'
    idx = latex_code.find(marker)
    if idx == -1:
        return latex_code  # no preamble boundary — handled by wrap mode

    preamble = latex_code[:idx]
    body = latex_code[idx:]

    if has_pdf_layout:
        # Strip geometry package (our injection will replace it)
        preamble = _GEOMETRY_PKG_RE.sub('', preamble)
        preamble = _GEOMETRY_CMD_RE.sub('', preamble)
        preamble = _NEWGEOMETRY_CMD_RE.sub('', preamble)

        # Strip baselinestretch (our layout preamble sets it)
        preamble = _BASELINESTRETCH_RE.sub('', preamble)

        # Strip familydefault (our layout preamble sets it)
        preamble = _FAMILYDEFAULT_RE.sub('', preamble)

    if has_header_footer:
        # Strip fancyhdr package and all header/footer field commands
        preamble = _FANCYHDR_PKG_RE.sub('', preamble)
        preamble = _PAGESTYLE_FANCY_RE.sub('', preamble)
        preamble = _FANCYHF_CLEAR_RE.sub('', preamble)
        preamble = _FANCYHDR_FIELD_RE.sub('', preamble)

    return preamble + body


def _build_layout_preamble(processing_settings: dict) -> str:
    """Build extra preamble lines from processing_settings.pdf_layout for fonts/spacing.

    Falls back to sensible defaults when Export Studio is active (pdf_layout
    dict exists) but individual fields are empty.
    """
    pdf_layout = processing_settings.get('pdf_layout') or {}
    if not pdf_layout:
        return ''

    lines = ''

    # Font family — default to serif
    font_family = (pdf_layout.get('font_family') or 'serif').lower()
    lines += _FONT_FAMILY_MAP.get(font_family, '')

    # Line spacing — default to 1.5
    line_spacing = str(pdf_layout.get('line_spacing') or '1.5').strip()
    lines += _LINE_SPACING_MAP.get(line_spacing, '')

    return lines


def _build_header_footer_preamble(processing_settings: dict) -> str:
    """Build fancyhdr preamble from processing_settings header/footer text config."""
    hf = processing_settings.get('header_footer') or {}
    header_left = hf.get('header_left', '')
    header_center = hf.get('header_center', '')
    header_right = hf.get('header_right', '')
    footer_left = hf.get('footer_left', '')
    footer_center = hf.get('footer_center', '')
    footer_right = hf.get('footer_right', '')

    has_any = any([header_left, header_center, header_right,
                   footer_left, footer_center, footer_right])
    if not has_any:
        return ''

    lines = '\\usepackage{fancyhdr}\n\\pagestyle{fancy}\n'
    lines += '\\fancyhf{}\n'  # clear defaults
    if header_left:
        lines += f'\\lhead{{{header_left}}}\n'
    if header_center:
        lines += f'\\chead{{{header_center}}}\n'
    if header_right:
        lines += f'\\rhead{{{header_right}}}\n'
    if footer_left:
        lines += f'\\lfoot{{{footer_left}}}\n'
    if footer_center:
        lines += f'\\cfoot{{{footer_center}}}\n'
    elif not any([footer_left, footer_right]):
        # Default page numbers if no footer is set but headers exist
        lines += '\\cfoot{\\thepage}\n'
    if footer_right:
        lines += f'\\rfoot{{{footer_right}}}\n'

    return lines


def _prepare_latex_document(
    latex_code: str,
    preamble: str | None,
    wrap_mode: str,
    optimize_pgfplots: bool,
    processing_settings: dict | None = None,
) -> str:
    # ── Run AI-generated code sanitization as a safety net ──
    latex_code = sanitize_ai_latex_code(latex_code)

    # Fix common \documentclass syntax errors from AI generation
    # e.g. \documentclass12pt]{article} → \documentclass[12pt]{article}
    latex_code = re.sub(
        r'\\documentclass(?!\[)(\d+\s*pt)\]',
        r'\\documentclass[\1]',
        latex_code,
    )

    # Sanitize unresolved [[placeholder]] in preamble-critical commands.
    latex_code = _sanitize_preamble_placeholders(latex_code)
    latex_code = _escape_unresolved_placeholders(latex_code)

    ps = processing_settings or {}

    if "\\begin{document}" in latex_code:
        # Full document provided — inject geometry/layout before \begin{document}
        latex_code = _ensure_xcolor(latex_code)

        # Strip existing geometry / fancyhdr / baselinestretch from the
        # preamble so our Export Studio injection doesn't cause
        # "Option clash for package geometry" or duplicate-command errors.
        latex_code = _strip_conflicting_packages(latex_code, ps)

        # Inject geometry and layout into existing preamble
        geometry_line = _build_geometry_options(ps)
        layout_lines = _build_layout_preamble(ps)
        hf_lines = _build_header_footer_preamble(ps)
        inject = geometry_line + layout_lines + hf_lines
        if inject:
            latex_code = latex_code.replace(
                '\\begin{document}',
                inject + '\\begin{document}',
                1,
            )
        return latex_code

    preamble_block = preamble.strip() if preamble else ""

    # ── Comprehensive default preamble for maximum compatibility ──
    # These packages cover the vast majority of AI-generated LaTeX content.
    # Only add packages not already present in the user-provided preamble.
    _DEFAULT_PACKAGES = [
        # Math
        ('amsmath', None),
        ('amssymb', None),
        ('amsfonts', None),
        ('mathtools', None),
        # Tables
        ('booktabs', None),
        ('longtable', None),
        ('multirow', None),
        ('tabularx', None),
        ('array', None),
        # Graphics & colour
        ('graphicx', None),
        ('xcolor', 'table,dvipsnames,svgnames'),
        # Text formatting
        ('enumitem', None),
        ('setspace', None),
        ('parskip', None),
        # Links & references
        ('hyperref', 'hidelinks'),
        # Layout
        ('float', None),
        ('placeins', None),
        ('caption', None),
        # Code listings
        ('listings', None),
        # Misc
        ('microtype', None),
        ('ragged2e', None),
        ('fancyvrb', None),
    ]

    for pkg, opts in _DEFAULT_PACKAGES:
        marker = f'\\usepackage{{{pkg}}}'
        # Also check for \usepackage[...]{pkg} variant
        marker_re = re.compile(r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{' + re.escape(pkg) + r'\}')
        already_in_preamble = marker_re.search(preamble_block)
        already_in_code = marker_re.search(latex_code)
        if not already_in_preamble and not already_in_code:
            if opts:
                preamble_block += f'\n\\usepackage[{opts}]{{{pkg}}}'
            else:
                preamble_block += f'\n\\usepackage{{{pkg}}}'

    # ── Auto-detect packages needed by the LaTeX code body ──
    _AUTO_DETECT = [
        (r'\\begin\{tikzpicture\}|\\usetikzlibrary', 'tikz', None),
        (r'\\begin\{axis\}|\\begin\{pgfplot', 'pgfplots', None),
        (r'\\begin\{circuitikz\}', 'circuitikz', None),
        (r'\\begin\{forest\}', 'forest', None),
        (r'\\chemfig\b', 'chemfig', None),
        (r'\\begin\{multicols\}', 'multicol', None),
        (r'\\begin\{wrapfigure\}|\\begin\{wraptable\}', 'wrapfig', None),
        (r'\\begin\{tcolorbox\}', 'tcolorbox', None),
        (r'\\begin\{minted\}|\\mintinline', 'minted', None),
        (r'\\begin\{algorithm\}', 'algorithm2e', None),
        (r'\\SI\b|\\si\b|\\num\b', 'siunitx', None),
        (r'\\cref\b|\\Cref\b', 'cleveref', None),
        (r'\\begin\{subfigure\}', 'subcaption', None),
        (r'\\cancel\b|\\bcancel\b|\\xcancel\b', 'cancel', None),
        (r'\\lipsum\b', 'lipsum', None),
        (r'\\blindtext\b', 'blindtext', None),
        (r'\\begin\{adjustbox\}', 'adjustbox', None),
        (r'\\uline\b|\\sout\b', 'ulem', 'normalem'),
        (r'\\begin\{tabulary\}', 'tabulary', None),
    ]

    for pattern, pkg, opts in _AUTO_DETECT:
        if re.search(pattern, latex_code):
            marker_re = re.compile(r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{' + re.escape(pkg) + r'\}')
            if not marker_re.search(preamble_block) and not marker_re.search(latex_code):
                if opts:
                    preamble_block += f'\n\\usepackage[{opts}]{{{pkg}}}'
                else:
                    preamble_block += f'\n\\usepackage{{{pkg}}}'

    # ── pgfplots compat ──
    if re.search(r'\\begin\{axis\}', latex_code):
        if '\\pgfplotsset{compat=' not in preamble_block:
            preamble_block += '\n\\pgfplotsset{compat=1.18}'
        if optimize_pgfplots:
            preamble_block += f'\n{PGFPLOTS_OPTIMIZATION_SETTINGS}'

    # ── Strip packages from preamble that Export Studio will inject ──
    if ps.get('pdf_layout'):
        preamble_block = _GEOMETRY_PKG_RE.sub('', preamble_block)
        preamble_block = _GEOMETRY_CMD_RE.sub('', preamble_block)
        preamble_block = _BASELINESTRETCH_RE.sub('', preamble_block)
        preamble_block = _FAMILYDEFAULT_RE.sub('', preamble_block)
    if ps.get('header_footer'):
        preamble_block = _FANCYHDR_PKG_RE.sub('', preamble_block)
        preamble_block = _PAGESTYLE_FANCY_RE.sub('', preamble_block)
        preamble_block = _FANCYHF_CLEAR_RE.sub('', preamble_block)
        preamble_block = _FANCYHDR_FIELD_RE.sub('', preamble_block)

    # Also strip from the latex_code body itself
    if ps.get('pdf_layout'):
        latex_code = _GEOMETRY_PKG_RE.sub('', latex_code)
        latex_code = _GEOMETRY_CMD_RE.sub('', latex_code)
        latex_code = _BASELINESTRETCH_RE.sub('', latex_code)
        latex_code = _FAMILYDEFAULT_RE.sub('', latex_code)
    if ps.get('header_footer'):
        latex_code = _FANCYHDR_PKG_RE.sub('', latex_code)
        latex_code = _PAGESTYLE_FANCY_RE.sub('', latex_code)
        latex_code = _FANCYHF_CLEAR_RE.sub('', latex_code)
        latex_code = _FANCYHDR_FIELD_RE.sub('', latex_code)

    # ── Apply processing_settings layout options ──
    geometry_line = _build_geometry_options(ps)
    if geometry_line:
        preamble_block = f"{preamble_block}\n{geometry_line}"

    layout_lines = _build_layout_preamble(ps)
    if layout_lines:
        preamble_block = f"{preamble_block}\n{layout_lines}"

    hf_lines = _build_header_footer_preamble(ps)
    if hf_lines:
        preamble_block = f"{preamble_block}\n{hf_lines}"

    # ── Document class — use font size from processing_settings ──
    pdf_layout = ps.get('pdf_layout') or {}
    font_size = (pdf_layout.get('font_size') or '12pt').strip() if pdf_layout else ''
    if wrap_mode == "article":
        if font_size and font_size in ('10pt', '11pt', '12pt', '14pt', '16pt'):
            document_class = f"\\documentclass[{font_size}]{{article}}"
        else:
            document_class = "\\documentclass[12pt]{article}"
    else:
        document_class = "\\documentclass[varwidth]{standalone}"

    return (
        f"{document_class}\n"
        f"{preamble_block}\n"
        "\\begin{document}\n"
        f"{latex_code}\n"
        "\\end{document}\n"
    )


# ── Post-processing: apply Export Studio settings to compiled PDF ────────

def _postprocess_pdf(pdf_bytes: bytes, document, processing_settings: dict, request=None) -> bytes:
    """Apply Export Studio post-processing to a compiled PDF (from XeLaTeX or xhtml2pdf).

    This mirrors what the main document exporter does after building the base PDF:
    1. Header/footer PDF overlay (cropped regions from uploaded PDFs)
    2. Text protection (rasterize + encrypted text)
    3. Metadata, passwords, unprintable-area annotations via apply_pdf_layout

    ``processing_settings`` is the same dict from custom_metadata.processing_settings.
    """
    if not _HAS_PDF_SYSTEM or not pdf_bytes:
        return pdf_bytes

    ps = processing_settings or {}

    # ── Resolve processing_defaults from the document (org merge + removal strip) ──
    proc_defaults = {}
    if hasattr(document, 'get_processing_defaults'):
        try:
            proc_defaults = document.get_processing_defaults() or {}
        except Exception:
            proc_defaults = {}

    # ── 1. Header/footer PDF overlay ─────────────────────────────────────
    header_pdf_config = ps.get('header_pdf') or proc_defaults.get('header_pdf') or {}
    footer_pdf_config = ps.get('footer_pdf') or proc_defaults.get('footer_pdf') or {}

    if not isinstance(header_pdf_config, dict):
        header_pdf_config = {}
    if not isinstance(footer_pdf_config, dict):
        footer_pdf_config = {}

    header_file_id = header_pdf_config.get('file_id')
    footer_file_id = footer_pdf_config.get('file_id')

    def _parse_size(value, default=0):
        if value is None:
            return default
        try:
            raw = str(value).strip().lower()
            if raw.endswith('mm'):
                return float(raw[:-2]) * 2.834645669
            if raw.endswith('pt'):
                return float(raw[:-2])
            if raw.endswith('px'):
                return float(raw[:-2]) * 0.75
            return float(raw)
        except (ValueError, TypeError):
            return default

    header_height = _parse_size(header_pdf_config.get('height'), 0)
    footer_height = _parse_size(header_pdf_config.get('footer_height'), 0)
    if not footer_height and footer_pdf_config:
        footer_height = _parse_size(footer_pdf_config.get('height'), 0)

    def _resolve_overlay_path(file_id, config):
        if not file_id:
            return None, 0
        try:
            from .models import DocumentFile
            df = DocumentFile.objects.get(id=file_id)
            if df.file:
                page_idx = max(int(config.get('page', 1)) - 1, 0) if config else 0
                return df.file.path, page_idx
        except Exception:
            pass
        return None, 0

    _header_overlay_path, _header_page_idx = None, 0
    _footer_overlay_path, _footer_page_idx = None, 0
    _overlay_needed = False

    if header_file_id and header_height > 0:
        _header_overlay_path, _header_page_idx = _resolve_overlay_path(header_file_id, header_pdf_config)
        if _header_overlay_path:
            _overlay_needed = True

    if footer_file_id and footer_height > 0:
        _footer_overlay_path, _footer_page_idx = _resolve_overlay_path(footer_file_id, footer_pdf_config)
        if _footer_overlay_path:
            _overlay_needed = True

    # Fallback: footer from same header_pdf file
    if not _footer_overlay_path and header_file_id and footer_height > 0:
        _footer_overlay_path = _header_overlay_path
        _footer_page_idx = _header_page_idx

    if _overlay_needed:
        try:
            pdf_bytes = _overlay_header_footer_pdf(
                pdf_bytes,
                header_pdf_path=_header_overlay_path,
                footer_pdf_path=_footer_overlay_path,
                header_height_pts=header_height,
                footer_height_pts=footer_height,
                header_page_index=_header_page_idx,
                footer_page_index=_footer_page_idx,
                header_config=header_pdf_config,
                footer_config=footer_pdf_config,
            )
        except Exception:
            pass  # graceful fallback — return PDF without overlay

    # ── 2. Text protection (rasterize) ───────────────────────────────────
    text_prot = ps.get('pdf_text_protection') or proc_defaults.get('pdf_text_protection') or {}
    if isinstance(text_prot, dict) and text_prot.get('enabled'):
        mode = text_prot.get('mode', 'rasterize')
        if mode == 'rasterize' and fitz is not None:
            try:
                raster_dpi = int(text_prot.get('dpi') or 200)
                pdf_bytes = _rasterize_pdf_bytes(pdf_bytes, raster_dpi)
            except Exception:
                pass

    # ── 3. Metadata, passwords, unprintable area ─────────────────────────
    pdf_layout = ps.get('pdf_layout') or proc_defaults.get('pdf_layout') or {}
    options = PDFLayoutOptions(
        page_size=pdf_layout.get('page_size', 'a4'),
        font_family=pdf_layout.get('font_family', 'serif'),
        font_size=pdf_layout.get('font_size', '12pt'),
        line_spacing=pdf_layout.get('line_spacing', '1.5'),
        margin_size=pdf_layout.get('margin_size', 'normal'),
        image_size=pdf_layout.get('image_size', 'medium'),
        caption_alignment=pdf_layout.get('caption_alignment', 'center'),
        show_unprintable_area=bool(pdf_layout.get('show_unprintable_area', False)),
        unprintable_area=pdf_layout.get('unprintable_area', 'standard'),
    )

    # PDF passwords
    pdf_security = ps.get('pdf_security') or proc_defaults.get('pdf_security') or {}
    passwords = {}
    if isinstance(pdf_security, dict):
        passwords = {
            'user_password': pdf_security.get('user_password') or None,
            'owner_password': pdf_security.get('owner_password') or None,
        }

    try:
        pdf_bytes = apply_pdf_layout(
            pdf_bytes,
            options,
            document,
            passwords if any(passwords.values()) else None,
        )
    except Exception:
        pass  # graceful fallback

    return pdf_bytes


class LatexRenderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, document_id):
        """Compile LaTeX to PDF with XeLaTeX and return PDF + raster preview."""
        document = get_object_or_404(Document, id=document_id)

        latex_code = request.data.get("latex_code")
        preamble = request.data.get("preamble")
        if not latex_code:
            if document.is_latex_code and document.latex_code:
                latex_code = document.latex_code

        if not latex_code:
            return Response(
                {"error": "latex_code is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Resolve [[image:...]] placeholders → \includegraphics ──
        latex_code, image_files = resolve_image_placeholders_latex(latex_code, document)

        # ── Resolve [[field_name]] metadata placeholders ──
        extra_metadata = request.data.get("metadata") or {}
        latex_code = resolve_latex_metadata(latex_code, document, extra_metadata or None)

        configured_xelatex = (
            os.environ.get("XELATEX_PATH")
            or getattr(settings, "XELATEX_PATH", None)
        )
        if configured_xelatex and os.path.isfile(configured_xelatex):
            xelatex = configured_xelatex
        else:
            extra_paths = [
                "/Library/TeX/texbin",  # MacTeX / BasicTeX
                "/usr/texbin",
                "/usr/local/texlive/2025/bin/universal-darwin",
            ]
            search_path = os.pathsep.join(
                [os.environ.get("PATH", "")] + extra_paths
            )
            xelatex = shutil.which("xelatex", path=search_path)
        if not xelatex:
            return Response(
                {
                    "error": "XeLaTeX not found. Install TeX Live or MacTeX.",
                    "hint": "Set XELATEX_PATH or add /Library/TeX/texbin to PATH for the server process.",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        dpi = int(request.data.get("dpi") or 150)

        wrap_mode = (request.data.get("wrap_mode") or "standalone").lower()
        optimize_graphs = _parse_bool(request.data.get("optimize_graphs"))
        uses_pgfplots = "\\begin{axis}" in latex_code
        can_optimize = "\\begin{document}" not in latex_code and uses_pgfplots

        # ── Processing settings (margins, headers, footers, layout) ──
        req_processing = request.data.get("processing_settings") or {}
        # Fall back to the document's own saved processing_settings if none provided
        if not req_processing:
            cm = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
            req_processing = cm.get('processing_settings') or {}

        # If processing settings specify any page/layout/header/footer config
        # or the document already has header/footer templates assigned, force
        # article wrap mode so packages like geometry and fancyhdr behave
        # correctly (standalone doesn't play well with those packages).
        has_pdf_layout = bool(req_processing.get('pdf_layout'))
        has_header_footer = bool(req_processing.get('header_footer'))
        has_header_pdf = bool(req_processing.get('header_pdf'))
        has_footer_pdf = bool(req_processing.get('footer_pdf'))
        if has_pdf_layout or has_header_footer or has_header_pdf or has_footer_pdf or getattr(document, 'header_template_id', None) or getattr(document, 'footer_template_id', None):
            wrap_mode = 'article'

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_dir_path = Path(tmp_dir)

            # Copy (or convert) image files into the temp directory so
            # \includegraphics can find them.  Unsupported formats (AVIF,
            # WebP, HEIC …) are converted to PNG automatically.
            for fname, abs_path in image_files:
                dest = tmp_dir_path / fname
                _convert_image_for_latex(abs_path, dest)

            def run_xelatex(document_text: str):
                tex_path = tmp_dir_path / "document.tex"
                tex_path.write_text(document_text, encoding="utf-8")
                command = [
                    xelatex,
                    "-interaction=nonstopmode",
                    "-halt-on-error",
                    f"-output-directory={tmp_dir_path}",
                    str(tex_path),
                ]
                proc = subprocess.run(command, capture_output=True, text=True, cwd=str(tmp_dir_path))
                # Attach the full log from the .log file for better error parsing
                log_file = tmp_dir_path / "document.log"
                if log_file.exists():
                    try:
                        proc._full_log = log_file.read_text(encoding='utf-8', errors='replace')
                    except Exception:
                        proc._full_log = None
                else:
                    proc._full_log = None
                return proc

            def _get_log(proc_result):
                """Get the best available compilation log output."""
                # Prefer the .log file — it always has the full log
                full_log = getattr(proc_result, '_full_log', None)
                if full_log:
                    return full_log
                # Fall back to stdout + stderr combined
                return (proc_result.stdout or '') + '\n' + (proc_result.stderr or '')

            document_text = _prepare_latex_document(
                latex_code,
                preamble,
                wrap_mode,
                optimize_pgfplots=bool(optimize_graphs) if optimize_graphs is not None else False,
                processing_settings=req_processing,
            )
            result = run_xelatex(document_text)
            optimization_applied = bool(optimize_graphs) if optimize_graphs is not None else False

            if result.returncode != 0:
                combined_output = _get_log(result)
                if (
                    can_optimize
                    and optimize_graphs is None
                    and _is_tex_memory_error(combined_output)
                ):
                    document_text = _prepare_latex_document(
                        latex_code,
                        preamble,
                        wrap_mode,
                        optimize_pgfplots=True,
                        processing_settings=req_processing,
                    )
                    result = run_xelatex(document_text)
                    optimization_applied = True
                    combined_output = _get_log(result)

                # ── Fallback retry: inject missing packages detected from log ──
                if result.returncode != 0:
                    parsed = _parse_latex_errors(combined_output)
                    missing_pkgs = parsed.get('missing_packages', [])

                    if missing_pkgs:
                        # Inject the missing packages into the preamble and retry
                        patched_preamble = preamble or ''
                        for pkg in missing_pkgs:
                            pkg_re = re.compile(
                                r'\\usepackage\s*(?:\[[^\]]*\])?\s*\{' + re.escape(pkg) + r'\}'
                            )
                            if not pkg_re.search(patched_preamble) and not pkg_re.search(latex_code):
                                patched_preamble += f'\n\\usepackage{{{pkg}}}'

                        document_text = _prepare_latex_document(
                            latex_code,
                            patched_preamble,
                            wrap_mode,
                            optimize_pgfplots=optimization_applied,
                            processing_settings=req_processing,
                        )
                        result = run_xelatex(document_text)
                        combined_output = _get_log(result)

                if result.returncode != 0:
                    parsed = _parse_latex_errors(combined_output)
                    error_payload: dict[str, object] = {
                        "error": parsed['error_summary'],
                        "error_lines": parsed['error_lines'],
                        "missing_packages": parsed['missing_packages'],
                        "raw_errors": parsed['raw_errors'],
                    }
                    if _is_tex_memory_error(combined_output):
                        error_payload["memory_error"] = True
                        error_payload[
                            "hint"
                        ] = "The plot is too complex for TeX memory limits. Try reducing samples/mesh density or set optimize_graphs=true."
                    return Response(
                        error_payload,
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            pdf_path = tmp_dir_path / "document.pdf"
            if not pdf_path.exists():
                return Response(
                    {"error": "XeLaTeX did not produce a PDF"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            pdf_bytes = pdf_path.read_bytes()

            # ── Post-process: apply Export Studio settings (header/footer
            #    PDF overlays, watermarks, metadata, passwords, text
            #    protection) — same pipeline the main document editor uses.
            pdf_bytes = _postprocess_pdf(pdf_bytes, document, req_processing, request)

            pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

            preview_b64 = None
            preview_pages = []
            if fitz is not None:
                pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                zoom = max(float(dpi) / 72.0, 1.0)
                mat = fitz.Matrix(zoom, zoom)
                for page_num in range(pdf_doc.page_count):
                    page = pdf_doc.load_page(page_num)
                    pix = page.get_pixmap(matrix=mat, alpha=False)
                    page_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
                    preview_pages.append(page_b64)
                    if page_num == 0:
                        preview_b64 = page_b64
                pdf_doc.close()

            return Response(
                {
                    "document_id": str(document.id),
                    "pdf_base64": pdf_b64,
                    "preview_png_base64": preview_b64,
                    "preview_pages": preview_pages,
                    "page_count": len(preview_pages),
                    "preview_dpi": dpi,
                    "graph_optimization_applied": optimization_applied,
                },
                status=status.HTTP_200_OK,
            )


# ── HTML metadata resolution ────────────────────────────────────────────

def _html_escape(val: str) -> str:
    """Escape HTML special characters in a metadata value."""
    import html as _html
    return _html.escape(str(val), quote=True)


def _latex_opts_to_css(opts: str) -> str:
    """Translate LaTeX ``\\includegraphics`` options to inline CSS.

    Handles common keys like ``width=5cm``, ``height=3in``, ``scale=0.5``,
    ``max width=\\linewidth``.  Unknown keys are silently ignored.  Returns
    a CSS style string (without outer quotes).
    """
    if not opts:
        return ''

    css_parts = []
    # Split on commas, but be careful with nested braces / TeX commands
    for part in opts.split(','):
        part = part.strip()
        if not part or '=' not in part:
            continue
        key, _, val = part.partition('=')
        key = key.strip().lower()
        val = val.strip()

        # Map LaTeX length to CSS length — pass through cm/mm/in/pt/em/ex
        # and translate \linewidth / \textwidth → 100%
        def _to_css_len(v):
            v = v.strip()
            if '\\linewidth' in v or '\\textwidth' in v or '\\columnwidth' in v:
                return '100%'
            # Already a valid CSS unit?
            if any(v.endswith(u) for u in ('cm', 'mm', 'in', 'pt', 'px', 'em', 'ex', '%')):
                return v
            # Bare number → treat as pt
            try:
                float(v)
                return f'{v}pt'
            except ValueError:
                return None

        if key == 'width':
            css_len = _to_css_len(val)
            if css_len:
                css_parts.append(f'width:{css_len}')
        elif key == 'height':
            css_len = _to_css_len(val)
            if css_len:
                css_parts.append(f'height:{css_len}')
        elif key in ('max width', 'max-width'):
            css_len = _to_css_len(val)
            if css_len:
                css_parts.append(f'max-width:{css_len}')
        elif key in ('max height', 'max-height'):
            css_len = _to_css_len(val)
            if css_len:
                css_parts.append(f'max-height:{css_len}')
        elif key == 'scale':
            try:
                pct = float(val) * 100
                css_parts.append(f'width:{pct:.0f}%')
            except ValueError:
                pass
        elif key == 'keepaspectratio':
            css_parts.append('object-fit:contain')

    return ';'.join(css_parts)


def _resolve_image_placeholders_html(html_code, document):
    """Replace ``[[image:...]]`` placeholders in HTML with ``<img>`` tags
    or styled placeholder spans for unmapped images.

    Respects ``%%img-opts:name:opts%%`` comments (same format used by the
    LaTeX path) so that code-specified dimensions are honoured rather than
    the image's native resolution.
    """
    if '[[image:' not in html_code:
        return html_code

    meta = document.document_metadata or {}
    img_map = meta.get('_image_placeholders', {})

    # ── Parse %%img-opts:name:opts%% comments for code-specified dimensions ──
    img_opts_map = {}
    for m in re.finditer(r'%%img-opts:([^:]+):([^%]+)%%', html_code):
        img_opts_map[m.group(1).strip()] = m.group(2).strip()
    # Strip the comments so they don't leak into rendered HTML
    html_code = re.sub(r'%%img-opts:[^%]+%%\n?', '', html_code)

    tokens = _IMAGE_PLACEHOLDER_RE.findall(html_code)
    if not tokens:
        return html_code

    all_uuids = set()
    for token in tokens:
        token = token.strip()
        if _UUID_RE.match(token):
            all_uuids.add(token)
        else:
            mapped = img_map.get(token)
            if mapped:
                all_uuids.add(str(mapped))

    uuid_to_image = {}
    if all_uuids:
        for img_obj in DocumentImage.objects.filter(id__in=list(all_uuids)):
            uuid_to_image[str(img_obj.id)] = img_obj

        # Fallback to Attachment table for UUIDs not found in DocumentImage
        missing_uuids = all_uuids - set(uuid_to_image.keys())
        if missing_uuids:
            try:
                from attachments.models import Attachment
                for att in Attachment.objects.filter(
                    id__in=list(missing_uuids), file_kind='image',
                ):
                    uuid_to_image[str(att.id)] = att
            except Exception:
                pass

    def _replace_match(match):
        token = match.group(1).strip()
        img_obj = None
        opts_key = token  # key for img_opts_map lookup

        if _UUID_RE.match(token):
            img_obj = uuid_to_image.get(token)
        else:
            mapped_uuid = img_map.get(token)
            if mapped_uuid:
                img_obj = uuid_to_image.get(str(mapped_uuid))

        # Duck-type: DocumentImage has .image, Attachment has .file
        file_field = getattr(img_obj, 'image', None) or getattr(img_obj, 'file', None) if img_obj else None
        if img_obj and file_field:
            # Use absolute file path so xhtml2pdf can read the file directly
            try:
                abs_path = file_field.path  # e.g. /Users/.../media/documents/images/...
                name = getattr(img_obj, 'name', 'Image') or 'Image'
                safe_name = _html_escape(name)

                # Build CSS from code-specified options (if any)
                latex_opts = img_opts_map.get(opts_key, '')
                extra_css = _latex_opts_to_css(latex_opts)

                if extra_css:
                    # Code-specified sizing — use it, just add display:block
                    style = f'{extra_css};display:block;margin:8px auto'
                else:
                    # No explicit sizing — render at natural size, capped at
                    # container width.  'width:auto' prevents stretching.
                    style = 'max-width:100%;width:auto;height:auto;display:block;margin:8px auto'

                return (
                    f'<img src="{_html_escape(abs_path)}" alt="{safe_name}" '
                    f'style="{style}" />'
                )
            except Exception:
                pass

        # Unmapped or missing image
        safe_token = _html_escape(token)
        return (
            f'<span style="color:#b91c1c;background:#fef2f2;padding:2px 8px;'
            f'border-radius:4px;font-size:12px;">'
            f'🖼️ [{safe_token}]</span>'
        )

    return _IMAGE_PLACEHOLDER_RE.sub(_replace_match, html_code)


def resolve_html_metadata(html_code: str, document, extra_metadata: dict | None = None) -> str:
    """
    Replace [[field_name]] placeholders in HTML source with values from
    document metadata.  Values are HTML-escaped.
    """
    # First resolve [[image:...]] placeholders to <img> tags
    html_code = _resolve_image_placeholders_html(html_code, document)

    if '[[' not in html_code:
        return html_code

    metadata = {}
    try:
        if document.document_metadata:
            metadata = dict(document.document_metadata)
        if document.custom_metadata:
            for k, v in document.custom_metadata.items():
                if isinstance(v, dict) and isinstance(metadata.get(k), dict):
                    metadata[k].update(v)
                else:
                    metadata[k] = v
    except Exception:
        pass

    if extra_metadata and isinstance(extra_metadata, dict):
        for k, v in extra_metadata.items():
            if isinstance(v, dict) and isinstance(metadata.get(k), dict):
                metadata[k].update(v)
            else:
                metadata[k] = v

    if not metadata:
        return html_code

    flat = _flatten_dict(metadata)
    lookup = {}
    for key, value in flat.items():
        if value is None:
            continue
        key_str = str(key)
        leaf = key_str.split('.')[-1]
        escaped = _html_escape(str(value))
        lookup[_normalize(key_str)] = escaped
        lookup[_normalize(leaf)] = escaped

    if not lookup:
        return html_code

    pattern = re.compile(r'\[\[([^\]]+)\]\]')

    def _replace(match):
        token = match.group(1).strip()
        value = lookup.get(_normalize(token))
        if value is None:
            # Leave unresolved placeholders visible as styled spans
            return f'<span style="color:#b91c1c;background:#fef2f2;padding:0 4px;border-radius:3px">[[{match.group(1)}]]</span>'
        return value

    return pattern.sub(_replace, html_code)


# ── HTML page-size and margin helpers ────────────────────────────────────

_HTML_PAGE_SIZE_MAP = {
    'a4': 'A4',
    'a3': 'A3',
    'a5': 'A5',
    'letter': 'letter',
    'legal': 'legal',
}

_HTML_MARGIN_PRESETS = {
    'narrow': '1.27cm',
    'normal': '2.5cm',
    'wide':   '3.18cm',
    'none':   '0cm',
}

_HTML_FONT_FAMILY_MAP = {
    'serif':     '"Georgia", "Times New Roman", Times, serif',
    'sans':      '"Helvetica Neue", Helvetica, Arial, sans-serif',
    'monospace': '"Courier New", Courier, monospace',
}

_HTML_LINE_SPACING_MAP = {
    '1':    '1.2',
    '1.15': '1.38',
    '1.5':  '1.8',
    '2':    '2.4',
}


def _build_html_page_style(processing_settings: dict) -> str:
    """Build @page and body CSS from processing_settings.pdf_layout."""
    pdf_layout = (processing_settings or {}).get('pdf_layout') or {}

    page_size = _HTML_PAGE_SIZE_MAP.get((pdf_layout.get('page_size') or 'a4').lower(), 'A4')
    margin = _HTML_MARGIN_PRESETS.get((pdf_layout.get('margin_size') or 'normal').lower(), '2.5cm')
    font_family = _HTML_FONT_FAMILY_MAP.get((pdf_layout.get('font_family') or 'sans').lower(), '"Helvetica Neue", Helvetica, Arial, sans-serif')
    font_size = (pdf_layout.get('font_size') or '12pt').strip() or '12pt'
    line_height = _HTML_LINE_SPACING_MAP.get(str(pdf_layout.get('line_spacing') or '1.5').strip(), '1.5')

    return (
        f"@page {{ size: {page_size}; margin: {margin}; }}\n"
        f"  body {{ font-family: {font_family}; font-size: {font_size}; "
        f"line-height: {line_height}; color: #1a1a1a; }}"
    )


def _build_html_header_footer(processing_settings: dict) -> tuple[str, str]:
    """Build header and footer HTML blocks from processing_settings.header_footer."""
    hf = (processing_settings or {}).get('header_footer') or {}
    header_parts = []
    footer_parts = []

    hl = hf.get('header_left', '')
    hc = hf.get('header_center', '')
    hr_ = hf.get('header_right', '')
    fl = hf.get('footer_left', '')
    fc = hf.get('footer_center', '')
    fr = hf.get('footer_right', '')

    if hl or hc or hr_:
        header_parts.append(
            '<div style="display:flex;justify-content:space-between;align-items:center;'
            'padding:8px 0;border-bottom:1px solid #e5e7eb;margin-bottom:12px;font-size:10pt;color:#6b7280;">'
            f'<span>{hl}</span><span>{hc}</span><span>{hr_}</span></div>'
        )

    if fl or fc or fr:
        footer_parts.append(
            '<div style="display:flex;justify-content:space-between;align-items:center;'
            'padding:8px 0;border-top:1px solid #e5e7eb;margin-top:12px;font-size:10pt;color:#6b7280;">'
            f'<span>{fl}</span><span>{fc}</span><span>{fr}</span></div>'
        )

    return '\n'.join(header_parts), '\n'.join(footer_parts)


def _inject_processing_styles_into_html(html_code: str, processing_settings: dict) -> str:
    """Inject Export Studio @page + body CSS into an existing full HTML document.

    Inserts a ``<style>`` block just before ``</head>`` (or ``<body>`` if no
    ``</head>``).  The injected ``@page`` and ``body`` rules use ``!important``
    so they reliably override any inline styles already present in the HTML.
    """
    ps = processing_settings or {}
    pdf_layout = ps.get('pdf_layout') or {}
    if not pdf_layout and not ps.get('header_footer'):
        return html_code  # nothing to inject

    page_size = _HTML_PAGE_SIZE_MAP.get((pdf_layout.get('page_size') or '').lower(), '')
    margin = _HTML_MARGIN_PRESETS.get((pdf_layout.get('margin_size') or '').lower(), '')
    font_family = _HTML_FONT_FAMILY_MAP.get((pdf_layout.get('font_family') or '').lower(), '')
    font_size = (pdf_layout.get('font_size') or '').strip()
    line_height = _HTML_LINE_SPACING_MAP.get(str(pdf_layout.get('line_spacing') or '').strip(), '')

    parts = []
    # @page rule
    page_parts = []
    if page_size:
        page_parts.append(f'size: {page_size} !important')
    if margin:
        page_parts.append(f'margin: {margin} !important')
    if page_parts:
        parts.append(f"@page {{ {'; '.join(page_parts)}; }}")

    # body rule
    body_parts = []
    if font_family:
        body_parts.append(f'font-family: {font_family} !important')
    if font_size:
        body_parts.append(f'font-size: {font_size} !important')
    if line_height:
        body_parts.append(f'line-height: {line_height} !important')
    if body_parts:
        parts.append(f"body {{ {'; '.join(body_parts)}; }}")

    if not parts:
        return html_code

    style_block = '<style data-export-studio>\n' + '\n'.join(parts) + '\n</style>\n'

    # Insert before </head> if present, otherwise before <body>
    import re as _re
    head_end = _re.search(r'</head\s*>', html_code, _re.IGNORECASE)
    if head_end:
        return html_code[:head_end.start()] + style_block + html_code[head_end.start():]

    body_start = _re.search(r'<body[^>]*>', html_code, _re.IGNORECASE)
    if body_start:
        return html_code[:body_start.start()] + style_block + html_code[body_start.start():]

    # Last resort — prepend
    return style_block + html_code


def _prepare_html_document(html_code: str, processing_settings: dict | None = None) -> str:
    """Wrap a fragment in a full HTML document if needed, applying processing_settings."""
    ps = processing_settings or {}
    lower = html_code.strip().lower()

    if lower.startswith('<!doctype') or lower.startswith('<html'):
        # Already a full document — inject Export Studio styles into existing <head>
        return _inject_processing_styles_into_html(html_code, ps)

    page_style = _build_html_page_style(ps)
    header_html, footer_html = _build_html_header_footer(ps)

    return (
        '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8"/>\n<style>\n'
        f'  {page_style}\n'
        '  h1 { font-size: 22pt; margin-bottom: 0.4em; }\n'
        '  h2 { font-size: 17pt; margin-bottom: 0.3em; }\n'
        '  h3 { font-size: 14pt; margin-bottom: 0.2em; }\n'
        '  table { border-collapse: collapse; width: 100%; margin: 1em 0; }\n'
        '  th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }\n'
        '  th { background: #f3f4f6; }\n'
        '  ul, ol { padding-left: 1.5em; }\n'
        '</style>\n</head>\n<body>\n'
        f'{header_html}\n'
        f'{html_code}\n'
        f'{footer_html}\n'
        '</body>\n</html>'
    )


class HtmlRenderView(APIView):
    """Render an HTML code block → PDF (via xhtml2pdf) + PNG preview (via PyMuPDF)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, document_id):
        if pisa is None:
            return Response(
                {"error": "xhtml2pdf is not installed on the server."},
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )

        document = get_object_or_404(Document, id=document_id)

        # Accept explicit HTML or fall back to the document's LatexCode block
        html_code = request.data.get("html_code")
        extra_metadata = request.data.get("metadata")
        dpi = int(request.data.get("dpi", 150))

        if not html_code:
            # Find the first LatexCode block with code_type='html'
            from .models import LatexCode
            block = (
                LatexCode.objects
                .filter(section__document=document, code_type='html')
                .order_by('section__order', 'order')
                .first()
            )
            if block is None:
                # Fallback: any code block
                block = (
                    LatexCode.objects
                    .filter(section__document=document)
                    .order_by('section__order', 'order')
                    .first()
                )
            if block is None:
                return Response(
                    {"error": "No code block found for this document."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            html_code = block.get_effective_content()

        if not html_code:
            return Response(
                {"error": "HTML code is empty."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve [[placeholder]] metadata
        html_code = resolve_html_metadata(str(html_code), document, extra_metadata)

        # ── Processing settings (margins, headers, footers, layout) ──
        req_processing = request.data.get("processing_settings") or {}
        if not req_processing:
            cm = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
            req_processing = cm.get('processing_settings') or {}

        # Wrap fragment in full document if necessary (with processing_settings applied)
        html_code = _prepare_html_document(html_code, processing_settings=req_processing)

        # ── HTML → PDF via xhtml2pdf ──────────────────────────────────
        pdf_buffer = io.BytesIO()
        pisa_status = pisa.CreatePDF(
            src=html_code,
            dest=pdf_buffer,
            encoding='utf-8',
        )

        if getattr(pisa_status, 'err', 0):
            return Response(
                {"error": "HTML to PDF conversion failed.", "details": str(getattr(pisa_status, 'err', ''))},
                status=status.HTTP_400_BAD_REQUEST,
            )

        pdf_bytes = pdf_buffer.getvalue()

        # ── Post-process: apply Export Studio settings (header/footer
        #    PDF overlays, watermarks, metadata, passwords, text
        #    protection) — same pipeline the main document editor uses.
        pdf_bytes = _postprocess_pdf(pdf_bytes, document, req_processing, request)

        pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

        # ── PDF → PNG preview via PyMuPDF ─────────────────────────────
        preview_b64 = None
        preview_pages = []
        if fitz is not None:
            try:
                pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                zoom = max(float(dpi) / 72.0, 1.0)
                mat = fitz.Matrix(zoom, zoom)
                for page_num in range(pdf_doc.page_count):
                    page = pdf_doc.load_page(page_num)
                    pix = page.get_pixmap(matrix=mat, alpha=False)
                    page_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
                    preview_pages.append(page_b64)
                    if page_num == 0:
                        preview_b64 = page_b64
                pdf_doc.close()
            except Exception:
                pass  # preview is optional

        return Response(
            {
                "document_id": str(document.id),
                "pdf_base64": pdf_b64,
                "preview_png_base64": preview_b64,
                "preview_pages": preview_pages,
                "page_count": len(preview_pages),
                "preview_dpi": dpi,
            },
            status=status.HTTP_200_OK,
        )
