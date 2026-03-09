import json
import os
import re
from typing import Optional, Tuple, Any, Dict

from django.contrib.auth.models import User

from documents.models import Document, DocumentScore, Section, Paragraph, Table
from documents.serializers import CompleteDocumentSerializer
from .gemini_ingest import call_gemini, extract_function_call_result


DEFAULT_MODEL = os.environ.get('GEN_MODEL', 'gemini-3-flash-preview')


SYSTEM_PROMPT = """You are a legal document evaluation assistant. Given a complete document JSON (provided by the user), produce an evaluation JSON object following the exact schema described below. RETURN ONLY VALID JSON — no explanation, no markdown fences.

The output schema MUST match exactly the keys in the example. Types should be correct (numbers where numbers expected, booleans where booleans expected, arrays where arrays expected).
If a value is unknown or not applicable, use null for objects/strings or an empty list where appropriate. Do not invent data that is not supported by the document.

SCHEMA REQUIRED (return an object with these top-level keys):
{
    "global_document_header": {
        "final_aggregated_score": 0,
        "overall_risk_category": "Low",
        "human_review_required": false,
        "review_trigger_reason": "string",
        "review_priority": "P3"
    },
    "core_score_dimensions": {
        "_logic": "0-100. Higher is better, except Risk.",
        "completeness_score": 0,
        "validity_enforceability_score": 0,
        "risk_exposure_score": 0,
        "compliance_regulatory_score": 0,
        "clarity_score": 0,
        "drafting_quality_score": 0
    },
    "operational_commercial_intelligence": {
        "obligation_balance_score": 50,
        "operational_feasibility_score": 0,
        "quantifiable_financial_exposure": {
            "currency": "USD",
            "primary_cap_amount": 0,
            "exposure_description": "string"
        },
        "notice_period_days": -1
    },
        "clause_level_review": [
            {
                "clause_id": "CL-001",
                "clause_type": "string",
                "source_location": "string",
                "section_id": "optional-section-uuid-or-null",
                "paragraph_id": "optional-paragraph-uuid-or-null",
                "table_id": "optional-table-uuid-or-null",
                "table_cell_ref": "optional e.g. r2:col3",
                "section_title": "string",
                "section_path": "string",
                "severity": "Moderate",
                "remediation_type": "Replace",
                "suggested_revision": "string",
                "conflicting_clause_ids": []
            }
        ],
    "ai_governance_trust_metrics": {
        "confidence_score": 0,
        "evidence_coverage_score": 0,
        "model_audit_meta": {
            "ruleset_id": "v1.2-harsh-audit",
            "analysis_timestamp_utc": "ISO-8601"
        }
    }
}

RULES:
- Use numeric scores for all *_score fields (integers or floats).
- final_aggregated_score should be 0-100. overall_risk_category one of [Low, Medium, High].
- review_priority should be one of [P1, P2, P3, P4] or null.
- Provide clause_level_review entries for clauses that the document contains which need remediation.
- Review clauses across all hierarchy levels: sections, subsections, sub-subsections, and the paragraphs/tables within them.
- Each clause item should include section_id (if available), section_title, and a section_path like "1 > Payment Terms > Late Fees".
- Each clause item should include exact section_id/paragraph_id/table_id when available in the document JSON.
- Include section_title and a section_path like "1 > Payment Terms > Late Fees".
- If a clause references a table cell, include table_cell_ref like "r2:col3".
- If the clause comes from a paragraph or table cell, include source_location that references the paragraph order or table title/row/column.
- Fill ai_governance_trust_metrics.confidence_score with a model confidence estimate (0-100).
- analysis_timestamp_utc in model_audit_meta should be an ISO-8601 timestamp if returned.
- Treat unresolved placeholders (tokens like [[paragraph_id.field]] or entries in "unresolved_placeholders") as missing data. Do not assume values; reduce completeness/clarity where material and add clause_level_review issues when they affect key terms.
- If a sentence instructs replacement (e.g., "Replace the placeholder [[...]] with ..."), treat it as evidence the value is missing; do not infer the value or treat the instruction itself as fulfillment.
- Return ONLY JSON and ensure it parses.
"""


RATIONALE_PROMPT = """You are a legal document rationale extractor. Given the document JSON, produce a compact rationale JSON that gives one-line evidence/rationale for each numeric score and any clause-level issues.

Return a JSON object with these keys:
- "core_score_rationale": {"completeness_score": "one-line evidence", ...}
- "clause_level_rationale": [ {"section_id": "uuid or null", "paragraph_id": "uuid or null", "clause_id": "CL-...", "rationale": "one-line evidence" }, ... ]

Only return JSON. Keep each rationale to one short sentence. Do NOT return scores here — only evidence/rationale statements to be used for scoring. Treat unresolved placeholders (tokens like [[paragraph_id.field]] or entries in "unresolved_placeholders") as missing data and mention them where relevant. If the document text says to replace a placeholder, still treat that value as missing.
"""


