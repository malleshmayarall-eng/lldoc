/**
 * useMasterDocuments – React hook for master document state management.
 *
 * Provides loading, searching, CRUD, branching, and AI-generation
 * functions with built-in loading/error states.
 */

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import masterService from '../services/masterService';

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState = {
  masters: [],
  selectedMaster: null,
  branches: [],
  loading: false,
  error: null,
  searchQuery: '',
  filters: { category: '', document_type: '', tags: '', ordering: '-updated_at' },
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload, error: null };
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'SET_MASTERS':
      return { ...state, loading: false, masters: action.payload };
    case 'SET_SELECTED_MASTER':
      return { ...state, loading: false, selectedMaster: action.payload };
    case 'SET_BRANCHES':
      return { ...state, loading: false, branches: action.payload };
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.payload };
    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case 'ADD_MASTER':
      return { ...state, loading: false, masters: [action.payload, ...state.masters] };
    case 'UPDATE_MASTER':
      return {
        ...state,
        loading: false,
        masters: state.masters.map((m) =>
          m.id === action.payload.id ? action.payload : m
        ),
        selectedMaster:
          state.selectedMaster?.id === action.payload.id
            ? action.payload
            : state.selectedMaster,
      };
    case 'REMOVE_MASTER':
      return {
        ...state,
        masters: state.masters.filter((m) => m.id !== action.payload),
        selectedMaster:
          state.selectedMaster?.id === action.payload ? null : state.selectedMaster,
      };
    case 'ADD_BRANCH':
      return { ...state, loading: false, branches: [action.payload, ...state.branches] };
    case 'REMOVE_BRANCH':
      return {
        ...state,
        branches: state.branches.filter((b) => b.id !== action.payload),
      };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMasterDocuments() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // ── Fetch helpers ────────────────────────────────────────────────────

  const fetchMasters = useCallback(async (searchParams = {}) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await masterService.searchMasters(searchParams);
      dispatch({ type: 'SET_MASTERS', payload: Array.isArray(data) ? data : data.results || [] });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
    }
  }, []);

  const fetchMaster = useCallback(async (id) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await masterService.getMaster(id);
      dispatch({ type: 'SET_SELECTED_MASTER', payload: data });
      return data;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  const fetchBranches = useCallback(async (params = {}) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await masterService.getBranches(params);
      dispatch({ type: 'SET_BRANCHES', payload: Array.isArray(data) ? data : data.results || [] });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
    }
  }, []);

  // ── CRUD ─────────────────────────────────────────────────────────────

  const createMaster = useCallback(async (data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.createMaster(data);
      dispatch({ type: 'ADD_MASTER', payload: result });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  const updateMaster = useCallback(async (id, data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.updateMaster(id, data);
      dispatch({ type: 'UPDATE_MASTER', payload: result });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  const deleteMaster = useCallback(async (id) => {
    try {
      await masterService.deleteMaster(id);
      dispatch({ type: 'REMOVE_MASTER', payload: id });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  // ── Branching ────────────────────────────────────────────────────────

  const createBranch = useCallback(async (masterId, data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.createBranch(masterId, data);
      dispatch({ type: 'ADD_BRANCH', payload: result });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  const deleteBranch = useCallback(async (id, keepDocument = false) => {
    try {
      await masterService.deleteBranch(id, keepDocument);
      dispatch({ type: 'REMOVE_BRANCH', payload: id });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  // ── AI ───────────────────────────────────────────────────────────────

  const aiGenerateMaster = useCallback(async (data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.aiGenerateMaster(data);
      dispatch({ type: 'ADD_MASTER', payload: result });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  const aiGenerateBranchContent = useCallback(async (branchId, data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.aiGenerateBranchContent(branchId, data);
      dispatch({ type: 'SET_LOADING', payload: false });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  // ── Duplication ──────────────────────────────────────────────────────

  const duplicateDocument = useCallback(async (data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.duplicateDocument(data);
      dispatch({ type: 'SET_LOADING', payload: false });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  const promoteToMaster = useCallback(async (data) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await masterService.promoteToMaster(data);
      dispatch({ type: 'ADD_MASTER', payload: result });
      return result;
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      throw err;
    }
  }, []);

  // ── Search helpers ───────────────────────────────────────────────────

  const setSearch = useCallback((q) => dispatch({ type: 'SET_SEARCH', payload: q }), []);
  const setFilters = useCallback((f) => dispatch({ type: 'SET_FILTERS', payload: f }), []);

  const searchParams = useMemo(() => {
    const p = { ...state.filters };
    if (state.searchQuery) p.q = state.searchQuery;
    // Remove empty values
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== ''));
  }, [state.searchQuery, state.filters]);

  // Auto-fetch when search params change
  useEffect(() => {
    fetchMasters(searchParams);
  }, [searchParams, fetchMasters]);

  return {
    ...state,
    fetchMasters,
    fetchMaster,
    fetchBranches,
    createMaster,
    updateMaster,
    deleteMaster,
    createBranch,
    deleteBranch,
    aiGenerateMaster,
    aiGenerateBranchContent,
    duplicateDocument,
    promoteToMaster,
    setSearch,
    setFilters,
  };
}

export default useMasterDocuments;
