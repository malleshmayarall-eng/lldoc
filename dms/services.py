from __future__ import annotations

from typing import Any, Iterable

import difflib

import io

from pypdf import PdfReader


def _iter_metadata_values(value: Any) -> Iterable[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        parts: list[str] = []
        for key, item in value.items():
            parts.append(str(key))
            parts.extend(_iter_metadata_values(item))
        return parts
    if isinstance(value, (list, tuple, set)):
        parts: list[str] = []
        for item in value:
            parts.extend(_iter_metadata_values(item))
        return parts
    return [str(value)]


def build_metadata_index(metadata: dict[str, Any]) -> str:
    tokens: list[str] = []
    for value in _iter_metadata_values(metadata):
        normalized = value.strip().lower()
        if normalized:
            tokens.append(normalized)
    return " ".join(sorted(set(tokens)))


def build_search_index(
    metadata_index: str,
    extracted_text: str,
    limit: int = 20000,
    extra: str | None = None,
) -> str:
    combined = f"{metadata_index} {extracted_text} {extra or ''}".strip().lower()
    if limit and len(combined) > limit:
        return combined[:limit]
    return combined


def compute_fuzzy_score(query: str, text: str, token_limit: int = 200) -> float:
    """Return similarity score between query and text (0..1)."""
    if not query or not text:
        return 0.0
    query_lower = query.lower().strip()
    text_lower = text.lower()
    if query_lower in text_lower:
        return 1.0

    query_tokens = [token for token in query_lower.split() if token]
    text_tokens = text_lower.replace("\n", " ").split()
    token_set = set(text_tokens)

    if query_tokens and all(token in token_set for token in query_tokens):
        return 0.95

    if len(query_lower) <= 3 and any(query_lower in token for token in token_set):
        return 0.9

    tokens = text_tokens[:token_limit]
    best = difflib.SequenceMatcher(None, query_lower, " ".join(tokens)).ratio()

    sentences = text_lower.replace("\n", " ").split(".")
    for sentence in sentences[:50]:
        sentence = sentence.strip()
        if not sentence:
            continue
        score = difflib.SequenceMatcher(None, query_lower, sentence[:500]).ratio()
        if score > best:
            best = score

    window_size = max(len(query_tokens), 3)
    for idx in range(0, len(tokens) - window_size + 1):
        window = " ".join(tokens[idx : idx + window_size])
        score = difflib.SequenceMatcher(None, query_lower, window).ratio()
        if score > best:
            best = score

    return best


def extract_pdf_metadata(pdf_bytes: bytes) -> dict[str, Any]:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    metadata = reader.metadata or {}
    cleaned = {
        "title": _safe_metadata_value(metadata.get("/Title")),
        "author": _safe_metadata_value(metadata.get("/Author")),
        "subject": _safe_metadata_value(metadata.get("/Subject")),
        "creator": _safe_metadata_value(metadata.get("/Creator")),
        "producer": _safe_metadata_value(metadata.get("/Producer")),
        "keywords": _safe_metadata_value(metadata.get("/Keywords")),
        "page_count": len(reader.pages),
    }
    cleaned["raw_metadata"] = {str(key): _safe_metadata_value(value) for key, value in metadata.items()}
    return cleaned


def extract_pdf_text(pdf_bytes: bytes, max_pages: int = 5) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages = min(max_pages, len(reader.pages))
    chunks: list[str] = []
    for page_index in range(pages):
        try:
            text = reader.pages[page_index].extract_text() or ""
        except Exception:
            text = ""
        if text:
            chunks.append(text)
    return "\n".join(chunks)


def merge_metadata(extracted: dict[str, Any], custom: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(extracted)
    if custom:
        merged.update(custom)
    return merged


def _safe_metadata_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value)
