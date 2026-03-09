/**
 * useInferenceContext — Builds inference context for AI service calls.
 *
 * This hook is the bridge between the inference engine and every AI service.
 * Instead of each AI component manually fetching context, this hook provides
 * pre-built context strings that can be injected directly into prompts.
 *
 * It reads from the inference tree (already fetched by useDocumentInference)
 * and assembles context by walking SELF → LATERAL → PARENT → PATH → ROOT —
 * the same hierarchy the backend builds, but using cached data to avoid
 * extra API calls.
 *
 * Usage:
 *   const { getContextForParagraph, getContextForSection, getContextForDocument }
 *     = useInferenceContext(documentId);
 *
 *   // In AI chat / scoring / review calls:
 *   const ctx = getContextForParagraph(paragraphId, sectionId);
 *   aiService.chat({ ..., inference_context: ctx });
 *
 * For components that need the full server-side context (with lateral edges
 * from the write-path), use fetchServerContext() which calls the backend.
 */

import { useCallback, useMemo } from 'react';
import useDocumentInference from './useDocumentInference';
import inferenceService from '../services/inferenceService';

// ── Helper: walk tree to build ancestor path ────────────────────────────────

function buildAncestorPath(tree, targetSectionId) {
  if (!tree?.tree) return [];
  const path = [];

  function walk(nodes, trail) {
    for (const node of nodes) {
      const currentTrail = [...trail, node];
      if (node.section_id === targetSectionId) {
        path.push(...currentTrail);
        return true;
      }
      if (node.children && walk(node.children, currentTrail)) return true;
    }
    return false;
  }

  walk(tree.tree, []);
  return path;
}

// ── Helper: assemble context lines from inference data ──────────────────────

