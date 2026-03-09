"""
Tree Inference Engine — Bottom-up hierarchical AI processing
=============================================================

The engine walks the document tree from leaves to root:

    Phase 1 — LEAF INFERENCE
        For every Paragraph, Sentence, LatexCode, Table:
        • Compute content hash → skip if unchanged since last inference
        • Call LLM to produce ComponentInference (summary, entities, tags …)

    Phase 2 — SECTION AGGREGATION  (bottom-up)
        For every Section (deepest first):
        • Collect child ComponentInferences + child SectionAggregateInferences
        • Call LLM to produce a SectionAggregateInference

    Phase 3 — DOCUMENT AGGREGATION
        • Collect root-section aggregates
        • Call LLM to produce DocumentInferenceSummary

Each phase is **incremental**: unchanged subtrees are skipped via hash
comparison, so re-running inference after a small edit is near-instant
for untouched sections.

Public API:
    ``TreeInferenceEngine(document, user=None, model=None)``
        .infer_component(component)        → ComponentInference
        .infer_section(section)             → SectionAggregateInference
        .infer_document()                   → DocumentInferenceSummary
        .infer_subtree(section)             → full bottom-up for one subtree
        .infer_full()                       → full bottom-up for entire document
        .get_section_context(section)        → pre-built context string for AI
        .get_document_context()              → pre-built context string for AI
"""
import json
import logging
import os
import time
from typing import Optional

