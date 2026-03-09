"""
Hierarchical Inference Engine — Universal Context Provider
============================================================
Bottom-up tree inference system for the document structure hierarchy:

    Document
      └─ Section (depth 0..N)
           ├─ Paragraph
           │    └─ Sentence
           ├─ LatexCode
           └─ Table

The document tree **is** the compression.  Leaf components get 1-3 sentence
summaries; sections aggregate children into purpose + obligations + entities;
the document level distils everything into an executive gist with parties
and risks.  Each tree level adds only what the child level didn't capture —
no redundancy, maximum information density, minimum tokens.

Two-Loop Architecture:

  **Write Path** (embed → search → rerank → graph UPSERT):
    On every component save, the write path embeds the text (BGE-M3 ColBERT),
    performs MaxSim nearest-neighbour search in the vector store, re-ranks
    candidates with a cross-encoder, and upserts lateral edges (CRITICAL /
    CONTEXTUAL) into the graph.  Runs async (thread/Celery).

  **Read Path** (tree traversal + lateral edges → context assembly):
    When an AI service requests context, the context window builder walks
    the tree (SELF → LATERAL → PARENT → PATH → ROOT) and assembles a
    dense context string.  Lateral edges inject cross-component dependencies
    discovered by the write path.

Modules:
  • ``models.py``           — ComponentInference, SectionAggregateInference,
                              DocumentInferenceSummary, LateralEdge
  • ``engine.py``           — TreeInferenceEngine: bottom-up walk with hash-based caching
  • ``context_window.py``   — Hierarchical context builder + lateral edge injection
  • ``graph_traversal.py``  — Public API: get_hierarchical_context_for_paragraph/section/document/table/scope/node
  • ``signals.py``          — Auto-propagation + write-path dispatch on component save
  • ``embedding.py``        — BGE-M3 embedding service (TEI / local / noop)
  • ``vector_store.py``     — MaxSim vector search (Qdrant / in-memory / noop)
  • ``reranker.py``         — Cross-encoder re-ranking (TEI / local / noop)
  • ``write_path.py``       — Write-path orchestrator: embed → search → rerank → graph
  • ``tasks.py``            — Celery tasks for async write-path execution
  • ``views.py``            — DRF endpoints to trigger / retrieve / manage
  • ``urls.py``             — URL routing for all inference endpoints
  • ``prompts.py``          — Tiered LLM prompts for each hierarchy level
  • ``serializers.py``      — DRF serializers for models + write-path results

Usage in any AI service::

    from aiservices.inference.graph_traversal import get_hierarchical_context_for_paragraph
    context = get_hierarchical_context_for_paragraph(paragraph)
    # Dense path-relative context: doc gist → ancestors → self → child sentences
"""
