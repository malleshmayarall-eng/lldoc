"""Gemini ingestion helpers for AI services.

This module provides a small integration helper that:
- builds a system + user prompt
- sends the payload to a Gemini-compatible endpoint (if API key provided)
- parses the model response JSON and optionally creates the
  Document, Section and Paragraph records in the database.
"""

import json
import os
import re
import uuid
from datetime import date
from typing import Optional, Dict, Any

import requests
from django.db import transaction
from django.utils.dateparse import parse_date

from documents.models import Document, Section, Paragraph, Table


DEFAULT_GEMINI_MODEL = os.environ.get('GEN_MODEL', 'gemini-2.5-flash')
DEFAULT_GEMINI_URL = os.environ.get(
    'GEN_API_URL',
    'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
)



def _build_payload(raw_text: str, system_prompt: Optional[str] = None, model: str = DEFAULT_GEMINI_MODEL) -> Dict[str, Any]:
    # Target Gemini (Google) only: instruct the model to return plain JSON
    # matching the `create_document` schema. No extra text or function-calling
    # wrappers — just the JSON object.
    system_prompt = system_prompt or (
        "You are a professional legal document structuring assistant. Parse the user's raw text and "
        "return a single JSON object (no surrounding text, no markdown code fences).\n\n"
        "GOAL:\n"
        "Extract as much document data as explicitly stated in the text. Do NOT guess or invent details. "
        "If a field is not present, omit it or set it to null.\n\n"
        "IMPORTANT EXCLUSIONS:\n"
        "- Do NOT invent organization profile fields, user profile data, header/footer template IDs, image IDs, or file paths.\n"
        "- Only include parties/signatories as they appear in the text; treat company names as parties, not organization settings.\n\n"
    "FORMATTING:\n"
    "- When returning section content or paragraph text, use HTML tags for formatting. You may use:\n"
    "  <p>, <strong>, <em>, <u>, <br>, <ul>, <ol>, <li>, <span style='color:#RRGGBB'>, <span style='font-size:14px'>.\n"
    "- Use <em> for italics, <span style='color:#RRGGBB'> for color, and <span style='font-size:14px'> for font size.\n"
    "- Use <ul>/<ol> with <li> for bullet points or numbering when the text implies lists.\n"
    "- Do NOT use <style>, <script>, <iframe>, <img>, or inline event handlers.\n"
    "- Do NOT wrap the overall JSON in HTML; only format text fields like content_text/edited_text.\n\n"
    "OUTPUT CONSTRAINTS:\n"
    "- Return ONLY a JSON object. No prose, no markdown fences.\n"
    "- Do NOT include `id` or `client_id` fields anywhere; the server generates UUIDs.\n"
    "- Required top-level fields: title, sections. All others are optional.\n\n"
    "DOCUMENT FIELDS TO EXTRACT (when explicit):\n"
    "- title, author, version, version_label, document_type, category, status, jurisdiction\n"
    "- reference_number, project_name, governing_law\n"
    "- term_length, auto_renewal, renewal_terms\n"
    "- effective_date, expiration_date, execution_date (use ISO format YYYY-MM-DD)\n"
    "- parties (array of {name, role?, type?})\n"
    "- signatories (array of {name, title?, role?})\n"
    "- document_metadata (nested object for dates/legal/financial/terms/provisions/compliance/confidentiality/dispute_resolution/classification)\n"
    "- custom_metadata (extra structured facts explicitly present; use keys like industry, contract_value, currency, payment_terms, notice_period, insurance_requirements, liability_cap, indemnification_summary, dispute_venue, governing_law_source, confidentiality_period, renewal_window, termination_notice, effective_event, renewal_event, deliverables, milestones, pricing_model, penalties, audit_rights)\n\n"
    "CUSTOM METADATA RULES:\n"
    "- Only include facts explicitly stated in the text.\n"
    "- Prefer structured key/value pairs over long prose.\n"
    "- If the data belongs in document_metadata (dates/legal/financial/terms/etc.), put it there first; use custom_metadata for additional details.\n\n"
        "STRUCTURE SYSTEM:\n"
        "- Document has a `title` (string) and `sections` (array of root sections)\n"
        "- Each section has: `title` (string), `order` (integer, 0-based), `depth_level` (integer, defaults to 1 for roots), "
        "`content_text` (optional string for section intro/summary), `paragraphs` (array), and `children` (array of nested subsections)\n"
        "- Each paragraph has: `order` (integer, 0-based), `content_text` (string for original/parsed text), "
        "`edited_text` (optional string for reviewed/edited version)\n"
    "- Sections may include optional `tables` arrays when the text contains structured data\n"
    "- If the text contains structured data (tables, schedules, pricing grids), create a `tables` array on the section\n"
    "  with this structure: [{\n"
    "    'order': 0,\n"
    "    'title': 'Pricing',\n"
    "    'num_columns': 3,\n"
    "    'num_rows': 2,\n"
    "    'column_headers': [{'id': 'col1', 'label': 'Item'}, {'id': 'col2', 'label': 'Qty'}, {'id': 'col3', 'label': 'Price'}],\n"
    "    'table_data': [\n"
    "      {'row_id': 'r1', 'cells': {'col1': 'Service A', 'col2': '1', 'col3': '$100'}},\n"
    "      {'row_id': 'r2', 'cells': {'col1': 'Service B', 'col2': '2', 'col3': '$200'}}\n"
    "    ]\n"
    "  }]\n"
        "- Subsections are nested inside their parent's `children` array (recursive structure)\n"
        "- For subsections, `depth_level` should be parent.depth_level + 1 (e.g., root=1, first child=2, grandchild=3)\n\n"
        "PARSING RULES:\n"
        "1. Extract a meaningful document title from the text (first heading or infer from content)\n"
    "2. Identify major sections and create root-level section objects (depth_level=1)\n"
    "2a. You can create sections, subsections, and sub-subsections for better organization; use `children` for all nested levels\n"
        "3. For each distinct topic, subtopic, or numbered/lettered subdivision, create subsections in the `children` array\n"
        "4. Each section may have an optional `content_text` field for introductory/summary text before paragraphs\n"
        "5. Break section content into logical paragraphs with sequential `order` values (0, 1, 2...)\n"
        "6. Preserve original text in `content_text`; if you clean/edit it, put the result in `edited_text`\n"
        "7. Maintain hierarchy: subsections go in `children`, NOT at root level\n"
        "8. Keep titles concise (max 255 chars); split long content into multiple paragraphs\n\n"
        "OUTPUT FORMAT:\n"
        "Return ONLY the JSON object with this exact structure:\n"
        "{\n"
        '  "title": "Document Title",\n'
        '  "author": "Optional author",\n'
        '  "version": "1.0",\n'
        '  "version_label": "Draft",\n'
        '  "document_type": "contract",\n'
        '  "status": "draft",\n'
        '  "category": "contract",\n'
        '  "jurisdiction": "US-CA",\n'
        '  "reference_number": "CNT-001",\n'
        '  "governing_law": "Delaware",\n'
        '  "effective_date": "2026-01-01",\n'
        '  "expiration_date": "2027-01-01",\n'
        '  "execution_date": "2025-12-15",\n'
        '  "parties": [{"name": "Company A", "role": "Provider"}],\n'
        '  "signatories": [{"name": "Jane Doe", "title": "CEO"}],\n'
        '  "document_metadata": {"dates": {}, "legal": {}, "financial": {}, "terms": {}, "provisions": {}},\n'
        '  "custom_metadata": {},\n'
        '  "sections": [\n'
        "    {\n"
        '      "title": "Section 1",\n'
        '      "order": 0,\n'
        '      "depth_level": 1,\n'
        '      "content_text": "Optional intro text for section",\n'
        '      "paragraphs": [\n'
        '        {"order": 0, "content_text": "First paragraph text"},\n'
        '        {"order": 1, "content_text": "Second paragraph text"}\n'
        "      ],\n"
    '      "tables": [\n'
    '        {"order": 0, "title": "Pricing", "num_columns": 3, "num_rows": 2,\n'
    '         "column_headers": [{"id": "col1", "label": "Item"}, {"id": "col2", "label": "Qty"}, {"id": "col3", "label": "Price"}],\n'
    '         "table_data": [{"row_id": "r1", "cells": {"col1": "Service A", "col2": "1", "col3": "$100"}}]}\n'
    "      ],\n"
        '      "children": [\n'
        "        {\n"
        '          "title": "Subsection 1.1",\n'
        '          "order": 0,\n'
        '          "depth_level": 2,\n'
        '          "paragraphs": [{"order": 0, "content_text": "Nested content"}],\n'
        '          "children": []\n'
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "CRITICAL: Return ONLY the JSON object above. No explanations, no markdown fences, no additional text."
    )

    parts = []
    if system_prompt:
        parts.append({'text': system_prompt})
    parts.append({'text': raw_text})

    payload = {
        'contents': [{
            'role': 'user',
            'parts': parts
        }],
        'generationConfig': {
            'temperature': 0.1,
            'topP': 0.9,
            'topK': 40,
            'maxOutputTokens': 12000
        }
    }
    return payload


