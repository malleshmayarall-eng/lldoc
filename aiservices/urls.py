from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import AIInteractionViewSet, DocumentAnalysisRunViewSet, ingest_text, analyze_text, generate_from_prompt, document_setup_questions
from .views import score_document, score_document_with_reasoning
from .views import paragraph_ai_results, document_paragraph_ai_results
from .views import ai_chat, ai_chat_edit
from .views import ai_generate_latex
from .views import DocumentTypeAIPresetViewSet
from .views import ai_dashboard_assistant
from .views import (
    document_ai_config,
    document_ai_config_update,
    document_ai_config_toggle,
    document_ai_config_bulk_toggle,
    document_ai_config_reset,
    document_ai_service_status,
    document_type_list,
    document_ai_set_type,
)
from .paragraph_ai.views import (
    paragraph_ai_review,
    paragraph_ai_rewrite,
    document_paragraph_ai_review_updated,
    document_paragraph_ai_scoring,
)

router = DefaultRouter()
router.register(r'interactions', AIInteractionViewSet, basename='ai-interaction')
router.register(r'analysis', DocumentAnalysisRunViewSet, basename='ai-analysis')
router.register(r'presets', DocumentTypeAIPresetViewSet, basename='ai-preset')

urlpatterns = [
    path('', include(router.urls)),
    path('ingest-text/', ingest_text, name='ai-ingest-text'),
    path('analyze-text/', analyze_text, name='ai-analyze-text'),
    path('generate-from-prompt/', generate_from_prompt, name='ai-generate-from-prompt'),
    path('document-questions/', document_setup_questions, name='ai-document-questions'),
    path('score-document/<uuid:pk>/', score_document, name='ai-score-document'),
    path('score-document-with-reasoning/<uuid:pk>/', score_document_with_reasoning, name='ai-score-document-with-reasoning'),
    path('paragraphs/<uuid:pk>/ai-results/', paragraph_ai_results, name='ai-paragraph-results'),
    path('documents/<uuid:pk>/paragraph-ai-results/', document_paragraph_ai_results, name='ai-document-paragraph-results'),
    path('paragraphs/<uuid:pk>/ai-review/', paragraph_ai_review, name='ai-paragraph-review'),
    path('paragraphs/<uuid:pk>/ai-review/rewrite/', paragraph_ai_rewrite, name='ai-paragraph-review-rewrite'),
    path('documents/<uuid:pk>/paragraph-ai-review/updated/', document_paragraph_ai_review_updated, name='ai-document-paragraph-review-updated'),
    path('documents/<uuid:pk>/paragraph-ai-scoring/', document_paragraph_ai_scoring, name='ai-document-paragraph-scoring'),
    path('chat/', ai_chat, name='ai-chat'),
    path('chat-edit/', ai_chat_edit, name='ai-chat-edit'),
    path('documents/<uuid:pk>/generate-latex/', ai_generate_latex, name='ai-generate-latex'),

    # ── Per-Document AI Config ───────────────────────────────────────────
    path('documents/<uuid:pk>/config/', document_ai_config, name='ai-document-config'),
    path('documents/<uuid:pk>/config/update/', document_ai_config_update, name='ai-document-config-update'),
    path('documents/<uuid:pk>/config/toggle/', document_ai_config_toggle, name='ai-document-config-toggle'),
    path('documents/<uuid:pk>/config/bulk-toggle/', document_ai_config_bulk_toggle, name='ai-document-config-bulk-toggle'),
    path('documents/<uuid:pk>/config/reset/', document_ai_config_reset, name='ai-document-config-reset'),
    path('documents/<uuid:pk>/config/status/', document_ai_service_status, name='ai-document-config-status'),
    path('documents/<uuid:pk>/config/set-type/', document_ai_set_type, name='ai-document-config-set-type'),
    path('document-types/', document_type_list, name='ai-document-types'),

    # ── AI Dashboard Assistant ───────────────────────────────────────
    path('dashboard-assistant/', ai_dashboard_assistant, name='ai-dashboard-assistant'),

    # ── Hierarchical Inference Engine ────────────────────────────────
    path('inference/', include('aiservices.inference.urls')),
]
