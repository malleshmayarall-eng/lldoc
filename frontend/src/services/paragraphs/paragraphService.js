import api from '../api';
import { API_ENDPOINTS } from '@constants/api';

/**
 * Paragraph Service - Manages paragraphs within sections
 * Paragraphs are content blocks with precise character positions
 */
export const paragraphService = {
  // Get all paragraphs for a section
  getParagraphs: async (sectionId) => {
    const response = await api.get(`/documents/sections/${sectionId}/paragraphs/`);
    return response.data;
  },

  // Get single paragraph with sentences
  getParagraph: async (paragraphId) => {
    const response = await api.get(API_ENDPOINTS.PARAGRAPHS.BY_ID(paragraphId));
    return response.data;
  },

  // Create a new paragraph
  createParagraph: async (sectionId, paragraphData) => {
    // Normalize paragraph_type to backend-accepted values
    const normalizeParagraphType = (value) => {
      if (!value) return 'standard';
      const v = String(value).toLowerCase();
      if (v === 'body') return 'standard';
      if (v === 'page_break') return 'standard';
      const allowed = new Set(['standard', 'definition', 'obligation']);
      return allowed.has(v) ? v : 'standard';
    };

    const response = await api.post(API_ENDPOINTS.PARAGRAPHS.BASE, {
      section: sectionId,
      content: paragraphData.content || paragraphData.content_text,
      content_start: paragraphData.content_start ?? 0,
      content_end: paragraphData.content_end ?? (paragraphData.content?.length || paragraphData.content_text?.length || 0),
      paragraph_type: normalizeParagraphType(paragraphData.paragraph_type),
      order: paragraphData.order,
    });
    return response.data;
  },

  // Update paragraph via document-level edit-paragraph action
  updateParagraph: async (documentId, paragraphId, paragraphData) => {
    const response = await api.post(API_ENDPOINTS.PARAGRAPHS.EDIT(documentId), {
      paragraph_id: paragraphId,
      content: paragraphData.content || paragraphData.content_text,
      formatting: paragraphData.formatting,
      order: paragraphData.order,
    });
    return response.data;
  },

  // Delete paragraph
  deleteParagraph: async (paragraphId) => {
    const response = await api.delete(API_ENDPOINTS.PARAGRAPHS.BY_ID(paragraphId));
    return response.data;
  },

  // Get paragraph with all sentences
  getParagraphWithSentences: async (paragraphId) => {
    const response = await api.get(`/documents/paragraphs/${paragraphId}/sentences/`);
    return response.data;
  },
};

export default paragraphService;
