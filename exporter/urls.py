"""URL configuration for export UI endpoints."""

from django.urls import path

from .views import (
    document_processing_view,
    header_footer_editor_view,
    header_footer_template_designer_view,
)
from .print_views import (
    document_download_pdf,
)

app_name = 'exporter'

urlpatterns = [
    path('<str:document_id>/process/', document_processing_view, name='document_processing'),
    path('<str:document_id>/headers-footers/', header_footer_editor_view, name='document_header_footer_editor'),
    path('templates/designer/', header_footer_template_designer_view, name='header_footer_template_designer'),
    path('<str:document_id>/download-pdf/', document_download_pdf, name='document_download_pdf'),
]