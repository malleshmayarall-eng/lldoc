"""
Write Path — The full embed → search → rerank → graph pipeline
=================================================================

When a document component is saved, the write path:

1. **Embed** the component text (BGE-M3 token-level ColBERT vectors)
2. **Search** the vector DB for the top-K most similar components (MaxSim)
3. **Rerank** candidates with a cross-encoder for fine-grained scores
4. **Classify** each score → CRITICAL (≥0.85) / CONTEXTUAL (0.65–0.84)
5. **Graph UPSERT** — delete old outbound edges, write new edges
6. **Propagate staleness** up the tree (component → section → document)

The entire pipeline runs with **zero LLM calls** — only embedding +
cross-encoder models (both sub-100ms).

Public API:
    ``run_write_path(component, document)``        → WritePathResult
    ``run_write_path_for_document(document)``       → batch all components
    ``rebuild_embeddings(document)``                 → re-embed everything
    ``get_write_path_status(document)``              → stats / health

Environment:
    INFERENCE_WRITE_PATH_ENABLED = 'true' | 'false'  (default: 'true')
    INFERENCE_MAXSIM_TOP_K       = 15                 (default)
"""
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from .embedding import embed_text, EmbeddingResult
from .vector_store import get_vector_store, SearchResult
from .reranker import get_reranker, classify_edge, RerankResult
from .models import LateralEdge, ComponentInference

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

MAXSIM_TOP_K = int(os.environ.get('INFERENCE_MAXSIM_TOP_K', '15'))

WRITE_PATH_ENABLED = os.environ.get(
    'INFERENCE_WRITE_PATH_ENABLED', 'true',
).lower() in ('true', '1', 'yes')


# ──────────────────────────────────────────────────────────────────────────
# Result types
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class WritePathResult:
    """Result of running the write path for a single component."""
    component_id: str = ''
    component_type: str = ''
    document_id: str = ''

    # Pipeline steps
    embedding_ms: int = 0
    search_ms: int = 0
    rerank_ms: int = 0
    upsert_ms: int = 0
    total_ms: int = 0

    # Counts
    candidates_found: int = 0
    critical_edges: int = 0
    contextual_edges: int = 0
    noise_discarded: int = 0
    edges_written: int = 0

    # Status
    success: bool = True
    error: str = ''
    skipped: bool = False
    skip_reason: str = ''


@dataclass
class DocumentWritePathResult:
    """Result of running write path for all components in a document."""
    document_id: str = ''
    total_components: int = 0
    components_processed: int = 0
    components_skipped: int = 0
    components_failed: int = 0
    total_edges: int = 0
    total_ms: int = 0
    results: list[WritePathResult] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────
# Content extraction (reused from engine.py)
# ──────────────────────────────────────────────────────────────────────────

def _get_component_text(component) -> str:
    """Extract the effective text content from any component type."""
    from documents.models import Paragraph, Sentence, LatexCode, Table

    if isinstance(component, Paragraph):
        return component.get_effective_content() or ''
    elif isinstance(component, Sentence):
        return component.content_text or ''
    elif isinstance(component, LatexCode):
        return component.get_effective_content() or ''
    elif isinstance(component, Table):
        return _table_to_text(component)
    else:
        return getattr(component, 'get_effective_content', lambda: '')() or \
               getattr(component, 'content_text', '') or ''


def _table_to_text(table) -> str:
    """Serialize a Table to readable text."""
    parts = []
    if table.title:
        parts.append(f'Table: {table.title}')
    headers = table.column_headers or []
    header_labels = [h.get('label', h.get('id', '')) for h in headers]
    if header_labels:
        parts.append('Columns: ' + ' | '.join(header_labels))
    for row in (table.table_data or [])[:20]:  # Cap at 20 rows for embedding
        cells = row.get('cells', {})
        row_vals = [str(cells.get(h.get('id', ''), '')) for h in headers]
        parts.append(' | '.join(row_vals))
    return '\n'.join(parts)


def _get_component_type_str(component) -> str:
    from documents.models import Paragraph, Sentence, LatexCode, Table, Section
    type_map = {
        Paragraph: 'paragraph',
        Sentence: 'sentence',
        LatexCode: 'latex_code',
        Table: 'table',
        Section: 'section',
    }
    return type_map.get(type(component), 'unknown')


