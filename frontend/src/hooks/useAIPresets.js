/**
 * useAIPresets – React hook for document-type AI preset management.
 *
 * Provides CRUD operations for org-level AI presets, plus factory
 * defaults and available services list.
 *
 * Usage:
 *   const { presets, defaults, loading, createPreset, updatePreset, deletePreset } =
 *     useAIPresets();
 */

import { useCallback, useEffect, useReducer } from 'react';
import aiConfigService from '../services/aiConfigService';

// ── Reducer ──────────────────────────────────────────────────────────────────

const initialState = {
  presets: [],
  defaults: null,       // { default_services_config, available_services }
  selectedPreset: null,
  loading: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: true, error: null };
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'SET_PRESETS':
      return { ...state, loading: false, presets: action.payload };
    case 'SET_DEFAULTS':
      return { ...state, defaults: action.payload };
    case 'SET_SELECTED':
      return { ...state, selectedPreset: action.payload };
    case 'ADD_PRESET':
      return { ...state, loading: false, presets: [action.payload, ...state.presets] };
    case 'UPDATE_PRESET':
      return {
        ...state,
        loading: false,
        presets: state.presets.map((p) =>
          p.id === action.payload.id ? action.payload : p
        ),
        selectedPreset:
          state.selectedPreset?.id === action.payload.id
            ? action.payload
            : state.selectedPreset,
      };
    case 'REMOVE_PRESET':
      return {
        ...state,
        loading: false,
        presets: state.presets.filter((p) => p.id !== action.payload),
        selectedPreset:
          state.selectedPreset?.id === action.payload ? null : state.selectedPreset,
      };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useAIPresets() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // ── Fetch all presets ────────────────────────────────────────────────

  const fetchPresets = useCallback(async () => {
    dispatch({ type: 'SET_LOADING' });
    try {
      const data = await aiConfigService.getPresets();
      dispatch({ type: 'SET_PRESETS', payload: Array.isArray(data) ? data : data.results || [] });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.response?.data?.error || err.message || 'Failed to load presets',
      });
    }
  }, []);

  // ── Fetch factory defaults ───────────────────────────────────────────

  const fetchDefaults = useCallback(async () => {
    try {
      const data = await aiConfigService.getFactoryDefaults();
      dispatch({ type: 'SET_DEFAULTS', payload: data });
    } catch {
      // Silent fail — UI still works without defaults
    }
  }, []);

  // ── Get preset by document type ──────────────────────────────────────

  const getPresetByType = useCallback(async (documentType) => {
    try {
      return await aiConfigService.getPresetByType(documentType);
    } catch (err) {
      return null;
    }
  }, []);

  // ── Create preset ───────────────────────────────────────────────────

  const createPreset = useCallback(async (data) => {
    dispatch({ type: 'SET_LOADING' });
    try {
      const result = await aiConfigService.createPreset(data);
      dispatch({ type: 'ADD_PRESET', payload: result });
      return result;
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.response?.data?.error || err.message || 'Failed to create preset',
      });
      throw err;
    }
  }, []);

  // ── Update preset ───────────────────────────────────────────────────

  const updatePreset = useCallback(async (id, data) => {
    dispatch({ type: 'SET_LOADING' });
    try {
      const result = await aiConfigService.updatePreset(id, data);
      dispatch({ type: 'UPDATE_PRESET', payload: result });
      return result;
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.response?.data?.error || err.message || 'Failed to update preset',
      });
      throw err;
    }
  }, []);

  // ── Delete preset ───────────────────────────────────────────────────

  const deletePreset = useCallback(async (id) => {
    dispatch({ type: 'SET_LOADING' });
    try {
      await aiConfigService.deletePreset(id);
      dispatch({ type: 'REMOVE_PRESET', payload: id });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.response?.data?.error || err.message || 'Failed to delete preset',
      });
      throw err;
    }
  }, []);

  // ── Select preset ───────────────────────────────────────────────────

  const selectPreset = useCallback((preset) => {
    dispatch({ type: 'SET_SELECTED', payload: preset });
  }, []);

  // ── Auto-fetch on mount ─────────────────────────────────────────────

  useEffect(() => {
    fetchPresets();
    fetchDefaults();
  }, [fetchPresets, fetchDefaults]);

  return {
    presets: state.presets,
    defaults: state.defaults,
    selectedPreset: state.selectedPreset,
    loading: state.loading,
    error: state.error,
    fetchPresets,
    fetchDefaults,
    getPresetByType,
    createPreset,
    updatePreset,
    deletePreset,
    selectPreset,
  };
}
