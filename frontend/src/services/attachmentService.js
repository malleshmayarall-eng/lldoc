/**
 * Attachment Service
 *
 * API layer for the centralised Attachments library.
 * Handles listing, uploading, filtering and scoped queries
 * for images and documents across user / team / organisation.
 */

import api from './api';
import { API_CONFIG } from '../config/app.config';
import { API_ENDPOINTS } from '@constants/api';

// ── URL helpers ──────────────────────────────────────────────────────────

const fixUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  return `${API_CONFIG.BACKEND_URL}${url.startsWith('/') ? url : '/' + url}`;
};

const fixAttachmentUrls = (item) => {
  if (!item) return item;
  return {
    ...item,
    url: fixUrl(item.url || item.file),
    file: fixUrl(item.file),
    thumbnail_url: fixUrl(item.thumbnail_url || item.thumbnail),
  };
};

// ── Service ──────────────────────────────────────────────────────────────

const attachmentService = {
  /**
   * List all attachments visible to the current user.
   * Supports query params: scope, file_kind, image_type, team, document, search, ordering
   */
  async list(params = {}) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.BASE, { params });
    const data = response.data;

    if (Array.isArray(data)) return data.map(fixAttachmentUrls);
    if (data?.results && Array.isArray(data.results)) {
      return { ...data, results: data.results.map(fixAttachmentUrls) };
    }
    return data;
  },

  /**
   * Get a single attachment by ID.
   */
  async get(id) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.BY_ID(id));
    return fixAttachmentUrls(response.data);
  },

  /**
   * Upload a new attachment.
   * @param {File} file
   * @param {{name?, description?, file_kind?, image_type?, scope?, team?, document?, tags?}} meta
   */
  async upload(file, meta = {}) {
    const formData = new FormData();
    formData.append('file', file);

    if (meta.name) formData.append('name', meta.name);
    if (meta.description) formData.append('description', meta.description);
    if (meta.file_kind) formData.append('file_kind', meta.file_kind);
    if (meta.image_type) formData.append('image_type', meta.image_type);
    if (meta.scope) formData.append('scope', meta.scope);
    if (meta.team) formData.append('team', meta.team);
    if (meta.document) formData.append('document', meta.document);
    if (meta.tags && Array.isArray(meta.tags)) {
      formData.append('tags', JSON.stringify(meta.tags));
    }

    const response = await api.post(API_ENDPOINTS.ATTACHMENTS.UPLOAD || API_ENDPOINTS.ATTACHMENTS.BASE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return fixAttachmentUrls(response.data);
  },

  /**
   * Delete an attachment.
   */
  async delete(id) {
    await api.delete(API_ENDPOINTS.ATTACHMENTS.BY_ID(id));
  },

  /**
   * Get current user's uploads.
   */
  async myUploads(params = {}) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.MY_UPLOADS, { params });
    const data = response.data;
    if (data?.attachments) return { ...data, attachments: data.attachments.map(fixAttachmentUrls) };
    if (Array.isArray(data)) return data.map(fixAttachmentUrls);
    return data;
  },

  /**
   * Get attachments for a specific team.
   */
  async team(teamId, params = {}) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.TEAM(teamId), { params });
    const data = response.data;
    if (data?.attachments) return { ...data, attachments: data.attachments.map(fixAttachmentUrls) };
    if (Array.isArray(data)) return data.map(fixAttachmentUrls);
    return data;
  },

  /**
   * Get organisation-wide attachments.
   */
  async organization(params = {}) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.ORGANIZATION, { params });
    const data = response.data;
    if (data?.attachments) return { ...data, attachments: data.attachments.map(fixAttachmentUrls) };
    if (Array.isArray(data)) return data.map(fixAttachmentUrls);
    return data;
  },

  /**
   * Get images only.
   */
  async images(params = {}) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.IMAGES, { params });
    const data = response.data;
    if (data?.attachments) return { ...data, attachments: data.attachments.map(fixAttachmentUrls) };
    if (Array.isArray(data)) return data.map(fixAttachmentUrls);
    return data;
  },

  /**
   * Get documents only.
   */
  async documents(params = {}) {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.DOCUMENTS, { params });
    const data = response.data;
    if (data?.attachments) return { ...data, attachments: data.attachments.map(fixAttachmentUrls) };
    if (Array.isArray(data)) return data.map(fixAttachmentUrls);
    return data;
  },

  /**
   * Get summary / stats for the current user.
   */
  async summary() {
    const response = await api.get(API_ENDPOINTS.ATTACHMENTS.SUMMARY);
    return response.data;
  },
};

export default attachmentService;
