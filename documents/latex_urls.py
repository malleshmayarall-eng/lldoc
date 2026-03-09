from django.urls import path

from .latex_views import LatexDocumentView

urlpatterns = [
    path("<uuid:document_id>/latex/", LatexDocumentView.as_view(), name="document-latex"),
]