def _get_component_section(component):
    """Resolve the parent section for any component type."""
    section = getattr(component, 'section', None)
    if not section:
        paragraph = getattr(component, 'paragraph', None)
        if paragraph:
            section = getattr(paragraph, 'section', None)
    return section


def _get_component_label(component) -> str:
    """Human-readable label for a component."""
    comp_type = _get_component_type_str(component)
    section = _get_component_section(component)
    section_title = getattr(section, 'title', '') or 'Untitled'

    if hasattr(component, 'title') and component.title:
        return f'{comp_type}: "{component.title}" in {section_title}'
    return f'{comp_type} in {section_title}'


# ──────────────────────────────────────────────────────────────────────────
# Load candidate texts from DB (for reranker)
# ──────────────────────────────────────────────────────────────────────────

def _load_candidate_texts(search_results: list[SearchResult]) -> dict[str, str]:
    """
    Load the actual text content for each search result component.
    Returns {component_id: text}.
    """
    from documents.models import Paragraph, Sentence, LatexCode, Table

    MODEL_MAP = {
        'paragraph': Paragraph,
        'sentence': Sentence,
        'latex_code': LatexCode,
        'table': Table,
    }

    texts = {}
    for sr in search_results:
        model_class = MODEL_MAP.get(sr.component_type)
        if not model_class:
            continue
        try:
            obj = model_class.objects.get(pk=sr.component_id)
            texts[sr.component_id] = _get_component_text(obj)
        except model_class.DoesNotExist:
            texts[sr.component_id] = ''

    return texts


def _get_target_summary(component_id: str) -> str:
    """Get the latest inference summary for a component (for edge cache)."""
    try:
        inf = ComponentInference.objects.filter(
            object_id=component_id,
            is_latest=True,
        ).first()
        return inf.summary if inf else ''
    except Exception:
        return ''


# ──────────────────────────────────────────────────────────────────────────
# The Write Path
# ──────────────────────────────────────────────────────────────────────────

def run_write_path(component, document=None) -> WritePathResult:
    """
    Execute the full write path for a single component:

    1. Embed (BGE-M3 ColBERT)
    2. MaxSim search (vector DB)
    3. Cross-encoder rerank
    4. Classify edges (CRITICAL / CONTEXTUAL / noise)
    5. Graph UPSERT (LateralEdge model)
    6. Staleness propagation (upward through tree)

    Returns a WritePathResult with timing and edge counts.
    """
    result = WritePathResult(
        component_id=str(component.id),
        component_type=_get_component_type_str(component),
    )

    # ── Guard: is the write path enabled? ────────────────────────────
    if not WRITE_PATH_ENABLED:
        result.skipped = True
        result.skip_reason = 'Write path disabled (INFERENCE_WRITE_PATH_ENABLED=false)'
        return result

    # ── Resolve document ─────────────────────────────────────────────
    if document is None:
        section = _get_component_section(component)
        document = getattr(section, 'document', None) if section else None
    if not document:
        result.success = False
        result.error = 'Cannot resolve document for component'
        return result

    result.document_id = str(document.id)
    t_total = time.time()

    # ── Step 1: Get component text ───────────────────────────────────
    text = _get_component_text(component)
    if not text or not text.strip():
        result.skipped = True
        result.skip_reason = 'Component has no text content'
        return result

    # ── Step 2: Embed (BGE-M3 token-level) ───────────────────────────
    t0 = time.time()
    try:
        embedding = embed_text(text)
    except Exception as exc:
        result.success = False
        result.error = f'Embedding failed: {exc}'
        return result
    result.embedding_ms = int((time.time() - t0) * 1000)

    # ── Step 3: Upsert into vector DB ────────────────────────────────
    section = _get_component_section(component)
    section_id = str(section.id) if section else ''

    store = get_vector_store()
    vectors_to_store = embedding.colbert_vecs if embedding.has_colbert else [embedding.dense]

    if vectors_to_store and any(v for v in vectors_to_store):
        store.upsert(
            component_id=str(component.id),
            document_id=str(document.id),
            component_type=result.component_type,
            section_id=section_id,
            colbert_vecs=vectors_to_store,
        )

    # ── Step 4: MaxSim search ────────────────────────────────────────
    t0 = time.time()
    query_vecs = embedding.colbert_vecs if embedding.has_colbert else [embedding.dense]
    search_results = store.search(
        document_id=str(document.id),
        query_vectors=query_vecs,
        limit=MAXSIM_TOP_K,
        exclude_id=str(component.id),
    )
    result.search_ms = int((time.time() - t0) * 1000)
    result.candidates_found = len(search_results)

    if not search_results:
        # No candidates — still clear old edges
        _graph_upsert(component, document, [])
        result.total_ms = int((time.time() - t_total) * 1000)
        return result

    # ── Step 5: Load candidate texts for reranker ────────────────────
    candidate_texts_map = _load_candidate_texts(search_results)

    # Build ordered candidate list aligned with search_results
    candidate_texts = [
        candidate_texts_map.get(sr.component_id, '')
        for sr in search_results
    ]

    # ── Step 6: Cross-encoder rerank ─────────────────────────────────
    t0 = time.time()
    reranker = get_reranker()
    rerank_results = reranker.rerank(text, candidate_texts)
    result.rerank_ms = int((time.time() - t0) * 1000)

    # ── Step 7: Classify and build edges ─────────────────────────────
    edges_to_create = []
    for rr in rerank_results:
        if rr.edge_type is None:
            result.noise_discarded += 1
            continue

        if rr.candidate_index >= len(search_results):
            continue

        sr = search_results[rr.candidate_index]

        if rr.edge_type == 'critical':
            result.critical_edges += 1
        else:
            result.contextual_edges += 1

        edges_to_create.append({
            'search_result': sr,
            'rerank_result': rr,
        })

    # ── Step 8: Graph UPSERT ─────────────────────────────────────────
    t0 = time.time()
    _graph_upsert(component, document, edges_to_create)
    result.upsert_ms = int((time.time() - t0) * 1000)
    result.edges_written = len(edges_to_create)

    # ── Step 9: Staleness propagation ────────────────────────────────
    _propagate_staleness_upward(component)

    result.total_ms = int((time.time() - t_total) * 1000)
    return result


