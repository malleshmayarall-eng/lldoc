/**
 * AI Configuration Service
 *
 * API layer for document-type AI presets and per-document AI config.
 * Uses API_ENDPOINTS constants — never hardcoded paths.
 */

import api from './api';
import { API_ENDPOINTS } from '@constants/api';

const aiConfigService = {
  // ── Document-Type AI Presets (Org-Level) ───────────────────────────────

  /** List all AI presets */
  getPresets: async (params = {}) => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.PRESETS.BASE, { params });
    return response.data;
  },

  /** Get a single preset */
  getPreset: async (id) => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.PRESETS.BY_ID(id));
    return response.data;
  },

  /** Create a new preset */
  createPreset: async (data) => {
    const response = await api.post(API_ENDPOINTS.AI_CONFIG.PRESETS.BASE, data);
    return response.data;
  },

  /** Update a preset */
  updatePreset: async (id, data) => {
    const response = await api.patch(API_ENDPOINTS.AI_CONFIG.PRESETS.BY_ID(id), data);
    return response.data;
  },

  /** Delete a preset */
  deletePreset: async (id) => {
    const response = await api.delete(API_ENDPOINTS.AI_CONFIG.PRESETS.BY_ID(id));
    return response.data;
  },

  /** Get preset by document type */
  getPresetByType: async (documentType) => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.PRESETS.BY_TYPE, {
      params: { document_type: documentType },
    });
    return response.data;
  },

  /** Get factory defaults + available services list */
  getFactoryDefaults: async () => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.PRESETS.DEFAULTS);
    return response.data;
  },

  // ── Per-Document AI Config ────────────────────────────────────────────

  /** Get AI config for a document (auto-creates if missing) */
  getDocumentConfig: async (documentId) => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.DOCUMENT.CONFIG(documentId));
    return response.data;
  },

  /** Update per-document AI config (deep-merged) */
  updateDocumentConfig: async (documentId, data) => {
    const response = await api.patch(API_ENDPOINTS.AI_CONFIG.DOCUMENT.UPDATE(documentId), data);
    return response.data;
  },

  /** Toggle a single AI service on/off */
  toggleService: async (documentId, service, enabled) => {
    const response = await api.post(API_ENDPOINTS.AI_CONFIG.DOCUMENT.TOGGLE(documentId), {
      service,
      enabled,
    });
    return response.data;
  },

  /** Bulk toggle multiple AI services */
  bulkToggle: async (documentId, toggles) => {
    const response = await api.post(API_ENDPOINTS.AI_CONFIG.DOCUMENT.BULK_TOGGLE(documentId), {
      toggles,
    });
    return response.data;
  },

  /** Reset per-document config to defaults */
  resetDocumentConfig: async (documentId) => {
    const response = await api.post(API_ENDPOINTS.AI_CONFIG.DOCUMENT.RESET(documentId));
    return response.data;
  },

  /** Get lightweight service status (for sidebar) */
  getServiceStatus: async (documentId) => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.DOCUMENT.STATUS(documentId));
    return response.data;
  },

  /** Set document type and apply matching AI preset */
  setDocumentType: async (documentId, documentType) => {
    const response = await api.post(API_ENDPOINTS.AI_CONFIG.DOCUMENT.SET_TYPE(documentId), {
      document_type: documentType,
    });
    return response.data;
  },

  /** Get list of known document types (presets + in-use + common) */
  getDocumentTypes: async () => {
    const response = await api.get(API_ENDPOINTS.AI_CONFIG.DOCUMENT_TYPES);
    return response.data;
  },
};

export default aiConfigService;
