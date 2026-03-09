"""
Graph Traversal — Public API for AI service context injection
=============================================================

This module provides the stable public interface that all AI services
import.  Internally it delegates to ``context_window.py`` which implements
the hierarchical compression strategy.

Every ``get_context_for_*`` function returns a **ready-to-inject** string
that gives the AI maximum understanding of the document structure in the
fewest tokens possible.

The ``service_name`` parameter is accepted for API compatibility but is
no longer used for token budgeting — the tree hierarchy itself is the
compression mechanism.

Public API
~~~~~~~~~~
- ``get_context_for_paragraph(paragraph, ...)``
- ``get_context_for_section(section, ...)``
- ``get_context_for_table(table, ...)``
- ``get_context_for_document(document, ...)``
- ``get_context_for_scope(document, scope, scope_id, ...)``
- ``has_fresh_inference(document)``
- ``has_fresh_section_inference(section)``
- ``has_fresh_component_inference(component)``
"""
import logging
from typing import Optional

from .context_window import (
    build_context_for_paragraph,
    build_context_for_section,
    build_context_for_table,
    build_context_for_document,
    build_context_for_scope,
    build_document_tree_context,
    has_fresh_inference,
    has_fresh_section_inference,
    has_fresh_component_inference,
    build_hierarchical_context_for_node,
    build_hierarchical_context_for_scope,
    build_hierarchical_context_for_section,
    build_hierarchical_context_for_paragraph,
    build_hierarchical_context_for_table,
    build_hierarchical_context_for_sentence,
    build_hierarchical_context_for_document,
)

logger = logging.getLogger(__name__)

__all__ = [
    'get_context_for_paragraph',
    'get_context_for_section',
    'get_context_for_table',
    'get_context_for_document',
    'get_context_for_scope',
    'get_document_tree_context',
    'has_fresh_inference',
    'has_fresh_section_inference',
    'has_fresh_component_inference',
    # Hierarchical path-relative context (ancestor + self + direct children only)
    'get_hierarchical_context_for_node',
    'get_hierarchical_context_for_scope',
    'get_hierarchical_context_for_section',
    'get_hierarchical_context_for_paragraph',
    'get_hierarchical_context_for_table',
    'get_hierarchical_context_for_sentence',
    'get_hierarchical_context_for_document',
]


# ══════════════════════════════════════════════════════════════════════════
#  Paragraph context
# ══════════════════════════════════════════════════════════════════════════

def get_context_for_paragraph(
    paragraph,
    service_name: str = 'default',
    **kwargs,
) -> str:
    """
    Get hierarchical context for a paragraph.

    Returns a dense string encoding:
      - Self summary (1-3 sentences)
      - Parent section purpose + obligations
      - Ancestor path (one-liner per level)
      - Document gist

    ``service_name`` is accepted for API compatibility but ignored —
    the tree hierarchy is the only compression layer.
    """
    try:
        return build_context_for_paragraph(paragraph)
    except Exception:
        logger.exception('Failed to build paragraph context')
        return ''


# ══════════════════════════════════════════════════════════════════════════
#  Section context
# ══════════════════════════════════════════════════════════════════════════

def get_context_for_section(
    section,
    service_name: str = 'default',
    **kwargs,
) -> str:
    """
    Get hierarchical context for a section.

    Returns a dense string encoding:
      - Self aggregate (summary + purpose + obligations + terms)
      - Child component summaries (one-liner each)
      - Subsection summaries
      - Ancestor path
      - Document gist
    """
    try:
        return build_context_for_section(section)
    except Exception:
        logger.exception('Failed to build section context')
        return ''


# ══════════════════════════════════════════════════════════════════════════
#  Table context
# ══════════════════════════════════════════════════════════════════════════

def get_context_for_table(
    table,
    service_name: str = 'default',
    **kwargs,
) -> str:
    """
    Get hierarchical context for a table.

    Returns a dense string encoding:
      - Self summary + entities + data insights
      - Parent section purpose
      - Ancestor path
      - Document gist
    """
    try:
        return build_context_for_table(table)
    except Exception:
        logger.exception('Failed to build table context')
        return ''


