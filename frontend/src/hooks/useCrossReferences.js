/**
 * useCrossReferences — Hook managing cross-reference (lateral edge) visualization.
 *
 * State:
 *   enabled      — whether cross-ref overlay is active
 *   sourceId     — UUID of the selected source component
 *   sourceType   — component type of the source
 *   edges        — lateral edges from source → targets
 *
 * Actions:
 *   toggle()             — enable/disable cross-ref mode
 *   selectSource(id, type) — pick a component; fetches its lateral edges
 *   clearSource()        — deselect
 *
 * Also exposes a document-level edge summary (total counts by type).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import inferenceService from '../services/inferenceService';

// ── Reducer ──────────────────────────────────────────────────────────

const initialState = {
  enabled: false,
  sourceId: null,
  sourceType: null,
  edges: [],
  loading: false,
  allEdges: null, // document-level edge list (lazy-loaded)
};

function reducer(state, action) {
  switch (action.type) {
    case 'TOGGLE':
      return {
        ...state,
        enabled: !state.enabled,
        // Clear selection when toggling off
        ...(!state.enabled ? {} : { sourceId: null, sourceType: null, edges: [] }),
      };
    case 'ENABLE':
      return { ...state, enabled: true };
    case 'DISABLE':
      return { ...state, enabled: false, sourceId: null, sourceType: null, edges: [] };
    case 'SELECT_SOURCE':
      return { ...state, sourceId: action.id, sourceType: action.componentType, loading: true };
    case 'SET_EDGES':
      return { ...state, edges: action.payload, loading: false };
    case 'CLEAR_SOURCE':
      return { ...state, sourceId: null, sourceType: null, edges: [] };
    case 'SET_ALL_EDGES':
      return { ...state, allEdges: action.payload };
    case 'LOADING':
      return { ...state, loading: true };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────

export default function useCrossReferences(documentId) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const mountedRef = useRef(true);
  // Keep a ref to sourceId so selectSource never has a stale closure
  const sourceIdRef = useRef(state.sourceId);
  sourceIdRef.current = state.sourceId;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Reset when document changes
  useEffect(() => {
    dispatch({ type: 'DISABLE' });
  }, [documentId]);

  // ── Toggle ──────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    dispatch({ type: 'TOGGLE' });
  }, []);

  const enable = useCallback(() => dispatch({ type: 'ENABLE' }), []);
  const disable = useCallback(() => dispatch({ type: 'DISABLE' }), []);

  // ── Select source — fetches lateral edges ────────────────────────────

  const selectSource = useCallback(async (componentId, componentType) => {
    if (!componentId || !componentType) return;

    // Toggle off if clicking same source (use ref to avoid stale closure)
    if (sourceIdRef.current === componentId) {
      dispatch({ type: 'CLEAR_SOURCE' });
      return;
    }

    console.debug('[CrossRef] selectSource', componentType, componentId);
    dispatch({ type: 'SELECT_SOURCE', id: componentId, componentType });

    try {
      const data = await inferenceService.getLateralEdges(componentType, componentId);
      console.debug('[CrossRef] edges received:', data?.edges?.length || 0, data);
      if (mountedRef.current) {
        dispatch({ type: 'SET_EDGES', payload: data?.edges || [] });
      }
    } catch (err) {
      console.warn('[CrossRef] getLateralEdges failed:', err);
      if (mountedRef.current) {
        dispatch({ type: 'SET_EDGES', payload: [] });
      }
    }
  }, []); // stable — uses refs, no state deps

  // ── Clear source ────────────────────────────────────────────────────

  const clearSource = useCallback(() => {
    dispatch({ type: 'CLEAR_SOURCE' });
  }, []);

  // ── Lazy-load all document edges (for count badges) ──────────────────

  const fetchAllEdges = useCallback(async () => {
    if (!documentId || state.allEdges) return;
    try {
      const data = await inferenceService.getDocumentLateralEdges(documentId);
      if (mountedRef.current) {
        dispatch({ type: 'SET_ALL_EDGES', payload: data?.edges || [] });
      }
    } catch {
      // Silent
    }
  }, [documentId, state.allEdges]);

  // Auto-fetch all edges when enabled (for counts)
  useEffect(() => {
    if (state.enabled && !state.allEdges) {
      fetchAllEdges();
    }
  }, [state.enabled, state.allEdges, fetchAllEdges]);

  // ── Derived: edge count per component ────────────────────────────────

  const edgeCountMap = useMemo(() => {
    if (!state.allEdges) return {};
    const counts = {};
    for (const edge of state.allEdges) {
      const srcKey = edge.source_id || edge.component_id;
      if (srcKey) {
        counts[srcKey] = (counts[srcKey] || 0) + 1;
      }
    }
    return counts;
  }, [state.allEdges]);

  // ── Derived: summary stats ───────────────────────────────────────────

  const stats = useMemo(() => {
    const all = state.allEdges || [];
    return {
      total: all.length,
      critical: all.filter((e) => e.edge_type === 'critical').length,
      contextual: all.filter((e) => e.edge_type === 'contextual').length,
    };
  }, [state.allEdges]);

  return {
    // State
    enabled: state.enabled,
    sourceId: state.sourceId,
    sourceType: state.sourceType,
    edges: state.edges,
    loading: state.loading,
    allEdges: state.allEdges,
    edgeCountMap,
    stats,

    // Actions
    toggle,
    enable,
    disable,
    selectSource,
    clearSource,
    fetchAllEdges,
  };
}
