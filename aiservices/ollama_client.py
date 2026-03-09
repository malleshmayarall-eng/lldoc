"""Ollama / local LLM client for AI services.

Calls a local Ollama instance via its OpenAI-compatible chat API.
Default model: Qwen3-8B (131K context, excellent JSON output).

Environment variables
---------------------
OLLAMA_BASE_URL   – Base URL of the Ollama server (default: http://localhost:11434)
OLLAMA_MODEL      – Model tag to use (default: qwen3:8b)

Usage
-----
    from aiservices.ollama_client import call_ollama

    result = call_ollama(
        system_prompt="You are a helpful assistant. Return JSON only.",
        user_prompt="Summarise this data: ...",
        temperature=0.3,
    )
    # result is the parsed dict if the model returned JSON, or a raw string.
"""

import json
import logging
import os
from typing import Any, Dict, Optional, Union

import requests

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2")


def _strip_think_tags(text: str) -> str:
    """Remove <think>…</think> reasoning blocks that Qwen3 may emit."""
    import re
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Try to parse JSON from model output, handling markdown fences."""
    text = _strip_think_tags(text)

    # Strip markdown code fences if present
    if "```" in text:
        import re
        match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
        if match:
            text = match.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find the first { ... } block
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    return None


def is_ollama_available() -> bool:
    """Quick health-check: can we reach the Ollama server?"""
    try:
        resp = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
        return resp.status_code == 200
    except Exception:
        return False


def call_ollama(
    system_prompt: str,
    user_prompt: str,
    *,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
    json_mode: bool = True,
    timeout: int = 120,
) -> Union[Dict[str, Any], str]:
    """Call a local Ollama model and return the response.

    Parameters
    ----------
    system_prompt : str
        System-level instruction (persona, output format).
    user_prompt : str
        The actual query / data to process.
    model : str, optional
        Override OLLAMA_MODEL for this call.
    temperature : float
        Sampling temperature (0.0–1.0). Lower = more deterministic.
    max_tokens : int
        Maximum tokens to generate.
    json_mode : bool
        If True, sets Ollama's response format to JSON and appends /no_think
        to encourage Qwen3 to skip its thinking block.
    timeout : int
        Request timeout in seconds.

    Returns
    -------
    dict or str
        Parsed JSON dict if the model returned valid JSON, otherwise the raw
        response text.

    Raises
    ------
    ConnectionError
        If the Ollama server is unreachable.
    requests.exceptions.HTTPError
        If Ollama returns a non-2xx status.
    """
    model = model or OLLAMA_MODEL
    url = f"{OLLAMA_BASE_URL}/api/chat"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    if json_mode:
        payload["format"] = "json"

    logger.info("Calling Ollama [%s] at %s", model, url)

    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
    except requests.exceptions.ConnectionError as exc:
        logger.warning("Ollama server unreachable at %s: %s", OLLAMA_BASE_URL, exc)
        raise ConnectionError(
            f"Cannot reach Ollama at {OLLAMA_BASE_URL}. "
            "Is the server running? (ollama serve)"
        ) from exc
    except requests.exceptions.HTTPError as exc:
        body = ""
        try:
            body = resp.text[:500]
        except Exception:
            pass
        logger.error("Ollama HTTP error: %s – %s", resp.status_code, body)
        raise

    data = resp.json()
    raw_content = data.get("message", {}).get("content", "")

    if not raw_content:
        logger.warning("Ollama returned empty content")
        return {}

    logger.debug("Ollama raw content (first 500 chars): %s", raw_content[:500])

    # Clean up think tags, then parse JSON
    content = _strip_think_tags(raw_content)

    # If stripping think tags removed everything, try parsing from raw
    if not content.strip():
        logger.warning("Content empty after stripping <think> tags, trying raw content")
        content = raw_content

    parsed = _extract_json(content)
    if parsed is not None:
        return parsed

    # Last resort: try parsing JSON from the raw (unstripped) content
    parsed_raw = _extract_json(raw_content)
    if parsed_raw is not None:
        return parsed_raw

    return content