def _graph_upsert(component, document, edges_to_create: list):
    """
    Atomic graph UPSERT:
      1. Delete all existing outbound edges from this component
      2. Write new edges

    Single transaction — the graph is always consistent.
    """
    source_ct = ContentType.objects.get_for_model(component)

    with transaction.atomic():
        # Delete old outbound edges
        LateralEdge.objects.filter(
            source_content_type=source_ct,
            source_object_id=component.id,
        ).delete()

        # Create new edges
        if not edges_to_create:
            return

        # Resolve content types for targets
        from documents.models import Paragraph, Sentence, LatexCode, Table
        MODEL_MAP = {
            'paragraph': Paragraph,
            'sentence': Sentence,
            'latex_code': LatexCode,
            'table': Table,
        }

        new_edges = []
        for edge_data in edges_to_create:
            sr = edge_data['search_result']
            rr = edge_data['rerank_result']

            target_model = MODEL_MAP.get(sr.component_type)
            if not target_model:
                continue

            target_ct = ContentType.objects.get_for_model(target_model)

            # Try to get a cached summary + label for fast read-path
            target_summary = _get_target_summary(sr.component_id)

            # Build label from target info
            try:
                target_obj = target_model.objects.get(pk=sr.component_id)
                target_label = _get_component_label(target_obj)
            except target_model.DoesNotExist:
                target_label = f'{sr.component_type}:{sr.component_id}'

            new_edges.append(LateralEdge(
                document=document,
                source_content_type=source_ct,
                source_object_id=component.id,
                target_content_type=target_ct,
                target_object_id=sr.component_id,
                edge_type=rr.edge_type,
                score=rr.score,
                target_summary=target_summary,
                target_label=target_label,
            ))

        if new_edges:
            LateralEdge.objects.bulk_create(new_edges)


def _propagate_staleness_upward(component):
    """Mark section → ancestors → document as stale (same as signals.py)."""
    from .signals import _propagate_staleness
    section = _get_component_section(component)
    document = getattr(section, 'document', None) if section else None
    _propagate_staleness(component, section=section, document=document)


# ──────────────────────────────────────────────────────────────────────────
# Batch operations
# ──────────────────────────────────────────────────────────────────────────