from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from ..gemini_ingest import call_gemini, extract_function_call_result, DEFAULT_GEMINI_MODEL
from .models import ComponentInference, SectionAggregateInference, DocumentInferenceSummary
from .prompts import (
    COMPONENT_INFERENCE_PROMPT,
    SECTION_AGGREGATE_PROMPT,
    DOCUMENT_AGGREGATE_PROMPT,
    TABLE_INFERENCE_PROMPT,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# LLM caller (reuses the project's Gemini integration)
# ──────────────────────────────────────────────────────────────────────────

def _call_inference_llm(prompt: str, model: str, temperature: float = 0.1,
                        max_tokens: int = 4096) -> dict:
    """
    Send a prompt to the configured LLM and return parsed JSON.
    Falls back to the project-wide Gemini caller.
    """
    api_key = os.environ.get('GEMINI_API') or ''
    if not api_key:
        logger.error('Inference engine: GEMINI_API key not configured')
        return {'error': 'missing_api_key'}

    model = model or DEFAULT_GEMINI_MODEL
    payload = {
        'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
        'generationConfig': {
            'temperature': temperature,
            'topP': 0.9,
            'topK': 40,
            'maxOutputTokens': max_tokens,
        },
        'model': model,
    }
    try:
        raw_resp = call_gemini(payload, api_key=api_key)
    except Exception as exc:
        logger.error(f'Inference LLM call failed: {exc}')
        return {'error': str(exc)}

    if isinstance(raw_resp, dict) and raw_resp.get('mock'):
        return {'error': 'mock_response'}

    parsed = extract_function_call_result(raw_resp)
    if isinstance(parsed, dict):
        return parsed

    # Attempt to extract JSON from the raw text response
    text = ''
    if isinstance(raw_resp, dict):
        try:
            candidates = raw_resp.get('candidates', [])
            if candidates:
                parts = candidates[0].get('content', {}).get('parts', [])
                if parts:
                    text = parts[0].get('text', '')
        except (IndexError, KeyError, TypeError):
            pass
    elif isinstance(raw_resp, str):
        text = raw_resp

    if text:
        return _extract_json_from_text(text)

    return {'error': 'empty_response'}


def _extract_json_from_text(text: str) -> dict:
    """Try to parse JSON from LLM text, stripping markdown fences."""
    import re
    # Strip markdown code fences
    cleaned = re.sub(r'^```(?:json)?\s*', '', text.strip())
    cleaned = re.sub(r'\s*```$', '', cleaned.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find JSON object in the text
        match = re.search(r'\{[\s\S]*\}', cleaned)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    return {'error': 'json_parse_failed', 'raw_text': text[:500]}


# ──────────────────────────────────────────────────────────────────────────
# Content extractors — get text from each component type
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
        # Fallback: try get_effective_content or content_text
        return getattr(component, 'get_effective_content', lambda: '')() or \
               getattr(component, 'content_text', '') or ''


def _table_to_text(table) -> str:
    """Serialize a Table to a readable text representation."""
    parts = []
    if table.title:
        parts.append(f'Table: {table.title}')
    headers = table.column_headers or []
    header_labels = []
    header_ids = []
    for header in headers:
        if isinstance(header, dict):
            label = header.get('label', header.get('id', ''))
            header_id = header.get('id', label)
        else:
            label = str(header)
            header_id = str(header)
        header_labels.append(str(label))
        header_ids.append(str(header_id))
    if header_labels:
        parts.append('Columns: ' + ' | '.join(header_labels))
    for row in (table.table_data or []):
        if isinstance(row, dict):
            cells = row.get('cells', {})
            if isinstance(cells, dict):
                row_vals = [str(cells.get(header_id, '')) for header_id in header_ids]
            else:
                row_vals = [str(cells)]
        elif isinstance(row, (list, tuple)):
            row_vals = [str(value) for value in row]
        else:
            row_vals = [str(row)]
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


# ──────────────────────────────────────────────────────────────────────────
# TreeInferenceEngine
# ──────────────────────────────────────────────────────────────────────────

class TreeInferenceEngine:
    """
    Hierarchical inference engine for a single document.

    Usage:
        engine = TreeInferenceEngine(document, user=request.user)
        result = engine.infer_full()           # full document
        result = engine.infer_subtree(section)  # single subtree
        context = engine.get_section_context(section)  # for downstream AI
    """

    def __init__(self, document, user=None, model: str | None = None,
                 force: bool = False):
        """
        Args:
            document: Document instance
            user: User triggering the inference
            model: LLM model ID (defaults to project default)
            force: If True, re-infer even if hashes match (skip cache)
        """
        self.document = document
        self.user = user
        self.model = model or DEFAULT_GEMINI_MODEL
        self.force = force
        self._stats = {
            'components_processed': 0,
            'components_skipped': 0,
            'sections_processed': 0,
            'sections_skipped': 0,
            'llm_calls': 0,
            'errors': [],
            'duration_ms': 0,
        }

    # ── Public API ───────────────────────────────────────────────────

    def infer_full(self) -> dict:
        """
        Full bottom-up inference for the entire document.
        Returns a stats dict with the DocumentInferenceSummary id.
        """
        t0 = time.time()

        # Phase 1 + 2: process all root sections (recursively)
        root_sections = self.document.sections.filter(
            parent__isnull=True,
        ).order_by('order')

        for section in root_sections:
            self.infer_subtree(section)

        # Phase 3: document-level aggregation
        doc_summary = self._aggregate_document()

        self._stats['duration_ms'] = int((time.time() - t0) * 1000)
        return {
            'status': 'completed',
            'document_id': str(self.document.id),
            'document_inference_id': str(doc_summary.id) if doc_summary else None,
            **self._stats,
        }

    def infer_subtree(self, section) -> Optional[SectionAggregateInference]:
        """
        Bottom-up inference for a single section subtree.
        Processes children recursively, then aggregates.
        """
        # Phase 1: infer leaf components of this section
        self._infer_section_components(section)

        # Recurse into child subsections (deepest first via recursion)
        for child_section in section.children.order_by('order'):
            self.infer_subtree(child_section)

        # Phase 2: aggregate this section
        return self._aggregate_section(section)

    def infer_component(self, component) -> Optional[ComponentInference]:
        """Infer a single component (Paragraph, Sentence, etc.)."""
        return self._infer_single_component(component)

    def infer_section(self, section) -> Optional[SectionAggregateInference]:
        """Aggregate a section from existing child inferences (no recursion)."""
        return self._aggregate_section(section)

    def get_section_context(self, section) -> str:
        """
        Build a pre-formed context string for a section, suitable for
        injection into downstream AI prompts.
        """
        agg = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).first()
        if not agg:
            return f'Section "{section.title or "Untitled"}": no inference available.'

        parts = [
            f'## Section: {section.title or "Untitled"}',
            f'Purpose: {agg.custom_metadata.get("section_purpose", "N/A")}',
            f'Summary: {agg.summary}',
        ]
        if agg.aggregated_entities:
            parts.append(f'Key entities: {", ".join(agg.aggregated_entities[:20])}')
        if agg.aggregated_tags:
            parts.append(f'Tags: {", ".join(agg.aggregated_tags)}')
        obligations = agg.custom_metadata.get('key_obligations', [])
        if obligations:
            parts.append(f'Key obligations: {"; ".join(obligations[:10])}')
        risks = agg.custom_metadata.get('risk_indicators', [])
        if risks:
            parts.append(f'Risk indicators: {"; ".join(risks[:10])}')
        return '\n'.join(parts)

    def get_document_context(self) -> str:
        """
        Build a pre-formed context string for the entire document.
        """
        doc_inf = DocumentInferenceSummary.objects.filter(
            document=self.document, is_latest=True,
        ).first()
        if not doc_inf:
            return f'Document "{self.document.title}": no inference available.'

        parts = [
            f'# Document: {self.document.title}',
            f'Type: {self.document.document_type or "N/A"}',
            f'Summary: {doc_inf.summary}',
        ]
        if doc_inf.all_entities:
            parts.append(f'Key entities: {", ".join(doc_inf.all_entities[:30])}')
        if doc_inf.all_tags:
            parts.append(f'Tags: {", ".join(doc_inf.all_tags)}')
        for sec in (doc_inf.section_summaries or []):
            parts.append(f'\n## {sec.get("title", "Section")}')
            parts.append(f'  Summary: {sec.get("summary", "N/A")}')
        return '\n'.join(parts)

    def get_stats(self) -> dict:
        return dict(self._stats)

    # ── Private: Component-level inference ───────────────────────────

    def _infer_section_components(self, section):
        """Infer all leaf components within a section (not subsections)."""
        from documents.models import Paragraph, LatexCode, Table

        # Paragraphs
        for para in section.paragraphs.order_by('order'):
            self._infer_single_component(para)
            # Sentences within the paragraph
            for sentence in para.sentences.order_by('order'):
                self._infer_single_component(sentence)

        # LatexCode blocks
        for latex in section.latex_codes.order_by('order'):
            self._infer_single_component(latex)

        # Tables
        for table in section.tables.order_by('order'):
            self._infer_single_component(table)

    def _infer_single_component(self, component) -> Optional[ComponentInference]:
        """Produce a ComponentInference for one component, skipping if fresh."""
        from documents.models import Table

        text = _get_component_text(component)
        if not text or not text.strip():
            return None

        content_hash = ComponentInference.compute_hash(text)
        comp_type = _get_component_type_str(component)

        # ── Skip if unchanged ────────────────────────────────────────
        if not self.force:
            existing = ComponentInference.objects.filter(
                content_type=ContentType.objects.get_for_model(component),
                object_id=component.id,
                is_latest=True,
            ).first()
            if existing and existing.content_hash == content_hash:
                self._stats['components_skipped'] += 1
                return existing

        # ── Build prompt ─────────────────────────────────────────────
        section = getattr(component, 'section', None) or \
                  getattr(getattr(component, 'paragraph', None), 'section', None)
        section_title = getattr(section, 'title', '') or ''
        component_order = getattr(component, 'order', 0)

        if isinstance(component, Table):
            prompt = TABLE_INFERENCE_PROMPT.format(
                table_title=component.title or 'Untitled',
                table_type=component.table_type or 'data',
                column_headers=json.dumps(component.column_headers or [], default=str),
                num_rows=component.num_rows or 0,
                section_title=section_title,
                table_data_json=json.dumps(component.table_data or [], default=str)[:3000],
            )
        else:
            prompt = COMPONENT_INFERENCE_PROMPT.format(
                component_type=comp_type,
                section_title=section_title,
                component_order=component_order,
                content=text[:4000],  # Truncate very long content
            )

        # ── Call LLM ─────────────────────────────────────────────────
        t0 = time.time()
        result = _call_inference_llm(prompt, self.model)
        duration_ms = int((time.time() - t0) * 1000)
        self._stats['llm_calls'] += 1

        if 'error' in result:
            self._stats['errors'].append({
                'component_type': comp_type,
                'component_id': str(component.id),
                'error': result['error'],
            })
            return None

        # ── Persist ──────────────────────────────────────────────────
        document = self.document
        ct = ContentType.objects.get_for_model(component)

        inference = ComponentInference(
            content_type=ct,
            object_id=component.id,
            component_type=comp_type,
            document=document,
            section=section,
            summary=result.get('summary', ''),
            key_entities=result.get('key_entities', []),
            context_tags=result.get('context_tags', []),
            relationships=result.get('relationships', []),
            sentiment=_safe_float(result.get('sentiment')),
            complexity=_safe_float(result.get('complexity')),
            importance=_safe_float(result.get('importance', 0.5)),
            raw_llm_output=result,
            content_hash=content_hash,
            model_name=self.model,
            document_version_number=document.version_number,
            is_latest=True,
            created_by=self.user,
            inference_duration_ms=duration_ms,
        )
        inference.save()
        self._stats['components_processed'] += 1
        return inference

    # ── Private: Section aggregation ─────────────────────────────────

    def _aggregate_section(self, section) -> Optional[SectionAggregateInference]:
        """Aggregate child inferences into a SectionAggregateInference."""
        # Collect child component inferences
        child_component_infs = list(ComponentInference.objects.filter(
            section=section, is_latest=True,
        ).order_by('component_type', 'created_at'))

        # Collect child subsection aggregates
        child_section_aggs = list(SectionAggregateInference.objects.filter(
            section__parent=section, is_latest=True,
        ).order_by('section__order'))

        if not child_component_infs and not child_section_aggs:
            return None

        # ── Compute children hash for staleness detection ────────────
        child_hashes = [ci.content_hash for ci in child_component_infs]
        child_hashes += [ca.children_hash for ca in child_section_aggs]
        children_hash = SectionAggregateInference.compute_children_hash(child_hashes)

        # ── Skip if unchanged ────────────────────────────────────────
        if not self.force:
            existing = SectionAggregateInference.objects.filter(
                section=section, is_latest=True,
            ).first()
            if existing and existing.children_hash == children_hash:
                self._stats['sections_skipped'] += 1
                return existing

        # ── Build child summaries payload ────────────────────────────
        child_summaries = []
        for ci in child_component_infs:
            child_summaries.append({
                'component_id': str(ci.object_id),
                'component_type': ci.component_type,
                'summary': ci.summary,
                'importance': ci.importance,
                'entities': ci.key_entities[:10],
                'tags': ci.context_tags,
            })
        for ca in child_section_aggs:
            child_summaries.append({
                'component_id': str(ca.section_id),
                'component_type': 'subsection',
                'summary': ca.summary,
                'importance': ca.max_importance or 0.5,
                'entities': ca.aggregated_entities[:10],
                'tags': ca.aggregated_tags,
            })

        prompt = SECTION_AGGREGATE_PROMPT.format(
            section_title=section.title or 'Untitled',
            section_type=section.section_type or 'clause',
            depth_level=section.depth_level,
            child_summaries_json=json.dumps(child_summaries, default=str)[:6000],
        )

        # ── Call LLM ─────────────────────────────────────────────────
        t0 = time.time()
        result = _call_inference_llm(prompt, self.model, max_tokens=4096)
        duration_ms = int((time.time() - t0) * 1000)
        self._stats['llm_calls'] += 1

        if 'error' in result:
            self._stats['errors'].append({
                'section_id': str(section.id),
                'error': result['error'],
            })
            # Still create a simple aggregation without LLM
            result = self._local_aggregate_fallback(child_component_infs, child_section_aggs)

        # ── Compute stats ────────────────────────────────────────────
        sentiments = [ci.sentiment for ci in child_component_infs if ci.sentiment is not None]
        sentiments += [ca.avg_sentiment for ca in child_section_aggs if ca.avg_sentiment is not None]
        complexities = [ci.complexity for ci in child_component_infs if ci.complexity is not None]
        complexities += [ca.avg_complexity for ca in child_section_aggs if ca.avg_complexity is not None]
        importances = [ci.importance for ci in child_component_infs if ci.importance is not None]
        importances += [ca.max_importance for ca in child_section_aggs if ca.max_importance is not None]

        agg = SectionAggregateInference(
            section=section,
            document=self.document,
            summary=result.get('summary', ''),
            child_summaries=child_summaries,
            aggregated_entities=result.get('aggregated_entities', []),
            aggregated_tags=result.get('aggregated_tags', []),
            aggregated_relationships=result.get('aggregated_relationships', []),
            avg_sentiment=_safe_avg(sentiments),
            avg_complexity=_safe_avg(complexities),
            max_importance=max(importances) if importances else None,
            total_components=len(child_component_infs),
            total_paragraphs=sum(1 for ci in child_component_infs if ci.component_type == 'paragraph'),
            total_sentences=sum(1 for ci in child_component_infs if ci.component_type == 'sentence'),
            total_tables=sum(1 for ci in child_component_infs if ci.component_type == 'table'),
            total_latex_codes=sum(1 for ci in child_component_infs if ci.component_type == 'latex_code'),
            total_subsections=len(child_section_aggs),
            children_hash=children_hash,
            model_name=self.model,
            document_version_number=self.document.version_number,
            is_latest=True,
            created_by=self.user,
            inference_duration_ms=duration_ms,
            custom_metadata={
                'section_purpose': result.get('section_purpose', ''),
                'risk_indicators': result.get('risk_indicators', []),
                'key_obligations': result.get('key_obligations', []),
                'key_terms_defined': result.get('key_terms_defined', []),
            },
        )
        agg.save()
        self._stats['sections_processed'] += 1
        return agg

    # ── Private: Document aggregation ────────────────────────────────

    def _aggregate_document(self) -> Optional[DocumentInferenceSummary]:
        """Produce the top-level DocumentInferenceSummary."""
        root_aggs = list(SectionAggregateInference.objects.filter(
            document=self.document,
            section__parent__isnull=True,
            is_latest=True,
        ).order_by('section__order'))

        if not root_aggs:
            return None

        sections_hash = SectionAggregateInference.compute_children_hash(
            [a.children_hash for a in root_aggs]
        )

        # ── Skip if unchanged ────────────────────────────────────────
        if not self.force:
            existing = DocumentInferenceSummary.objects.filter(
                document=self.document, is_latest=True,
            ).first()
            if existing and existing.sections_hash == sections_hash:
                return existing

        section_summaries = []
        for agg in root_aggs:
            section_summaries.append({
                'section_id': str(agg.section_id),
                'title': agg.section.title or 'Untitled',
                'summary': agg.summary,
                'importance': agg.max_importance,
                'tags': agg.aggregated_tags,
                'entities': agg.aggregated_entities[:15],
            })

        prompt = DOCUMENT_AGGREGATE_PROMPT.format(
            document_title=self.document.title or 'Untitled',
            document_type=self.document.document_type or 'document',
            total_sections=len(root_aggs),
            section_summaries_json=json.dumps(section_summaries, default=str)[:8000],
        )

        t0 = time.time()
        result = _call_inference_llm(prompt, self.model, max_tokens=6144)
        duration_ms = int((time.time() - t0) * 1000)
        self._stats['llm_calls'] += 1

        if 'error' in result:
            self._stats['errors'].append({
                'document_id': str(self.document.id),
                'error': result['error'],
            })
            result = self._local_doc_aggregate_fallback(root_aggs)

        # Collect all unique entities and tags
        all_entities = result.get('all_entities', [])
        all_tags = result.get('all_tags', [])
        all_rels = result.get('all_relationships', [])

        sentiments = [a.avg_sentiment for a in root_aggs if a.avg_sentiment is not None]
        complexities = [a.avg_complexity for a in root_aggs if a.avg_complexity is not None]
        total_components = sum(a.total_components for a in root_aggs)

        doc_inf = DocumentInferenceSummary(
            document=self.document,
            summary=result.get('summary', ''),
            section_summaries=section_summaries,
            all_entities=all_entities,
            all_tags=all_tags,
            all_relationships=all_rels,
            avg_sentiment=_safe_avg(sentiments),
            avg_complexity=_safe_avg(complexities),
            total_sections=len(root_aggs),
            total_components=total_components,
            sections_hash=sections_hash,
            model_name=self.model,
            document_version_number=self.document.version_number,
            is_latest=True,
            created_by=self.user,
            inference_duration_ms=duration_ms,
            custom_metadata={
                'document_purpose': result.get('document_purpose', ''),
                'key_obligations': result.get('key_obligations', []),
                'key_risks': result.get('key_risks', []),
                'key_terms': result.get('key_terms', []),
                'parties_identified': result.get('parties_identified', []),
                'cross_section_issues': result.get('cross_section_issues', []),
            },
        )
        doc_inf.save()
        return doc_inf

    # ── Fallback aggregators (no LLM, pure data merge) ───────────────

    @staticmethod
    def _local_aggregate_fallback(component_infs, section_aggs) -> dict:
        """Produce a simple merge without LLM when the call fails."""
        all_entities = set()
        all_tags = set()
        summaries = []
        for ci in component_infs:
            summaries.append(ci.summary)
            all_entities.update(ci.key_entities or [])
            all_tags.update(ci.context_tags or [])
        for sa in section_aggs:
            summaries.append(sa.summary)
            all_entities.update(sa.aggregated_entities or [])
            all_tags.update(sa.aggregated_tags or [])
        return {
            'summary': ' '.join(s for s in summaries if s)[:500],
            'aggregated_entities': sorted(all_entities),
            'aggregated_tags': sorted(all_tags),
            'aggregated_relationships': [],
            'section_purpose': '',
            'risk_indicators': [],
            'key_obligations': [],
            'key_terms_defined': [],
        }

    @staticmethod
    def _local_doc_aggregate_fallback(root_aggs) -> dict:
        """Document-level fallback without LLM."""
        all_entities = set()
        all_tags = set()
        summaries = []
        for agg in root_aggs:
            summaries.append(agg.summary)
            all_entities.update(agg.aggregated_entities or [])
            all_tags.update(agg.aggregated_tags or [])
        return {
            'summary': ' '.join(s for s in summaries if s)[:800],
            'all_entities': sorted(all_entities),
            'all_tags': sorted(all_tags),
            'all_relationships': [],
            'document_purpose': '',
            'key_obligations': [],
            'key_risks': [],
            'key_terms': [],
            'parties_identified': [],
            'cross_section_issues': [],
        }


# ──────────────────────────────────────────────────────────────────────────
# Utility helpers
# ──────────────────────────────────────────────────────────────────────────

def _safe_float(val, default=None) -> Optional[float]:
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_avg(values: list) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 4)