REASONING_PROMPT = """You are a legal document analyst. Review the document JSON and produce concise, evidence-based rationale for scoring.

Return ONLY valid JSON with this structure:
{
    "score_rationale": {
        "completeness_score": "One-line rationale with evidence",
        "validity_enforceability_score": "One-line rationale with evidence",
        "risk_exposure_score": "One-line rationale with evidence",
        "compliance_regulatory_score": "One-line rationale with evidence",
        "clarity_score": "One-line rationale with evidence",
        "drafting_quality_score": "One-line rationale with evidence",
        "final_aggregated_score": "One-line rationale summarizing overall score"
    },
    "clause_evidence": [
        {
            "clause_id": "CL-001",
            "section_id": "optional-section-uuid-or-null",
            "paragraph_id": "optional-paragraph-uuid-or-null",
            "table_id": "optional-table-uuid-or-null",
            "table_cell_ref": "optional e.g. r2:col3",
            "evidence": "One-line evidence from the document"
        }
    ]
}

Rules:
- Keep each rationale to one line.
- Do NOT include scores here; only rationale/evidence.
- Treat unresolved placeholders (tokens like [[paragraph_id.field]] or entries in "unresolved_placeholders") as missing data; cite them when they affect scoring. If the document text instructs replacement of a placeholder, treat it as missing.
- Return ONLY JSON and ensure it parses.
"""


PLACEHOLDER_PATTERN = re.compile(r"\[\[[^\]]+\]\]")

SCORING_WITH_REASONING_PROMPT = (
    "You are a legal document evaluation assistant. You will be given a document JSON and a rationale JSON. "
    "Use the rationale as evidence to assign scores. Return ONLY the scoring JSON, with no additional text.\n\n"
    + SYSTEM_PROMPT
)


def _stringify_table(section_tables) -> str:
    lines = []
    for table in section_tables:
        title = table.title or 'Table'
        lines.append(f"[Table] {title}")
        headers = [str(h.get('label')) for h in (table.column_headers or []) if isinstance(h, dict) and h.get('label')]
        if headers:
            lines.append(" | ".join(headers))
        for row in table.table_data or []:
            if isinstance(row, dict):
                cells = row.get('cells') if isinstance(row.get('cells'), dict) else {}
                lines.append(" | ".join(str(v) for v in (cells or {}).values()))
    return "\n".join(lines)


def _build_document_text(document: Document) -> str:
    parts = []
    for section in Section.objects.filter(document=document).order_by('order'):
        if section.title:
            parts.append(section.title)
        if section.content_text:
            parts.append(section.content_text)
        for paragraph in Paragraph.objects.filter(section=section).order_by('order'):
            parts.append(paragraph.render_with_metadata())
        table_text = _stringify_table(Table.objects.filter(section=section))
        if table_text:
            parts.append(table_text)
    return "\n".join([p for p in parts if p])


def _extract_placeholders(text: Optional[str]) -> list:
    if not text:
        return []
    return sorted(set(PLACEHOLDER_PATTERN.findall(text)))


def _attach_placeholder_context(doc_serialized: Dict[str, Any], source_text: Optional[str]) -> None:
    placeholders = _extract_placeholders(source_text)
    if placeholders:
        doc_serialized.setdefault('unresolved_placeholders', placeholders)
        doc_serialized.setdefault('placeholder_count', len(placeholders))


def _apply_rendered_paragraphs(doc_serialized: Dict[str, Any], document: Document) -> None:
    rendered_map = {
        str(paragraph.id): paragraph.render_with_metadata()
        for paragraph in Paragraph.objects.filter(section__document=document)
    }

    def update_section(section_data: Dict[str, Any]) -> None:
        for paragraph in section_data.get('paragraphs') or []:
            paragraph_id = paragraph.get('id')
            if not paragraph_id:
                continue
            rendered = rendered_map.get(str(paragraph_id))
            if rendered is None:
                continue
            paragraph['content'] = rendered
            paragraph['content_text'] = rendered
            paragraph['edited_text'] = rendered
        for child in section_data.get('children') or []:
            if isinstance(child, dict):
                update_section(child)

    for section in doc_serialized.get('sections') or []:
        if isinstance(section, dict):
            update_section(section)


