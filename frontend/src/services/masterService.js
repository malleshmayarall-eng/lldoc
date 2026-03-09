/**
 * Master Documents, Branching & Duplication Service
 *
 * API layer for the master document / branching / duplication system.
 * All paths use API_ENDPOINTS constants — never hardcoded.
 */

import api from './api';
import { API_ENDPOINTS } from '@constants/api';

export const masterService = {
  // ── Master Documents ───────────────────────────────────────────────────

  /** List accessible master documents */
  getMasters: async (params = {}) => {
    const response = await api.get(API_ENDPOINTS.MASTERS.BASE, { params });
    return response.data;
  },

  /** Get a single master document (detail with recent branches) */
  getMaster: async (id) => {
    const response = await api.get(API_ENDPOINTS.MASTERS.BY_ID(id));
    return response.data;
  },

  /** Create a new master document */
  createMaster: async (data) => {
    const response = await api.post(API_ENDPOINTS.MASTERS.BASE, data);
    return response.data;
  },

  /** Update a master document */
  updateMaster: async (id, data) => {
    const response = await api.patch(API_ENDPOINTS.MASTERS.BY_ID(id), data);
    return response.data;
  },

  /** Delete a master document */
  deleteMaster: async (id) => {
    const response = await api.delete(API_ENDPOINTS.MASTERS.BY_ID(id));
    return response.data;
  },

  /**
   * Search master documents.
   * @param {{ q?, category?, document_type?, tags?, ordering? }} params
   */
  searchMasters: async (params = {}) => {
    const response = await api.get(API_ENDPOINTS.MASTERS.SEARCH, { params });
    return response.data;
  },

  /**
   * Create a branch from a master document.
   * @param {string} masterId
   * @param {{ branch_name, title_override?, metadata_overrides?, style_overrides?, ... }} data
   */
  createBranch: async (masterId, data) => {
    const response = await api.post(API_ENDPOINTS.MASTERS.BRANCH(masterId), data);
    return response.data;
  },

  /**
   * AI-generate a new master document from a prompt or raw text.
   * @param {{ prompt?, raw_text?, name?, category?, ... }} data
   */
  aiGenerateMaster: async (data) => {
    const response = await api.post(API_ENDPOINTS.MASTERS.AI_GENERATE, data);
    return response.data;
  },

  /**
   * Promote an existing document to a master document (via masters endpoint).
   * @param {{ document_id, name?, category?, tags? }} data
   */
  promoteToMaster: async (data) => {
    const response = await api.post(API_ENDPOINTS.MASTERS.PROMOTE, data);
    return response.data;
  },

  /**
   * Promote an existing document (via document action shortcut).
   * @param {string} documentId
   * @param {{ name?, category?, tags? }} data
   */
  promoteDocumentToMaster: async (documentId, data = {}) => {
    const response = await api.post(API_ENDPOINTS.DUPLICATE.PROMOTE_ACTION(documentId), data);
    return response.data;
  },

  // ── Branches ───────────────────────────────────────────────────────────

  /** List branches (optionally filtered by master, type, status) */
  getBranches: async (params = {}) => {
    const response = await api.get(API_ENDPOINTS.BRANCHES.BASE, { params });
    return response.data;
  },

  /** Get a single branch detail (includes full document data) */
  getBranch: async (id) => {
    const response = await api.get(API_ENDPOINTS.BRANCHES.BY_ID(id));
    return response.data;
  },

  /** Update a branch (name, notes, status) */
  updateBranch: async (id, data) => {
    const response = await api.patch(API_ENDPOINTS.BRANCHES.BY_ID(id), data);
    return response.data;
  },

  /** Delete a branch (and its document by default) */
  deleteBranch: async (id, keepDocument = false) => {
    const params = keepDocument ? { keep_document: 'true' } : {};
    const response = await api.delete(API_ENDPOINTS.BRANCHES.BY_ID(id), { params });
    return response.data;
  },

  /**
   * AI-generate or modify content on a branch's document.
   * @param {string} branchId
   * @param {{ prompt, merge_strategy? }} data
   */
  aiGenerateBranchContent: async (branchId, data) => {
    const response = await api.post(API_ENDPOINTS.BRANCHES.AI_CONTENT(branchId), data);
    return response.data;
  },

  /** Duplicate a branch (creates new branch + document) */
  duplicateBranch: async (branchId, data = {}) => {
    const response = await api.post(API_ENDPOINTS.BRANCHES.DUPLICATE(branchId), data);
    return response.data;
  },

  // ── Document Duplication ───────────────────────────────────────────────

  /**
   * Duplicate any document (standalone endpoint).
   * @param {{ source_document, title?, metadata_overrides?, include_structure? }} data
   */
  duplicateDocument: async (data) => {
    const response = await api.post(API_ENDPOINTS.DUPLICATE.BASE, data);
    return response.data;
  },

  /**
   * Duplicate a document via the document action shortcut.
   * @param {string} documentId
   * @param {{ title?, metadata_overrides? }} data
   */
  duplicateDocumentAction: async (documentId, data = {}) => {
    const response = await api.post(API_ENDPOINTS.DUPLICATE.DOCUMENT_ACTION(documentId), data);
    return response.data;
  },
};

export default masterService;
