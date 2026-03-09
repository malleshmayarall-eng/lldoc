"""
Embedding Service — BGE-M3 token-level vectors for MaxSim search
==================================================================

The embedding layer converts component text into vector representations
used by the write path to discover lateral dependencies.

Production: BGE-M3 via Hugging Face TEI (HTTP) — returns ColBERT-style
token-level matrices for MaxSim.

Development: In-process ``sentence-transformers`` or ``FlagEmbedding`` —
same model, no Docker required.

Fallback: If no model is available, returns a lightweight hash-based
pseudo-embedding that degrades MaxSim to exact-match only.

Public API:
    ``get_embedder()``                  → singleton EmbeddingService
    ``embed_text(text)``                → EmbeddingResult(dense, colbert_vecs)
    ``embed_texts_batch(texts)``        → list[EmbeddingResult]

Environment:
    INFERENCE_EMBED_MODE    = 'tei' | 'local' | 'none'  (default: 'local')
    INFERENCE_EMBED_MODEL   = 'BAAI/bge-m3'              (default)
    INFERENCE_TEI_URL       = 'http://localhost:8081'     (for TEI mode)
"""
import hashlib
import logging
import os
import struct
import time
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Data types
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class EmbeddingResult:
    """Result of embedding a single text."""
    # Dense single-vector (for fallback / HNSW search)
    dense: list[float] = field(default_factory=list)
    # ColBERT-style token-level matrix (for MaxSim)
    colbert_vecs: list[list[float]] = field(default_factory=list)
    # Number of tokens
    num_tokens: int = 0
    # Model used
    model: str = ''
    # Embedding latency in ms
    latency_ms: int = 0

    @property
    def has_colbert(self) -> bool:
        return len(self.colbert_vecs) > 0

    @property
    def dimension(self) -> int:
        if self.colbert_vecs:
            return len(self.colbert_vecs[0]) if self.colbert_vecs[0] else 0
        if self.dense:
            return len(self.dense)
        return 0


# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

DEFAULT_MODEL = 'BAAI/bge-m3'
DEFAULT_TEI_URL = 'http://localhost:8081'

EMBED_MODES = ('tei', 'local', 'none')


def _get_config():
    return {
        'mode': os.environ.get('INFERENCE_EMBED_MODE', 'local'),
        'model': os.environ.get('INFERENCE_EMBED_MODEL', DEFAULT_MODEL),
        'tei_url': os.environ.get('INFERENCE_TEI_URL', DEFAULT_TEI_URL),
    }


# ──────────────────────────────────────────────────────────────────────────
# TEI Backend (production: HTTP calls to Text Embeddings Inference)
# ──────────────────────────────────────────────────────────────────────────

