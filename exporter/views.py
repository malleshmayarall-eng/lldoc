"""Export UI views (centralized document export pages)."""

from django.shortcuts import render, get_object_or_404

from documents.models import Document


def document_processing_view(request, document_id):
    """Render the main document processing UI page."""
    context = {
        'document_id': document_id,
    }
    return render(request, 'exporter/document_processing.html', context)


def header_footer_editor_view(request, document_id):
    """Render the header/footer editor UI for a document."""
    document = get_object_or_404(Document, id=document_id)
    context = {
        'document': document,
        'document_id': document_id,
    }
    return render(request, 'exporter/header_footer_editor.html', context)


def header_footer_template_designer_view(request):
    """Render the header/footer template designer UI."""
    return render(request, 'exporter/header_footer_template_designer.html', {})