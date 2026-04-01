"""
AI Node Executor — LLM processing for each document
=====================================================
Four output modes — the AI node is both an **extractor** and a **gate**:

  1. json_extract  — AI returns structured JSON fields that get merged into
                     the document's extracted_metadata.  Downstream Rule nodes
                     can filter on any of those fields.
                     Config carries `json_fields` — a list of
                     {name, type, description} dicts that become the JSON
                     schema the LLM must follow.

  2. yes_no        — AI answers YES or NO (activation gate).  The boolean
                     result is stored as `extracted_metadata[output_key]`
                     ("yes" / "no").  A downstream Rule node can use
                     field = output_key, operator = eq, value = "yes".

  3. text          — Free-form text response (original behaviour).
                     Stored as `extracted_metadata[output_key]`.

  4. derived       — Compute derived/calculated metadata fields that
                     NuExtract (NER) cannot extract.  E.g.:
                       • total_experience = sum of work durations (resumes)
                       • risk_score = clause analysis score (contracts)
                       • days_until_due = due_date - invoice_date
                       • seniority_level = categorise from title + years
                     Uses the workflow's DerivedField definitions to
                     auto-generate an AI prompt.  No system_prompt needed.
                     Delegates to derived_field_executor.py.

Config schema (stored in node.config):
  {
    "model": "gemini-2.5-flash",
    "system_prompt": "...",
    "output_format": "json_extract" | "yes_no" | "text" | "derived",
    "output_key": "ai_analysis",           // base key in extracted_metadata
    "json_fields": [                        // only for json_extract
      {"name": "risk_level",   "type": "string",  "description": "high/medium/low"},
      {"name": "contract_type","type": "string",  "description": "NDA, MSA, SOW…"},
      {"name": "expiry_date",  "type": "string",  "description": "ISO date"},
      {"name": "auto_renew",   "type": "boolean", "description": "true/false"},
    ],
    "derived_field_ids": [...],             // only for derived — optional filter
    "temperature": 0.3,
    "max_tokens": 2048,
    "include_text": true,
    "include_metadata": true,
  }
"""
import hashlib
import json
import logging
import os
import re

from django.conf import settings
from django.utils import timezone

from .models import WorkflowDocument, WorkflowNode, AIPromptCache

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt-level cache helpers
# ---------------------------------------------------------------------------

def _compute_prompt_hash(model_id: str, system_prompt: str, document_context: str) -> str:
    """SHA-256 hash of the full prompt inputs — deterministic cache key."""
    payload = f"{model_id}\n---\n{system_prompt}\n---\n{document_context}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def _get_cached_response(prompt_hash: str):
    """Return the cached AIPromptCache entry or None."""
    try:
        entry = AIPromptCache.objects.filter(prompt_hash=prompt_hash).first()
        if entry:
            entry.hit_count += 1
            entry.last_hit_at = timezone.now()
            entry.save(update_fields=['hit_count', 'last_hit_at'])
            return entry
    except Exception as e:
        logger.warning(f"Cache lookup failed: {e}")
    return None


def _store_cached_response(
    prompt_hash: str,
    model_id: str,
    output_format: str,
    response_text: str,
    parsed_result: dict,
):
    """Store a new cache entry. Silently ignores duplicates."""
    try:
        AIPromptCache.objects.get_or_create(
            prompt_hash=prompt_hash,
            defaults={
                'model_id': model_id,
                'output_format': output_format,
                'response_text': response_text,
                'parsed_result': parsed_result,
            },
        )
    except Exception as e:
        logger.warning(f"Cache store failed: {e}")


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

AI_MODELS = {
    'gemini-2.5-flash': {
        'provider': 'gemini',
        'display_name': 'Gemini 2.5 Flash',
        'description': 'Fast, cost-effective for most tasks',
        'icon': '✨',
    },
    'gemini-2.5-pro-preview-05-06': {
        'provider': 'gemini',
        'display_name': 'Gemini 2.5 Pro',
        'description': 'Best quality, longer context window',
        'icon': '🧠',
    },
    'gpt-4o': {
        'provider': 'openai',
        'display_name': 'GPT-4o',
        'description': 'OpenAI flagship model',
        'icon': '🤖',
    },
    'gpt-4o-mini': {
        'provider': 'openai',
        'display_name': 'GPT-4o Mini',
        'description': 'Fast, affordable OpenAI model',
        'icon': '🤖',
    },
}


