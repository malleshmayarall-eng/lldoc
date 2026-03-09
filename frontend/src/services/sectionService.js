import api from './api';

/**
 * Section Service
 * Handles section CRUD via direct REST endpoints.
 *
 * Architecture (2025):
 * - Creates/deletes go through direct REST endpoints (real UUID on creation).
 * - Updates are handled by SaveCoordinator → partial-save (debounced).
 * - No more temp IDs — createSection() returns a real UUID from the server.
 */

export const sectionService = {
  /**
   * Build a local section object for UI state.
   * NOTE: This does NOT assign an ID. The caller must POST via createSection()
   * first and then assign the returned UUID.
   */
  createSectionObject(sectionData, order = 0, depth = 1) {
    return {
      title: sectionData.title || `Section ${order + 1}`,
      content_text: sectionData.content_text || sectionData.content || '',
      order: sectionData.order ?? order,
      depth_level: sectionData.depth_level ?? sectionData.level ?? depth,
      section_type: sectionData.section_type || 'clause',
      paragraphs: sectionData.paragraphs || [],
      tables: sectionData.tables || [],
      image_components: sectionData.image_components || [],
      children: sectionData.children || [],
    };
  },

  createSection: async (documentId, payload) => {
    if (!documentId) {
      throw new Error('documentId is required to create a section');
    }
    const response = await api.post(`/documents/${documentId}/sections/`, payload);
    return response.data;
  },

  updateSection: async (sectionId, payload) => {
    const response = await api.patch(`/documents/sections/${sectionId}/`, payload);
    return response.data;
  },

  deleteSection: async (sectionId) => {
    const response = await api.delete(`/documents/sections/${sectionId}/`);
    return response.data;
  },
};

export default sectionService;
