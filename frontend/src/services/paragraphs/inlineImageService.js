import api from '../api';

/**
 * Inline Image Service - Text-Embedded Marker System
 * ALL operations work by editing paragraph text markers
 * Uses {{image:uuid:uuid|alt}} markers in paragraph text
 */

export const inlineImageService = {
  /**
   * Insert image marker into paragraph text
   * This is the ONLY operation that calls the backend
   * Creates InlineImage metadata and inserts {{image:...}} marker
   */
  async insertImageMarker(data) {
    console.log('📤 Inserting image marker:', data);
    const response = await api.post('/documents/inline-images/insert-image-marker/', {
      paragraph_id: data.paragraph || data.paragraph_id,
      image_ref_id: data.image_reference || data.image_ref_id,
      alt_text: data.alt_text || 'Image',
      insert_position: data.position_in_text || data.insert_position || 0,
      alignment: data.alignment || 'center',
      size_mode: data.size_mode || 'max-width',
      width_pixels: data.width_pixels,
      height_pixels: data.height_pixels,
      max_width_pixels: data.max_width_pixels || 600,
      caption: data.caption
    });
    console.log('✅ Image marker inserted:', response.data);
    return response.data;
  },

  /**
   * Cleanup orphaned images (markers without metadata)
   */
  async cleanupOrphanedImages(paragraphId) {
    const payload = paragraphId ? { paragraph_id: paragraphId } : {};
    const response = await api.post('/documents/inline-images/cleanup-orphaned-images/', payload);
    return response.data;
  }
};

export default inlineImageService;