def list_ai_models():
    """Return list of available AI models for the frontend."""
    return [
        {
            'id': model_id,
            'provider': info['provider'],
            'display_name': info['display_name'],
            'description': info['description'],
            'icon': info['icon'],
        }
        for model_id, info in AI_MODELS.items()
    ]


# ---------------------------------------------------------------------------
# Per-document prompt builder
# ---------------------------------------------------------------------------

def _build_document_context(doc: WorkflowDocument, include_text: bool, include_metadata: bool) -> str:
    """Build the document context string for the AI prompt."""
    parts = []

    parts.append(f"Document: {doc.title or 'Untitled'}")
    parts.append(f"Type: {doc.file_type or 'unknown'}")

    if include_metadata:
        global_meta = doc.global_metadata or {}
        extracted_meta = doc.extracted_metadata or {}
        combined = {**global_meta, **extracted_meta}
        if combined:
            parts.append("\n--- Extracted Metadata ---")
            for key, value in combined.items():
                if key.startswith('_'):
                    continue  # skip internal keys
                parts.append(f"  {key}: {value}")

    if include_text:
        text = doc.direct_text or doc.ocr_text or ''
        if text:
            # Truncate very long texts to stay within context limits
            max_chars = 30000
            if len(text) > max_chars:
                text = text[:max_chars] + f"\n... [truncated, {len(text)} total chars]"
            parts.append("\n--- Document Text ---")
            parts.append(text)

    return "\n".join(parts)


