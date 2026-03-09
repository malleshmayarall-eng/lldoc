/**
 * useDocumentAIConfig – React hook for per-document AI configuration.
 *
 * Provides loading, toggling, bulk-toggling, updating, and resetting
 * AI service config for a single document. Auto-fetches on mount.
 *
 * Usage:
 *   const { config, loading, error, toggleService, bulkToggle, updateConfig, resetConfig } =
 *     useDocumentAIConfig(documentId);
 */

import { useCallback, useEffect, useReducer } from 'react';
import aiConfigService from '../services/aiConfigService';

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState = {
  config: null,
  status: null,
  loading: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: true, error: null };
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'SET_CONFIG':
      return { ...state, loading: false, config: action.payload, error: null };
    case 'SET_STATUS':
      return { ...state, status: action.payload };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useDocumentAIConfig(documentId) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // ── Fetch full config ────────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    if (!documentId) return;
    dispatch({ type: 'SET_LOADING' });
    try {
      const data = await aiConfigService.getDocumentConfig(documentId);
      dispatch({ type: 'SET_CONFIG', payload: data });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.response?.data?.error || err.message || 'Failed to load AI config',
      });
    }
  }, [documentId]);

  // ── Fetch lightweight status (for sidebar) ───────────────────────────

  const fetchStatus = useCallback(async () => {
    if (!documentId) return;
    try {
      const data = await aiConfigService.getServiceStatus(documentId);
      dispatch({ type: 'SET_STATUS', payload: data });
    } catch {
      // Silent fail for sidebar badge
    }
  }, [documentId]);

  // ── Toggle one service ───────────────────────────────────────────────

  const toggleService = useCallback(
    async (service, enabled) => {
      if (!documentId) return;
      dispatch({ type: 'SET_LOADING' });
      try {
        const data = await aiConfigService.toggleService(documentId, service, enabled);
        dispatch({ type: 'SET_CONFIG', payload: data });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err.response?.data?.error || err.message || 'Failed to toggle service',
        });
      }
    },
    [documentId]
  );

  // ── Bulk toggle ──────────────────────────────────────────────────────

  const bulkToggle = useCallback(
    async (toggles) => {
      if (!documentId) return;
      dispatch({ type: 'SET_LOADING' });
      try {
        const data = await aiConfigService.bulkToggle(documentId, toggles);
        dispatch({ type: 'SET_CONFIG', payload: data });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err.response?.data?.error || err.message || 'Failed to bulk toggle',
        });
      }
    },
    [documentId]
  );

  // ── Update config (deep-merge) ──────────────────────────────────────

  const updateConfig = useCallback(
    async (updates) => {
      if (!documentId) return;
      dispatch({ type: 'SET_LOADING' });
      try {
        const data = await aiConfigService.updateDocumentConfig(documentId, updates);
        dispatch({ type: 'SET_CONFIG', payload: data });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err.response?.data?.error || err.message || 'Failed to update config',
        });
      }
    },
    [documentId]
  );

  // ── Reset to defaults ───────────────────────────────────────────────

  const resetConfig = useCallback(async () => {
    if (!documentId) return;
    dispatch({ type: 'SET_LOADING' });
    try {
      const data = await aiConfigService.resetDocumentConfig(documentId);
      dispatch({ type: 'SET_CONFIG', payload: data });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.response?.data?.error || err.message || 'Failed to reset config',
      });
    }
  }, [documentId]);

  // ── Set document type (applies matching preset) ─────────────────────

  const setDocumentType = useCallback(
    async (documentType) => {
      if (!documentId) return;
      dispatch({ type: 'SET_LOADING' });
      try {
        const data = await aiConfigService.setDocumentType(documentId, documentType);
        dispatch({ type: 'SET_CONFIG', payload: data });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err.response?.data?.error || err.message || 'Failed to set document type',
        });
      }
    },
    [documentId]
  );

  // ── Auto-fetch on mount / documentId change ─────────────────────────

  useEffect(() => {
    if (documentId) {
      fetchConfig();
    } else {
      dispatch({ type: 'RESET' });
    }
  }, [documentId, fetchConfig]);

  return {
    config: state.config,
    status: state.status,
    loading: state.loading,
    error: state.error,
    fetchConfig,
    fetchStatus,
    toggleService,
    bulkToggle,
    updateConfig,
    resetConfig,
    setDocumentType,
  };
}
