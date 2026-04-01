"""
CLM Inference Node Executor
=============================

New CLM node type ``inference`` that leverages the hierarchical inference
engine to provide rich, pre-computed context for AI-powered CLM nodes.

Instead of sending raw document text to an LLM (which is slow and token-
expensive), the inference node:

  1. Runs (or reuses cached) bottom-up tree inference on linked editor documents
  2. Feeds the pre-built context (summaries, entities, tags, risks) into a
     compact prompt
  3. Stores results in the CLM document's ``extracted_metadata``

This makes downstream Rule/Validator/Action nodes dramatically more
efficient because they operate on pre-distilled context rather than
full-text re-reads.

Config schema (stored in node.config):
  {
    "model": "gemini-2.5-flash",
    "system_prompt": "...",                    // user's custom prompt
    "output_key": "inference_analysis",        // key in extracted_metadata
    "inference_scope": "document" | "section", // what to infer
    "target_section_title": "",                // only for scope=section
    "include_entities": true,
    "include_relationships": true,
    "include_risks": true,
    "force_reinfer": false,                    // skip cache
    "temperature": 0.2,
    "max_tokens": 4096,
  }
"""
import json
import logging
import os
import time

from django.utils import timezone

from clm.models import WorkflowDocument, WorkflowNode

logger = logging.getLogger(__name__)


def _get_editor_document(clm_doc: WorkflowDocument):
    """
    Try to find the linked editor Document for a CLM WorkflowDocument.
    CLM documents store text + metadata from uploaded PDFs, but if they
    were created from an editor document, we can leverage its structure.
    """
    from documents.models import Document

    # Check if the CLM doc has a linked editor document
    meta = clm_doc.extracted_metadata or {}

    # Convention: CLM stores editor_document_id in metadata
    editor_doc_id = meta.get('editor_document_id') or meta.get('document_id')
    if editor_doc_id:
        try:
            return Document.objects.get(pk=editor_doc_id)
        except Document.DoesNotExist:
            pass

    # Fallback: search by title match
    title = clm_doc.title or ''
    if title:
        match = Document.objects.filter(title__iexact=title).first()
        if match:
            return match

    return None


def _build_inference_context(editor_doc, scope: str, target_section_title: str,
                             include_entities: bool, include_relationships: bool,
                             include_risks: bool) -> str:
    """
    Build the inference context string from the hierarchical inference engine.
    Uses cached results when available.
    """
    from aiservices.inference.engine import TreeInferenceEngine
    from aiservices.inference.models import (
        DocumentInferenceSummary,
        SectionAggregateInference,
    )

    engine = TreeInferenceEngine(document=editor_doc)

    if scope == 'section' and target_section_title:
        # Find the target section
        section = editor_doc.sections.filter(
            title__icontains=target_section_title,
        ).first()
        if section:
            context = engine.get_section_context(section)
        else:
            context = f'Section "{target_section_title}" not found in document.'
    else:
        context = engine.get_document_context()

    # Enrich context with structured data if requested
    parts = [context]

    if scope != 'section':
        doc_inf = DocumentInferenceSummary.objects.filter(
            document=editor_doc, is_latest=True,
        ).first()
        if doc_inf:
            if include_entities and doc_inf.all_entities:
                parts.append(f'\n### All Entities\n{json.dumps(doc_inf.all_entities[:50])}')
            if include_relationships and doc_inf.all_relationships:
                parts.append(f'\n### Relationships\n{json.dumps(doc_inf.all_relationships[:30])}')
            if include_risks:
                risks = (doc_inf.custom_metadata or {}).get('key_risks', [])
                if risks:
                    parts.append(f'\n### Key Risks\n{json.dumps(risks)}')

    return '\n'.join(parts)


def _build_clm_text_context(clm_doc: WorkflowDocument) -> str:
    """Fallback: build context from CLM document text + metadata (no editor doc)."""
    parts = []
    if clm_doc.title:
        parts.append(f'Document: {clm_doc.title}')
    if clm_doc.original_text:
        parts.append(f'Text:\n{clm_doc.original_text[:6000]}')
    meta = clm_doc.extracted_metadata or {}
    if meta:
        # Include only non-internal keys
        filtered = {k: v for k, v in meta.items()
                    if not k.startswith('_') and v is not None}
        if filtered:
            parts.append(f'Metadata:\n{json.dumps(filtered, default=str, indent=2)[:3000]}')
    return '\n\n'.join(parts)


