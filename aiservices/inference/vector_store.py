"""
Vector Store Service — Qdrant integration for MaxSim search
=============================================================

Manages the vector database that stores per-component ColBERT embeddings
and provides MaxSim (Maximum Similarity) search for lateral dependency
discovery.

Production: Qdrant with native multi-vector MaxSim (v1.10+).
Development: In-memory Qdrant (no Docker needed) or brute-force NumPy
fallback when Qdrant is unavailable.

Public API:
    ``get_vector_store()``                        → singleton VectorStore
    ``upsert_component(doc_id, comp_id, ...)``    → store/update embedding
    ``search_similar(doc_id, query_vectors, ...)`` → top-K MaxSim results
    ``delete_component(doc_id, comp_id)``          → remove from index
    ``delete_document(doc_id)``                    → remove all doc vectors

Environment:
    INFERENCE_VECTOR_MODE   = 'qdrant' | 'memory' | 'none'  (default: 'memory')
    INFERENCE_QDRANT_URL    = 'http://localhost:6333'        (for qdrant mode)
    INFERENCE_QDRANT_COLLECTION = 'doc_components'           (default)
"""
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Data types
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class SearchResult:
    """A single MaxSim search hit."""
    component_id: str
    component_type: str
    section_id: str
    document_id: str
    score: float
    # Text content for reranker (loaded from DB, not stored in vector DB)
    text: str = ''


# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

DEFAULT_QDRANT_URL = 'http://localhost:6333'
DEFAULT_COLLECTION = 'doc_components'
DEFAULT_VECTOR_DIM = 1024   # BGE-M3 ColBERT token dimension


def _get_config():
    return {
        'mode': os.environ.get('INFERENCE_VECTOR_MODE', 'memory'),
        'qdrant_url': os.environ.get('INFERENCE_QDRANT_URL', DEFAULT_QDRANT_URL),
        'collection': os.environ.get('INFERENCE_QDRANT_COLLECTION', DEFAULT_COLLECTION),
    }


# ──────────────────────────────────────────────────────────────────────────
# Qdrant Backend (production)
# ──────────────────────────────────────────────────────────────────────────