function assembleContextLines(opts = {}) {
  const {
    selfSummary,    // component inference
    selfType,       // 'paragraph' | 'table' | etc
    selfLabel,      // 'This paragraph' | section title
    sectionAggregate,
    ancestorPath,   // array of tree nodes (root → parent)
    documentSummary,
    lateralEdges,   // { edges: [...] } from cache
  } = opts;

  const lines = [];

  // SELF
  if (selfSummary) {
    lines.push(`[${selfLabel || `This ${selfType}`}] ${selfSummary.summary || ''}`);
    const tags = selfSummary.context_tags;
    if (tags?.length) lines.push(`  Type: ${tags.slice(0, 4).join(', ')}`);
    const entities = selfSummary.key_entities;
    if (entities?.length) lines.push(`  Entities: ${entities.slice(0, 8).join(', ')}`);
  }

  // LATERAL
  if (lateralEdges?.edges?.length) {
    for (const edge of lateralEdges.edges) {
      const prefix = edge.edge_type === 'critical' ? '→ CRITICAL' : '→ CONTEXTUAL';
      const label = edge.target_label || edge.target_type || 'component';
      const summary = edge.target_summary || '';
      if (summary) lines.push(`  [${prefix}] ${label}: ${summary}`);
    }
  }

  // PARENT (section aggregate)
  if (sectionAggregate) {
    const meta = sectionAggregate.custom_metadata || {};
    const purpose = meta.section_purpose || sectionAggregate.summary?.slice(0, 120) || '';
    const title = sectionAggregate.section_title || 'Untitled';
    lines.push(`[Section: ${title}] ${purpose}`);
    if (meta.key_obligations?.length) {
      lines.push(`  Obligations: ${meta.key_obligations.slice(0, 4).join('; ')}`);
    }
    if (meta.risk_indicators?.length) {
      lines.push(`  Risks: ${meta.risk_indicators.slice(0, 3).join('; ')}`);
    }
  }

  // PATH (ancestors)
  if (ancestorPath?.length > 1) {
    // Skip the last node (it's the direct parent, already shown)
    for (let i = 0; i < ancestorPath.length - 1; i++) {
      const node = ancestorPath[i];
      const agg = node.aggregate;
      if (agg) {
        const meta = agg.custom_metadata || {};
        const purpose = meta.section_purpose || agg.summary?.slice(0, 80) || '';
        lines.push(`  [↑ ${node.title || 'Section'}] ${purpose}`);
      }
    }
  }

  // ROOT (document)
  if (documentSummary) {
    const meta = documentSummary.custom_metadata || {};
    const purpose = meta.document_purpose || documentSummary.summary?.slice(0, 150) || '';
    const parties = meta.parties_identified || [];
    let gist = purpose;
    if (parties.length) gist += ` | Parties: ${parties.slice(0, 4).join(', ')}`;
    const title = documentSummary.document_title || 'Untitled';
    lines.push(`[Document: ${title}] ${gist}`);
  }

  return lines.join('\n');
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useInferenceContext(documentId, options = {}) {
  const inference = useDocumentInference(documentId, {
    autoFetchTree: true,
    pollStaleMs: options.pollStaleMs || 0,
  });

  const {
    tree,
    sectionInferenceMap,
    componentInferenceMap,
    getLateralEdgesFor,
  } = inference;

  // ── Find section node in tree by ID ─────────────────────────────────────

  const findSectionNode = useCallback((sectionId) => {
    if (!tree?.tree) return null;
    function walk(nodes) {
      for (const node of nodes) {
        if (node.section_id === sectionId) return node;
        if (node.children) {
          const found = walk(node.children);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(tree.tree);
  }, [tree]);

  // ── Client-side context for a paragraph ─────────────────────────────────

  const getContextForParagraph = useCallback((paragraphId, sectionId) => {
    const selfSummary = componentInferenceMap[paragraphId];
    const sectionAggregate = sectionInferenceMap[sectionId];
    const ancestorPath = buildAncestorPath(tree, sectionId);
    const lateralEdges = inference.state?.lateralEdgesCache?.[`paragraph:${paragraphId}`];

    return assembleContextLines({
      selfSummary,
      selfType: 'paragraph',
      selfLabel: 'This paragraph',
      sectionAggregate,
      ancestorPath,
      documentSummary: tree?.document_summary,
      lateralEdges,
    });
  }, [componentInferenceMap, sectionInferenceMap, tree, inference]);

  // ── Client-side context for a section ───────────────────────────────────

  const getContextForSection = useCallback((sectionId) => {
    const sectionNode = findSectionNode(sectionId);
    const sectionAggregate = sectionInferenceMap[sectionId];
    const ancestorPath = buildAncestorPath(tree, sectionId);

    const lines = [];

    // SELF
    if (sectionAggregate) {
      const meta = sectionAggregate.custom_metadata || {};
      lines.push(`[This section: ${sectionNode?.title || 'Untitled'}] ${sectionAggregate.summary || ''}`);
      if (meta.section_purpose) lines.push(`  Purpose: ${meta.section_purpose}`);
      if (meta.key_obligations?.length) lines.push(`  Obligations: ${meta.key_obligations.slice(0, 6).join('; ')}`);
      if (meta.risk_indicators?.length) lines.push(`  Risks: ${meta.risk_indicators.slice(0, 4).join('; ')}`);
    }

    // CHILDREN compact
    if (sectionNode?.components?.length) {
      lines.push('  Components:');
      for (const ci of sectionNode.components.slice(0, 15)) {
        const tags = ci.context_tags?.length ? ` [${ci.context_tags.slice(0, 2).join(',')}]` : '';
        lines.push(`    · ${ci.component_type}${tags}: ${(ci.summary || '').slice(0, 100)}`);
      }
    }

    // CHILDREN subsections
    if (sectionNode?.children?.length) {
      for (const child of sectionNode.children.slice(0, 8)) {
        if (child.aggregate) {
          const meta = child.aggregate.custom_metadata || {};
          const purpose = meta.section_purpose || child.aggregate.summary?.slice(0, 80) || '';
          lines.push(`    [§ ${child.title || 'Sub'}] ${purpose}`);
        }
      }
    }

    // PATH
    if (ancestorPath?.length > 1) {
      for (let i = 0; i < ancestorPath.length - 1; i++) {
        const node = ancestorPath[i];
        if (node.aggregate) {
          const meta = node.aggregate.custom_metadata || {};
          lines.push(`  [↑ ${node.title || 'Section'}] ${meta.section_purpose || node.aggregate.summary?.slice(0, 80) || ''}`);
        }
      }
    }

    // ROOT
    if (tree?.document_summary) {
      const meta = tree.document_summary.custom_metadata || {};
      const gist = meta.document_purpose || tree.document_summary.summary?.slice(0, 150) || '';
      lines.push(`[Document: ${tree.document_title || 'Untitled'}] ${gist}`);
    }

    return lines.join('\n');
  }, [findSectionNode, sectionInferenceMap, tree]);

  // ── Client-side context for a table ─────────────────────────────────────

  const getContextForTable = useCallback((tableId, sectionId) => {
    const selfSummary = componentInferenceMap[tableId];
    const sectionAggregate = sectionInferenceMap[sectionId];
    const ancestorPath = buildAncestorPath(tree, sectionId);
    const lateralEdges = inference.state?.lateralEdgesCache?.[`table:${tableId}`];

    return assembleContextLines({
      selfSummary,
      selfType: 'table',
      selfLabel: `This table`,
      sectionAggregate,
      ancestorPath,
      documentSummary: tree?.document_summary,
      lateralEdges,
    });
  }, [componentInferenceMap, sectionInferenceMap, tree, inference]);

  // ── Client-side context for the entire document ─────────────────────────

  const getContextForDocument = useCallback(() => {
    if (!tree?.document_summary) return '';

    const lines = [];
    const ds = tree.document_summary;
    const meta = ds.custom_metadata || {};

    lines.push(`[Document: ${tree.document_title || 'Untitled'}] ${ds.summary || ''}`);
    if (meta.document_purpose) lines.push(`  Purpose: ${meta.document_purpose}`);
    if (meta.parties_identified?.length) {
      lines.push(`  Parties: ${meta.parties_identified.join(', ')}`);
    }

    // Top-level sections
    if (tree.tree?.length) {
      lines.push('  Sections:');
      for (const node of tree.tree) {
        if (node.aggregate) {
          const m = node.aggregate.custom_metadata || {};
          const purpose = m.section_purpose || node.aggregate.summary?.slice(0, 80) || '';
          lines.push(`    [§ ${node.title || 'Section'}] ${purpose}`);
        }
      }
    }

    return lines.join('\n');
  }, [tree]);

  // ── Server-side context (full, with lateral edges from write-path) ──────

  const fetchServerContext = useCallback(async (scope, scopeId) => {
    try {
      switch (scope) {
        case 'document':
          return await inferenceService.getDocumentContext(documentId);
        case 'section':
          return await inferenceService.getSectionContext(scopeId);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }, [documentId]);

  // ── Prefetch lateral edges for a component ──────────────────────────────

  const prefetchLateral = useCallback(async (componentType, componentId) => {
    await getLateralEdgesFor(componentType, componentId);
  }, [getLateralEdgesFor]);

  return {
    // Pass-through from useDocumentInference
    ...inference,

    // Context builders (client-side, instant, no API call)
    getContextForParagraph,
    getContextForSection,
    getContextForTable,
    getContextForDocument,

    // Server-side context (full accuracy, lateral edges included)
    fetchServerContext,

    // Prefetch lateral edges
    prefetchLateral,
  };
}
