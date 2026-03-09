/**
 * Quick LaTeX Document Service
 *
 * API layer for the Quick LaTeX document workflow.
 * Quick LaTeX docs are lightweight, single-LatexCode-block documents
 * optimised for AI generation, metadata placeholders, and duplication.
 */

import api from './api';
import { API_ENDPOINTS } from '@constants/api';

const quickLatexService = {
  // ── CRUD ───────────────────────────────────────────────────────────────

  /** List all quick-latex documents for the current user */
  list: async (params = {}) => {
    const response = await api.get(API_ENDPOINTS.QUICK_LATEX.BASE, { params });
    return response.data;
  },

  /** Get a single quick-latex document by ID */
  get: async (id) => {
    const response = await api.get(API_ENDPOINTS.QUICK_LATEX.BY_ID(id));
    return response.data;
  },

  /**
   * Create a new quick-latex document.
   * @param {{ title, latex_code?, document_type?, document_metadata?, parties?, source_document_id?, metadata_overrides? }} data
   */
  create: async (data) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.BASE, data);
    return response.data;
  },

  /**
   * Update a quick-latex document (PATCH).
   * Can update metadata AND latex_code in one call.
   * @param {string} id - Document UUID
   * @param {Object} data - Fields to update
   */
  update: async (id, data) => {
    const response = await api.patch(API_ENDPOINTS.QUICK_LATEX.BY_ID(id), data);
    return response.data;
  },

  /** Delete a quick-latex document */
  delete: async (id) => {
    await api.delete(API_ENDPOINTS.QUICK_LATEX.BY_ID(id));
  },

  // ── Duplicate ──────────────────────────────────────────────────────────

  /**
   * Duplicate a quick-latex document with metadata overrides.
   * @param {string} id - Source document UUID
   * @param {{ title?, metadata_overrides?, custom_metadata_overrides?, parties_override? }} data
   */
  duplicate: async (id, data = {}) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.DUPLICATE(id), data);
    return response.data;
  },

  /**
   * Bulk-duplicate a quick-latex document (repository pattern).
   * @param {string} id - Source document UUID
   * @param {Array<{ title, metadata_overrides?, custom_metadata_overrides?, parties_override? }>} copies
   */
  bulkDuplicate: async (id, copies) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.BULK_DUPLICATE(id), { copies });
    return response.data;
  },

  // ── AI ─────────────────────────────────────────────────────────────────

  /**
   * Preview-only AI generation — returns LaTeX/HTML code without
   * creating or modifying any document. Used in the create-dialog so
   * the user can review the output before accepting.
   * @param {{ prompt: string, title?: string, document_type?: string, code_type?: 'latex'|'html' }} data
   * @returns {{ status, latex_code, code_type }}
   */
  aiPreview: async (data) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.AI_PREVIEW, data);
    return response.data;
  },

  /**
   * Generate / regenerate LaTeX code using AI.
   * @param {string} id - Document UUID
   * @param {{ prompt, preamble?, replace? }} data
   */
  aiGenerate: async (id, data) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.AI_GENERATE(id), data);
    return response.data;
  },

  // ── Placeholders ───────────────────────────────────────────────────────

  /**
   * Get all [[placeholder]] keys and their current values.
   * @param {string} id - Document UUID
   */
  getPlaceholders: async (id) => {
    const response = await api.get(API_ENDPOINTS.QUICK_LATEX.PLACEHOLDERS(id));
    return response.data;
  },

  // ── Metadata ───────────────────────────────────────────────────────────

  /**
   * Update only document_metadata (deep-merged).
   * @param {string} id - Document UUID
   * @param {Object} metadata - Key-value pairs to merge
   */
  updateMetadata: async (id, metadata) => {
    const response = await api.patch(API_ENDPOINTS.QUICK_LATEX.METADATA(id), metadata);
    return response.data;
  },

  // ── Rendered LaTeX ─────────────────────────────────────────────────────

  /**
   * Get the LaTeX code with all [[placeholders]] resolved from metadata.
   * @param {string} id - Document UUID
   */
  getRenderedLatex: async (id) => {
    const response = await api.get(API_ENDPOINTS.QUICK_LATEX.RENDERED_LATEX(id));
    return response.data;
  },

  // ── Create from source ─────────────────────────────────────────────────

  /**
   * Convert any existing document into a Quick LaTeX document.
   * @param {{ source_document_id, title?, metadata_overrides? }} data
   */
  fromSource: async (data) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.FROM_SOURCE, data);
    return response.data;
  },

  // ── Preview (render LaTeX → PNG / PDF) ──────────────────────────────────

  /**
   * Render LaTeX code to a PNG image and PDF via the document render pipeline.
   * @param {string} documentId - Document UUID
   * @param {{ latex_code, preamble?, metadata? }} payload
   * @returns {{ preview_png_base64?, pdf_base64?, error? }}
   */
  renderPreview: async (documentId, payload = {}) => {
    const response = await api.post(`/documents/${documentId}/latex/render/`, payload);
    return response.data;
  },

  /**
   * Render HTML code to a PNG image and PDF via xhtml2pdf.
   * @param {string} documentId - Document UUID
   * @param {{ html_code?, metadata? }} payload
   * @returns {{ preview_png_base64?, pdf_base64?, error? }}
   */
  renderHtmlPreview: async (documentId, payload = {}) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.RENDER_HTML(documentId), payload);
    return response.data;
  },

  // ── Code type switch ───────────────────────────────────────────────────

  /**
   * Switch between LaTeX and HTML code type, optionally converting via AI.
   * @param {string} id - Document UUID
   * @param {{ code_type: 'latex'|'html', convert?: boolean }} data
   */
  switchCodeType: async (id, data) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.SWITCH_CODE_TYPE(id), data);
    return response.data;
  },

  // ── Save PDF ───────────────────────────────────────────────────────────

  /**
   * Save a rendered PDF to the server.
   * @param {string} id - Document UUID
   * @param {{ pdf_base64: string, filename?: string }} data
   */
  savePdf: async (id, data) => {
    const response = await api.post(`${API_ENDPOINTS.QUICK_LATEX.BY_ID(id)}save-pdf/`, data);
    return response.data;
  },

  // ── Chat History ───────────────────────────────────────────────────

  /**
   * Load persisted AI chat messages for a document.
   * @param {string} id - Document UUID
   * @returns {{ messages: Array }}
   */
  loadChatHistory: async (id) => {
    const response = await api.get(API_ENDPOINTS.QUICK_LATEX.CHAT_HISTORY(id));
    return response.data;
  },

  /**
   * Save AI chat messages to the server.
   * @param {string} id - Document UUID
   * @param {Array} messages - Full chat messages array
   */
  saveChatHistory: async (id, messages) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.CHAT_HISTORY(id), { messages });
    return response.data;
  },

  /**
   * Delete / clear all AI chat messages for a document.
   * @param {string} id - Document UUID
   */
  deleteChatHistory: async (id) => {
    const response = await api.delete(API_ENDPOINTS.QUICK_LATEX.CHAT_HISTORY(id));
    return response.data;
  },

  // ── Image Placeholders ─────────────────────────────────────────────────

  /**
   * List images available for use in [[image:UUID]] placeholders.
   * @param {string} id - Document UUID
   * @param {{ search?: string, type?: string, include_public?: boolean }} params
   * @returns {{ images: Array, count: number }}
   */
  getImages: async (id, params = {}) => {
    const response = await api.get(API_ENDPOINTS.QUICK_LATEX.IMAGES(id), { params });
    return response.data;
  },

  /**
   * Upload an image and get back the [[image:UUID]] placeholder string.
   * @param {string} id - Document UUID
   * @param {File} file - Image file
   * @param {{ name?: string, image_type?: string, caption?: string }} meta
   * @returns {{ status, image: { id, url, placeholder, ... } }}
   */
  uploadImage: async (id, file, meta = {}) => {
    const formData = new FormData();
    formData.append('image', file);
    if (meta.name) formData.append('name', meta.name);
    formData.append('image_type', meta.image_type || 'picture');
    if (meta.caption) formData.append('caption', meta.caption);

    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.UPLOAD_IMAGE(id), formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Resolve [[image:UUID]] placeholders to actual image URLs.
   * @param {string} id - Document UUID
   * @param {string[]} [imageIds] - Specific UUIDs (auto-detect if omitted)
   * @returns {{ images: Record<string, { url, thumbnail_url, ... }>, count: number }}
   */
  resolveImages: async (id, imageIds = null) => {
    const body = imageIds ? { image_ids: imageIds } : {};
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.RESOLVE_IMAGES(id), body);
    return response.data;
  },

  /**
   * Map a named image placeholder to an actual uploaded image.
   * POST /api/documents/quick-latex/<id>/map-image/
   * @param {string} id - Document UUID
   * @param {string} placeholderName - e.g. "company_logo"
   * @param {string|null} imageId - UUID of the image, or null to unmap
   */
  mapImage: async (id, placeholderName, imageId = null) => {
    const response = await api.post(API_ENDPOINTS.QUICK_LATEX.MAP_IMAGE(id), {
      placeholder_name: placeholderName,
      image_id: imageId,
    });
    return response.data;
  },
};

export default quickLatexService;