def run_write_path_for_document(document) -> DocumentWritePathResult:
    """
    Run the write path for ALL components in a document.

    Use this for initial indexing or full recomputation.
    Processes sections in order, paragraphs within sections in order.
    """
    from documents.models import Paragraph, LatexCode, Table

    doc_result = DocumentWritePathResult(document_id=str(document.id))
    t_total = time.time()

    all_components = []

    # Collect all components in document order
    for section in document.sections.all().order_by('order'):
        for para in section.paragraphs.order_by('order'):
            all_components.append(para)
        for latex in section.latex_codes.order_by('order'):
            all_components.append(latex)
        for table in section.tables.order_by('order'):
            all_components.append(table)

    doc_result.total_components = len(all_components)

    for component in all_components:
        wp_result = run_write_path(component, document=document)
        doc_result.results.append(wp_result)

        if wp_result.skipped:
            doc_result.components_skipped += 1
        elif wp_result.success:
            doc_result.components_processed += 1
            doc_result.total_edges += wp_result.edges_written
        else:
            doc_result.components_failed += 1

    doc_result.total_ms = int((time.time() - t_total) * 1000)
    return doc_result


def rebuild_embeddings(document) -> dict:
    """
    Re-embed all components of a document into the vector store.
    Does NOT run reranking or graph update — just refreshes vectors.
    """
    from documents.models import Paragraph, LatexCode, Table

    store = get_vector_store()
    stats = {
        'document_id': str(document.id),
        'embedded': 0,
        'skipped': 0,
        'errors': 0,
    }

    for section in document.sections.all().order_by('order'):
        components = []
        components.extend(list(section.paragraphs.order_by('order')))
        components.extend(list(section.latex_codes.order_by('order')))
        components.extend(list(section.tables.order_by('order')))

        for comp in components:
            text = _get_component_text(comp)
            if not text or not text.strip():
                stats['skipped'] += 1
                continue

            try:
                embedding = embed_text(text)
                vectors = embedding.colbert_vecs if embedding.has_colbert else [embedding.dense]
                if vectors and any(v for v in vectors):
                    store.upsert(
                        component_id=str(comp.id),
                        document_id=str(document.id),
                        component_type=_get_component_type_str(comp),
                        section_id=str(section.id),
                        colbert_vecs=vectors,
                    )
                    stats['embedded'] += 1
                else:
                    stats['skipped'] += 1
            except Exception as exc:
                logger.error('Embed failed for %s: %s', comp.id, exc)
                stats['errors'] += 1

    return stats


# ──────────────────────────────────────────────────────────────────────────
# Status / health
# ──────────────────────────────────────────────────────────────────────────

def get_write_path_status(document=None) -> dict:
    """
    Return the status of all write path services and per-document stats.
    """
    from .embedding import get_embedder
    from .vector_store import get_vector_store as _get_vs
    from .reranker import get_reranker as _get_rr

    embedder = get_embedder()
    vs = _get_vs()
    reranker = _get_rr()

    embedding_healthy = getattr(embedder, 'health_check', lambda: True)()
    vector_store_healthy = vs.health_check()
    reranker_healthy = reranker.health_check()

    status = {
        # Flattened keys expected by WritePathStatusSerializer
        'enabled': WRITE_PATH_ENABLED,
        'embedding_backend': type(embedder).__name__,
        'vector_store_backend': type(vs).__name__,
        'reranker_backend': type(reranker).__name__,
        'vector_count': vs.count(),
        'lateral_edges': {
            'document_id': str(document.id) if document else None,
            'total': LateralEdge.objects.filter(document=document).count() if document else 0,
            'critical': (
                LateralEdge.objects.filter(document=document, edge_type='critical').count()
                if document else 0
            ),
            'contextual': (
                LateralEdge.objects.filter(document=document, edge_type='contextual').count()
                if document else 0
            ),
        },
        'thresholds': {
            'critical': float(os.environ.get('INFERENCE_CRITICAL_THRESHOLD', '0.85')),
            'contextual': float(os.environ.get('INFERENCE_CONTEXTUAL_THRESHOLD', '0.65')),
            'maxsim_top_k': MAXSIM_TOP_K,
        },
        # Additional nested diagnostics are kept for debugging / future use.
        'health': {
            'embedding': embedding_healthy,
            'vector_store': vector_store_healthy,
            'reranker': reranker_healthy,
        },
    }

    if document:
        status['document'] = {
            'document_id': str(document.id),
            'vectors_indexed': vs.count(str(document.id)),
            'lateral_edges': LateralEdge.objects.filter(document=document).count(),
            'critical_edges': LateralEdge.objects.filter(
                document=document, edge_type='critical',
            ).count(),
            'contextual_edges': LateralEdge.objects.filter(
                document=document, edge_type='contextual',
            ).count(),
        }

    return status