def _build_gemini_payload(prompt: str, texts, model: str) -> Dict[str, Any]:
    parts = [{'text': prompt}]
    for text in texts:
        if text:
            parts.append({'text': text})
    return {
        'contents': [{
            'role': 'user',
            'parts': parts
        }],
        'generationConfig': {
            'temperature': 0.0,
            'topP': 0.95,
            'topK': 40,
            'maxOutputTokens': 4000
        },
        'model': model
    }


def evaluate_document(document: Document, created_by: Optional[User] = None,
                      api_key: Optional[str] = None, model: Optional[str] = None,
                      document_override: Optional[Dict[str, Any]] = None,
                      two_step: bool = False,
                      document_context: str = '') -> Tuple[DocumentScore, Optional[Dict[str, Any]], Any]:
    """Evaluate `document` using the LLM. Returns (DocumentScore instance, parsed_json, raw_response).

    - If the model does not return valid JSON, parsed_json may be None and raw_response will contain the raw model response.
    - The function will persist a DocumentScore record for auditability.
    - `document_context` is the AI config context (system prompt, ai_focus, mode) from DocumentAIConfig.
    """
    api_key = api_key or os.environ.get('GEMINI_API')
    model = model or DEFAULT_MODEL

    # ── Hierarchical inference context ──────────────────────────────
    inference_context = ''
    try:
        from aiservices.inference.graph_traversal import get_hierarchical_context_for_document
        inference_context = get_hierarchical_context_for_document(document)
    except Exception:
        pass  # degrade gracefully

    # Serialize the document to JSON for the model to analyze
    if isinstance(document_override, dict):
        doc_serialized = document_override
    else:
        doc_serialized = dict(CompleteDocumentSerializer(document).data)
    _apply_rendered_paragraphs(doc_serialized, document)
    document_text = _build_document_text(document)
    if document_text:
        doc_serialized.setdefault('document_text', document_text)
        if not doc_serialized.get('raw_text'):
            doc_serialized['raw_text'] = document_text
        if not doc_serialized.get('current_text'):
            doc_serialized['current_text'] = document_text
    placeholder_source = document_text or doc_serialized.get('current_text') or doc_serialized.get('raw_text') or ''
    _attach_placeholder_context(doc_serialized, placeholder_source)
    try:
        document_payload_text = json.dumps(doc_serialized, default=str)
    except Exception as exc:
        print(f"[document_scoring] payload_json_error={exc}")
        # fallback to a minimal representation
        document_payload_text = json.dumps({'id': str(document.id), 'title': document.title, 'raw_text': document.raw_text})
        print("[document_scoring] payload_fallback_used=true")

    print(f"[document_scoring] document_payload_text_len={len(document_payload_text)}")
    print(f"[document_scoring] document_payload_preview={document_payload_text[:10000]}")

    # Prepend document AI context (type-specific system prompt, ai_focus, mode)
    # and inference graph context for richer document understanding
    inference_preamble = ''
    if inference_context:
        inference_preamble = (
            '\n\nDOCUMENT INTELLIGENCE (AI-generated structural analysis):\n'
            f'{inference_context}\n'
            '--- END INTELLIGENCE ---\n\n'
        )
    effective_system_prompt = f'{document_context}{inference_preamble}{SYSTEM_PROMPT}' if document_context else f'{inference_preamble}{SYSTEM_PROMPT}'

    # Build payload: include the SYSTEM_PROMPT then the document JSON
    payload = _build_gemini_payload(effective_system_prompt, [document_payload_text], model)

    raw_resp = None
    parsed = None

    if two_step:
        # Step 1: ask for concise one-line rationales/evidence per scoring dimension and clauses
        effective_rationale_prompt = f'{document_context}{inference_preamble}{RATIONALE_PROMPT}' if document_context else f'{inference_preamble}{RATIONALE_PROMPT}'
        r_payload = {
            'contents': [{
                'role': 'user',
                'parts': [
                    {'text': effective_rationale_prompt},
                    {'text': document_payload_text}
                ]
            }],
            'generationConfig': {
                'temperature': 0.0,
                'topP': 0.95,
                'topK': 40,
                'maxOutputTokens': 2000
            },
            'model': model
        }
        raw_rationale = call_gemini(r_payload, api_key=api_key)
        parsed_rationale = extract_function_call_result(raw_rationale)

        # Step 2: provide the rationale to the scorer and ask for final JSON
        combined_prompt = effective_system_prompt + '\n\nUSE THE FOLLOWING RATIONALE WHEN SCORING (JSON):\n' + json.dumps(parsed_rationale or {})
        f_payload = {
            'contents': [{
                'role': 'user',
                'parts': [
                    {'text': combined_prompt},
                    {'text': document_payload_text}
                ]
            }],
            'generationConfig': {
                'temperature': 0.0,
                'topP': 0.95,
                'topK': 40,
                'maxOutputTokens': 4000
            },
            'model': model
        }
        raw_resp = call_gemini(f_payload, api_key=api_key)
        parsed = extract_function_call_result(raw_resp)
        # store both
        raw_combined = {'rationale': raw_rationale, 'final': raw_resp}
        parsed_combined = {'rationale': parsed_rationale, 'final': parsed}
        raw_resp = raw_combined
        # for mapping into fields, prefer the final parsed result
        parsed = parsed_combined
        parsed_for_mapping = parsed_combined.get('final') if isinstance(parsed_combined, dict) else None
    else:
        raw_resp = call_gemini(payload, api_key=api_key)
        parsed = extract_function_call_result(raw_resp)
        parsed_for_mapping = parsed

    # Create DocumentScore record (map fields if parsed)
    def _float_or_default(value, default=0.0):
        try:
            if value is None:
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _bool_or_default(value, default=False):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {'true', '1', 'yes', 'y'}
        return default

    default_global = {
        'final_aggregated_score': 0.0,
        'overall_risk_category': 'Low',
        'human_review_required': False,
        'review_trigger_reason': None,
        'review_priority': 'P3',
    }
    default_core = {
        '_logic': '0-100. Higher is better, except Risk.',
        'completeness_score': 0,
        'validity_enforceability_score': 0,
        'risk_exposure_score': 0,
        'compliance_regulatory_score': 0,
        'clarity_score': 0,
        'drafting_quality_score': 0,
    }
    default_operational = {
        'obligation_balance_score': 50,
        'operational_feasibility_score': 0,
        'quantifiable_financial_exposure': {
            'currency': 'USD',
            'primary_cap_amount': 0,
            'exposure_description': None,
        },
        'notice_period_days': -1,
    }
    default_trust = {
        'confidence_score': 0,
        'evidence_coverage_score': 0,
        'model_audit_meta': {
            'ruleset_id': 'v1.2-harsh-audit',
            'analysis_timestamp_utc': None,
        }
    }

    gd = default_global.copy()
    core = default_core.copy()
    op = default_operational.copy()
    clause = []
    trust = default_trust.copy()

    # parsed_for_mapping holds the final scoring JSON when two_step used; otherwise parsed
    if isinstance(parsed_for_mapping, dict):
        gd.update(parsed_for_mapping.get('global_document_header') or {})
        core.update(parsed_for_mapping.get('core_score_dimensions') or {})
        op.update(parsed_for_mapping.get('operational_commercial_intelligence') or {})
        clause = parsed_for_mapping.get('clause_level_review') or []
        trust.update(parsed_for_mapping.get('ai_governance_trust_metrics') or {})

    score = DocumentScore.objects.create(
        document=document,
        created_by=created_by,
    final_aggregated_score=_float_or_default(gd.get('final_aggregated_score')),
    overall_risk_category=gd.get('overall_risk_category'),
    human_review_required=_bool_or_default(gd.get('human_review_required')),
    review_trigger_reason=gd.get('review_trigger_reason'),
    review_priority=gd.get('review_priority'),
    core_score_dimensions=core,
    operational_commercial_intelligence=op,
    clause_level_review=clause,
    ai_governance_trust_metrics=trust,
        raw_llm_output=parsed if isinstance(parsed, dict) else None,
        raw_llm_text=json.dumps(raw_resp) if not isinstance(raw_resp, dict) else json.dumps(raw_resp),
        model_name=model,
        automated=True,
    )

    return score, parsed, raw_resp


