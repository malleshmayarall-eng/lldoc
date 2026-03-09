"""
Export UI views (static/iframe pages).
"""

from django.shortcuts import get_object_or_404, render
from .models import Document


def export_shell_view(request, document_id):
    """
    Render the export customization shell UI (iframe-friendly).

    This page bootstraps a Django session from a JWT passed in the query string.
    """
    document = get_object_or_404(Document, id=document_id)
    context = {
        'document': document,
        'document_id': document_id,
        'token': request.GET.get('token', ''),
    }
    return render(request, 'documents/export/export_shell.html', context)


def document_processing_view(request, document_id):
    """
    Render the main document processing static page.

    This page checks login/access and provides print/download customization UI.
    """
    context = {
        'document_id': document_id,
    }
    return render(request, 'documents/export/document_processing.html', context)