class TEIEmbedder:
    """
    Calls a Hugging Face Text Embeddings Inference server for BGE-M3
    ColBERT vectors.

    TEI endpoint:  POST /embed
    With multi-vector support: returns token-level embeddings when
    the model supports ColBERT output.
    """

    def __init__(self, base_url: str, model: str):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self._healthy = None

    def health_check(self) -> bool:
        try:
            resp = requests.get(f'{self.base_url}/health', timeout=3)
            self._healthy = resp.status_code == 200
        except Exception:
            self._healthy = False
        return self._healthy

    def embed(self, text: str) -> EmbeddingResult:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[EmbeddingResult]:
        t0 = time.time()
        results = []

        try:
            # TEI /embed endpoint with ColBERT output
            resp = requests.post(
                f'{self.base_url}/embed',
                json={
                    'inputs': texts,
                    'truncate': True,
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()

            latency_ms = int((time.time() - t0) * 1000)

            # TEI returns list of embeddings; for ColBERT models it returns
            # nested arrays (token-level). For single-vector models it
            # returns flat arrays.
            for i, embedding in enumerate(data):
                if isinstance(embedding, list) and embedding and isinstance(embedding[0], list):
                    # Token-level ColBERT output
                    colbert_vecs = embedding
                    # Dense = mean pool of token vectors
                    dim = len(colbert_vecs[0])
                    dense = [
                        sum(v[d] for v in colbert_vecs) / len(colbert_vecs)
                        for d in range(dim)
                    ]
                    results.append(EmbeddingResult(
                        dense=dense,
                        colbert_vecs=colbert_vecs,
                        num_tokens=len(colbert_vecs),
                        model=self.model,
                        latency_ms=latency_ms,
                    ))
                else:
                    # Single-vector output
                    results.append(EmbeddingResult(
                        dense=embedding,
                        colbert_vecs=[],
                        num_tokens=1,
                        model=self.model,
                        latency_ms=latency_ms,
                    ))

        except Exception as exc:
            logger.error('TEI embed_batch failed: %s', exc)
            latency_ms = int((time.time() - t0) * 1000)
            for text in texts:
                results.append(_fallback_embedding(text, latency_ms))

        return results


# ──────────────────────────────────────────────────────────────────────────
# Local Backend (development: in-process FlagEmbedding / sentence-transformers)
# ──────────────────────────────────────────────────────────────────────────

class LocalEmbedder:
    """
    Loads BGE-M3 (or compatible model) in-process using FlagEmbedding.
    Falls back to sentence-transformers if FlagEmbedding is not installed.
    Falls back to hash-based pseudo-embedding if neither is available.

    The model is loaded lazily on first call and cached.
    """

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._flag_model = None
        self._st_model = None
        self._backend = None   # 'flag' | 'st' | 'hash'

    def _load(self):
        if self._backend is not None:
            return

        # Try FlagEmbedding first (native ColBERT support)
        try:
            from FlagEmbedding import BGEM3FlagModel
            logger.info('Loading BGE-M3 via FlagEmbedding (ColBERT support)...')
            self._flag_model = BGEM3FlagModel(
                self.model_name,
                use_fp16=True,
            )
            self._backend = 'flag'
            logger.info('BGE-M3 loaded via FlagEmbedding')
            return
        except ImportError:
            logger.debug('FlagEmbedding not installed, trying sentence-transformers')
        except Exception as exc:
            logger.warning('FlagEmbedding load failed: %s', exc)

        # Try sentence-transformers (single-vector only)
        try:
            from sentence_transformers import SentenceTransformer
            logger.info('Loading %s via sentence-transformers (single-vector)...', self.model_name)
            self._st_model = SentenceTransformer(self.model_name)
            self._backend = 'st'
            logger.info('Model loaded via sentence-transformers')
            return
        except ImportError:
            logger.debug('sentence-transformers not installed')
        except Exception as exc:
            logger.warning('sentence-transformers load failed: %s', exc)

        # Fallback: hash-based pseudo-embedding
        logger.warning(
            'No embedding library available. Using hash-based fallback. '
            'Install FlagEmbedding or sentence-transformers for real embeddings.'
        )
        self._backend = 'hash'

    def embed(self, text: str) -> EmbeddingResult:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: list[str]) -> list[EmbeddingResult]:
        self._load()
        t0 = time.time()
        results = []

        if self._backend == 'flag':
            results = self._embed_flag(texts)
        elif self._backend == 'st':
            results = self._embed_st(texts)
        else:
            for text in texts:
                results.append(_fallback_embedding(text, 0))

        latency_ms = int((time.time() - t0) * 1000)
        for r in results:
            r.latency_ms = latency_ms

        return results

    def _embed_flag(self, texts: list[str]) -> list[EmbeddingResult]:
        """FlagEmbedding: native ColBERT vectors."""
        output = self._flag_model.encode(
            texts,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=True,
        )

        results = []
        dense_vecs = output.get('dense_vecs', output.get('dense', []))
        colbert_vecs = output.get('colbert_vecs', [])

        for i, text in enumerate(texts):
            dense = dense_vecs[i].tolist() if i < len(dense_vecs) else []
            colbert = colbert_vecs[i].tolist() if i < len(colbert_vecs) else []
            results.append(EmbeddingResult(
                dense=dense,
                colbert_vecs=colbert,
                num_tokens=len(colbert) if colbert else 1,
                model=self.model_name,
            ))

        return results

    def _embed_st(self, texts: list[str]) -> list[EmbeddingResult]:
        """sentence-transformers: single-vector only."""
        embeddings = self._st_model.encode(texts, convert_to_numpy=True)
        results = []
        for i, text in enumerate(texts):
            vec = embeddings[i].tolist()
            results.append(EmbeddingResult(
                dense=vec,
                colbert_vecs=[],  # No ColBERT support
                num_tokens=1,
                model=self.model_name,
            ))
        return results


# ──────────────────────────────────────────────────────────────────────────
# No-op Backend (embedding disabled)
# ──────────────────────────────────────────────────────────────────────────

class NoopEmbedder:
    """Returns empty embeddings — for when embedding is disabled."""

    def embed(self, text: str) -> EmbeddingResult:
        return EmbeddingResult(model='none')

    def embed_batch(self, texts: list[str]) -> list[EmbeddingResult]:
        return [EmbeddingResult(model='none') for _ in texts]

    def health_check(self) -> bool:
        return True


# ──────────────────────────────────────────────────────────────────────────
# Hash-based fallback embedding (deterministic, zero-dependency)
# ──────────────────────────────────────────────────────────────────────────

def _fallback_embedding(text: str, latency_ms: int = 0) -> EmbeddingResult:
    """
    Deterministic pseudo-embedding from SHA-256 hash.

    This is NOT semantically meaningful — it only matches exact text.
    Used as a last resort when no embedding model is available, so the
    write path can still run (MaxSim will just not find real relationships).
    """
    h = hashlib.sha256(text.encode('utf-8')).digest()
    # Unpack 32 bytes → 8 floats, normalise to [-1, 1]
    floats = list(struct.unpack('8f', h))
    # Normalise
    norm = max(sum(f * f for f in floats) ** 0.5, 1e-9)
    dense = [f / norm for f in floats]

    # Simulate token-level by splitting on whitespace and hashing each token
    tokens = text.split()[:64]  # Cap at 64 tokens
    colbert_vecs = []
    for token in tokens:
        th = hashlib.sha256(token.encode('utf-8')).digest()
        tf = list(struct.unpack('8f', th))
        tn = max(sum(f * f for f in tf) ** 0.5, 1e-9)
        colbert_vecs.append([f / tn for f in tf])

    return EmbeddingResult(
        dense=dense,
        colbert_vecs=colbert_vecs,
        num_tokens=len(colbert_vecs),
        model='hash-fallback',
        latency_ms=latency_ms,
    )


# ──────────────────────────────────────────────────────────────────────────
# Singleton access
# ──────────────────────────────────────────────────────────────────────────

_embedder_instance = None


def get_embedder():
    """
    Return the singleton embedder based on INFERENCE_EMBED_MODE:
      'tei'   → TEIEmbedder (production: HTTP to TEI container)
      'local' → LocalEmbedder (dev: in-process FlagEmbedding / sentence-transformers)
      'none'  → NoopEmbedder (embedding disabled)
    """
    global _embedder_instance
    if _embedder_instance is not None:
        return _embedder_instance

    config = _get_config()
    mode = config['mode']

    if mode == 'tei':
        _embedder_instance = TEIEmbedder(config['tei_url'], config['model'])
        logger.info('Embedding service: TEI mode → %s', config['tei_url'])
    elif mode == 'local':
        _embedder_instance = LocalEmbedder(config['model'])
        logger.info('Embedding service: local mode → %s', config['model'])
    elif mode == 'none':
        _embedder_instance = NoopEmbedder()
        logger.info('Embedding service: disabled (none mode)')
    else:
        logger.warning('Unknown INFERENCE_EMBED_MODE=%s, using local', mode)
        _embedder_instance = LocalEmbedder(config['model'])

    return _embedder_instance


def embed_text(text: str) -> EmbeddingResult:
    """Embed a single text. Convenience wrapper."""
    return get_embedder().embed(text)


def embed_texts_batch(texts: list[str]) -> list[EmbeddingResult]:
    """Embed a batch of texts. Convenience wrapper."""
    return get_embedder().embed_batch(texts)


def reset_embedder():
    """Reset the singleton (for testing)."""
    global _embedder_instance
    _embedder_instance = None
