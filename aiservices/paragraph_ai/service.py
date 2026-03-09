import json
import os
from typing import Any, Dict, Optional

from ..gemini_ingest import call_gemini, extract_function_call_result, DEFAULT_GEMINI_MODEL
from .prompts import (
    PARAGRAPH_METADATA_PROMPT,
    PARAGRAPH_REWRITE_PROMPT,
    PARAGRAPH_SCORING_PROMPT,
)


def _build_prompt_payload(prompt: str, model: str, payload_json: str,
                          temperature: float = 0.2, max_tokens: int = 12000,
                          document_context: str = '') -> Dict[str, Any]:
    # Prepend document AI context (system prompt, ai_focus, mode) to the
    # task-specific prompt so that the model responds in a way aligned with
    # the document type configuration.
    effective_prompt = f'{document_context}{prompt}' if document_context else prompt
    return {
        'contents': [{
            'role': 'user',
            'parts': [
                {'text': effective_prompt},
                {'text': payload_json}
            ]
        }],
        'generationConfig': {
            'temperature': temperature,
            'topP': 0.9,
            'topK': 40,
            'maxOutputTokens': max_tokens,
        },
        'model': model,
    }


def _call_paragraph_prompt(prompt: str, payload: Dict[str, Any], api_key: Optional[str],
                           model: Optional[str], temperature: float, max_tokens: int,
                           document_context: str = '') -> Dict[str, Any]:
    api_key = api_key or os.environ.get('GEMINI_API')
    if not api_key:
        print("Paragraph AI: missing GEMINI_API key")
        return {'error': 'missing_api_key'}

    model = model or DEFAULT_GEMINI_MODEL
    payload_json = json.dumps(payload, default=str)
    gemini_payload = _build_prompt_payload(prompt, model, payload_json, temperature, max_tokens,
                                           document_context=document_context)
    try:
        raw_resp = call_gemini(gemini_payload, api_key=api_key)
    except Exception as exc:
        print(f"Paragraph AI: Gemini request failed: {exc}")
        return {'error': 'gemini_api_error', 'message': str(exc)}

    if isinstance(raw_resp, dict) and raw_resp.get('mock'):
        print("Paragraph AI: Gemini returned mock payload")
        return {'error': 'gemini_api_error', 'message': 'Gemini response not available.'}

    parsed = extract_function_call_result(raw_resp)
    return {
        'parsed': parsed,
        'raw_response': raw_resp,
        'model_name': model,
    }


def evaluate_paragraph_metadata(payload: Dict[str, Any], api_key: Optional[str] = None,
                                model: Optional[str] = None,
                                document_context: str = '') -> Dict[str, Any]:
    return _call_paragraph_prompt(
        PARAGRAPH_METADATA_PROMPT,
        payload,
        api_key=api_key,
        model=model,
        temperature=0.1,
        max_tokens=6000,
        document_context=document_context,
    )


def evaluate_paragraph_rewrite(payload: Dict[str, Any], api_key: Optional[str] = None,
                               model: Optional[str] = None,
                               document_context: str = '') -> Dict[str, Any]:
    return _call_paragraph_prompt(
        PARAGRAPH_REWRITE_PROMPT,
        payload,
        api_key=api_key,
        model=model,
        temperature=0.2,
        max_tokens=8000,
        document_context=document_context,
    )


def evaluate_paragraph_scoring(payload: Dict[str, Any], api_key: Optional[str] = None,
                               model: Optional[str] = None,
                               document_context: str = '') -> Dict[str, Any]:
    return _call_paragraph_prompt(
        PARAGRAPH_SCORING_PROMPT,
        payload,
        api_key=api_key,
        model=model,
        temperature=0.2,
        max_tokens=4000,
        document_context=document_context,
    )
