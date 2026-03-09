from typing import Any, Dict, List, Tuple, Optional, cast
import difflib
import json
import re

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from documents.models import Paragraph, ParagraphAIResult, Document
from sharing.permissions import IsOwnerOrSharedWith
from ..serializers import ParagraphAIReviewApplySerializer
from .service import (
    evaluate_paragraph_metadata,
    evaluate_paragraph_rewrite,
    evaluate_paragraph_scoring,
)


def _is_ai_service_enabled(document, service_name):
    """Check whether an AI service is enabled for a document via DocumentAIConfig."""
    try:
        from aiservices.models import DocumentAIConfig
        ai_cfg = DocumentAIConfig.get_or_create_for_document(document)
        return ai_cfg.is_service_enabled(service_name)
    except Exception:
        return True  # fail-open so existing documents aren't blocked

PLACEHOLDER_REGEX = re.compile(r'\[\[([^\]]+)\]\]')


def _normalize_grammar(text: str) -> Tuple[str, bool]:
    if not text or not isinstance(text, str):
        return text, False
    if re.search(r'<[^>]+>', text):
        return text, False
    original = text
    corrected = re.sub(r'\s+', ' ', text).strip()
    corrected = re.sub(r'\s+([,.;:!?])', r'\1', corrected)
    corrected = re.sub(r'([,.;:!?])([A-Za-z])', r'\1 \2', corrected)
    if corrected and corrected[0].islower():
        corrected = corrected[0].upper() + corrected[1:]
    return corrected, corrected != original


def _flatten_dict(data: Dict[str, Any], parent_key: str = '', sep: str = '.') -> Dict[str, Any]:
    items: Dict[str, Any] = {}
    for key, value in (data or {}).items():
        new_key = f"{parent_key}{sep}{key}" if parent_key else str(key)
        if isinstance(value, dict):
            items.update(_flatten_dict(value, new_key, sep=sep))
        else:
            items[new_key] = value
    return items


def _normalize_placeholder_key(key: str) -> str:
    base = key.split('.')[-1]
    base = re.sub(r'[^A-Za-z0-9]+', '_', base).strip('_')
    return base.lower()


def _build_placeholder_map(flat_metadata: Dict[str, Any]) -> Dict[str, str]:
    placeholder_map: Dict[str, str] = {}
    for key, value in (flat_metadata or {}).items():
        if value is None:
            continue
        if isinstance(value, dict):
            continue
        if isinstance(value, list):
            if all(isinstance(item, (str, int, float)) for item in value):
                value = ', '.join([str(item) for item in value])
            else:
                continue
        placeholder_key = _normalize_placeholder_key(str(key))
        placeholder_map[placeholder_key] = str(value)
    return placeholder_map


def _apply_placeholders_to_text(text: str, paragraph_id: str, placeholder_map: Dict[str, str]) -> Tuple[str, set]:
    processed = text
    detected = set()
    for placeholder, value in (placeholder_map or {}).items():
        if not value:
            continue
        if value in processed:
            token = f'[[{paragraph_id}.{placeholder}]]'
            processed = processed.replace(value, token)
            detected.add(placeholder)
    detected.update(set(PLACEHOLDER_REGEX.findall(processed or '')))
    return processed, detected


def _resolve_placeholders_in_text(text: str, paragraph_id: str,
                                  placeholder_map: Dict[str, str], overrides: Dict[str, str]) -> str:
    resolved = text
    if not isinstance(resolved, str):
        return resolved
    combined = dict(placeholder_map or {})
    for key, value in (overrides or {}).items():
        combined[str(key).lower()] = str(value)
    for placeholder, value in combined.items():
        token = f'[[{paragraph_id}.{placeholder}]]'
        resolved = resolved.replace(token, value)
    return resolved


