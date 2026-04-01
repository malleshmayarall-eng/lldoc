"""
Enrich Plugin — Auto-adds computed metadata to documents.
===========================================================
- Word count from extracted text
- Character count
- File fingerprint (SHA-256)
- Language detection (basic heuristic)
"""
import hashlib
import logging

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)


def _get_settings(node) -> dict:
    config = (node.config or {}).get('input_plugins', [])
    for p in config:
        if p.get('name') == 'enrich':
            if not p.get('enabled', True):
                return {}
            return p.get('settings', {})
    return {'word_count': True, 'file_fingerprint': True}


def _detect_language(text: str) -> str:
    """
    Basic language detection via character-frequency heuristics.
    Returns ISO 639-1 code or 'unknown'.
    """
    if not text or len(text) < 50:
        return 'unknown'

    # Very basic: check for common language-specific characters
    text_lower = text.lower()

    # CJK characters
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    if cjk > len(text) * 0.1:
        return 'zh'

    # Arabic
    arabic = sum(1 for c in text if '\u0600' <= c <= '\u06ff')
    if arabic > len(text) * 0.1:
        return 'ar'

    # Devanagari (Hindi)
    devanagari = sum(1 for c in text if '\u0900' <= c <= '\u097f')
    if devanagari > len(text) * 0.1:
        return 'hi'

    # Cyrillic (Russian)
    cyrillic = sum(1 for c in text if '\u0400' <= c <= '\u04ff')
    if cyrillic > len(text) * 0.1:
        return 'ru'

    # For Latin-script languages: use common word frequency
    words = text_lower.split()
    word_freq = {}
    for w in words[:500]:
        word_freq[w] = word_freq.get(w, 0) + 1

    # English markers
    en_markers = {'the', 'and', 'is', 'in', 'of', 'to', 'for', 'that', 'it', 'with'}
    en_score = sum(word_freq.get(m, 0) for m in en_markers)

    # Spanish
    es_markers = {'el', 'la', 'de', 'en', 'que', 'los', 'del', 'las', 'por', 'con'}
    es_score = sum(word_freq.get(m, 0) for m in es_markers)

    # French
    fr_markers = {'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'est', 'dans'}
    fr_score = sum(word_freq.get(m, 0) for m in fr_markers)

    # German
    de_markers = {'der', 'die', 'das', 'und', 'ist', 'ein', 'den', 'von', 'mit', 'auf'}
    de_score = sum(word_freq.get(m, 0) for m in de_markers)

    scores = {'en': en_score, 'es': es_score, 'fr': fr_score, 'de': de_score}
    best = max(scores, key=scores.get)
    if scores[best] > 3:
        return best

    return 'en'  # default to English


class EnrichPlugin:
    """Auto-enriches documents with computed metadata."""

    @clm_input_hookimpl
    def on_post_extract(self, node, document, extracted_fields):
        settings = _get_settings(node)
        if not settings:
            return None

        additions = {}

        # Word count from original_text or extracted text
        text = getattr(document, 'original_text', '') or ''
        if not text:
            # Concatenate all extracted string values
            text = ' '.join(
                str(v) for v in extracted_fields.values()
                if isinstance(v, str)
            )

        if settings.get('word_count', True) and text:
            words = text.split()
            additions['_word_count'] = len(words)

        if settings.get('char_count', False) and text:
            additions['_char_count'] = len(text)

        if settings.get('detect_language', False) and text:
            additions['_language'] = _detect_language(text)

        if additions:
            return {'fields': additions}
        return None

    @clm_input_hookimpl
    def on_transform(self, node, document):
        settings = _get_settings(node)
        if not settings:
            return

        if settings.get('file_fingerprint', True):
            # Use file_hash if already available
            file_hash = getattr(document, 'file_hash', '')
            if file_hash:
                gm = dict(document.global_metadata or {})
                gm['_file_fingerprint'] = file_hash
                document.global_metadata = gm
            elif hasattr(document, 'file') and document.file:
                try:
                    document.file.seek(0)
                    content = document.file.read()
                    document.file.seek(0)
                    fingerprint = hashlib.sha256(content).hexdigest()
                    gm = dict(document.global_metadata or {})
                    gm['_file_fingerprint'] = fingerprint
                    document.global_metadata = gm
                except Exception as e:
                    logger.debug(f"[enrich] Could not compute file fingerprint: {e}")
