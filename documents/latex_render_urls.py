from django.urls import path

from .latex_render_views import HtmlRenderView, LatexRenderView

urlpatterns = [
    path("<uuid:document_id>/latex/render/", LatexRenderView.as_view(), name="document-latex-render"),
    path("<uuid:document_id>/html/render/", HtmlRenderView.as_view(), name="document-html-render"),
]
