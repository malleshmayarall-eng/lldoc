"""
Reranker Service — Cross-encoder scoring for dependency classification
========================================================================

Given a list of (source_text, candidate_text) pairs from MaxSim search,
the reranker produces fine-grained relevance scores and classifies each
pair as CRITICAL, CONTEXTUAL, or noise.

Production: bge-reranker-v2-m3 via Hugging Face TEI (HTTP).
Development: In-process FlagEmbedding FlagReranker.
LLM mode: Uses Gemini (or compatible LLM) to score text relevance.
Fallback: Simple TF-IDF / Jaccard similarity when no model is available.

Public API:
    ``get_reranker()``                              → singleton Reranker
    ``rerank_pairs(pairs)``                         → list[RerankResult]
    ``classify_edge(score)``                        → 'critical' | 'contextual' | None

Environment:
    INFERENCE_RERANK_MODE       = 'tei' | 'local' | 'llm' | 'none'  (default: 'llm')
    INFERENCE_RERANK_MODEL      = 'BAAI/bge-reranker-v2-m3'  (default, for local/tei)
    INFERENCE_RERANK_TEI_URL    = 'http://localhost:8082'     (for TEI mode)
    INFERENCE_CRITICAL_THRESHOLD   = 0.85    (score ≥ this → CRITICAL)
    INFERENCE_CONTEXTUAL_THRESHOLD = 0.65    (score ≥ this → CONTEXTUAL)
"""
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Optional

import requests

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Data types
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class RerankResult:
    """Result of reranking a single (source, candidate) pair."""
    candidate_index: int
    score: float
    edge_type: Optional[str]    # 'critical', 'contextual', or None (noise)
    latency_ms: int = 0


# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3'
DEFAULT_RERANK_TEI_URL = 'http://localhost:8082'

CRITICAL_THRESHOLD = float(os.environ.get('INFERENCE_CRITICAL_THRESHOLD', '0.85'))
CONTEXTUAL_THRESHOLD = float(os.environ.get('INFERENCE_CONTEXTUAL_THRESHOLD', '0.65'))


def _get_config():
    return {
        'mode': os.environ.get('INFERENCE_RERANK_MODE', 'llm'),
        'model': os.environ.get('INFERENCE_RERANK_MODEL', DEFAULT_RERANK_MODEL),
        'tei_url': os.environ.get('INFERENCE_RERANK_TEI_URL', DEFAULT_RERANK_TEI_URL),
    }


def classify_edge(score: float) -> Optional[str]:
    """
    Classify a cross-encoder score into an edge type.

    Returns:
        'critical'    if score ≥ CRITICAL_THRESHOLD (0.85)
        'contextual'  if score ≥ CONTEXTUAL_THRESHOLD (0.65)
        None          if score < CONTEXTUAL_THRESHOLD (noise, discard)
    """
    if score >= CRITICAL_THRESHOLD:
        return 'critical'
    if score >= CONTEXTUAL_THRESHOLD:
        return 'contextual'
    return None


# ──────────────────────────────────────────────────────────────────────────
# TEI Backend (production)
# ──────────────────────────────────────────────────────────────────────────