def _generate_paragraph_suggestions(text: str) -> List[Dict[str, Any]]:
    suggestions: List[Dict[str, Any]] = []

    if not text:
        return suggestions

    if re.search(r'\s{2,}', text):
        suggestions.append({
            'id': 'grammar_double_space',
            'type': 'grammar',
            'message': 'Remove consecutive spaces.',
            'original': '  ',
            'replacement': ' ',
        })

    if text and text[0].islower():
        suggestions.append({
            'id': 'grammar_capitalize',
            'type': 'grammar',
            'message': 'Capitalize the first letter.',
            'original': text[0],
            'replacement': text[0].upper(),
        })

    if text and text[-1] not in '.!?':
        suggestions.append({
            'id': 'grammar_terminal_punct',
            'type': 'grammar',
            'message': 'Add ending punctuation for completeness.',
            'original': text,
            'replacement': f"{text}.",
        })

    legal_phrases = [
        ('may', 'shall', 'Replace discretionary language with mandatory language where appropriate.'),
        ('reasonable', 'commercially reasonable', 'Specify the reasonableness standard.'),
        ('best efforts', 'commercially reasonable efforts', 'Clarify effort standard.'),
    ]

    for original, replacement, message in legal_phrases:
        pattern = re.compile(rf'\b{re.escape(original)}\b', re.IGNORECASE)
        match = pattern.search(text)
        if match:
            suggestions.append({
                'id': f'legal_replace_{original.replace(" ", "_")}',
                'type': 'legal',
                'message': message,
                'original': match.group(0),
                'replacement': replacement,
            })

    if re.search(r'\bTBD\b', text, re.IGNORECASE):
        suggestions.append({
            'id': 'legal_tbd',
            'type': 'legal',
            'message': 'Replace TBD with a concrete obligation or date.',
            'original': 'TBD',
            'replacement': 'to be determined',
        })

    return suggestions


def _apply_suggestions(text: str, suggestions: List[Dict[str, Any]]) -> str:
    updated = text
    for suggestion in suggestions or []:
        original = suggestion.get('original')
        replacement = suggestion.get('replacement')
        if original and replacement and isinstance(updated, str):
            updated = updated.replace(original, replacement, 1)
    return updated


