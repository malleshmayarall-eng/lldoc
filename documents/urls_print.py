"""
URL Configuration for Document Print/PDF Views
"""

from django.urls import path
from documents.print_views import (
    document_print_view,
    document_download_pdf,
    public_document_print_view
)

app_name = 'documents_print'

urlpatterns = [
    # Authenticated print view - accepts both int and string (UUID) document IDs
    path('<str:document_id>/print/', document_print_view, name='document_print'),
    
    # PDF download endpoint
    path('<str:document_id>/download-pdf/', document_download_pdf, name='document_download_pdf'),
    
    # Public/shared print view
    path('<str:document_id>/print/public/', public_document_print_view, name='document_print_public'),
    path('<str:document_id>/print/shared/<str:share_token>/', public_document_print_view, name='document_print_shared'),

]
