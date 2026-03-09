/**
 * useDocumentInference — React hook for the inference engine.
 *
 * Provides a single entry point for any component to:
 *   • Read inference state (tree, staleness, lateral edges, write-path status)
 *   • Trigger actions   (infer, write-path, rebuild embeddings)
 *   • Get component-level context for AI prompts
 *
 * Auto-fetches the inference tree on mount, polls staleness while active.
 *
 * Usage:
 *   const {
 *     tree, stale, writePathStatus,
 *     loading, error,
 *     runInference, runWritePath,
 *     getSectionInference, getComponentInference,
 *     getLateralEdgesFor,
 *   } = useDocumentInference(documentId);
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import inferenceService from '../services/inferenceService';

// ── State shape ──────────────────────────────────────────────────────────────

const initialState = {
  // Inference tree (full snapshot from GET /tree/)
  tree: null,
  // Staleness report (from GET /stale/)
  stale: null,
  // Write-path health (from GET /write-path-status/)
  writePathStatus: null,
  // Lateral edges cache: { [componentKey]: edgesResponse }
  lateralEdgesCache: {},

  loading: false,
  inferring: false,
  writingPath: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: null };
    case 'SET_TREE':
      return { ...state, loading: false, tree: action.payload, error: null };
    case 'SET_STALE':
      return { ...state, stale: action.payload };
    case 'SET_WP_STATUS':
      return { ...state, writePathStatus: action.payload };
    case 'INFERRING':
      return { ...state, inferring: true, error: null };
    case 'INFER_DONE':
      return { ...state, inferring: false };
    case 'WRITING_PATH':
      return { ...state, writingPath: true, error: null };
    case 'WRITE_PATH_DONE':
      return { ...state, writingPath: false };
    case 'SET_LATERAL':
      return {
        ...state,
        lateralEdgesCache: {
          ...state.lateralEdgesCache,
          [action.key]: action.payload,
        },
      };
    case 'ERROR':
      return { ...state, loading: false, inferring: false, writingPath: false, error: action.payload };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useDocumentInference(documentId, options = {}) {
  const {
    autoFetchTree = true,
    pollStaleMs = 0,        // 0 = no polling
  } = options;

  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch tree ──────────────────────────────────────────────────────────

  const fetchTree = useCallback(async () => {
    if (!documentId) return;
    dispatch({ type: 'LOADING' });
    try {
      const data = await inferenceService.getDocumentTree(documentId);
      if (mountedRef.current) dispatch({ type: 'SET_TREE', payload: data });
    } catch (err) {
      if (mountedRef.current) {
        dispatch({ type: 'ERROR', payload: err.response?.data?.message || err.message });
      }
    }
  }, [documentId]);

  // ── Fetch staleness ─────────────────────────────────────────────────────

  const fetchStale = useCallback(async () => {
    if (!documentId) return;
    try {
      const data = await inferenceService.getStaleComponents(documentId);
      if (mountedRef.current) dispatch({ type: 'SET_STALE', payload: data });
    } catch {
      // Silent — staleness is supplementary
    }
  }, [documentId]);

  // ── Fetch write-path status ─────────────────────────────────────────────

  const fetchWritePathStatus = useCallback(async () => {
    if (!documentId) return;
    try {
      const data = await inferenceService.getWritePathStatus(documentId);
      if (mountedRef.current) dispatch({ type: 'SET_WP_STATUS', payload: data });
    } catch {
      // Silent
    }
  }, [documentId]);

  // ── Auto-fetch on mount / documentId change ────────────────────────────

  useEffect(() => {
    if (autoFetchTree && documentId) {
      fetchTree();
      fetchStale();
      fetchWritePathStatus();
    }
    return () => dispatch({ type: 'RESET' });
  }, [documentId, autoFetchTree, fetchTree, fetchStale, fetchWritePathStatus]);

  // ── Optional stale polling ──────────────────────────────────────────────

  useEffect(() => {
    if (!pollStaleMs || !documentId) return;
    const interval = setInterval(fetchStale, pollStaleMs);
    return () => clearInterval(interval);
  }, [pollStaleMs, documentId, fetchStale]);

  // ── Run full LLM inference ──────────────────────────────────────────────

  const runInference = useCallback(async (opts = {}) => {
    if (!documentId) return null;
    dispatch({ type: 'INFERRING' });
    try {
      const result = await inferenceService.inferDocument(documentId, opts);
      if (mountedRef.current) {
        dispatch({ type: 'INFER_DONE' });
        // Refresh tree + stale after inference
        fetchTree();
        fetchStale();
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        dispatch({ type: 'ERROR', payload: err.response?.data?.message || err.message });
      }
      return null;
    }
  }, [documentId, fetchTree, fetchStale]);

  // ── Run write-path ──────────────────────────────────────────────────────

  const runWritePath = useCallback(async (asyncMode = 'sync') => {
    if (!documentId) return null;
    dispatch({ type: 'WRITING_PATH' });
    try {
      const result = await inferenceService.runWritePathDocument(documentId, asyncMode);
      if (mountedRef.current) {
        dispatch({ type: 'WRITE_PATH_DONE' });
        fetchWritePathStatus();
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        dispatch({ type: 'ERROR', payload: err.response?.data?.message || err.message });
      }
      return null;
    }
  }, [documentId, fetchWritePathStatus]);

  // ── Full refresh (inference + write-path) ───────────────────────────────

  const fullRefresh = useCallback(async (opts = {}) => {
    if (!documentId) return null;
    dispatch({ type: 'INFERRING' });
    try {
      const result = await inferenceService.fullRefresh(documentId, opts);
      if (mountedRef.current) {
        dispatch({ type: 'INFER_DONE' });
        fetchTree();
        fetchStale();
        fetchWritePathStatus();
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        dispatch({ type: 'ERROR', payload: err.response?.data?.message || err.message });
      }
      return null;
    }
  }, [documentId, fetchTree, fetchStale, fetchWritePathStatus]);

  // ── Infer single section ────────────────────────────────────────────────

  const runSectionInference = useCallback(async (sectionId, opts = {}) => {
    try {
      const result = await inferenceService.inferSection(sectionId, opts);
      // Refresh tree silently
      fetchTree();
      return result;
    } catch (err) {
      if (mountedRef.current) {
        dispatch({ type: 'ERROR', payload: err.response?.data?.message || err.message });
      }
      return null;
    }
  }, [fetchTree]);

  // ── Infer single component ──────────────────────────────────────────────

  const runComponentInference = useCallback(async (componentType, componentId, opts = {}) => {
    try {
      return await inferenceService.inferComponent(componentType, componentId, opts);
    } catch (err) {
      if (mountedRef.current) {
        dispatch({ type: 'ERROR', payload: err.response?.data?.message || err.message });
      }
      return null;
    }
  }, []);

  // ── Get lateral edges (cached per component) ───────────────────────────

  const getLateralEdgesFor = useCallback(async (componentType, componentId) => {
    const key = `${componentType}:${componentId}`;
    if (state.lateralEdgesCache[key]) {
      return state.lateralEdgesCache[key];
    }
    try {
      const data = await inferenceService.getLateralEdges(componentType, componentId);
      if (mountedRef.current) {
        dispatch({ type: 'SET_LATERAL', key, payload: data });
      }
      return data;
    } catch {
      return null;
    }
  }, [state.lateralEdgesCache]);

  // ── Derived data from tree ──────────────────────────────────────────────

  /** Flat map: sectionId → aggregate inference */
  const sectionInferenceMap = useMemo(() => {
    if (!state.tree?.tree) return {};
    const map = {};
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.aggregate) {
          map[node.section_id] = node.aggregate;
        }
        if (node.children) walk(node.children);
      }
    };
    walk(state.tree.tree);
    return map;
  }, [state.tree]);

  /** Flat map: componentId → component inference */
  const componentInferenceMap = useMemo(() => {
    if (!state.tree?.tree) return {};
    const map = {};
    const walk = (nodes) => {
      for (const node of nodes) {
        for (const ci of (node.components || [])) {
          if (ci.component_id) {
            map[ci.component_id] = ci;
          }
        }
        if (node.children) walk(node.children);
      }
    };
    walk(state.tree.tree);
    return map;
  }, [state.tree]);

  /** Stale component IDs set (for quick lookup) */
  const staleComponentIds = useMemo(() => {
    if (!state.stale?.stale_components) return new Set();
    return new Set(state.stale.stale_components.map((s) => s.component_id));
  }, [state.stale]);

  /** Quick getters */
  const getSectionInference = useCallback(
    (sectionId) => sectionInferenceMap[sectionId] || null,
    [sectionInferenceMap],
  );

  const getComponentInference = useCallback(
    (componentId) => componentInferenceMap[componentId] || null,
    [componentInferenceMap],
  );

  const isComponentStale = useCallback(
    (componentId) => staleComponentIds.has(componentId),
    [staleComponentIds],
  );

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalComponents = Object.keys(componentInferenceMap).length;
    const totalSections = Object.keys(sectionInferenceMap).length;
    const totalStale = state.stale?.total_stale || 0;
    const hasDocumentSummary = !!state.tree?.document_summary;
    return { totalComponents, totalSections, totalStale, hasDocumentSummary };
  }, [componentInferenceMap, sectionInferenceMap, state.stale, state.tree]);

  return {
    // State
    tree: state.tree,
    stale: state.stale,
    writePathStatus: state.writePathStatus,
    loading: state.loading,
    inferring: state.inferring,
    writingPath: state.writingPath,
    error: state.error,
    stats,

    // Maps (for direct lookup by ID)
    sectionInferenceMap,
    componentInferenceMap,
    staleComponentIds,

    // Getters
    getSectionInference,
    getComponentInference,
    isComponentStale,
    getLateralEdgesFor,

    // Actions
    fetchTree,
    fetchStale,
    fetchWritePathStatus,
    runInference,
    runWritePath,
    fullRefresh,
    runSectionInference,
    runComponentInference,
  };
}