def _build_format_instructions(output_format: str, json_fields: list, output_key: str) -> str:
    """
    Build format-specific instructions appended to the system prompt.
    These tell the LLM exactly what shape to return.

    Principles:
      - Type-aware: each field type gets explicit formatting rules + examples.
      - Bias-free: yes_no mode uses balanced framing with no leading language.
      - Strict: forbids markdown, prose, or any wrapper around the JSON.
      - Null-safe: mandates null for missing/unclear values.
    """
    if output_format == 'yes_no':
        return (
            "\n\n--- OUTPUT FORMAT ---\n"
            "Evaluate the question strictly based on the document content.\n\n"
            "RULES:\n"
            "1. Respond with ONLY a JSON object — no prose, no markdown, no explanation.\n"
            '2. Exactly one of: {"answer": "yes"} or {"answer": "no"}\n'
            "3. Base your answer solely on evidence in the provided text.\n"
            "4. If the document does not contain enough information to answer "
            'definitively, respond {"answer": "no"}.\n'
            "5. Do not infer, assume, or speculate beyond what is explicitly stated.\n"
            "6. Treat the question neutrally — give equal weight to yes and no.\n\n"
            "EXAMPLES:\n"
            'Question: "Does this contract contain an auto-renewal clause?"\n'
            'Document mentions: "This agreement shall automatically renew..."\n'
            'Response: {"answer": "yes"}\n\n'
            'Question: "Is the payment term net-60?"\n'
            'Document mentions: "Payment is due within 30 days"\n'
            'Response: {"answer": "no"}'
        )

    elif output_format == 'json_extract':
        if not json_fields:
            return (
                "\n\n--- OUTPUT FORMAT ---\n"
                "Respond with ONLY a valid JSON object.\n"
                "No markdown fences, no explanation, no surrounding text.\n"
                "Use null for any value you cannot determine from the document."
            )

        # Build typed schema with per-type formatting rules
        schema_lines = []
        type_rules = set()

        for f in json_fields:
            fname = f.get('name', '')
            ftype = f.get('type', 'string').strip().lower()
            fdesc = f.get('description', '')

            # Normalise type names
            if ftype in ('int', 'integer', 'float', 'decimal', 'numeric'):
                ftype = 'number'
            elif ftype in ('bool',):
                ftype = 'boolean'
            elif ftype in ('array',):
                ftype = 'list'
            elif ftype in ('datetime',):
                ftype = 'date'

            # Schema line
            desc_part = f'  // {fdesc}' if fdesc else ''
            schema_lines.append(f'  "{fname}": <{ftype}>{desc_part}')

            # Collect type-specific rules
            type_rules.add(ftype)

        schema_str = "{\n" + ",\n".join(schema_lines) + "\n}"

        # Build type-specific formatting rules
        type_instructions = []
        if 'string' in type_rules:
            type_instructions.append(
                "  STRING: Double-quoted JSON string. Use null if not found."
            )
        if 'number' in type_rules:
            type_instructions.append(
                "  NUMBER: Bare numeric value (no quotes, no currency symbols, no commas). "
                "e.g. 50000 not \"$50,000\". For percentages, use the decimal: 5.5 not \"5.5%\". "
                "Use null if not found."
            )
        if 'date' in type_rules:
            type_instructions.append(
                "  DATE: ISO 8601 string \"YYYY-MM-DD\". e.g. \"2025-03-15\". "
                "Use null if not found or ambiguous."
            )
        if 'boolean' in type_rules:
            type_instructions.append(
                "  BOOLEAN: Bare true or false (not quoted). "
                "Use null if the document does not clearly indicate yes/no."
            )
        if 'list' in type_rules:
            type_instructions.append(
                "  LIST: JSON array of strings. e.g. [\"Python\", \"React\"]. "
                "Use [] (empty array) if none found, null only if the concept is inapplicable."
            )

        type_rules_str = "\n".join(type_instructions)

        return (
            "\n\n--- OUTPUT FORMAT ---\n"
            "Respond with ONLY a valid JSON object matching this schema:\n"
            f"{schema_str}\n\n"
            "TYPE RULES:\n"
            f"{type_rules_str}\n\n"
            "EXTRACTION RULES:\n"
            "1. Return ONLY the JSON object — no markdown fences, no explanation, "
            "no surrounding text.\n"
            "2. Every key in the schema MUST be present in your response.\n"
            "3. Extract values ONLY from the document. Do not infer or fabricate.\n"
            "4. Use null for any field whose value cannot be determined.\n"
            "5. Prefer exact quotes from the document over paraphrasing.\n"
            "6. For numeric fields, extract the raw number without formatting.\n"
            "7. For dates, convert any date format found to YYYY-MM-DD.\n"
            "8. For lists, include all items mentioned — do not truncate."
        )

    elif output_format == 'derived':
        return (
            "\n\n--- OUTPUT FORMAT ---\n"
            "You are computing a derived/calculated value from the extracted metadata.\n"
            "Respond with ONLY a valid JSON object: {\"result\": <value>}\n"
            "The value should match the expected type of the derived field.\n"
            "Use null if computation is impossible due to missing inputs.\n"
            "No markdown, no explanation — only the JSON object."
        )

    else:  # text
        return ""  # no extra format instructions for free-text


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------

def _extract_json(raw: str) -> dict | None:
    """
    Best-effort parse JSON from LLM output.
    Handles markdown code fences, trailing commas, etc.
    """
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith('```'):
        # Remove ```json or ``` prefix and trailing ```
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'```\s*$', '', text)
        text = text.strip()

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON object in text
    match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Try nested JSON objects
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


def _parse_yes_no(raw: str) -> str:
    """Parse a yes/no response from LLM output. Returns 'yes', 'no', or 'unknown'."""
    text = raw.strip().lower()

    # Try JSON parse first
    parsed = _extract_json(raw)
    if parsed and isinstance(parsed, dict):
        answer = str(parsed.get('answer', '')).strip().lower()
        if answer in ('yes', 'true', '1'):
            return 'yes'
        if answer in ('no', 'false', '0'):
            return 'no'

    # Fallback: check raw text
    if text in ('yes', 'true', '1'):
        return 'yes'
    if text in ('no', 'false', '0'):
        return 'no'
    if text.startswith('yes'):
        return 'yes'
    if text.startswith('no'):
        return 'no'

    return 'unknown'


# ---------------------------------------------------------------------------
# AI model callers
# ---------------------------------------------------------------------------