class QdrantVectorStore:
    """
    Qdrant-backed vector store with native MaxSim via multi_vector config.

    Requires qdrant-client >= 1.10 and Qdrant server >= 1.10.

    Collection schema:
        vectors: {"colbert": MultiVector(dim=1024, comparator=MAX_SIM)}
        payload: {document_id, component_id, component_type, section_id, org_id}
    """

    def __init__(self, url: str, collection: str):
        self.url = url
        self.collection = collection
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from qdrant_client import QdrantClient
            self._client = QdrantClient(url=self.url, timeout=10)
            self._ensure_collection()
        except ImportError:
            raise RuntimeError(
                'qdrant-client not installed. Install with: pip install qdrant-client'
            )
        return self._client

    def _ensure_collection(self):
        """Create collection if it doesn't exist."""
        from qdrant_client import models as qmodels

        client = self._client
        collections = [c.name for c in client.get_collections().collections]

        if self.collection not in collections:
            client.create_collection(
                collection_name=self.collection,
                vectors_config={
                    'colbert': qmodels.VectorParams(
                        size=DEFAULT_VECTOR_DIM,
                        distance=qmodels.Distance.COSINE,
                        multivector_config=qmodels.MultiVectorConfig(
                            comparator=qmodels.MultiVectorComparator.MAX_SIM,
                        ),
                    ),
                },
            )
            # Create payload indexes for filtering
            client.create_payload_index(
                collection_name=self.collection,
                field_name='document_id',
                field_schema=qmodels.PayloadSchemaType.KEYWORD,
            )
            logger.info('Created Qdrant collection: %s', self.collection)

    def upsert(self, component_id: str, document_id: str,
               component_type: str, section_id: str,
               colbert_vecs: list[list[float]],
               org_id: str = '') -> bool:
        """Store/update a component's ColBERT vectors."""
        from qdrant_client import models as qmodels

        try:
            client = self._get_client()
            client.upsert(
                collection_name=self.collection,
                points=[
                    qmodels.PointStruct(
                        id=component_id,
                        vector={'colbert': colbert_vecs},
                        payload={
                            'document_id': document_id,
                            'component_id': component_id,
                            'component_type': component_type,
                            'section_id': section_id,
                            'org_id': org_id,
                        },
                    ),
                ],
            )
            return True
        except Exception as exc:
            logger.error('Qdrant upsert failed for %s: %s', component_id, exc)
            return False

    def search(self, document_id: str, query_vectors: list[list[float]],
               limit: int = 15, exclude_id: str = '') -> list[SearchResult]:
        """MaxSim search within a document, excluding the source component."""
        from qdrant_client import models as qmodels

        try:
            client = self._get_client()

            must_filters = [
                qmodels.FieldCondition(
                    key='document_id',
                    match=qmodels.MatchValue(value=document_id),
                ),
            ]
            must_not = []
            if exclude_id:
                must_not.append(
                    qmodels.HasIdCondition(has_id=[exclude_id])
                )

            results = client.query_points(
                collection_name=self.collection,
                query=query_vectors,
                using='colbert',
                limit=limit,
                query_filter=qmodels.Filter(
                    must=must_filters,
                    must_not=must_not if must_not else None,
                ),
            )

            return [
                SearchResult(
                    component_id=str(hit.id),
                    component_type=hit.payload.get('component_type', ''),
                    section_id=hit.payload.get('section_id', ''),
                    document_id=document_id,
                    score=hit.score,
                )
                for hit in results.points
            ]
        except Exception as exc:
            logger.error('Qdrant search failed: %s', exc)
            return []

    def delete_component(self, component_id: str) -> bool:
        """Remove a component from the index."""
        from qdrant_client import models as qmodels
        try:
            client = self._get_client()
            client.delete(
                collection_name=self.collection,
                points_selector=qmodels.PointIdsList(points=[component_id]),
            )
            return True
        except Exception as exc:
            logger.error('Qdrant delete failed for %s: %s', component_id, exc)
            return False

    def delete_document(self, document_id: str) -> bool:
        """Remove all components of a document from the index."""
        from qdrant_client import models as qmodels
        try:
            client = self._get_client()
            client.delete(
                collection_name=self.collection,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(
                        must=[
                            qmodels.FieldCondition(
                                key='document_id',
                                match=qmodels.MatchValue(value=document_id),
                            ),
                        ],
                    ),
                ),
            )
            return True
        except Exception as exc:
            logger.error('Qdrant delete_document failed for %s: %s', document_id, exc)
            return False

    def health_check(self) -> bool:
        try:
            self._get_client()
            return True
        except Exception:
            return False

    def count(self, document_id: str = '') -> int:
        """Count vectors, optionally filtered by document."""
        from qdrant_client import models as qmodels
        try:
            client = self._get_client()
            if document_id:
                result = client.count(
                    collection_name=self.collection,
                    count_filter=qmodels.Filter(
                        must=[
                            qmodels.FieldCondition(
                                key='document_id',
                                match=qmodels.MatchValue(value=document_id),
                            ),
                        ],
                    ),
                )
            else:
                result = client.count(collection_name=self.collection)
            return result.count
        except Exception:
            return 0


# ──────────────────────────────────────────────────────────────────────────
# In-Memory Backend (development / testing)
# ──────────────────────────────────────────────────────────────────────────

