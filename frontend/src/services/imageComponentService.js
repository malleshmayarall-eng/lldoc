import api from './api';
import { fixImageUrl } from '../utils/imageUtils';

/**
 * Image Component Service
 * Handles positioning and management of images within document sections.
 *
 * Architecture (2025):
 * - Creates/deletes go through direct REST endpoints (real UUID on creation).
 * - Updates are handled by SaveCoordinator → partial-save (debounced).
 * - No more save-structure or temp IDs in this service.
 */

const API_BASE = '/documents';

const fixImageComponentUrls = (component) => ({
  ...component,
  image_url: fixImageUrl(component.image_url),
  image_thumbnail_url: fixImageUrl(component.image_thumbnail_url),
});

const stripUndefined = (payload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const buildImagePayload = (data, { includeId = true } = {}) => {
  if (!data) return {};

  const payload = {
    id: includeId ? data.id : undefined,
    image_reference_id:
      data.image_reference_id ||
      data.imageReferenceId ||
      data.image_reference ||
      data.imageReference ||
      data.image_id ||
      data.imageId ||
      data.image?.id,
    caption: data.caption,
    alt_text: data.alt_text ?? data.altText,
    title: data.title,
    figure_number: data.figure_number ?? data.figureNumber,
    // Core display — size slider + alignment
    alignment: data.alignment,
    size_mode: data.size_mode ?? data.sizeMode,
    custom_width_percent: data.custom_width_percent ?? data.customWidthPercent,
    // Classification
    component_type: data.component_type ?? data.componentType ?? data.image_type ?? data.imageType,
    order: data.order,
    is_visible: data.is_visible ?? data.isVisible,
    show_caption: data.show_caption ?? data.showCaption,
    show_figure_number: data.show_figure_number ?? data.showFigureNumber,
    custom_metadata: data.custom_metadata ?? data.customMetadata,
  };

  return stripUndefined(payload);
};

export const imageComponentService = {
  /**
   * Get all image components in a section
   */
  async getImageComponentsInSection(sectionId) {
    try {
      const response = await api.get(`${API_BASE}/sections/${sectionId}/image-components/`);
      return {
        count: response.data.count || response.data.results?.length || 0,
        results: (response.data.results || []).map(fixImageComponentUrls)
      };
    } catch (error) {
      console.error(`Failed to fetch image components for section ${sectionId}:`, error);
      throw error;
    }
  },

  /**
   * Get a specific image component by ID
   */
  async getImageComponent(componentId) {
    try {
      const response = await api.get(`${API_BASE}/image-components/${componentId}/`);
      return fixImageComponentUrls(response.data);
    } catch (error) {
      console.error(`Failed to fetch image component ${componentId}:`, error);
      throw error;
    }
  },

  /**
   * Create an image component directly via POST (returns real UUID immediately).
   * Use this for the create-first approach: POST → get ID → add to local state.
   * @param {string} sectionId - Real section UUID
   * @param {Object} componentData - Image component data
   * @returns {Promise<Object>} Created component with server-assigned UUID
   */
  async createImageComponentDirect(sectionId, componentData) {
    const imageReferenceId =
      componentData?.image_reference_id ||
      componentData?.imageReferenceId ||
      componentData?.image_id ||
      componentData?.imageId ||
      componentData?.image?.id;

    if (!imageReferenceId) {
      throw new Error('image_reference_id is required to create an image component');
    }

    const response = await api.post(`${API_BASE}/image-components/`, {
      section_id: sectionId,
      image_reference_id: imageReferenceId,
      caption: componentData.caption ?? '',
      alt_text: componentData.alt_text ?? componentData.name ?? 'Document image',
      component_type: componentData.component_type ?? componentData.image_type ?? 'figure',
      size_mode: componentData.size_mode ?? 'medium',
      alignment: componentData.alignment ?? 'center',
      order: componentData.order ?? 0,
      show_caption: componentData.show_caption ?? true,
      show_figure_number: componentData.show_figure_number ?? false,
    });
    return fixImageComponentUrls(response.data);
  },

  /**
   * Create a new image component — delegates to createImageComponentDirect.
   * @deprecated Use createImageComponentDirect() directly.
   */
  async createImageComponent(_documentId, sectionId, componentData) {
    return this.createImageComponentDirect(sectionId, componentData);
  },

  /**
   * Update an existing image component via direct PATCH
   */
  async updateImageComponent(_documentId, _sectionId, componentId, updates) {
    try {
      const payload = buildImagePayload({ ...updates, id: componentId }, { includeId: false });
      const response = await api.patch(`${API_BASE}/image-components/${componentId}/`, stripUndefined(payload));
      return fixImageComponentUrls(response.data);
    } catch (error) {
      console.error(`Failed to update image component ${componentId}:`, error);
      throw error;
    }
  },

  /**
   * Delete an image component directly via API
   */
  async deleteImageComponentDirect(componentId) {
    await api.delete(`${API_BASE}/image-components/${componentId}/`);
  },

  /**
   * Delete an image component — delegates to deleteImageComponentDirect.
   * @deprecated Use deleteImageComponentDirect() directly.
   */
  async deleteImageComponent(_documentId, _sectionId, componentId) {
    await this.deleteImageComponentDirect(componentId);
    return { success: true };
  },
};

export default imageComponentService;
