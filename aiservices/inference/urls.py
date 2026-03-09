"""
Inference URL routing
======================

All endpoints are prefixed with ``/api/ai/inference/`` (via aiservices/urls.py).
"""
from django.urls import path

from .views import (
    # Trigger inference (LLM-based)
    infer_document,
    infer_section,
    infer_component,
    # Retrieve results
    document_inference_summary,
    document_inference_context,
    section_inference_summary,
    section_inference_context,
    section_component_inferences,
    # Tree and staleness
    document_inference_tree,
    document_stale_inferences,
    # Write-path (embed → MaxSim → rerank → graph UPSERT)
    write_path_document,
    write_path_component,
    # Lateral edges
    lateral_edges_for_component,
    document_lateral_edges,
    # Maintenance
    rebuild_document_embeddings,
    write_path_status,
)

urlpatterns = [
    # ── Trigger inference (LLM) ──────────────────────────────────────
    path('documents/<uuid:pk>/infer/', infer_document, name='inference-document-infer'),
    path('sections/<uuid:pk>/infer/', infer_section, name='inference-section-infer'),
    path('components/<str:component_type>/<uuid:pk>/infer/', infer_component, name='inference-component-infer'),

    # ── Retrieve results ─────────────────────────────────────────────
    path('documents/<uuid:pk>/summary/', document_inference_summary, name='inference-document-summary'),
    path('documents/<uuid:pk>/context/', document_inference_context, name='inference-document-context'),
    path('sections/<uuid:pk>/summary/', section_inference_summary, name='inference-section-summary'),
    path('sections/<uuid:pk>/context/', section_inference_context, name='inference-section-context'),
    path('sections/<uuid:pk>/components/', section_component_inferences, name='inference-section-components'),

    # ── Tree and staleness ───────────────────────────────────────────
    path('documents/<uuid:pk>/tree/', document_inference_tree, name='inference-document-tree'),
    path('documents/<uuid:pk>/stale/', document_stale_inferences, name='inference-document-stale'),

    # ── Write-path (embed → MaxSim → rerank → graph) ────────────────
    path('documents/<uuid:pk>/write-path/', write_path_document, name='inference-write-path-document'),
    path('write-path/components/<str:component_type>/<uuid:pk>/', write_path_component, name='inference-write-path-component'),

    # ── Lateral edges ────────────────────────────────────────────────
    path('lateral-edges/<str:component_type>/<uuid:pk>/', lateral_edges_for_component, name='inference-lateral-edges-component'),
    path('documents/<uuid:pk>/lateral-edges/', document_lateral_edges, name='inference-document-lateral-edges'),

    # ── Maintenance ──────────────────────────────────────────────────
    path('documents/<uuid:pk>/rebuild-embeddings/', rebuild_document_embeddings, name='inference-rebuild-embeddings'),
    path('documents/<uuid:pk>/write-path-status/', write_path_status, name='inference-write-path-status'),
]
