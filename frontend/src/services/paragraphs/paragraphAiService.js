import api from '../api';

const paragraphAiService = {
  getMetadataPlaceholders: async (paragraphId) => {
    if (!paragraphId) throw new Error('paragraphId is required');
    const response = await api.get(`/ai/paragraphs/${paragraphId}/ai-review/`);
    return response.data;
  },

  getParagraphAiReview: async (paragraphId) => {
    if (!paragraphId) throw new Error('paragraphId is required');
    const response = await api.get(`/ai/paragraphs/${paragraphId}/ai-review/`);
    return response.data;
  },

  rewriteParagraphAiReview: async (paragraphId, payload) => {
    if (!paragraphId) throw new Error('paragraphId is required');
    const response = await api.post(`/ai/paragraphs/${paragraphId}/ai-review/rewrite/`, payload);
    return response.data;
  },

  applyParagraphAiReview: async (paragraphId, payload) => {
    if (!paragraphId) throw new Error('paragraphId is required');
    const response = await api.post(`/ai/paragraphs/${paragraphId}/ai-review/apply/`, payload);
    return response.data;
  },

  getParagraphAiResult: async (paragraphId, { versionNumber } = {}) => {
    if (!paragraphId) throw new Error('paragraphId is required');
    const response = await api.get(`/ai/paragraphs/${paragraphId}/ai-results/`, {
      params: versionNumber ? { version_number: versionNumber } : undefined,
    });
    return response.data;
  },

  getDocumentParagraphAiResults: async (documentId, { versionNumber, paragraphIds } = {}) => {
    if (!documentId) throw new Error('documentId is required');
    const params = {};
    if (versionNumber) params.version_number = versionNumber;
    if (Array.isArray(paragraphIds) && paragraphIds.length > 0) {
      params.paragraph_id = paragraphIds;
    }
    const response = await api.get(`/ai/documents/${documentId}/paragraph-ai-results/`, {
      params: Object.keys(params).length ? params : undefined,
    });
    return response.data;
  },

  refreshUpdatedParagraphAiResults: async (documentId, { limit } = {}) => {
    if (!documentId) throw new Error('documentId is required');
    const response = await api.post(`/ai/documents/${documentId}/paragraph-ai-review/updated/`, null, {
      params: typeof limit === 'number' ? { limit } : undefined,
    });
    return response.data;
  },

  applyPlaceholders: async (paragraphId, payload) => {
    if (!paragraphId) throw new Error('paragraphId is required');
    const response = await api.post(`/ai/paragraphs/${paragraphId}/apply-placeholders/`, payload);
    return response.data;
  },
};

export default paragraphAiService;