# ══════════════════════════════════════════════════════════════════════════
#  Document context
# ══════════════════════════════════════════════════════════════════════════

def get_context_for_document(
    document,
    service_name: str = 'default',
    **kwargs,
) -> str:
    """
    Get the full document tree context — the densest possible
    representation of the entire document for AI consumption.

    This is the maximally compressed form: the entire document hierarchy
    encoded as an indented tree with pre-distilled summaries at every level.
    """
    try:
        return build_context_for_document(document)
    except Exception:
        logger.exception('Failed to build document context')
        return ''


# ══════════════════════════════════════════════════════════════════════════
#  Scope dispatcher (for ai_chat / ai_chat_edit)
# ══════════════════════════════════════════════════════════════════════════

def get_context_for_scope(
    document,
    scope: str,
    scope_id: str | None = None,
    service_name: str = 'default',
    **kwargs,
) -> str:
    """
    Dispatch to the right builder based on ``scope``.

    Used by ai_chat and ai_chat_edit which work on variable scopes
    (document / section / paragraph / table).
    """
    try:
        return build_context_for_scope(document, scope, scope_id)
    except Exception:
        logger.exception('Failed to build scope context for scope=%s', scope)
        return ''


# ══════════════════════════════════════════════════════════════════════════
#  Full tree shortcut
# ══════════════════════════════════════════════════════════════════════════

def get_document_tree_context(document) -> str:
    """
    Alias for build_document_tree_context — returns the full indented
    tree representation of the document.
    """
    try:
        return build_document_tree_context(document)
    except Exception:
        logger.exception('Failed to build document tree context')
        return ''


# ══════════════════════════════════════════════════════════════════════════
#  Hierarchical path-relative context (ancestor + self + direct children)
# ══════════════════════════════════════════════════════════════════════════

def get_hierarchical_context_for_node(node) -> str:
    """
    Path-relative context for any document node.

    Rule: ancestors (root→parent) as one-liners + self (full block)
          + immediate children (one-liners only).
    Grandchildren and siblings are intentionally excluded.

    Accepts: Document, Section, Paragraph, Table, Sentence instances.
    """
    try:
        return build_hierarchical_context_for_node(node)
    except Exception:
        logger.exception('Failed to build hierarchical context for node %s', type(node))
        return ''


def get_hierarchical_context_for_scope(
    document,
    scope: str,
    scope_id: str | None = None,
    **kwargs,
) -> str:
    """
    Scope-string dispatcher for the hierarchical context builder.

    scope: 'document' | 'section' | 'paragraph' | 'table' | 'sentence'

    Returns the path-relative inference index:
        ancestors (one-liner each) → self (full block) → direct children (one-liners)
    """
    try:
        return build_hierarchical_context_for_scope(document, scope, scope_id)
    except Exception:
        logger.exception('Failed to build hierarchical scope context for scope=%s', scope)
        return ''


def get_hierarchical_context_for_section(section, **kwargs) -> str:
    """Path-relative context for a section node."""
    try:
        return build_hierarchical_context_for_section(section)
    except Exception:
        logger.exception('Failed to build hierarchical section context')
        return ''


def get_hierarchical_context_for_paragraph(paragraph, **kwargs) -> str:
    """Path-relative context for a paragraph node."""
    try:
        return build_hierarchical_context_for_paragraph(paragraph)
    except Exception:
        logger.exception('Failed to build hierarchical paragraph context')
        return ''


def get_hierarchical_context_for_table(table, **kwargs) -> str:
    """Path-relative context for a table node."""
    try:
        return build_hierarchical_context_for_table(table)
    except Exception:
        logger.exception('Failed to build hierarchical table context')
        return ''


def get_hierarchical_context_for_sentence(sentence, **kwargs) -> str:
    """Path-relative context for a sentence (leaf) node."""
    try:
        return build_hierarchical_context_for_sentence(sentence)
    except Exception:
        logger.exception('Failed to build hierarchical sentence context')
        return ''


def get_hierarchical_context_for_document(document, **kwargs) -> str:
    """Path-relative context for a document node (self + root sections)."""
    try:
        return build_hierarchical_context_for_document(document)
    except Exception:
        logger.exception('Failed to build hierarchical document context')
        return ''
