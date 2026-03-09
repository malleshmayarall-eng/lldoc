"""
Print/PDF View for Documents

This view renders a document in a professional PDF-ready format.
"""

from django.http import HttpResponse, HttpResponseForbidden
from django.shortcuts import render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.core import signing

from documents.models import Document, DocumentImage
from documents.pdf_render import safe_render_pdf_to_html
from .pdf_system import PDFLayoutOptions, render_document_pdf


def _is_valid_preview_token(token: str, document_id: str, max_age_seconds: int = 300) -> bool:
    if not token:
        return False
    try:
        payload = signing.loads(token, max_age=max_age_seconds)
    except signing.SignatureExpired:
        return False
    except signing.BadSignature:
        return False

    return str(payload.get("doc")) == str(document_id)


def _is_valid_download_token(token: str, document_id: str, max_age_seconds: int = 300) -> bool:
    if not token:
        return False
    try:
        payload = signing.loads(token, max_age=max_age_seconds)
    except signing.SignatureExpired:
        return False
    except signing.BadSignature:
        return False

    return str(payload.get("doc")) == str(document_id) and payload.get("scope") == "download"


def _build_header_footer_context(document):
    def _build_style_inline(style: dict, is_header: bool) -> str:
        if not isinstance(style, dict):
            return ""
        styles = []
        height = style.get("height")
        if height:
            styles.append(f"height: {height};")
        background = style.get("background_color")
        if background:
            styles.append(f"background-color: {background};")
        border_key = "border_bottom" if is_header else "border_top"
        border_value = style.get(border_key)
        if border_value:
            css_border = "border-bottom" if is_header else "border-top"
            styles.append(f"{css_border}: {border_value};")
        padding = style.get("padding")
        if padding:
            styles.append(f"padding: {padding};")
        font_family = style.get("font_family")
        if font_family:
            styles.append(f"font-family: {font_family};")
        font_size = style.get("font_size")
        if font_size:
            styles.append(f"font-size: {font_size};")
        color = style.get("text_color") or style.get("color") or style.get("font_color")
        if color:
            styles.append(f"color: {color};")
        return " ".join(styles)

    def _build_text_styles(style: dict) -> dict:
        def _style_for(position: str) -> str:
            styles = []
            align = style.get("text_align")
            if isinstance(align, dict):
                align = align.get(position)
            if align:
                styles.append(f"text-align: {align};")
            weight = style.get("font_weight")
            if isinstance(weight, dict):
                weight = weight.get(position)
            if weight:
                styles.append(f"font-weight: {weight};")
            return " ".join(styles)

        if not isinstance(style, dict):
            return {"left": "", "center": "", "right": ""}
        return {
            "left": _style_for("left"),
            "center": _style_for("center"),
            "right": _style_for("right"),
        }

    def _prepare_config(config: dict, is_header: bool) -> dict:
        if not isinstance(config, dict) or not config:
            return {}

        import copy

        rendered = copy.deepcopy(config)
        icons_by_position = {"left": [], "center": [], "right": []}
        for icon in rendered.get("icons") or []:
            position = icon.get("position", "left")
            image_url = None
            image_id = icon.get("image_id")
            if image_id:
                try:
                    image = DocumentImage.objects.get(id=image_id)
                    if image.image:
                        image_url = image.image.url
                except Exception:
                    image_url = None
            icon_payload = {**icon, "image_url": image_url}
            icons_by_position.setdefault(position, []).append(icon_payload)

        rendered["icons_by_position"] = icons_by_position
        rendered["style_inline"] = _build_style_inline(rendered.get("style") or {}, is_header)
        rendered["text_styles"] = _build_text_styles(rendered.get("style") or {})

        text = rendered.get("text") or {}
        for position, value in text.items():
            if isinstance(value, str):
                text[position] = (
                    value.replace("{page}", '<span class="page-number"></span>')
                    .replace("{total}", '<span class="total-pages"></span>')
                )
        rendered["text"] = text
        return rendered

    header_config = _prepare_config(document.get_rendered_header_config(), True)
    footer_config = _prepare_config(document.get_rendered_footer_config(), False)

    return {
        "header_config": header_config,
        "footer_config": footer_config,
        "has_header": bool(header_config),
        "has_footer": bool(footer_config),
    }