def _call_gemini(model_id: str, system_prompt: str, document_context: str,
                 temperature: float = 0.3, max_tokens: int = 2048) -> dict:
    """Call Google Gemini API."""
    try:
        import google.generativeai as genai
    except ImportError:
        return {'error': 'google-generativeai package not installed. Run: pip install google-generativeai'}

    api_key = os.environ.get('GEMINI_API') or getattr(settings, 'GEMINI_API_KEY', '')
    if not api_key:
        return {'error': 'GEMINI_API key not configured'}

    genai.configure(api_key=api_key)

    model = genai.GenerativeModel(
        model_name=model_id,
        system_instruction=system_prompt,
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
        ),
    )

    full_prompt = f"{document_context}"

    try:
        response = model.generate_content(full_prompt)
        return {
            'response': response.text,
            'model': model_id,
            'provider': 'gemini',
        }
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return {'error': str(e), 'model': model_id, 'provider': 'gemini'}


def _call_openai(model_id: str, system_prompt: str, document_context: str,
                 temperature: float = 0.3, max_tokens: int = 2048) -> dict:
    """Call OpenAI ChatGPT API."""
    try:
        import openai
    except ImportError:
        return {'error': 'openai package not installed. Run: pip install openai'}

    api_key = os.environ.get('OPENAI_API_KEY') or getattr(settings, 'OPENAI_API_KEY', '')
    if not api_key:
        return {'error': 'OPENAI_API_KEY not configured'}

    client = openai.OpenAI(api_key=api_key)

    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": document_context},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return {
            'response': response.choices[0].message.content,
            'model': model_id,
            'provider': 'openai',
            'usage': {
                'prompt_tokens': response.usage.prompt_tokens,
                'completion_tokens': response.usage.completion_tokens,
            },
        }
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        return {'error': str(e), 'model': model_id, 'provider': 'openai'}


def _call_model(model_id: str, system_prompt: str, document_context: str,
                temperature: float = 0.3, max_tokens: int = 2048) -> dict:
    """Route to the correct provider based on model ID."""
    model_info = AI_MODELS.get(model_id)
    if not model_info:
        return {'error': f'Unknown model: {model_id}'}

    provider = model_info['provider']
    if provider == 'gemini':
        return _call_gemini(model_id, system_prompt, document_context, temperature, max_tokens)
    elif provider == 'openai':
        return _call_openai(model_id, system_prompt, document_context, temperature, max_tokens)
    else:
        return {'error': f'Unsupported provider: {provider}'}


# ---------------------------------------------------------------------------
# Main executor
# ---------------------------------------------------------------------------

