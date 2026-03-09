"""
Derived Field Executor — AI-computed metadata that NuExtract misses
====================================================================
Handles fields that require reasoning, calculation, or inference beyond
simple NER extraction.  Examples:

  - Resume:   total_experience = sum of all work durations
  - Contract: risk_score = analysis of clause protectiveness
  - Invoice:  days_until_due = due_date minus invoice_date
  - Any doc:  seniority_level = categorise from title + experience

The executor:
  1. Reads the workflow's DerivedField definitions
  2. For each document, gathers its already-extracted metadata
  3. Auto-generates a structured AI prompt with computation instructions
  4. Calls the LLM (Gemini/OpenAI) to compute the derived values
  5. Merges results into the document's extracted_metadata

This is called from execute_ai_node() when output_format='derived'.
"""
import json
import logging

from django.utils import timezone

from .models import DerivedField, WorkflowDocument, WorkflowNode

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt builder for derived fields
# ---------------------------------------------------------------------------

def _build_derived_prompt(
    derived_fields: list[DerivedField],
    metadata: dict,
    document_text: str | None = None,
) -> tuple[str, str]:
    """
    Build the system prompt and document context for derived field computation.

    Returns:
        (system_prompt, document_context) tuple ready for LLM call.
    """
    # -- System prompt -------------------------------------------------------
    system_parts = [
        "You are a metadata computation engine. Your job is to compute "
        "derived metadata fields from already-extracted document data.",
        "",
        "You will receive:",
        "  1. A set of already-extracted metadata fields with their values",
        "  2. Instructions for each derived field you need to compute",
        "  3. Optionally, the full document text for deeper analysis",
        "",
        "RULES:",
        "- Compute each derived field according to its instructions.",
        "- Use the extracted metadata values as your primary input.",
        "- If the document text is provided, use it for additional context.",
        "- If you cannot compute a value (missing data), return null.",
        "- Return ONLY a valid JSON object with the computed fields.",
        "- No explanation, no markdown, no code fences — just the JSON.",
        "",
        "--- DERIVED FIELDS TO COMPUTE ---",
    ]

    json_schema_lines = []
    for df in derived_fields:
        system_parts.append(f"\nField: \"{df.name}\"")
        system_parts.append(f"  Type: {df.field_type}")
        if df.display_name:
            system_parts.append(f"  Label: {df.display_name}")
        if df.description:
            system_parts.append(f"  Description: {df.description}")
        system_parts.append(f"  Computation: {df.computation_hint}")
        if df.depends_on:
            system_parts.append(f"  Input fields: {', '.join(df.depends_on)}")
        if df.allowed_values:
            system_parts.append(f"  Allowed values: {json.dumps(df.allowed_values)}")

        # Build schema hint
        type_hint = {
            'string': '<string>',
            'number': '<number>',
            'boolean': '<boolean>',
            'date': '<string (YYYY-MM-DD)>',
            'list': '<array of strings>',
            'category': f'<one of {json.dumps(df.allowed_values)}>' if df.allowed_values else '<string>',
        }.get(df.field_type, '<string>')
        json_schema_lines.append(f'  "{df.name}": {type_hint}')

    system_parts.append("\n--- OUTPUT FORMAT ---")
    schema_str = "{\n" + ",\n".join(json_schema_lines) + "\n}"
    system_parts.append(f"Return ONLY this JSON structure:\n{schema_str}")
    system_parts.append("\nRules:")
    system_parts.append("- Every key must be present. Use null if you cannot compute.")
    system_parts.append("- Numbers must be unquoted.")
    system_parts.append("- Booleans must be true or false (not quoted).")
    system_parts.append("- Lists must be JSON arrays.")

    system_prompt = "\n".join(system_parts)

    # -- Document context ----------------------------------------------------
    context_parts = []

    context_parts.append("--- EXTRACTED METADATA ---")
    for key, value in sorted(metadata.items()):
        if key.startswith('_'):
            continue  # skip internal keys
        context_parts.append(f"  {key}: {value}")

    if document_text:
        # Truncate to stay within context limits
        max_chars = 20000
        text = document_text
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n... [truncated, {len(text)} total chars]"
        context_parts.append("\n--- DOCUMENT TEXT ---")
        context_parts.append(text)

    document_context = "\n".join(context_parts)

    return system_prompt, document_context