def _build_pdf_html_map(document, render_mode: str):
    """Build a mapping of file component IDs to rendered PDF HTML."""
    pdf_html_by_file_id = {}

    sections = document.sections.all().prefetch_related('file_components__file_reference')
    for section in sections:
        for file_component in section.file_components.all():
            file_ref = getattr(file_component, 'file_reference', None)
            if not file_ref or file_ref.file_type != 'pdf' or not file_ref.file:
                continue

            html = safe_render_pdf_to_html(
                file_ref.file.path,
                render_mode=render_mode,
                page_range=file_component.page_range
            )
            if html:
                pdf_html_by_file_id[file_component.id] = html

    return pdf_html_by_file_id


@login_required
def document_print_view(request, document_id):
    """
    Render document in print-ready PDF format.
    
    URL Parameters:
        - pageSize: 'a4', 'letter', or 'legal' (default: 'a4')
        - font: 'serif', 'sans', or 'mono' (default: 'serif')
        - fontSize: '10pt' to '14pt' (default: '12pt')
        - lineSpacing: 'single', '1.15', '1.5', or 'double' (default: '1.5')
    
    Example:
        /documents/123/print/?pageSize=letter&font=sans&fontSize=11pt&lineSpacing=1.15
    """
    document = get_object_or_404(Document, id=document_id)

    render_pdf_mode = request.GET.get('renderPdfMode', 'images')
    render_pdf_as_html = request.GET.get('renderPdfAsHtml', '1') != '0'
    pdf_html_by_file_id = (
        _build_pdf_html_map(document, render_pdf_mode) if render_pdf_as_html else {}
    )
    
    # Check permissions
    # TODO: Add permission check based on your access control system
    # if not request.user.has_perm('documents.view_document', document):
    #     return HttpResponseForbidden("You don't have permission to view this document")
    
    options = PDFLayoutOptions.from_request(request, document=document)
    header_footer_context = _build_header_footer_context(document)
    context = {
        'document': document,
        'document_id': document_id,  # Pass the document ID explicitly
        'current_date': timezone.now(),
        'pdf_html_by_file_id': pdf_html_by_file_id,
        **options.to_template_context(),
        **header_footer_context,
    }
    
    return render(request, 'exporter/document_print.html', context)


def document_download_pdf(request, document_id):
    """Generate and download PDF file with pypdf - no HTML rendering."""
    if not request.user.is_authenticated:
        token = request.GET.get("download_token")
        if not _is_valid_download_token(token, document_id):
            return HttpResponseForbidden("Download token required")

    document = get_object_or_404(Document, id=document_id)
    
    options = PDFLayoutOptions.from_request(request, document=document)
    
    # Generate PDF using reportlab + pypdf (no HTML involved)
    pdf_bytes = render_document_pdf(document, request, options)
    
    if not pdf_bytes:
        return HttpResponse("PDF generation failed", status=500)
    
    # Return PDF file
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    
    # If 'download' parameter is present, force download. Otherwise display inline (for iframe preview)
    if request.GET.get('download') == '1':
        response['Content-Disposition'] = f'attachment; filename="{document.title or document_id}.pdf"'
    else:
        response['Content-Disposition'] = f'inline; filename="{document.title or document_id}.pdf"'
    
    return response


def public_document_print_view(request, document_id, share_token=None):
    """
    Render shared document in print-ready format (no login required).
    
    Args:
        document_id: Document ID
        share_token: Optional share token for access control
    """
    document = get_object_or_404(Document, id=document_id)

    preview_token = request.GET.get("preview_token")

    # Verify share token if provided
    if share_token:
        # TODO: Implement share token verification
        # from sharing.models import DocumentShare
        # share = get_object_or_404(DocumentShare, document=document, token=share_token)
        # if not share.is_valid():
        #     return HttpResponseForbidden("Invalid or expired share link")
        pass
    elif not _is_valid_preview_token(preview_token, document_id):
        return HttpResponseForbidden("Preview token required")
    
    render_pdf_mode = request.GET.get('renderPdfMode', 'images')
    render_pdf_as_html = request.GET.get('renderPdfAsHtml', '1') != '0'
    pdf_html_by_file_id = (
        _build_pdf_html_map(document, render_pdf_mode) if render_pdf_as_html else {}
    )

    options = PDFLayoutOptions.from_request(request, document=document)
    header_footer_context = _build_header_footer_context(document)
    context = {
        'document': document,
        'current_date': timezone.now(),
        'pdf_html_by_file_id': pdf_html_by_file_id,
        **options.to_template_context(),
        **header_footer_context,
    }
    
    return render(request, 'exporter/document_print.html', context)