class InMemoryVectorStore:
    """
    Brute-force in-memory vector store with MaxSim computation.

    Stores all vectors in a Python dict. MaxSim is computed via nested
    loops — O(n × m × d) where n = query tokens, m = candidate tokens,
    d = dimension. Fine for development with < 1000 components.

    No external dependencies required.
    """

    def __init__(self):
        # {component_id: {vectors, payload}}
        self._store: dict[str, dict] = {}

    def upsert(self, component_id: str, document_id: str,
               component_type: str, section_id: str,
               colbert_vecs: list[list[float]],
               org_id: str = '') -> bool:
        self._store[component_id] = {
            'vectors': colbert_vecs,
            'payload': {
                'document_id': document_id,
                'component_id': component_id,
                'component_type': component_type,
                'section_id': section_id,
                'org_id': org_id,
            },
        }
        return True

    def search(self, document_id: str, query_vectors: list[list[float]],
               limit: int = 15, exclude_id: str = '') -> list[SearchResult]:
        """Brute-force MaxSim search."""
        if not query_vectors:
            return []

        candidates = []
        for comp_id, data in self._store.items():
            if comp_id == exclude_id:
                continue
            if data['payload']['document_id'] != document_id:
                continue

            score = self._maxsim(query_vectors, data['vectors'])
            candidates.append((comp_id, data['payload'], score))

        # Sort by score descending
        candidates.sort(key=lambda x: x[2], reverse=True)

        return [
            SearchResult(
                component_id=comp_id,
                component_type=payload.get('component_type', ''),
                section_id=payload.get('section_id', ''),
                document_id=document_id,
                score=score,
            )
            for comp_id, payload, score in candidates[:limit]
        ]

    @staticmethod
    def _maxsim(query_vecs: list[list[float]],
                doc_vecs: list[list[float]]) -> float:
        """
        MaxSim(Q, D) = (1/|Q|) × Σ_i max_j cos_sim(q_i, d_j)

        Normalised by query length so longer queries don't dominate.
        """
        if not query_vecs or not doc_vecs:
            return 0.0

        total = 0.0
        for qv in query_vecs:
            max_sim = -1.0
            for dv in doc_vecs:
                sim = _cosine_sim(qv, dv)
                if sim > max_sim:
                    max_sim = sim
            total += max_sim

        return total / len(query_vecs)

    def delete_component(self, component_id: str) -> bool:
        return self._store.pop(component_id, None) is not None

    def delete_document(self, document_id: str) -> bool:
        to_delete = [
            k for k, v in self._store.items()
            if v['payload']['document_id'] == document_id
        ]
        for k in to_delete:
            del self._store[k]
        return True

    def health_check(self) -> bool:
        return True

    def count(self, document_id: str = '') -> int:
        if document_id:
            return sum(
                1 for v in self._store.values()
                if v['payload']['document_id'] == document_id
            )
        return len(self._store)


# ──────────────────────────────────────────────────────────────────────────
# No-op Backend
# ──────────────────────────────────────────────────────────────────────────

class NoopVectorStore:
    """Disabled vector store — all operations are no-ops."""

    def upsert(self, *args, **kwargs) -> bool:
        return True

    def search(self, *args, **kwargs) -> list[SearchResult]:
        return []

    def delete_component(self, *args, **kwargs) -> bool:
        return True

    def delete_document(self, *args, **kwargs) -> bool:
        return True

    def health_check(self) -> bool:
        return True

    def count(self, *args, **kwargs) -> int:
        return 0


# ──────────────────────────────────────────────────────────────────────────
# Math helpers
# ──────────────────────────────────────────────────────────────────────────

def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a < 1e-9 or norm_b < 1e-9:
        return 0.0
    return dot / (norm_a * norm_b)


# ──────────────────────────────────────────────────────────────────────────
# Singleton access
# ──────────────────────────────────────────────────────────────────────────

_store_instance = None


def get_vector_store():
    """
    Return the singleton vector store based on INFERENCE_VECTOR_MODE:
      'qdrant' → QdrantVectorStore (production)
      'memory' → InMemoryVectorStore (development)
      'none'   → NoopVectorStore (disabled)
    """
    global _store_instance
    if _store_instance is not None:
        return _store_instance

    config = _get_config()
    mode = config['mode']

    if mode == 'qdrant':
        _store_instance = QdrantVectorStore(config['qdrant_url'], config['collection'])
        logger.info('Vector store: Qdrant mode → %s', config['qdrant_url'])
    elif mode == 'memory':
        _store_instance = InMemoryVectorStore()
        logger.info('Vector store: in-memory mode (dev)')
    elif mode == 'none':
        _store_instance = NoopVectorStore()
        logger.info('Vector store: disabled (none mode)')
    else:
        logger.warning('Unknown INFERENCE_VECTOR_MODE=%s, using memory', mode)
        _store_instance = InMemoryVectorStore()

    return _store_instance


def reset_vector_store():
    """Reset the singleton (for testing)."""
    global _store_instance
    _store_instance = None