def call_gemini(payload: Dict[str, Any], api_key: Optional[str] = None) -> Dict[str, Any]:
    """Call the configured Gemini/Generative API endpoint.

    If `api_key` is None, the function returns the constructed payload for testing.
    """
    if not api_key:
        print('api_key is None, returning mock payload')
        return {'mock': True, 'payload': payload}

    url = DEFAULT_GEMINI_URL.format(model=payload.get('model', DEFAULT_GEMINI_MODEL))
    params = {'key': api_key}

    headers = {'Content-Type': 'application/json'}
    try:
        resp = requests.post(url, params=params, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        body = None
        try:
            body = resp.text
        except Exception:
            body = '<unavailable>'
        raise requests.exceptions.HTTPError(
            f"HTTP {resp.status_code} error when calling generative API: {body}",
            response=resp
        ) from e

    try:
        return resp.json()
    except Exception:
        return {'text': resp.text}




def extract_function_call_result(response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract the document structure JSON from a Gemini (Google) response.

    We intentionally focus on Gemini/Google responses only.
    The response generally looks like:
      {"candidates": [{"content": {"parts": [{"text": "{...json...}"}]}}]}

    Returns the parsed dict or None.
    """
    try:
        candidates = response.get('candidates') or []
        if candidates:
            def try_parse_json(obj):
                if isinstance(obj, dict):
                    parts = obj.get('parts')
                    if isinstance(parts, list):
                        for part in parts:
                            res = try_parse_json(part)
                            if res is not None:
                                return res

                    if 'title' in obj and 'sections' in obj:
                        return obj

                    for v in obj.values():
                        res = try_parse_json(v)
                        if res is not None:
                            return res
                    return None

                if isinstance(obj, list):
                    for item in obj:
                        res = try_parse_json(item)
                        if res is not None:
                            return res
                    return None

                if isinstance(obj, str):
                    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", obj, re.DOTALL)
                    if fence:
                        try:
                            return json.loads(fence.group(1))
                        except Exception:
                            return None

                    m = re.search(r"(\{.*\})", obj, re.DOTALL)
                    if m:
                        try:
                            return json.loads(m.group(1))
                        except Exception:
                            return None
                return None

            for c in candidates:
                res = try_parse_json(c)
                if res is not None:
                    return res
    except Exception:
        pass

    return None


def create_document_in_db(structure: Dict[str, Any], created_by=None) -> Dict[str, Any]:
    """Create Document + Sections + Paragraphs from the validated `structure` dict.

    Handles nested sections (children) recursively.
    Returns a summary dict with created IDs.
    """
    if 'title' not in structure or 'sections' not in structure:
        raise ValueError('Structure must include title and sections')

    def _parse_date_value(value):
        if not value:
            return None
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            return parse_date(value) or None
        return None

    def _ensure_uuid(value):
        if not value:
            return uuid.uuid4()
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError, AttributeError):
            return uuid.uuid4()

    def _int_or_default(value, default):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _stringify_cell(value):
        if value is None:
            return ''
        if isinstance(value, (str, int, float, bool)):
            return str(value)
        try:
            return json.dumps(value)
        except TypeError:
            return str(value)

    def _normalize_table_data(table_data):
        normalized = []
        for row in table_data or []:
            if not isinstance(row, dict):
                normalized.append(row)
                continue
            cells = row.get('cells')
            if isinstance(cells, dict):
                cells = {key: _stringify_cell(val) for key, val in cells.items()}
            normalized.append({**row, 'cells': cells})
        return normalized

    metadata = structure.get('document_metadata') or {}
    metadata_dates = metadata.get('dates') or {}

    effective_date = _parse_date_value(structure.get('effective_date') or metadata_dates.get('effective_date'))
    expiration_date = _parse_date_value(structure.get('expiration_date') or metadata_dates.get('expiration_date'))
    execution_date = _parse_date_value(structure.get('execution_date') or metadata_dates.get('execution_date'))

    result = {'document_id': None, 'sections': []}

    with transaction.atomic():
        doc = Document.objects.create(
            title=structure.get('title') or 'Untitled',
            raw_text=structure.get('raw_text') or '',
            current_text=structure.get('current_text') or '',
            author=structure.get('author'),
            version=structure.get('version') or '1.0',
            version_label=structure.get('version_label'),
            document_type=structure.get('document_type') or 'contract',
            status=structure.get('status') or 'draft',
            category=structure.get('category') or 'contract',
            jurisdiction=structure.get('jurisdiction'),
            reference_number=structure.get('reference_number'),
            governing_law=structure.get('governing_law'),
            project_name=structure.get('project_name'),
            term_length=structure.get('term_length'),
            auto_renewal=structure.get('auto_renewal') or False,
            renewal_terms=structure.get('renewal_terms'),
            effective_date=effective_date,
            expiration_date=expiration_date,
            execution_date=execution_date,
            parties=structure.get('parties') or [],
            signatories=structure.get('signatories') or [],
            document_metadata=metadata,
            custom_metadata=structure.get('custom_metadata', {}),
            created_by=created_by,
        )
        result['document_id'] = str(doc.id)

        def process_section(s_data: Dict[str, Any], parent_section=None, default_depth=1):
            sec_id = _ensure_uuid(s_data.get('id') or s_data.get('client_id'))

            depth = s_data.get('depth_level')
            if depth is None:
                depth = parent_section.depth_level + 1 if parent_section else default_depth

            section = Section.objects.create(
                id=sec_id,
                document=doc,
                parent=parent_section,
                title=s_data.get('title', '')[:255],
                order=s_data.get('order', 0),
                depth_level=depth,
                content_text=s_data.get('content_text', '') or ''
            )
            sec_summary = {
                'client_id': s_data.get('client_id'),
                'id': str(section.id),
                'paragraphs': [],
                'children': []
            }

            for p in s_data.get('paragraphs', []):
                para_id = _ensure_uuid(p.get('id') or p.get('client_id'))
                para = Paragraph.objects.create(
                    id=para_id,
                    section=section,
                    content_text=p.get('content_text') or '',
                    edited_text=p.get('edited_text'),
                    order=p.get('order', 0),
                )
                sec_summary['paragraphs'].append({'client_id': p.get('client_id'), 'id': str(para.id)})

            # --- Auto-create paragraphs from section content_text -------
            # The LLM sometimes puts all content into section.content_text
            # instead of the paragraphs array. If no paragraphs were
            # returned, split content_text into paragraph records so the
            # frontend editor has editable paragraph components.
            if not sec_summary['paragraphs'] and section.content_text:
                raw = section.content_text.strip()
                # Try splitting on double-newlines first; fall back to
                # HTML <p>/</p> boundaries, then treat as one paragraph.
                if '\n\n' in raw:
                    chunks = [c.strip() for c in raw.split('\n\n') if c.strip()]
                elif '</p>' in raw.lower():
                    # Split on closing </p> tags, keep content between
                    chunks = re.split(r'</p>\s*', raw, flags=re.IGNORECASE)
                    chunks = [re.sub(r'<p[^>]*>', '', c, flags=re.IGNORECASE).strip()
                              for c in chunks if c.strip()]
                else:
                    chunks = [raw]

                for idx, chunk in enumerate(chunks):
                    para = Paragraph.objects.create(
                        section=section,
                        content_text=chunk,
                        order=idx,
                    )
                    sec_summary['paragraphs'].append({
                        'client_id': None,
                        'id': str(para.id),
                    })

            for table_data in s_data.get('tables', []) or []:
                normalized_table_data = _normalize_table_data(table_data.get('table_data', []))
                Table.objects.create(
                    section=section,
                    title=table_data.get('title') or '',
                    description=table_data.get('description'),
                    num_columns=_int_or_default(table_data.get('num_columns'), 2),
                    num_rows=_int_or_default(table_data.get('num_rows'), 1),
                    column_headers=table_data.get('column_headers', []),
                    table_data=normalized_table_data,
                    table_config=table_data.get('table_config', {}),
                    table_type=table_data.get('table_type', 'data'),
                    order=table_data.get('order', 0),
                )

            for child_data in s_data.get('children', []):
                child_summary = process_section(child_data, parent_section=section, default_depth=depth + 1)
                sec_summary['children'].append(child_summary)

            return sec_summary

        for s in structure.get('sections', []):
            sec_summary = process_section(s, parent_section=None, default_depth=1)
            result['sections'].append(sec_summary)

    return result


def generate_document_from_text(raw_text: str,
                                system_prompt: Optional[str] = None,
                                api_key: Optional[str] = None,
                                model: Optional[str] = None,
                                create_in_db: bool = False,
                                created_by=None) -> Dict[str, Any]:
    """Main helper: generate structure and optionally persist to DB.

    Returns a dict with keys:
    - `llm_response`: raw LLM response (or payload when mocked)
    - `structure`: parsed JSON structure (or None)
    - `db_result`: DB creation result when `create_in_db` True
    """
    api_key = api_key or os.environ.get('GEMINI_API')
    model = model or DEFAULT_GEMINI_MODEL
    payload = _build_payload(raw_text=raw_text, system_prompt=system_prompt, model=model)
    resp = call_gemini(payload, api_key=api_key)

    parsed = extract_function_call_result(resp)

    out = {'llm_response': resp, 'structure': parsed, 'db_result': None}
    
    if parsed and create_in_db:
        out['db_result'] = create_document_in_db(parsed, created_by=created_by)

    return out