def execute_ai_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Execute an AI node: sends each document to the configured AI model
    with the user's system prompt, stores the structured response.

    Output modes:
      • json_extract — parse JSON, merge each key into extracted_metadata
                       so downstream Rule nodes can filter on them.
      • yes_no       — parse yes/no, store as extracted_metadata[output_key]
                       ("yes"/"no"/"unknown"). Rule: field=output_key, op=eq, val=yes
      • text         — store raw text as extracted_metadata[output_key]
      • derived      — compute derived/calculated metadata fields that
                       NuExtract cannot extract (e.g. total_experience,
                       risk_score). Delegates to derived_field_executor.

    Documents always pass through (not filtered) — AI enriches metadata.
    """
    config = node.config or {}
    model_id = config.get('model', 'gemini-2.5-flash')
    system_prompt = config.get('system_prompt', '')
    output_format = config.get('output_format', 'text')  # json_extract | yes_no | text | derived
    output_key = config.get('output_key', 'ai_analysis')
    json_fields = config.get('json_fields', [])
    temperature = float(config.get('temperature', 0.3))
    max_tokens = int(config.get('max_tokens', 2048))
    include_text = config.get('include_text', True)
    include_metadata = config.get('include_metadata', True)

    # ── Derived mode: delegate to the derived field executor ────────
    if output_format == 'derived':
        from .derived_field_executor import execute_derived_fields
        return execute_derived_fields(
            node=node,
            incoming_document_ids=incoming_document_ids,
            triggered_by=triggered_by,
        )

    if not system_prompt:
        return {
            'node_id': str(node.id),
            'model': model_id,
            'output_format': output_format,
            'status': 'failed',
            'error': 'No system prompt configured',
            'processed': 0,
            'failed': 0,
            'results': [],
        }

    # Build format instructions to append to system prompt
    format_instructions = _build_format_instructions(output_format, json_fields, output_key)
    full_system_prompt = system_prompt + format_instructions

    documents = WorkflowDocument.objects.filter(id__in=incoming_document_ids)
    results = []
    processed_count = 0
    failed_count = 0
    cache_hits = 0

    for doc in documents:
        # Build document context
        doc_context = _build_document_context(doc, include_text, include_metadata)

        # ── Cache check ─────────────────────────────────────────
        prompt_hash = _compute_prompt_hash(model_id, full_system_prompt, doc_context)
        cached = _get_cached_response(prompt_hash)

        if cached:
            # Cache HIT — use stored response instead of calling the LLM
            raw_response = cached.response_text
            cache_hit = True
            cache_hits += 1
            logger.info(
                f"AI cache hit for doc {doc.id} (hash {prompt_hash[:12]}…, "
                f"hit #{cached.hit_count})"
            )
        else:
            # Cache MISS — call AI model
            cache_hit = False
            ai_result = _call_model(
                model_id=model_id,
                system_prompt=full_system_prompt,
                document_context=doc_context,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            if 'error' in ai_result:
                failed_count += 1
                results.append({
                    'document_id': str(doc.id),
                    'document_title': doc.title or str(doc.id),
                    'status': 'error',
                    'error': ai_result['error'],
                    'cache_hit': False,
                })
                continue

            raw_response = ai_result.get('response', '')

        meta = doc.extracted_metadata or {}
        result_entry = {
            'document_id': str(doc.id),
            'document_title': doc.title or str(doc.id),
            'status': 'success',
            'output_format': output_format,
            'cache_hit': cache_hit,
        }

        # ── json_extract mode ───────────────────────────────────
        if output_format == 'json_extract':
            parsed = _extract_json(raw_response)
            if parsed and isinstance(parsed, dict):
                for key, value in parsed.items():
                    meta[key] = value
                meta[output_key] = parsed
                result_entry['parsed_fields'] = parsed
                result_entry['response'] = json.dumps(parsed, indent=2)[:500]
            else:
                meta[output_key] = raw_response
                result_entry['parse_error'] = 'Could not parse JSON from AI response'
                result_entry['raw_response'] = raw_response[:300]
                result_entry['response'] = raw_response[:500]

        # ── yes_no mode ─────────────────────────────────────────
        elif output_format == 'yes_no':
            answer = _parse_yes_no(raw_response)
            meta[output_key] = answer
            result_entry['answer'] = answer
            result_entry['response'] = answer

        # ── text mode (default) ─────────────────────────────────
        else:
            meta[output_key] = raw_response
            result_entry['response'] = raw_response[:500] if len(raw_response) > 500 else raw_response
            result_entry['response_length'] = len(raw_response)

        # Save enriched metadata
        doc.extracted_metadata = meta
        doc.save(update_fields=['extracted_metadata', 'updated_at'])

        # ── Store in cache (only on miss) ───────────────────────
        if not cache_hit:
            _store_cached_response(
                prompt_hash=prompt_hash,
                model_id=model_id,
                output_format=output_format,
                response_text=raw_response,
                parsed_result={
                    k: result_entry[k]
                    for k in ('parsed_fields', 'answer', 'response', 'response_length')
                    if k in result_entry
                },
            )

        processed_count += 1
        results.append(result_entry)

    total = processed_count + failed_count
    if failed_count == total and total > 0:
        overall_status = 'failed'
    elif failed_count > 0:
        overall_status = 'partial'
    else:
        overall_status = 'completed'

    return {
        'node_id': str(node.id),
        'model': model_id,
        'output_format': output_format,
        'status': overall_status,
        'processed': processed_count,
        'failed': failed_count,
        'total': total,
        'cache_hits': cache_hits,
        'output_key': output_key,
        'json_fields': [f.get('name', '') for f in json_fields] if output_format == 'json_extract' else [],
        'results': results,
    }
