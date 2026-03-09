import api from '../api';

/**
 * Inline Reference Service
 * Supports inline references, comments, resolution, and document-level listing.
 */
export const inlineReferenceService = {
  // Create inline reference on a paragraph
  createInlineReference: async (paragraphId, payload) => {
    const res = await api.post(`/documents/paragraphs/${paragraphId}/inline-references/`, payload);
    return res.data;
  },

  // List inline references for a paragraph (supports query params like type/status)
  getInlineReferences: async (paragraphId, params = {}) => {
    const res = await api.get(`/documents/paragraphs/${paragraphId}/inline-references/`, { params });
    return res.data;
  },

  // List all inline references for a document with filters
  getDocumentInlineReferences: async (docId, params = {}) => {
    const res = await api.get(`/documents/${docId}/inline-references/`, { params });
    return res.data;
  },

  // Add comment to an inline reference
  addComment: async (refId, payload) => {
    const res = await api.post(`/documents/inline-references/${refId}/comments/`, payload);
    return res.data;
  },

  // Resolve inline reference
  resolveInlineReference: async (refId) => {
    const res = await api.post(`/documents/inline-references/${refId}/resolve/`);
    return res.data;
  },

  // Smart search for sections/paragraphs/documents
  searchTargets: async (query, params = {}) => {
    const res = await api.get('/documents/search/', {
      params: {
        q: query,
        limit: 8,
        ...params,
      },
    });
    return res.data;
  },

  // Reference context endpoints
  getDocumentContext: async (documentId) => {
    const res = await api.get(`/documents/reference-context/document/${documentId}/`);
    return res.data;
  },

  getSectionContext: async (sectionId) => {
    const res = await api.get(`/documents/reference-context/section/${sectionId}/`);
    return res.data;
  },

  getParagraphContext: async (paragraphId) => {
    const res = await api.get(`/documents/reference-context/paragraph/${paragraphId}/`);
    return res.data;
  },

  getBatchContext: async (references = []) => {
    const res = await api.post('/documents/reference-context/batch/', { references });
    return res.data;
  },

  /**
   * Get simple text content of a reference
   * Fast, lightweight endpoint that returns just the text
   * Use case: Tooltips, quick preview, modal display
   * 
   * Response format:
   * {
   *   reference_id: "uuid",
   *   type: "section" | "paragraph" | "url",
   *   display_text: "text shown in marker",
   *   text: "THE ACTUAL TEXT",
   *   title: "section or paragraph title",
   *   document_title: "source document" (optional)
   * }
   * 
   * @param {string} referenceId - The inline reference ID
   * @returns {Promise<Object>} Simple response with text and basic metadata
   */
  getReferenceText: async (referenceId) => {
    const res = await api.get(`/inline-references/${referenceId}/text/`);
    return res.data;
  },

  /**
   * Record click on inline reference (for analytics)
   * @param {string} referenceId - The inline reference ID
   */
  recordClick: async (referenceId) => {
    try {
      const res = await api.post(`/inline-references/${referenceId}/record-click/`);
      return res.data;
    } catch (error) {
      console.error('Failed to record reference click:', error);
      // Don't throw - analytics failures shouldn't break the UI
      return null;
    }
  },
};

export default inlineReferenceService;