def _resolve_suggestion_ranges(rendered_text: str, suggestions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rendered_text:
        return suggestions

    updated = []
    for suggestion in suggestions or []:
        suggestion_copy = dict(suggestion)
        original = suggestion_copy.get('original') or ''
        if not original:
            updated.append(suggestion_copy)
            continue

        start = rendered_text.find(original)
        if start == -1:
            try:
                matcher = difflib.SequenceMatcher(None, rendered_text, original)
                match = matcher.find_longest_match(0, len(rendered_text), 0, len(original))
                if match.size > 0:
                    start = match.a
            except Exception:
                start = -1

        if start != -1:
            end = start + len(original)
            suggestion_copy['range'] = {
                'start': start,
                'end': end
            }

        updated.append(suggestion_copy)

    return updated


def _filter_redundant_placeholder_suggestions(processed_text: str,
                                              suggestions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not processed_text or not suggestions:
        return suggestions

    filtered: List[Dict[str, Any]] = []
    for suggestion in suggestions:
        replacement = suggestion.get('replacement') or ''
        if replacement and PLACEHOLDER_REGEX.search(replacement):
            if replacement in processed_text:
                continue
        filtered.append(suggestion)

    return filtered


def _filter_grammar_only_suggestions(suggestions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not suggestions:
        return suggestions
    return [suggestion for suggestion in suggestions if suggestion.get('type') == 'grammar']


def _calculate_paragraph_scores(text: str, suggestions: List[Dict[str, Any]]) -> Dict[str, Any]:
    grammar_issues = 0
    if re.search(r'\s{2,}', text or ''):
        grammar_issues += 1
    if text and text[0].islower():
        grammar_issues += 1
    if text and text[-1] not in '.!?':
        grammar_issues += 1
    grammar_score = max(0.0, 1.0 - (grammar_issues * 0.15))

    legal_flags = len([s for s in suggestions if s.get('type') == 'legal'])
    legal_risk_score = max(0.0, 1.0 - (legal_flags * 0.2))

    clarity_score = max(0.0, 1.0 - min(0.4, len(text or '') / 1000))
    ambiguity_score = max(0.0, min(1.0, len(re.findall(r'\b(may|could|might|reasonable)\b', text or '', re.IGNORECASE)) * 0.1))
    reference_integrity_score = max(0.0, 1.0 - min(0.4, len(re.findall(r'\bthis|that|such\b', text or '', re.IGNORECASE)) * 0.05))
    enforceability_score = max(0.0, 1.0 - (legal_flags * 0.1))
    structural_validity_score = max(0.0, 1.0 - min(0.3, (text or '').count('(') * 0.05))

    overall = round((
        grammar_score
        + clarity_score
        + (1.0 - ambiguity_score)
        + (1.0 - legal_risk_score)
        + reference_integrity_score
        + enforceability_score
        + structural_validity_score
    ) / 7, 3)

    return {
        'grammar_score': round(grammar_score, 3),
        'clarity_score': round(clarity_score, 3),
        'ambiguity_score': round(ambiguity_score, 3),
        'legal_risk_score': round(legal_risk_score, 3),
        'reference_integrity_score': round(reference_integrity_score, 3),
        'enforceability_score': round(enforceability_score, 3),
        'structural_validity_score': round(structural_validity_score, 3),
        'overall_score': overall,
        'confidence_score': round(max(0.0, min(1.0, 1.0 - (grammar_issues * 0.08))), 3),
    }


def _get_document_ai_context(document, service_name: str = '') -> str:
    """Fetch the effective AI context string for a document (system prompt, ai_focus, mode).
    If service_name is provided, uses the per-service system prompt instead of the global one."""
    try:
        from aiservices.models import DocumentAIConfig
        ai_cfg = DocumentAIConfig.get_or_create_for_document(document)
        return ai_cfg.get_document_ai_context(service_name=service_name)
    except Exception:
        return ''


def _compute_paragraph_ai_review(paragraph: Paragraph, user) -> Tuple[Optional[Dict[str, Any]], Optional[Response]]:
    if not paragraph.section or not paragraph.section.document:
        return None, Response(
            {'status': 'error', 'message': 'Paragraph is not linked to a document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    document = paragraph.section.document
    # Build per-service context strings so each AI call gets its own tailored prompt
    ctx_metadata = _get_document_ai_context(document, service_name='paragraph_review')
    ctx_rewrite = _get_document_ai_context(document, service_name='paragraph_rewrite')
    ctx_scoring = _get_document_ai_context(document, service_name='paragraph_scoring')
    paragraph_metadata = paragraph.custom_metadata or {}
    flat_metadata = _flatten_dict(paragraph_metadata)
    placeholder_map = _build_placeholder_map(flat_metadata)

    base_text = paragraph.edited_text if paragraph.has_edits and paragraph.edited_text else paragraph.content_text
    if PLACEHOLDER_REGEX.search(base_text or ''):
        processed_text = base_text or ''
        rendered_text = paragraph.render_with_metadata(paragraph_metadata, processed_text)
    else:
        rendered_text = base_text or ''
        processed_text, _ = _apply_placeholders_to_text(rendered_text, str(paragraph.id), placeholder_map)

    siblings = list(
        Paragraph.objects.filter(section=paragraph.section).order_by('order')
    )
    prev_paragraph = None
    next_paragraph = None
    for idx, sibling in enumerate(siblings):
        if sibling.id == paragraph.id:
            prev_paragraph = siblings[idx - 1] if idx > 0 else None
            next_paragraph = siblings[idx + 1] if idx + 1 < len(siblings) else None
            break

    def _context_text(item: Paragraph) -> str:
        if not item:
            return ''
        base = item.edited_text if item.has_edits and item.edited_text else item.content_text
        return item.render_with_metadata(item.custom_metadata or {}, base or '')

    # ── Hierarchical inference context ───────────────────────────────
    inference_context = ''
    try:
        from aiservices.inference.graph_traversal import get_hierarchical_context_for_paragraph
        inference_context = get_hierarchical_context_for_paragraph(paragraph)
    except Exception:
        pass  # inference not available yet — degrade gracefully

    paragraph_payload = {
        'paragraph_id': str(paragraph.id),
        'paragraph_type': paragraph.paragraph_type,
        'paragraph_order': paragraph.order,
        'section_id': str(paragraph.section.id),
        'section_title': paragraph.section.title or '',
        'section_order': paragraph.section.order,
        'paragraph_metadata': paragraph_metadata,
        'processed_text': processed_text,
        'rendered_text': rendered_text,
        'inference_context': inference_context,
        'context': {
            'previous_paragraph': {
                'paragraph_id': str(prev_paragraph.id),
                'paragraph_order': prev_paragraph.order,
                'rendered_text': _context_text(prev_paragraph),
            } if prev_paragraph else None,
            'next_paragraph': {
                'paragraph_id': str(next_paragraph.id),
                'paragraph_order': next_paragraph.order,
                'rendered_text': _context_text(next_paragraph),
            } if next_paragraph else None,
        },
    }
    # Check if we already have a saved AI result for this paragraph & document version
    try:
        existing_ai = ParagraphAIResult.objects.filter(
            paragraph=paragraph,
            document=document,
            document_version_number=document.version_number,
            is_latest_for_version=True,
        ).order_by('-analysis_timestamp').first()
    except Exception:
        existing_ai = None

    if existing_ai:
        # Consider result fresh only if edit count and last_modified match
        paragraph_edit_count = paragraph.edit_count or 0
        ai_edit_count = existing_ai.paragraph_edit_count or 0
        ai_last_mod = existing_ai.paragraph_last_modified
        para_last_mod = paragraph.last_modified
        if paragraph_edit_count == ai_edit_count and (ai_last_mod is None or str(ai_last_mod) == str(para_last_mod)):
            # Return stored result instead of re-calling the AI
            payload = {
                'document_id': document.reference_number or str(document.id),
                'paragraph_id': str(paragraph.id),
                'paragraph_type': paragraph.paragraph_type,
                'paragraph_type_detected': existing_ai.paragraph_type_detected,
                'paragraph_ai_result_id': str(existing_ai.id),
                'ai_result_cached': True,
                'ai_result_timestamp': existing_ai.analysis_timestamp.isoformat() if existing_ai.analysis_timestamp else None,
                'paragraph_metadata': paragraph.custom_metadata or {},
                'metadata_detected': existing_ai.metadata_detected or {},
                'processed_text': existing_ai.processed_text or '',
                'grammar_status': existing_ai.grammar_status or 'Unchanged',
                'already_correct': existing_ai.already_correct,
                'placeholders_detected': existing_ai.placeholders_detected or [],
                'scores': existing_ai.scores or {},
                'suggestions': existing_ai.suggestions or [],
            }
            return payload, None

    metadata_response = evaluate_paragraph_metadata(paragraph_payload,
                                                     document_context=ctx_metadata)
    if metadata_response.get('error') == 'missing_api_key':
        return None, Response(
            {'status': 'error', 'message': 'Gemini API key not configured.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if metadata_response.get('error') == 'gemini_api_error':
        return None, Response(
            {
                'status': 'error',
                'message': metadata_response.get('message', 'Gemini request failed.'),
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )
    metadata_parsed = metadata_response.get('parsed') or {}

    rewrite_response = evaluate_paragraph_rewrite(paragraph_payload,
                                                   document_context=ctx_rewrite)
    if rewrite_response.get('error') == 'missing_api_key':
        return None, Response(
            {'status': 'error', 'message': 'Gemini API key not configured.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if rewrite_response.get('error') == 'gemini_api_error':
        return None, Response(
            {
                'status': 'error',
                'message': rewrite_response.get('message', 'Gemini request failed.'),
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )
    rewrite_parsed = rewrite_response.get('parsed') or {}

    processed_from_ai = rewrite_parsed.get('processed_text') if isinstance(rewrite_parsed, dict) else None
    rendered_from_ai = rewrite_parsed.get('rendered_text') if isinstance(rewrite_parsed, dict) else None
    corrected_rendered = rendered_from_ai or rendered_text
    grammar_status = rewrite_parsed.get('grammar_status') if isinstance(rewrite_parsed, dict) else None

    scoring_payload = {
        'processed_text': processed_from_ai or processed_text,
        'rendered_text': corrected_rendered,
        'suggestions': rewrite_parsed.get('suggestions') if isinstance(rewrite_parsed, dict) else None,
    }
    scoring_response = evaluate_paragraph_scoring(scoring_payload,
                                                   document_context=ctx_scoring)
    if scoring_response.get('error') == 'missing_api_key':
        return None, Response(
            {'status': 'error', 'message': 'Gemini API key not configured.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if scoring_response.get('error') == 'gemini_api_error':
        return None, Response(
            {
                'status': 'error',
                'message': scoring_response.get('message', 'Gemini request failed.'),
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )
    scoring_parsed = scoring_response.get('parsed') or {}

    model_name = {
        'metadata': metadata_response.get('model_name'),
        'rewrite': rewrite_response.get('model_name'),
        'scoring': scoring_response.get('model_name'),
    }

    allowed_types = {choice[0] for choice in Paragraph.PARAGRAPH_TYPES}
    detected_type = metadata_parsed.get('paragraph_type') if isinstance(metadata_parsed, dict) else None
    if detected_type not in allowed_types:
        detected_type = None

    metadata_detected = metadata_parsed.get('metadata_detected') if isinstance(metadata_parsed, dict) else None
    if not isinstance(metadata_detected, dict):
        metadata_detected = {}

    if paragraph_metadata or PLACEHOLDER_REGEX.search(processed_text or ''):
        metadata_detected = {}

    metadata_for_placeholders = paragraph_metadata or metadata_detected
    flat_metadata = _flatten_dict(metadata_for_placeholders)
    placeholder_map = _build_placeholder_map(flat_metadata)

    processed_text = processed_from_ai or processed_text
    processed_text, _ = _apply_placeholders_to_text(corrected_rendered, str(paragraph.id), placeholder_map)
    placeholders_detected = sorted(flat_metadata.keys())

    suggestions = rewrite_parsed.get('suggestions') if isinstance(rewrite_parsed, dict) else None
    if suggestions is None:
        suggestions = _generate_paragraph_suggestions(processed_text)

    suggestions = _filter_redundant_placeholder_suggestions(processed_text, suggestions)
    suggestions = _filter_grammar_only_suggestions(suggestions)
    suggestions = _resolve_suggestion_ranges(processed_text, suggestions)

    scores = scoring_parsed.get('scores') if isinstance(scoring_parsed, dict) else None
    if not isinstance(scores, dict):
        scores = _calculate_paragraph_scores(processed_text, suggestions)
    else:
        score_review = scoring_parsed.get('review') if isinstance(scoring_parsed, dict) else None
        score_reasoning = scoring_parsed.get('reasoning') if isinstance(scoring_parsed, dict) else None
        confidence_score = scoring_parsed.get('confidence_score') if isinstance(scoring_parsed, dict) else None
        model_version = scoring_parsed.get('model_version') if isinstance(scoring_parsed, dict) else None
        if score_review:
            scores['review'] = score_review
        if score_reasoning:
            scores['reasoning'] = score_reasoning
        if confidence_score is not None:
            scores['confidence_score'] = confidence_score
        if model_version:
            scores['model_version'] = model_version

    if not grammar_status:
        grammar_status = 'Corrected' if corrected_rendered != rendered_text else 'Unchanged'

    already_correct = grammar_status == 'Unchanged' and len(suggestions or []) == 0

    ai_result, _ = ParagraphAIResult.objects.update_or_create(
        paragraph=paragraph,
        document_version_number=document.version_number,
        defaults={
            'document': document,
            'created_by': user,
            'document_version': document.version,
            'document_version_label': document.version_label,
            'paragraph_edit_count': paragraph.edit_count or 0,
            'paragraph_last_modified': paragraph.last_modified,
            'paragraph_type_detected': detected_type,
            'grammar_status': grammar_status,
            'already_correct': already_correct,
            'processed_text': processed_text,
            'rendered_text': corrected_rendered,
            'metadata_detected': metadata_detected,
            'placeholders_detected': placeholders_detected,
            'scores': scores,
            'suggestions': suggestions,
            'raw_llm_output': {
                'metadata': metadata_parsed,
                'rewrite': rewrite_parsed,
                'scoring': scoring_parsed,
            },
            'raw_llm_text': json.dumps(
                {
                    'metadata': metadata_response.get('raw_response'),
                    'rewrite': rewrite_response.get('raw_response'),
                    'scoring': scoring_response.get('raw_response'),
                },
                default=str,
            ),
            'model_name': model_name,
            'is_latest_for_version': True,
        },
    )

    return {
        'document_id': document.reference_number or str(document.id),
        'paragraph_id': str(paragraph.id),
        'paragraph_type': paragraph.paragraph_type,
        'paragraph_type_detected': detected_type,
        'paragraph_ai_result_id': str(ai_result.id),
        'ai_result_cached': False,
        'ai_result_timestamp': ai_result.analysis_timestamp.isoformat() if ai_result.analysis_timestamp else None,
        'paragraph_metadata': paragraph.custom_metadata or {},
        'metadata_detected': metadata_detected,
        'processed_text': processed_text,
        'grammar_status': grammar_status,
        'already_correct': already_correct,
        'placeholders_detected': placeholders_detected,
        'scores': scores,
        'suggestions': suggestions,
    }, None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def paragraph_ai_review(request, pk):
    paragraph = get_object_or_404(Paragraph, pk=pk)
    if not paragraph.section or not paragraph.section.document:
        return Response(
            {'status': 'error', 'message': 'Paragraph is not linked to a document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    document = paragraph.section.document
    permission = IsOwnerOrSharedWith()
    if not permission.has_object_permission(request, None, document):
        return Response(
            {'status': 'forbidden', 'message': 'Access denied.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not _is_ai_service_enabled(document, 'paragraph_review'):
        return Response(
            {'status': 'disabled', 'message': 'Paragraph review is disabled for this document.'},
            status=status.HTTP_200_OK,
        )

    payload, error_response = _compute_paragraph_ai_review(paragraph, request.user)
    if error_response:
        return error_response
    return Response(payload, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_paragraph_ai_review_updated(request, pk):
    document = get_object_or_404(Document, pk=pk)
    permission = IsOwnerOrSharedWith()
    if not permission.has_object_permission(request, None, document):
        return Response(
            {'status': 'forbidden', 'message': 'Access denied.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    max_items_raw = request.query_params.get('limit')
    max_items = None
    if max_items_raw:
        try:
            max_items = int(max_items_raw)
        except (TypeError, ValueError):
            return Response(
                {'status': 'error', 'message': 'Invalid limit.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    paragraphs = Paragraph.objects.filter(section__document=document).order_by('order')
    updated_results = []
    skipped = []

    for paragraph in paragraphs:
        if not paragraph.needs_ai_recheck(document.version_number):
            skipped.append(str(paragraph.id))
            continue
        payload, error_response = _compute_paragraph_ai_review(paragraph, request.user)
        if error_response:
            return error_response
        updated_results.append(payload)
        if max_items is not None and len(updated_results) >= max_items:
            break

    return Response(
        {
            'status': 'ok',
            'document_id': document.reference_number or str(document.id),
            'version_number': document.version_number,
            'updated_count': len(updated_results),
            'skipped_count': len(skipped),
            'updated_results': updated_results,
            'skipped_paragraphs': skipped,
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_paragraph_ai_scoring(request, pk):
    document = get_object_or_404(Document, pk=pk)
    permission = IsOwnerOrSharedWith()
    if not permission.has_object_permission(request, None, document):
        return Response(
            {'status': 'forbidden', 'message': 'Access denied.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not _is_ai_service_enabled(document, 'paragraph_scoring'):
        return Response(
            {'status': 'disabled', 'message': 'Paragraph scoring is disabled for this document.', 'results': []},
            status=status.HTTP_200_OK,
        )

    document_context = _get_document_ai_context(document, service_name='paragraph_scoring')

    max_items_raw = request.query_params.get('limit')
    max_items = None
    if max_items_raw:
        try:
            max_items = int(max_items_raw)
        except (TypeError, ValueError):
            return Response(
                {'status': 'error', 'message': 'Invalid limit.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    paragraph_ids = request.query_params.getlist('paragraph_id')
    paragraphs = Paragraph.objects.filter(section__document=document).order_by('order')
    if paragraph_ids:
        paragraphs = paragraphs.filter(id__in=paragraph_ids)

    results = []
    updated = []
    skipped = []

    for paragraph in paragraphs:
        existing_ai = ParagraphAIResult.objects.filter(
            paragraph=paragraph,
            document=document,
            document_version_number=document.version_number,
            is_latest_for_version=True,
        ).order_by('-analysis_timestamp').first()

        if existing_ai and not paragraph.needs_ai_recheck(document.version_number):
            results.append({
                'paragraph_id': str(paragraph.id),
                'scores': existing_ai.scores or {},
                'analysis_timestamp': existing_ai.analysis_timestamp.isoformat() if existing_ai.analysis_timestamp else None,
                'cached': True,
            })
            skipped.append(str(paragraph.id))
            continue

        paragraph_metadata = paragraph.custom_metadata or {}
        base_text = paragraph.edited_text if paragraph.has_edits and paragraph.edited_text else paragraph.content_text
        rendered_text = paragraph.render_with_metadata(paragraph_metadata, base_text or '')
        processed_text = rendered_text
        if existing_ai and existing_ai.processed_text:
            processed_text = existing_ai.processed_text
        suggestions = existing_ai.suggestions if existing_ai else []

        scoring_payload = {
            'processed_text': processed_text,
            'rendered_text': rendered_text,
            'suggestions': suggestions,
        }
        scoring_response = evaluate_paragraph_scoring(scoring_payload,
                                                       document_context=document_context)
        if scoring_response.get('error') == 'missing_api_key':
            return Response(
                {'status': 'error', 'message': 'Gemini API key not configured.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if scoring_response.get('error') == 'gemini_api_error':
            return Response(
                {
                    'status': 'error',
                    'message': scoring_response.get('message', 'Gemini request failed.'),
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

        scoring_parsed = scoring_response.get('parsed') or {}
        scores = scoring_parsed.get('scores') if isinstance(scoring_parsed, dict) else None
        if not isinstance(scores, dict):
            scores = _calculate_paragraph_scores(processed_text, suggestions)
        else:
            score_review = scoring_parsed.get('review') if isinstance(scoring_parsed, dict) else None
            score_reasoning = scoring_parsed.get('reasoning') if isinstance(scoring_parsed, dict) else None
            confidence_score = scoring_parsed.get('confidence_score') if isinstance(scoring_parsed, dict) else None
            model_version = scoring_parsed.get('model_version') if isinstance(scoring_parsed, dict) else None
            if score_review:
                scores['review'] = score_review
            if score_reasoning:
                scores['reasoning'] = score_reasoning
            if confidence_score is not None:
                scores['confidence_score'] = confidence_score
            if model_version:
                scores['model_version'] = model_version

        raw_llm_output = None
        raw_llm_text = None
        if existing_ai and existing_ai.raw_llm_output:
            raw_llm_output = dict(existing_ai.raw_llm_output)
            raw_llm_output['scoring'] = scoring_parsed
        else:
            raw_llm_output = {'scoring': scoring_parsed}

        if existing_ai and existing_ai.raw_llm_text:
            try:
                existing_raw = json.loads(existing_ai.raw_llm_text)
                if isinstance(existing_raw, dict):
                    existing_raw['scoring'] = scoring_response.get('raw_response')
                    raw_llm_text = json.dumps(existing_raw, default=str)
            except (TypeError, ValueError):
                raw_llm_text = json.dumps({'scoring': scoring_response.get('raw_response')}, default=str)
        else:
            raw_llm_text = json.dumps({'scoring': scoring_response.get('raw_response')}, default=str)

        ai_result, _ = ParagraphAIResult.objects.update_or_create(
            paragraph=paragraph,
            document_version_number=document.version_number,
            defaults={
                'document': document,
                'created_by': request.user,
                'document_version': document.version,
                'document_version_label': document.version_label,
                'paragraph_edit_count': paragraph.edit_count or 0,
                'paragraph_last_modified': paragraph.last_modified,
                'processed_text': processed_text,
                'rendered_text': rendered_text,
                'scores': scores,
                'raw_llm_output': raw_llm_output,
                'raw_llm_text': raw_llm_text,
                'model_name': scoring_response.get('model_name'),
                'is_latest_for_version': True,
            },
        )

        results.append({
            'paragraph_id': str(paragraph.id),
            'scores': scores,
            'analysis_timestamp': ai_result.analysis_timestamp.isoformat() if ai_result.analysis_timestamp else None,
            'cached': False,
        })
        updated.append(str(paragraph.id))

        if max_items is not None and len(updated) >= max_items:
            break

    return Response(
        {
            'status': 'ok',
            'document_id': document.reference_number or str(document.id),
            'version_number': document.version_number,
            'updated_count': len(updated),
            'skipped_count': len(skipped),
            'results': results,
            'updated_paragraphs': updated,
            'skipped_paragraphs': skipped,
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def paragraph_ai_apply_review(request, pk):
    serializer = ParagraphAIReviewApplySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = cast(Dict[str, Any], serializer.validated_data)

    paragraph = get_object_or_404(Paragraph, pk=pk)
    if not paragraph.section or not paragraph.section.document:
        return Response(
            {'status': 'error', 'message': 'Paragraph is not linked to a document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    document = paragraph.section.document
    permission = IsOwnerOrSharedWith()
    if not permission.has_object_permission(request, None, document):
        return Response(
            {'status': 'forbidden', 'message': 'Access denied.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    paragraph_metadata = paragraph.custom_metadata or {}
    flat_metadata = _flatten_dict(paragraph_metadata)
    placeholder_map = _build_placeholder_map(flat_metadata)

    processed_text = data.get('processed_text')
    rendered_text = data.get('rendered_text')
    suggestions = data.get('suggestions') or []
    suggestions = _resolve_suggestion_ranges(rendered_text or '', suggestions)

    if not rendered_text:
        processed_text = processed_text or ''
        rendered_text = paragraph.render_with_metadata(paragraph_metadata, processed_text)

    updated_rendered = _apply_suggestions(rendered_text or '', suggestions)
    corrected_rendered, changed = _normalize_grammar(updated_rendered)
    processed_text, detected = _apply_placeholders_to_text(corrected_rendered, str(paragraph.id), placeholder_map)

    scores = _calculate_paragraph_scores(corrected_rendered, suggestions)

    paragraph.edited_text = processed_text
    paragraph.has_edits = True
    paragraph.modified_by = request.user
    paragraph.edit_count = (paragraph.edit_count or 0) + 1
    paragraph.save(update_fields=['edited_text', 'has_edits', 'modified_by', 'edit_count', 'last_modified'])

    return Response(
        {
            'document_id': document.reference_number or str(document.id),
            'paragraph_id': str(paragraph.id),
            'paragraph_type': paragraph.paragraph_type,
            'paragraph_metadata': paragraph.custom_metadata or {},
            'processed_text': processed_text,
            'rendered_text': corrected_rendered,
            'grammar_status': 'Corrected' if changed else 'Unchanged',
            'placeholders_detected': sorted(flat_metadata.keys()),
            'scores': scores,
            'suggestions_applied': suggestions,
            'status': 'updated',
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def paragraph_ai_rewrite(request, pk):
    serializer = ParagraphAIReviewApplySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = cast(Dict[str, Any], serializer.validated_data)

    paragraph = get_object_or_404(Paragraph, pk=pk)
    if not paragraph.section or not paragraph.section.document:
        return Response(
            {'status': 'error', 'message': 'Paragraph is not linked to a document.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    document = paragraph.section.document
    permission = IsOwnerOrSharedWith()
    if not permission.has_object_permission(request, None, document):
        return Response(
            {'status': 'forbidden', 'message': 'Access denied.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    disabled_resp = _is_ai_service_enabled(document, 'paragraph_rewrite')
    if not disabled_resp:
        return Response(
            {'status': 'disabled', 'message': 'Paragraph rewrite is disabled for this document.'},
            status=status.HTTP_200_OK,
        )

    document_context = _get_document_ai_context(document, service_name='paragraph_rewrite')
    paragraph_metadata = paragraph.custom_metadata or {}
    base_text = paragraph.edited_text if paragraph.has_edits and paragraph.edited_text else paragraph.content_text
    processed_text = data.get('processed_text') or data.get('rendered_text') or base_text or ''
    rendered_text = data.get('rendered_text') or processed_text
    suggestions = data.get('suggestions') or []

    paragraph_payload = {
        'paragraph_id': str(paragraph.id),
        'paragraph_type': paragraph.paragraph_type,
        'paragraph_order': paragraph.order,
        'section_id': str(paragraph.section.id),
        'section_title': paragraph.section.title or '',
        'section_order': paragraph.section.order,
        'paragraph_metadata': paragraph_metadata,
        'processed_text': processed_text,
        'rendered_text': rendered_text,
        'suggestions': suggestions,
    }

    rewrite_response = evaluate_paragraph_rewrite(paragraph_payload,
                                                   document_context=document_context)
    if rewrite_response.get('error') == 'missing_api_key':
        return Response(
            {'status': 'error', 'message': 'Gemini API key not configured.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if rewrite_response.get('error') == 'gemini_api_error':
        return Response(
            {
                'status': 'error',
                'message': rewrite_response.get('message', 'Gemini request failed.'),
            },
            status=status.HTTP_502_BAD_GATEWAY,
        )

    rewrite_parsed = rewrite_response.get('parsed') or {}
    processed_from_ai = rewrite_parsed.get('processed_text') if isinstance(rewrite_parsed, dict) else None
    rendered_from_ai = rewrite_parsed.get('rendered_text') if isinstance(rewrite_parsed, dict) else None
    grammar_status = rewrite_parsed.get('grammar_status') if isinstance(rewrite_parsed, dict) else None
    suggestions = rewrite_parsed.get('suggestions') if isinstance(rewrite_parsed, dict) else suggestions
    suggestions = _resolve_suggestion_ranges(rendered_from_ai or rendered_text, suggestions or [])

    return Response(
        {
            'document_id': document.reference_number or str(document.id),
            'paragraph_id': str(paragraph.id),
            'paragraph_type': paragraph.paragraph_type,
            'processed_text': processed_from_ai or processed_text,
            'rendered_text': rendered_from_ai or rendered_text,
            'grammar_status': grammar_status or 'Unchanged',
            'suggestions': suggestions,
        },
        status=status.HTTP_200_OK,
    )