# ---------------------------------------------------------------------------
# Main executor
# ---------------------------------------------------------------------------

def execute_derived_fields(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Execute derived field computation for an AI node.

    Reads the workflow's DerivedField definitions, generates AI prompts,
    and merges computed values into each document's extracted_metadata.

    Config (in node.config):
      {
        "output_format": "derived",
        "model": "gemini-2.0-flash",
        "temperature": 0.2,
        "max_tokens": 2048,
        "derived_field_ids": [...] | null,  // optional filter; null = all
      }

    Returns the same result structure as execute_ai_node for consistency.
    """
    from .ai_node_executor import _call_model, _compute_prompt_hash, \
        _get_cached_response, _store_cached_response

    config = node.config or {}
    model_id = config.get('model', 'gemini-2.0-flash')
    temperature = float(config.get('temperature', 0.2))
    max_tokens = int(config.get('max_tokens', 2048))
    field_ids = config.get('derived_field_ids')  # optional subset

    workflow = node.workflow

    # Fetch derived fields for this workflow
    df_qs = workflow.derived_fields.all().order_by('order', 'created_at')
    if field_ids:
        df_qs = df_qs.filter(id__in=field_ids)
    derived_fields = list(df_qs)

    if not derived_fields:
        return {
            'node_id': str(node.id),
            'model': model_id,
            'output_format': 'derived',
            'status': 'skipped',
            'message': 'No derived fields configured for this workflow. '
                       'Add DerivedField definitions via the API.',
            'processed': 0,
            'failed': 0,
            'total': 0,
            'cache_hits': 0,
            'derived_fields': [],
            'results': [],
        }

    # Determine which fields need document text
    needs_text = any(df.include_document_text for df in derived_fields)

    documents = WorkflowDocument.objects.filter(id__in=incoming_document_ids)
    results = []
    processed_count = 0
    failed_count = 0
    cache_hits = 0

    for doc in documents:
        # Gather all current metadata (global + workflow + previously computed)
        combined_meta = {}
        if doc.global_metadata:
            combined_meta.update(doc.global_metadata)
        if doc.extracted_metadata:
            combined_meta.update(doc.extracted_metadata)

        # Get document text if any derived field needs it
        doc_text = None
        if needs_text:
            doc_text = doc.direct_text or doc.ocr_text or ''

        # Build the prompt
        system_prompt, doc_context = _build_derived_prompt(
            derived_fields=derived_fields,
            metadata=combined_meta,
            document_text=doc_text,
        )

        # Cache check
        prompt_hash = _compute_prompt_hash(model_id, system_prompt, doc_context)
        cached = _get_cached_response(prompt_hash)

        result_entry = {
            'document_id': str(doc.id),
            'document_title': doc.title or str(doc.id),
            'output_format': 'derived',
        }

        if cached:
            raw_response = cached.response_text
            cache_hit = True
            cache_hits += 1
            logger.info(
                f"Derived field cache hit for doc {doc.id} "
                f"(hash {prompt_hash[:12]}…, hit #{cached.hit_count})"
            )
        else:
            cache_hit = False
            ai_result = _call_model(
                model_id=model_id,
                system_prompt=system_prompt,
                document_context=doc_context,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            if 'error' in ai_result:
                failed_count += 1
                result_entry.update({
                    'status': 'error',
                    'error': ai_result['error'],
                    'cache_hit': False,
                })
                results.append(result_entry)
                continue

            raw_response = ai_result.get('response', '')

        # Parse the JSON response
        from .ai_node_executor import _extract_json
        parsed = _extract_json(raw_response)

        if parsed and isinstance(parsed, dict):
            # Merge computed fields into extracted_metadata
            meta = doc.extracted_metadata or {}
            computed_fields = {}

            for df in derived_fields:
                if df.name in parsed:
                    value = parsed[df.name]
                    # Type validation / coercion
                    value = _coerce_derived_value(value, df)
                    meta[df.name] = value
                    computed_fields[df.name] = value
                else:
                    computed_fields[df.name] = None

            # Save
            doc.extracted_metadata = meta
            doc.save(update_fields=['extracted_metadata', 'updated_at'])

            result_entry.update({
                'status': 'success',
                'computed_fields': computed_fields,
                'cache_hit': cache_hit,
            })
        else:
            # Failed to parse — store raw response
            result_entry.update({
                'status': 'parse_error',
                'error': 'Could not parse JSON from AI response',
                'raw_response': raw_response[:500] if raw_response else '',
                'cache_hit': cache_hit,
            })
            failed_count += 1
            results.append(result_entry)
            # Don't cache parse errors
            continue

        # Store in cache (only on miss)
        if not cache_hit:
            _store_cached_response(
                prompt_hash=prompt_hash,
                model_id=model_id,
                output_format='derived',
                response_text=raw_response,
                parsed_result=result_entry.get('computed_fields', {}),
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
        'output_format': 'derived',
        'status': overall_status,
        'processed': processed_count,
        'failed': failed_count,
        'total': total,
        'cache_hits': cache_hits,
        'derived_fields': [df.name for df in derived_fields],
        'results': results,
    }


# ---------------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------------

def _coerce_derived_value(value, derived_field: DerivedField):
    """Coerce a computed value to the declared field type."""
    if value is None:
        return None

    try:
        match derived_field.field_type:
            case 'number':
                if isinstance(value, (int, float)):
                    return value
                # Strip non-numeric chars and parse
                import re
                cleaned = re.sub(r'[^\d.\-]', '', str(value))
                if '.' in cleaned:
                    return float(cleaned)
                return int(cleaned)

            case 'boolean':
                if isinstance(value, bool):
                    return value
                return str(value).strip().lower() in ('true', 'yes', '1')

            case 'date':
                if isinstance(value, str) and value.strip():
                    return value.strip()  # Keep as string (ISO format)
                return str(value)

            case 'list':
                if isinstance(value, list):
                    return value
                if isinstance(value, str):
                    # Try JSON array parse
                    import json as _json
                    try:
                        parsed = _json.loads(value)
                        if isinstance(parsed, list):
                            return parsed
                    except Exception:
                        pass
                    # Comma split fallback
                    import re
                    items = re.split(r'[,;|]\s*', value)
                    return [i.strip() for i in items if i.strip()]
                return [str(value)]

            case 'category':
                val_str = str(value).strip().lower()
                # Validate against allowed values if specified
                if derived_field.allowed_values:
                    allowed_lower = [str(v).lower() for v in derived_field.allowed_values]
                    if val_str in allowed_lower:
                        # Return the original-case version
                        idx = allowed_lower.index(val_str)
                        return derived_field.allowed_values[idx]
                    # Fuzzy fallback: find closest match
                    for i, av in enumerate(allowed_lower):
                        if av in val_str or val_str in av:
                            return derived_field.allowed_values[i]
                    return val_str  # No match, return as-is
                return val_str

            case _:  # string or unknown
                return str(value).strip()
    except Exception as e:
        logger.warning(
            f"Derived field coercion failed for {derived_field.name}="
            f"{value!r} (type={derived_field.field_type}): {e}"
        )
        return value


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

def get_derived_field_names(workflow) -> set[str]:
    """Return all derived field names for a workflow."""
    return set(
        workflow.derived_fields.values_list('name', flat=True)
    )


def get_derived_fields_for_display(workflow) -> list[dict]:
    """Return derived field definitions formatted for frontend display."""
    return [
        {
            'id': str(df.id),
            'name': df.name,
            'display_name': df.display_name or df.name,
            'field_type': df.field_type,
            'description': df.description,
            'computation_hint': df.computation_hint,
            'depends_on': df.depends_on or [],
            'allowed_values': df.allowed_values or [],
            'include_document_text': df.include_document_text,
            'order': df.order,
        }
        for df in workflow.derived_fields.all().order_by('order', 'created_at')
    ]