def _call_inference_ai(model_id: str, system_prompt: str, context: str,
                       temperature: float, max_tokens: int) -> dict:
    """Call the LLM with the inference context."""
    from clm.ai_node_executor import _call_model
    return _call_model(
        model_id=model_id,
        system_prompt=system_prompt,
        document_context=context,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def execute_inference_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Execute an inference node in the CLM workflow.

    For each incoming CLM document:
      1. Find the linked editor document (if any)
      2. Pull pre-computed hierarchical inference context
      3. Send context + user's system prompt to the LLM
      4. Store result in extracted_metadata[output_key]

    Documents always pass through (enrichment, not filtering).
    """
    config = node.config or {}
    model_id = config.get('model', 'gemini-2.5-flash')
    system_prompt = config.get('system_prompt', '')
    output_key = config.get('output_key', 'inference_analysis')
    inference_scope = config.get('inference_scope', 'document')
    target_section_title = config.get('target_section_title', '')
    include_entities = config.get('include_entities', True)
    include_relationships = config.get('include_relationships', True)
    include_risks = config.get('include_risks', True)
    force_reinfer = config.get('force_reinfer', False)
    temperature = float(config.get('temperature', 0.2))
    max_tokens = int(config.get('max_tokens', 4096))

    if not system_prompt:
        return {
            'node_id': str(node.id),
            'status': 'failed',
            'error': 'No system prompt configured for inference node',
            'processed': 0,
            'results': [],
        }

    documents = WorkflowDocument.objects.filter(id__in=incoming_document_ids)
    results = []
    processed = 0
    failed = 0
    inference_hits = 0  # docs that had pre-built inference available

    for clm_doc in documents:
        t0 = time.time()
        result_entry = {
            'document_id': str(clm_doc.id),
            'document_title': clm_doc.title or str(clm_doc.id),
        }

        # 1. Try to find linked editor document
        editor_doc = _get_editor_document(clm_doc)

        if editor_doc:
            # 2a. Run inference if needed (incremental — skips unchanged)
            if force_reinfer:
                from aiservices.inference.engine import TreeInferenceEngine
                engine = TreeInferenceEngine(
                    document=editor_doc,
                    model=model_id,
                    force=True,
                )
                engine.infer_full()

            # 2b. Build context from hierarchical inference
            context = _build_inference_context(
                editor_doc=editor_doc,
                scope=inference_scope,
                target_section_title=target_section_title,
                include_entities=include_entities,
                include_relationships=include_relationships,
                include_risks=include_risks,
            )
            result_entry['context_source'] = 'hierarchical_inference'
            inference_hits += 1
        else:
            # 2c. Fallback: use CLM document text directly
            context = _build_clm_text_context(clm_doc)
            result_entry['context_source'] = 'clm_text_fallback'

        # 3. Call LLM with context + system prompt
        full_prompt = (
            f"You have pre-analyzed document context below. "
            f"Use it to answer the user's request.\n\n"
            f"--- DOCUMENT CONTEXT ---\n{context}\n--- END CONTEXT ---"
        )

        ai_result = _call_inference_ai(
            model_id=model_id,
            system_prompt=system_prompt,
            context=full_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        duration_ms = int((time.time() - t0) * 1000)

        if 'error' in ai_result:
            failed += 1
            result_entry['status'] = 'error'
            result_entry['error'] = ai_result['error']
            result_entry['duration_ms'] = duration_ms
            results.append(result_entry)
            continue

        response_text = ai_result.get('response', '')

        # 4. Store in extracted_metadata
        meta = clm_doc.extracted_metadata or {}
        meta[output_key] = response_text

        # Also store structured inference metadata for downstream nodes
        meta[f'{output_key}_meta'] = {
            'context_source': result_entry.get('context_source', ''),
            'model': model_id,
            'inference_scope': inference_scope,
            'timestamp': timezone.now().isoformat(),
            'duration_ms': duration_ms,
        }

        clm_doc.extracted_metadata = meta
        clm_doc.save(update_fields=['extracted_metadata', 'updated_at'])

        result_entry['status'] = 'success'
        result_entry['response'] = response_text[:500]
        result_entry['duration_ms'] = duration_ms
        results.append(result_entry)
        processed += 1

    total = processed + failed
    if failed == total and total > 0:
        overall_status = 'failed'
    elif failed > 0:
        overall_status = 'partial'
    else:
        overall_status = 'completed'

    return {
        'node_id': str(node.id),
        'model': model_id,
        'status': overall_status,
        'inference_scope': inference_scope,
        'output_key': output_key,
        'processed': processed,
        'failed': failed,
        'total': total,
        'inference_hits': inference_hits,
        'results': results,
    }