class TEIReranker:
    """
    Calls a Hugging Face TEI reranker endpoint.

    TEI endpoint: POST /rerank
    Body: {"query": "source text", "texts": ["candidate 1", "candidate 2", ...]}
    Returns: [{"index": 0, "score": 0.92}, {"index": 1, "score": 0.71}, ...]
    """

    def __init__(self, base_url: str, model: str):
        self.base_url = base_url.rstrip('/')
        self.model = model

    def rerank(self, source_text: str,
               candidate_texts: list[str]) -> list[RerankResult]:
        """Score all candidates against the source text."""
        if not candidate_texts:
            return []

        t0 = time.time()
        try:
            resp = requests.post(
                f'{self.base_url}/rerank',
                json={
                    'query': source_text,
                    'texts': candidate_texts,
                    'return_text': False,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            latency_ms = int((time.time() - t0) * 1000)

            results = []
            for item in data:
                idx = item.get('index', 0)
                score = float(item.get('score', 0.0))
                results.append(RerankResult(
                    candidate_index=idx,
                    score=score,
                    edge_type=classify_edge(score),
                    latency_ms=latency_ms,
                ))

            return sorted(results, key=lambda r: r.score, reverse=True)

        except Exception as exc:
            logger.error('TEI rerank failed: %s', exc)
            latency_ms = int((time.time() - t0) * 1000)
            return self._fallback(source_text, candidate_texts, latency_ms)

    @staticmethod
    def _fallback(source_text, candidate_texts, latency_ms):
        """Jaccard fallback on TEI failure."""
        return _jaccard_rerank(source_text, candidate_texts, latency_ms)

    def health_check(self) -> bool:
        try:
            resp = requests.get(f'{self.base_url}/health', timeout=3)
            return resp.status_code == 200
        except Exception:
            return False


# ──────────────────────────────────────────────────────────────────────────
# Local Backend (development: in-process FlagReranker)
# ──────────────────────────────────────────────────────────────────────────

class LocalReranker:
    """
    In-process cross-encoder using FlagEmbedding's FlagReranker.
    Falls back to Jaccard similarity if the library is not available.
    """

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._model = None
        self._backend = None   # 'flag' | 'jaccard'

    def _load(self):
        if self._backend is not None:
            return

        try:
            from FlagEmbedding import FlagReranker
            logger.info('Loading reranker: %s via FlagEmbedding...', self.model_name)
            self._model = FlagReranker(self.model_name, use_fp16=True)
            self._backend = 'flag'
            logger.info('Reranker loaded: %s', self.model_name)
            return
        except ImportError:
            logger.debug('FlagEmbedding not installed')
        except Exception as exc:
            logger.warning('FlagReranker load failed: %s', exc)

        # Try sentence-transformers CrossEncoder
        try:
            from sentence_transformers import CrossEncoder
            logger.info('Loading reranker: %s via CrossEncoder...', self.model_name)
            self._model = CrossEncoder(self.model_name)
            self._backend = 'cross_encoder'
            logger.info('Reranker loaded via CrossEncoder: %s', self.model_name)
            return
        except ImportError:
            logger.debug('sentence-transformers not installed')
        except Exception as exc:
            logger.warning('CrossEncoder load failed: %s', exc)

        logger.warning(
            'No reranker library available. Using Jaccard fallback. '
            'Install FlagEmbedding for real cross-encoder reranking.'
        )
        self._backend = 'jaccard'

    def rerank(self, source_text: str,
               candidate_texts: list[str]) -> list[RerankResult]:
        if not candidate_texts:
            return []

        self._load()
        t0 = time.time()

        if self._backend == 'flag':
            results = self._rerank_flag(source_text, candidate_texts)
        elif self._backend == 'cross_encoder':
            results = self._rerank_cross_encoder(source_text, candidate_texts)
        else:
            results = _jaccard_rerank(source_text, candidate_texts, 0)

        latency_ms = int((time.time() - t0) * 1000)
        for r in results:
            r.latency_ms = latency_ms

        return results

    def _rerank_flag(self, source_text: str,
                     candidate_texts: list[str]) -> list[RerankResult]:
        """FlagReranker: batch scoring."""
        pairs = [[source_text, ct] for ct in candidate_texts]
        scores = self._model.compute_score(pairs, normalize=True)

        # compute_score returns a single float if only one pair, else list
        if isinstance(scores, (int, float)):
            scores = [scores]

        results = []
        for i, score in enumerate(scores):
            score = float(score)
            results.append(RerankResult(
                candidate_index=i,
                score=score,
                edge_type=classify_edge(score),
            ))

        return sorted(results, key=lambda r: r.score, reverse=True)

    def _rerank_cross_encoder(self, source_text: str,
                              candidate_texts: list[str]) -> list[RerankResult]:
        """sentence-transformers CrossEncoder scoring."""
        pairs = [[source_text, ct] for ct in candidate_texts]
        scores = self._model.predict(pairs)

        results = []
        for i, score in enumerate(scores):
            score = float(score)
            # CrossEncoder scores may not be [0,1] — apply sigmoid
            import math
            score = 1 / (1 + math.exp(-score))
            results.append(RerankResult(
                candidate_index=i,
                score=score,
                edge_type=classify_edge(score),
            ))

        return sorted(results, key=lambda r: r.score, reverse=True)

    def health_check(self) -> bool:
        return True


# ──────────────────────────────────────────────────────────────────────────
# LLM Backend (uses Gemini to score text pair relevance)
# ──────────────────────────────────────────────────────────────────────────

LLM_RERANK_PROMPT = """You are a legal document analyst. Score the semantic relevance between a SOURCE text and each CANDIDATE text.

For each candidate, return a relevance score from 0.0 to 1.0:
- 0.90-1.00: The texts are about the SAME specific topic, clause, or legal concept (e.g., both discuss the same indemnification clause, same party obligations, same defined term)
- 0.75-0.89: The texts are closely related — they reference overlapping legal concepts, terms, or obligations (e.g., one defines a term the other uses, or they describe related obligations of different parties)
- 0.60-0.74: The texts are moderately related — they share some legal context or domain but address different aspects (e.g., both about IP but different clauses)
- 0.30-0.59: Weak relation — same general document but different topics
- 0.00-0.29: Unrelated or only superficially similar

Return ONLY a JSON array of objects, one per candidate, in order:
[{{"index": 0, "score": 0.85, "reason": "brief reason"}}, ...]

SOURCE TEXT:
{source}

CANDIDATES:
{candidates}"""


class LLMReranker:
    """
    Uses the project's Gemini integration to score text pairs.
    More accurate than Jaccard for legal/document text, no model downloads needed.
    Batches all candidates into a single LLM call for efficiency.
    """

    def __init__(self):
        self._api_key = None

    def _get_api_key(self):
        if self._api_key is None:
            self._api_key = os.environ.get('GEMINI_API', '')
        return self._api_key

    def rerank(self, source_text: str,
               candidate_texts: list[str]) -> list[RerankResult]:
        if not candidate_texts:
            return []

        api_key = self._get_api_key()
        if not api_key:
            logger.warning('LLMReranker: No GEMINI_API key, falling back to Jaccard')
            return _jaccard_rerank(source_text, candidate_texts, 0)

        t0 = time.time()

        # Truncate texts to avoid excessive token usage
        max_chars = 500
        src_truncated = source_text[:max_chars]
        candidates_str = '\n'.join(
            f'[{i}] {ct[:max_chars]}'
            for i, ct in enumerate(candidate_texts)
        )

        prompt = LLM_RERANK_PROMPT.format(
            source=src_truncated,
            candidates=candidates_str,
        )

        try:
            from ..gemini_ingest import call_gemini, DEFAULT_GEMINI_MODEL

            model = os.environ.get('GEN_MODEL', DEFAULT_GEMINI_MODEL)
            payload = {
                'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
                'generationConfig': {
                    'temperature': 0.1,
                    'topP': 0.9,
                    'maxOutputTokens': 2048,
                    'responseMimeType': 'application/json',
                },
                'model': model,
            }

            raw_resp = call_gemini(payload, api_key=api_key)
            latency_ms = int((time.time() - t0) * 1000)

            if isinstance(raw_resp, dict) and raw_resp.get('mock'):
                logger.warning('LLMReranker: Got mock response, falling back to Jaccard')
                return _jaccard_rerank(source_text, candidate_texts, latency_ms)

            # Parse the response
            scores = self._parse_response(raw_resp, len(candidate_texts))
            results = []
            for i, score in enumerate(scores):
                results.append(RerankResult(
                    candidate_index=i,
                    score=score,
                    edge_type=classify_edge(score),
                    latency_ms=latency_ms,
                ))

            return sorted(results, key=lambda r: r.score, reverse=True)

        except Exception as exc:
            logger.error('LLMReranker failed: %s', exc)
            latency_ms = int((time.time() - t0) * 1000)
            return _jaccard_rerank(source_text, candidate_texts, latency_ms)

    def _parse_response(self, raw_resp: dict, num_candidates: int) -> list[float]:
        """Extract scores from the Gemini JSON response."""
        scores = [0.0] * num_candidates

        try:
            # Navigate Gemini response structure
            text = ''
            candidates = raw_resp.get('candidates', [])
            if candidates:
                parts = candidates[0].get('content', {}).get('parts', [])
                if parts:
                    text = parts[0].get('text', '')

            if not text:
                return scores

            # Parse the JSON array from the response
            # Try direct parse first
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                # Try to extract JSON from markdown code fences
                match = re.search(r'\[.*?\]', text, re.DOTALL)
                if match:
                    parsed = json.loads(match.group())
                else:
                    return scores

            if isinstance(parsed, list):
                for item in parsed:
                    idx = item.get('index', -1)
                    score = float(item.get('score', 0.0))
                    # Clamp score to [0, 1]
                    score = max(0.0, min(1.0, score))
                    if 0 <= idx < num_candidates:
                        scores[idx] = score

        except Exception as exc:
            logger.warning('LLMReranker: Failed to parse response: %s', exc)

        return scores

    def health_check(self) -> bool:
        return bool(self._get_api_key())


# ──────────────────────────────────────────────────────────────────────────
# No-op Backend
# ──────────────────────────────────────────────────────────────────────────

class NoopReranker:
    """Disabled reranker — returns empty results."""

    def rerank(self, source_text: str,
               candidate_texts: list[str]) -> list[RerankResult]:
        return []

    def health_check(self) -> bool:
        return True


# ──────────────────────────────────────────────────────────────────────────
# Jaccard fallback (zero-dependency)
# ──────────────────────────────────────────────────────────────────────────

def _jaccard_rerank(source_text: str, candidate_texts: list[str],
                    latency_ms: int) -> list[RerankResult]:
    """
    Simple Jaccard similarity as reranker fallback.

    Not semantically meaningful, but provides non-zero scores for terms
    that co-occur. Useful for catching defined terms referenced by name.
    """
    source_tokens = set(_tokenize(source_text))
    results = []

    for i, ct in enumerate(candidate_texts):
        candidate_tokens = set(_tokenize(ct))
        if not source_tokens or not candidate_tokens:
            score = 0.0
        else:
            intersection = source_tokens & candidate_tokens
            union = source_tokens | candidate_tokens
            score = len(intersection) / len(union) if union else 0.0

        results.append(RerankResult(
            candidate_index=i,
            score=score,
            edge_type=classify_edge(score),
            latency_ms=latency_ms,
        ))

    return sorted(results, key=lambda r: r.score, reverse=True)


def _tokenize(text: str) -> list[str]:
    """Simple whitespace + lowercase tokenization."""
    return [w.lower() for w in re.findall(r'\b\w+\b', text)]


# ──────────────────────────────────────────────────────────────────────────
# Singleton access
# ──────────────────────────────────────────────────────────────────────────

_reranker_instance = None


def get_reranker():
    """
    Return the singleton reranker based on INFERENCE_RERANK_MODE:
      'tei'   → TEIReranker (production)
      'local' → LocalReranker (dev: in-process FlagReranker)
      'llm'   → LLMReranker (dev: uses Gemini to score pairs)
      'none'  → NoopReranker (disabled)
    """
    global _reranker_instance
    if _reranker_instance is not None:
        return _reranker_instance

    config = _get_config()
    mode = config['mode']

    if mode == 'tei':
        _reranker_instance = TEIReranker(config['tei_url'], config['model'])
        logger.info('Reranker: TEI mode → %s', config['tei_url'])
    elif mode == 'llm':
        _reranker_instance = LLMReranker()
        logger.info('Reranker: LLM mode (Gemini-based scoring)')
    elif mode == 'local':
        _reranker_instance = LocalReranker(config['model'])
        logger.info('Reranker: local mode → %s', config['model'])
    elif mode == 'none':
        _reranker_instance = NoopReranker()
        logger.info('Reranker: disabled (none mode)')
    else:
        logger.warning('Unknown INFERENCE_RERANK_MODE=%s, using llm', mode)
        _reranker_instance = LLMReranker()

    return _reranker_instance


def rerank_pairs(source_text: str,
                 candidate_texts: list[str]) -> list[RerankResult]:
    """Convenience wrapper — rerank candidates against source."""
    return get_reranker().rerank(source_text, candidate_texts)


def reset_reranker():
    """Reset the singleton (for testing)."""
    global _reranker_instance
    _reranker_instance = None