def evaluate_document_with_reasoning(document: Document, created_by: Optional[User] = None,
                                     api_key: Optional[str] = None, model: Optional[str] = None,
                                     document_override: Optional[Dict[str, Any]] = None,
                                     document_context: str = '') -> Tuple[DocumentScore, Optional[Dict[str, Any]], Any]:
    """Two-step evaluation: first generate rationale, then score using that rationale."""
    api_key = api_key or os.environ.get('GEMINI_API')
    model = model or DEFAULT_MODEL

    if isinstance(document_override, dict):
        doc_serialized = document_override
    else:
        doc_serialized = dict(CompleteDocumentSerializer(document).data)

    _apply_rendered_paragraphs(doc_serialized, document)
    document_text = _build_document_text(document)
    if document_text:
        doc_serialized.setdefault('document_text', document_text)
        if not doc_serialized.get('raw_text'):
            doc_serialized['raw_text'] = document_text
        if not doc_serialized.get('current_text'):
            doc_serialized['current_text'] = document_text
    placeholder_source = document_text or doc_serialized.get('current_text') or doc_serialized.get('raw_text') or ''
    _attach_placeholder_context(doc_serialized, placeholder_source)

    try:
        document_payload_text = json.dumps(doc_serialized, default=str)
    except Exception as exc:
        print(f"[document_scoring] payload_json_error={exc}")
        document_payload_text = json.dumps({'id': str(document.id), 'title': document.title, 'raw_text': document.raw_text})
        print("[document_scoring] payload_fallback_used=true")

    print(f"[document_scoring] reasoning_payload_len={len(document_payload_text)}")

    # Prepend document AI context to reasoning and scoring prompts
    effective_reasoning_prompt = f'{document_context}{REASONING_PROMPT}' if document_context else REASONING_PROMPT
    effective_scoring_prompt = f'{document_context}{SCORING_WITH_REASONING_PROMPT}' if document_context else SCORING_WITH_REASONING_PROMPT

    reasoning_payload = _build_gemini_payload(effective_reasoning_prompt, [document_payload_text], model)
    reasoning_resp = call_gemini(reasoning_payload, api_key=api_key)
    reasoning_parsed = extract_function_call_result(reasoning_resp)

    rationale_json = reasoning_parsed if isinstance(reasoning_parsed, dict) else {
        'score_rationale': {},
        'clause_evidence': [],
        'raw_reasoning': reasoning_resp
    }
    rationale_text = json.dumps(rationale_json, default=str)

    scoring_payload = _build_gemini_payload(
        effective_scoring_prompt,
        [document_payload_text, rationale_text],
        model
    )
    scoring_resp = call_gemini(scoring_payload, api_key=api_key)
    scoring_parsed = extract_function_call_result(scoring_resp)

    # Reuse the standard scoring path but store rationale
    gd = {
        'final_aggregated_score': 0.0,
        'overall_risk_category': 'Low',
        'human_review_required': False,
        'review_trigger_reason': None,
        'review_priority': 'P3',
    }
    core = {
        '_logic': '0-100. Higher is better, except Risk.',
        'completeness_score': 0,
        'validity_enforceability_score': 0,
        'risk_exposure_score': 0,
        'compliance_regulatory_score': 0,
        'clarity_score': 0,
        'drafting_quality_score': 0,
    }
    op = {
        'obligation_balance_score': 50,
        'operational_feasibility_score': 0,
        'quantifiable_financial_exposure': {
            'currency': 'USD',
            'primary_cap_amount': 0,
            'exposure_description': None,
        },
        'notice_period_days': -1,
    }
    trust = {
        'confidence_score': 0,
        'evidence_coverage_score': 0,
        'model_audit_meta': {
            'ruleset_id': 'v1.2-harsh-audit',
            'analysis_timestamp_utc': None,
        }
    }
    clause = []

    if isinstance(scoring_parsed, dict):
        gd.update(scoring_parsed.get('global_document_header') or {})
        core.update(scoring_parsed.get('core_score_dimensions') or {})
        op.update(scoring_parsed.get('operational_commercial_intelligence') or {})
        clause = scoring_parsed.get('clause_level_review') or []
        trust.update(scoring_parsed.get('ai_governance_trust_metrics') or {})

    def _float_or_default(value, default=0.0):
        try:
            if value is None:
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _bool_or_default(value, default=False):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {'true', '1', 'yes', 'y'}
        return default

    score = DocumentScore.objects.create(
        document=document,
        created_by=created_by,
        final_aggregated_score=_float_or_default(gd.get('final_aggregated_score')),
        overall_risk_category=gd.get('overall_risk_category'),
        human_review_required=_bool_or_default(gd.get('human_review_required')),
        review_trigger_reason=gd.get('review_trigger_reason'),
        review_priority=gd.get('review_priority'),
        core_score_dimensions=core,
        operational_commercial_intelligence=op,
        clause_level_review=clause,
        ai_governance_trust_metrics=trust,
        score_rationale=rationale_json.get('score_rationale', {}),
        raw_llm_output=scoring_parsed if isinstance(scoring_parsed, dict) else None,
        raw_llm_text=json.dumps({'reasoning': reasoning_resp, 'scoring': scoring_resp}, default=str),
        model_name=model,
        automated=True,
    )

    return score, scoring_parsed, {'reasoning': reasoning_parsed, 'scoring': scoring_resp}
