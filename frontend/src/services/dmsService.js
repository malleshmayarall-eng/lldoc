import api from './api';

const buildMetadataPayload = (metadata) => {
  if (!metadata) return undefined;
  if (typeof metadata === 'string') return metadata;
  return JSON.stringify(metadata);
};

export const dmsService = {
  /**
   * List documents with seamless filter/sort query params.
   * @param {Object} params - { q, status, category, document_type, author,
   *   created_by, is_signed, created_after, created_before, uploaded_after,
   *   uploaded_before, updated_after, updated_before, effective_after,
   *   effective_before, expiration_after, expiration_before, signed_after,
   *   signed_before, sort_by, sort_dir, page }
   */
  listDocuments: async (params = {}) => {
    // Strip undefined/empty values
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    // Serialize metadata_filters array as JSON string
    if (clean.metadata_filters && Array.isArray(clean.metadata_filters)) {
      clean.metadata_filters = JSON.stringify(clean.metadata_filters);
    }
    const response = await api.get('/dms/documents/', { params: clean });
    return response.data;
  },

  /**
   * Get distinct values for filter dropdowns.
   */
  getFilterOptions: async () => {
    const response = await api.get('/dms/documents/filter-options/');
    return response.data;
  },

  /**
   * Get distinct metadata keys + sample values for metadata filter builder.
   * Returns: [{ key: "parties", sample_values: ["Acme Corp", "Widget Inc"] }, …]
   */
  getMetadataKeys: async () => {
    const response = await api.get('/dms/documents/metadata-keys/');
    return response.data;
  },

  preflightDocument: async ({
    file,
    title,
    metadata,
    extractMetadata = true,
    extractText = true,
  }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    if (metadata !== undefined) {
      formData.append('metadata', buildMetadataPayload(metadata));
    }
    if (typeof extractMetadata === 'boolean') {
      formData.append('extract_metadata', String(extractMetadata));
    }
    if (typeof extractText === 'boolean') {
      formData.append('extract_text', String(extractText));
    }

    const response = await api.post('/dms/documents/preflight/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  uploadDocument: async ({
    file,
    title,
    metadata,
    extractMetadata = true,
    extractText = true,
  }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    if (metadata !== undefined) {
      formData.append('metadata', buildMetadataPayload(metadata));
    }
    if (typeof extractMetadata === 'boolean') {
      formData.append('extract_metadata', String(extractMetadata));
    }
    if (typeof extractText === 'boolean') {
      formData.append('extract_text', String(extractText));
    }

    const response = await api.post('/dms/documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  searchDocuments: async ({ query, metadataFilters, includeText = false }) => {
    const response = await api.post('/dms/documents/search/', {
      query: query || '',
      metadata_filters: metadataFilters || {},
      include_text: Boolean(includeText),
    });
    return response.data;
  },

  getDocument: async (id, { includePdf = false } = {}) => {
    const response = await api.get(`/dms/documents/${id}/`, {
      params: { include_pdf: includePdf },
    });
    return response.data;
  },

  downloadDocument: async (id) => {
    const response = await api.get(`/dms/documents/${id}/download/`, {
      responseType: 'blob',
    });
    return response.data;
  },

  getDocumentAlerts: async (id, { warningDays = 30 } = {}) => {
    const response = await api.get(`/dms/documents/${id}/alerts/`, {
      params: { warning_days: warningDays },
    });
    return response.data;
  },

  getAlerts: async ({ warningDays = 30 } = {}) => {
    const response = await api.get('/dms/documents/alerts/', {
      params: { warning_days: warningDays },
    });
    return response.data;
  },
};

export default dmsService;
