"""
Inference Views — DRF endpoints for hierarchical inference
============================================================

Endpoints:
    POST   /api/ai/inference/documents/<pk>/infer/         — full document inference
    POST   /api/ai/inference/sections/<pk>/infer/          — single subtree inference
    POST   /api/ai/inference/components/<type>/<pk>/infer/ — single component inference

    GET    /api/ai/inference/documents/<pk>/summary/        — document inference summary
    GET    /api/ai/inference/documents/<pk>/context/        — pre-built context string
    GET    /api/ai/inference/sections/<pk>/summary/         — section aggregate
    GET    /api/ai/inference/sections/<pk>/context/         — section context string
    GET    /api/ai/inference/sections/<pk>/components/      — child component inferences

    GET    /api/ai/inference/documents/<pk>/tree/           — full tree with all inferences
    GET    /api/ai/inference/documents/<pk>/stale/          — list stale components
"""
import logging

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from documents.models import Document, Section, Paragraph, Sentence, LatexCode, Table
from sharing.permissions import IsOwnerOrSharedWith

from .engine import TreeInferenceEngine, _get_component_text
from .models import ComponentInference, SectionAggregateInference, DocumentInferenceSummary
from .serializers import (
    ComponentInferenceSerializer,
    ComponentInferenceDetailSerializer,
    SectionAggregateInferenceSerializer,
    DocumentInferenceSummarySerializer,
    InferenceStatsSerializer,
    LateralEdgeSerializer,
    WritePathResultSerializer,
    DocumentWritePathResultSerializer,
    WritePathStatusSerializer,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Trigger inference
# ──────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def infer_document(request, pk):
    """
    Run full bottom-up inference for an entire document.
    Incremental: unchanged components are skipped.

    POST body (optional):
        {"model": "gemini-2.5-flash", "force": false}
    """
    document = get_object_or_404(Document, pk=pk)

    model = request.data.get('model', '') or None
    force = request.data.get('force', False)

    engine = TreeInferenceEngine(
        document=document,
        user=request.user,
        model=model,
        force=force,
    )
    result = engine.infer_full()

    return Response({
        'status': 'ok',
        **result,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def infer_section(request, pk):
    """
    Run bottom-up inference for a single section subtree.

    POST body (optional):
        {"model": "gemini-2.5-flash", "force": false}
    """
    section = get_object_or_404(Section, pk=pk)
    if not section.document:
        return Response(
            {'status': 'error', 'message': 'Section is not linked to a document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    model = request.data.get('model', '') or None
    force = request.data.get('force', False)

    engine = TreeInferenceEngine(
        document=section.document,
        user=request.user,
        model=model,
        force=force,
    )
    agg = engine.infer_subtree(section)

    return Response({
        'status': 'ok',
        'section_id': str(section.id),
        'aggregate_inference_id': str(agg.id) if agg else None,
        **engine.get_stats(),
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def infer_component(request, component_type, pk):
    """
    Run inference for a single component.

    URL: /inference/components/<component_type>/<uuid:pk>/infer/
    component_type: paragraph | sentence | latex_code | table
    """
    MODEL_MAP = {
        'paragraph': Paragraph,
        'sentence': Sentence,
        'latex_code': LatexCode,
        'table': Table,
    }
    model_class = MODEL_MAP.get(component_type)
    if not model_class:
        return Response(
            {'status': 'error', 'message': f'Unknown component type: {component_type}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    component = get_object_or_404(model_class, pk=pk)

    # Resolve the owning document
    document = None
    section = getattr(component, 'section', None)
    if section:
        document = section.document
    elif hasattr(component, 'paragraph'):
        section = component.paragraph.section
        document = section.document if section else None

    if not document:
        return Response(
            {'status': 'error', 'message': 'Component is not linked to a document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    model = request.data.get('model', '') or None
    force = request.data.get('force', False)

    engine = TreeInferenceEngine(
        document=document,
        user=request.user,
        model=model,
        force=force,
    )
    inference = engine.infer_component(component)

    if inference:
        return Response({
            'status': 'ok',
            'inference': ComponentInferenceDetailSerializer(inference).data,
        }, status=status.HTTP_200_OK)
    else:
        return Response({
            'status': 'skipped',
            'message': 'Component has no content or inference failed.',
            **engine.get_stats(),
        }, status=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────
# Retrieve results
# ──────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_inference_summary(request, pk):
    """Get the latest document-level inference summary."""
    document = get_object_or_404(Document, pk=pk)

    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()

    if not doc_inf:
        return Response({
            'status': 'not_found',
            'message': 'No inference available. Run POST /infer/ first.',
        }, status=status.HTTP_404_NOT_FOUND)

    return Response({
        'status': 'ok',
        'inference': DocumentInferenceSummarySerializer(doc_inf).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_inference_context(request, pk):
    """Get the pre-built context string for the entire document."""
    document = get_object_or_404(Document, pk=pk)
    engine = TreeInferenceEngine(document=document)
    context = engine.get_document_context()

    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()

    return Response({
        'status': 'ok',
        'document_id': str(document.id),
        'document_title': document.title,
        'has_inference': doc_inf is not None,
        'context': context,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def section_inference_summary(request, pk):
    """Get the latest section aggregate inference."""
    section = get_object_or_404(Section, pk=pk)

    agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()

    if not agg:
        return Response({
            'status': 'not_found',
            'message': 'No inference available for this section.',
        }, status=status.HTTP_404_NOT_FOUND)

    return Response({
        'status': 'ok',
        'inference': SectionAggregateInferenceSerializer(agg).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def section_inference_context(request, pk):
    """Get the pre-built context string for a section."""
    section = get_object_or_404(Section, pk=pk)
    if not section.document:
        return Response({'status': 'error', 'message': 'Section has no document.'},
                        status=status.HTTP_400_BAD_REQUEST)

    engine = TreeInferenceEngine(document=section.document)
    context = engine.get_section_context(section)

    agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()

    return Response({
        'status': 'ok',
        'section_id': str(section.id),
        'section_title': section.title or 'Untitled',
        'has_inference': agg is not None,
        'context': context,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def section_component_inferences(request, pk):
    """List all component-level inferences for a section."""
    section = get_object_or_404(Section, pk=pk)

    inferences = ComponentInference.objects.filter(
        section=section, is_latest=True,
    ).order_by('component_type', 'created_at')

    return Response({
        'status': 'ok',
        'section_id': str(section.id),
        'count': inferences.count(),
        'inferences': ComponentInferenceSerializer(inferences, many=True).data,
    })


# ──────────────────────────────────────────────────────────────────────────
# Full tree view
# ──────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_inference_tree(request, pk):
    """
    Return the full inference tree for a document.
    Each section includes its aggregate + child component inferences.
    """
    document = get_object_or_404(Document, pk=pk)

    def _build_section_node(section):
        agg = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).first()

        component_infs = ComponentInference.objects.filter(
            section=section, is_latest=True,
        ).order_by('component_type', 'created_at')

        children = []
        for child in section.children.order_by('order'):
            children.append(_build_section_node(child))

        return {
            'section_id': str(section.id),
            'title': section.title or 'Untitled',
            'section_type': section.section_type,
            'depth_level': section.depth_level,
            'aggregate': SectionAggregateInferenceSerializer(agg).data if agg else None,
            'components': ComponentInferenceSerializer(component_infs, many=True).data,
            'children': children,
        }

    root_sections = document.sections.filter(parent__isnull=True).order_by('order')
    tree = [_build_section_node(s) for s in root_sections]

    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()

    return Response({
        'status': 'ok',
        'document_id': str(document.id),
        'document_title': document.title,
        'document_summary': DocumentInferenceSummarySerializer(doc_inf).data if doc_inf else None,
        'tree': tree,
    })


# ──────────────────────────────────────────────────────────────────────────
# Staleness detection
# ──────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_stale_inferences(request, pk):
    """
    List all components whose inference is stale (content changed
    since last inference run).
    """
    document = get_object_or_404(Document, pk=pk)

    stale_components = []

    for section in document.sections.all():
        # Check paragraphs
        for para in section.paragraphs.order_by('order'):
            text = para.get_effective_content() or ''
            if not text.strip():
                continue
            existing = ComponentInference.objects.filter(
                section=section,
                component_type='paragraph',
                object_id=para.id,
                is_latest=True,
            ).first()
            if not existing or existing.is_stale(text):
                stale_components.append({
                    'component_type': 'paragraph',
                    'component_id': str(para.id),
                    'section_id': str(section.id),
                    'section_title': section.title or 'Untitled',
                    'has_inference': existing is not None,
                })

        # Check tables
        for table in section.tables.order_by('order'):
            from .engine import _table_to_text
            text = _table_to_text(table)
            if not text.strip():
                continue
            existing = ComponentInference.objects.filter(
                section=section,
                component_type='table',
                object_id=table.id,
                is_latest=True,
            ).first()
            if not existing or existing.is_stale(text):
                stale_components.append({
                    'component_type': 'table',
                    'component_id': str(table.id),
                    'section_id': str(section.id),
                    'section_title': section.title or 'Untitled',
                    'has_inference': existing is not None,
                })

        # Check latex codes
        for latex in section.latex_codes.order_by('order'):
            text = latex.get_effective_content() or ''
            if not text.strip():
                continue
            existing = ComponentInference.objects.filter(
                section=section,
                component_type='latex_code',
                object_id=latex.id,
                is_latest=True,
            ).first()
            if not existing or existing.is_stale(text):
                stale_components.append({
                    'component_type': 'latex_code',
                    'component_id': str(latex.id),
                    'section_id': str(section.id),
                    'section_title': section.title or 'Untitled',
                    'has_inference': existing is not None,
                })

    return Response({
        'status': 'ok',
        'document_id': str(document.id),
        'total_stale': len(stale_components),
        'stale_components': stale_components,
    })


# ══════════════════════════════════════════════════════════════════════════
# Write-path endpoints
# ══════════════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def write_path_document(request, pk):
    """
    Run the write-path for every component in a document.
    Creates/refreshes lateral edges (embed → MaxSim → rerank → graph UPSERT).

    POST body (optional):
        {"async_mode": "thread"}   — thread | celery | sync (default: thread)
    """
    document = get_object_or_404(Document, pk=pk)
    async_mode = request.data.get('async_mode', 'sync')

    if async_mode == 'celery':
        try:
            from .tasks import run_write_path_document_task
            task = run_write_path_document_task.delay(str(document.id))
            return Response({
                'status': 'queued',
                'task_id': task.id,
                'document_id': str(document.id),
            }, status=status.HTTP_202_ACCEPTED)
        except Exception as exc:
            logger.warning('Celery dispatch failed, running sync: %s', exc)
            async_mode = 'sync'

    if async_mode == 'thread':
        import threading
        from .write_path import run_write_path_for_document

        def _run():
            try:
                run_write_path_for_document(document)
            except Exception as exc:
                logger.exception('Write-path thread error: %s', exc)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return Response({
            'status': 'started',
            'document_id': str(document.id),
            'message': 'Write-path running in background thread.',
        }, status=status.HTTP_202_ACCEPTED)

    # sync
    from .write_path import run_write_path_for_document
    result = run_write_path_for_document(document)
    return Response(
        DocumentWritePathResultSerializer(result).data,
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def write_path_component(request, component_type, pk):
    """
    Run the write-path for a single component.

    URL: /inference/write-path/components/<component_type>/<uuid:pk>/
    component_type: paragraph | sentence | latex_code | table
    """
    MODEL_MAP = {
        'paragraph': Paragraph,
        'sentence': Sentence,
        'latex_code': LatexCode,
        'table': Table,
    }
    model_class = MODEL_MAP.get(component_type)
    if not model_class:
        return Response(
            {'status': 'error', 'message': f'Unknown component type: {component_type}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    component = get_object_or_404(model_class, pk=pk)

    # Resolve document
    section = getattr(component, 'section', None)
    if not section and hasattr(component, 'paragraph'):
        section = component.paragraph.section
    document = section.document if section else None

    if not document:
        return Response(
            {'status': 'error', 'message': 'Component has no document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from .write_path import run_write_path
    result = run_write_path(component, document)
    return Response(
        WritePathResultSerializer(result).data,
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def lateral_edges_for_component(request, component_type, pk):
    """
    List all lateral edges originating from a component.

    URL: /inference/lateral-edges/<component_type>/<uuid:pk>/
    component_type: paragraph | sentence | latex_code | table | section

    For sections: aggregates edges from ALL child components (paragraphs,
    tables, latex codes) in that section, excluding intra-section edges.
    """
    from django.contrib.contenttypes.models import ContentType
    from .models import LateralEdge

    MODEL_MAP = {
        'paragraph': Paragraph,
        'sentence': Sentence,
        'latex_code': LatexCode,
        'table': Table,
        'section': Section,
    }
    model_class = MODEL_MAP.get(component_type)
    if not model_class:
        return Response(
            {'status': 'error', 'message': f'Unknown component type: {component_type}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    component = get_object_or_404(model_class, pk=pk)

    if component_type == 'section':
        # For sections, collect edges from ALL child components that point
        # outside this section — gives a section-level cross-reference view.
        section = component
        child_ids = set()
        # Collect all child component IDs in this section
        for para in section.paragraphs.all():
            child_ids.add(str(para.id))
        if hasattr(section, 'latex_codes'):
            for lc in section.latex_codes.all():
                child_ids.add(str(lc.id))
        if hasattr(section, 'tables'):
            for tbl in section.tables.all():
                child_ids.add(str(tbl.id))

        if not child_ids:
            return Response({
                'component_id': str(component.id),
                'component_type': component_type,
                'total_edges': 0,
                'critical_edges': 0,
                'contextual_edges': 0,
                'edges': [],
            })

        # Get all outbound edges from child components
        edges = LateralEdge.objects.filter(
            source_object_id__in=child_ids,
        ).select_related('source_content_type', 'target_content_type').order_by('-score')

        # Exclude intra-section edges (target is also in this section)
        edges = [e for e in edges if str(e.target_object_id) not in child_ids]
    else:
        ct = ContentType.objects.get_for_model(component)
        edges = list(LateralEdge.objects.filter(
            source_content_type=ct, source_object_id=component.id,
        ).select_related('source_content_type', 'target_content_type').order_by('-score'))

    critical_count = sum(1 for e in edges if e.edge_type == LateralEdge.EdgeType.CRITICAL)

    return Response({
        'component_id': str(component.id),
        'component_type': component_type,
        'total_edges': len(edges),
        'critical_edges': critical_count,
        'contextual_edges': len(edges) - critical_count,
        'edges': LateralEdgeSerializer(edges, many=True).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_lateral_edges(request, pk):
    """
    List all lateral edges in a document, optionally filtered by edge_type.

    URL: /inference/documents/<uuid:pk>/lateral-edges/
    Query params: ?edge_type=critical|contextual
    """
    from .models import LateralEdge

    document = get_object_or_404(Document, pk=pk)

    qs = LateralEdge.objects.filter(
        document=document,
    ).select_related('source_content_type', 'target_content_type').order_by('-score')

    edge_type_filter = request.query_params.get('edge_type')
    if edge_type_filter:
        qs = qs.filter(edge_type=edge_type_filter.lower())

    return Response({
        'document_id': str(document.id),
        'total_edges': qs.count(),
        'filter': edge_type_filter or 'all',
        'edges': LateralEdgeSerializer(qs[:200], many=True).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def rebuild_document_embeddings(request, pk):
    """
    Re-embed all components into the vector store without reranking.
    Use when the embedding model changes or vectors are corrupted.

    POST /inference/documents/<uuid:pk>/rebuild-embeddings/
    """
    document = get_object_or_404(Document, pk=pk)

    from .write_path import rebuild_embeddings
    stats = rebuild_embeddings(document)

    return Response({
        'status': 'ok',
        **stats,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def write_path_status(request, pk):
    """
    Health-check and status for the write-path services for a document.

    GET /inference/documents/<uuid:pk>/write-path-status/
    """
    document = get_object_or_404(Document, pk=pk)

    from .write_path import get_write_path_status
    status_data = get_write_path_status(document)

    return Response(WritePathStatusSerializer(status_data).data)
