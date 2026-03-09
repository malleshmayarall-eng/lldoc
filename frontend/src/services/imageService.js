import api from './api';
import { buildImageUploadFormData, fixImageUrls } from '../utils/imageUtils';
import documentService from './documentService';

/**
 * Image Service
 * Handles all image-related API operations
 */

export const imageService = {
  /**
   * Get a single image by ID
   */
  async getImage(imageId) {
    const response = await api.get(`/documents/images/${imageId}/`);
    return fixImageUrls(response.data);
  },

  /**
   * Batch get multiple images (NEW - for marker system)
   */
  async batchGetImages(imageIds) {
    try {
      const response = await api.post('/documents/images/batch/', {
        image_ids: imageIds
      });
      
      return {
        images: response.data.images.map(fixImageUrls),
        not_found: response.data.not_found || []
      };
    } catch (error) {
      console.error('Failed to batch fetch images:', error);
      // Fallback: fetch individually
      const images = [];
      const not_found = [];
      
      for (const id of imageIds) {
        try {
          const img = await this.getImage(id);
          images.push(img);
        } catch (err) {
          not_found.push(id);
        }
      }
      
      return { images, not_found };
    }
  },

  /**
   * Upload a new image
   */
  async uploadImage(file, { name, imageType, caption, description, documentId, isPublic = false, tags = [], uploadScope = 'document' }) {
    const formData = buildImageUploadFormData(file, {
      name,
      imageType,
      caption,
      description,
      documentId,
      isPublic,
      tags,
      uploadScope,
    });

    if (!formData) {
      throw new Error('Image file is required for upload');
    }

    const response = await api.post('/documents/images/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return fixImageUrls(response.data);
  },

  /**
   * Get images with flexible filtering
   */
  async getImages(params = {}) {
    const response = await api.get('/documents/images/', { params });
    const data = response.data;
    
    // Fix URLs for all images
    if (data.results && Array.isArray(data.results)) {
      data.results = data.results.map(fixImageUrls);
    } else if (Array.isArray(data)) {
      return data.map(fixImageUrls);
    }
    
    return data;
  },

  /**
   * Get all images for the current user
   */
  async getMyImages(includePublic = false) {
    const params = includePublic ? { include_public: true } : {};
    const response = await api.get('/documents/images/', { params });
    const data = response.data;

    if (data.results && Array.isArray(data.results)) {
      data.results = data.results.map(fixImageUrls);
    } else if (Array.isArray(data)) {
      return data.map(fixImageUrls);
    }

    return data;
  },

  /**
   * Get images grouped by type
   */
  async getImagesByTypes() {
    const response = await api.get('/documents/images/my-images/');
    const data = response.data;

    if (data?.by_type) {
      const normalized = {};
      Object.entries(data.by_type).forEach(([key, images]) => {
        normalized[key] = (images || []).map(fixImageUrls);
      });
      return { ...data, by_type: normalized };
    }

    return data;
  },

  /**
   * Get images of a specific type
   */
  async getImagesByType(imageType) {
    const response = await api.get(`/documents/images/by-type/${imageType}/`);
    const data = response.data;
    if (Array.isArray(data?.images)) {
      return { ...data, images: data.images.map(fixImageUrls) };
    }
    return data;
  },

  /**
   * Get available image types
   */
  async getImageTypes() {
    const response = await api.get('/documents/images/types/');
    return response.data;
  },

  // NOTE: getImage is already defined above and returns fixed URLs. Avoid duplicate keys.

  /**
   * Delete an image
   */
  async deleteImage(imageId) {
    const response = await api.delete(`/documents/images/${imageId}/`);
    return response.data;
  },

  /**
   * Make image public
   */
  async makePublic(imageId) {
    const response = await api.post(`/documents/images/${imageId}/make-public/`);
    return response.data;
  },

  /**
   * Make image private
   */
  async makePrivate(imageId) {
    const response = await api.post(`/documents/images/${imageId}/make-private/`);
    return response.data;
  },

  /**
   * Get public images
   */
  async getPublicImages(imageType = null) {
    const params = imageType ? { type: imageType } : {};
    const response = await api.get('/documents/images/public/', { params });
    const data = response.data;
    if (Array.isArray(data?.results)) {
      return { ...data, results: data.results.map(fixImageUrls) };
    }
    if (Array.isArray(data)) {
      return data.map(fixImageUrls);
    }
    return data;
  },

  /**
   * Get images for a specific document
   */
  async getDocumentImages(documentId) {
    const response = await api.get('/documents/images/', {
      params: { document: documentId }
    });
    const data = response.data;
    if (Array.isArray(data?.results)) {
      return { ...data, results: data.results.map(fixImageUrls) };
    }
    if (Array.isArray(data)) {
      return data.map(fixImageUrls);
    }
    return data;
  },

  /**
   * Quick upload - simplified interface
   */
  async quickUpload(file, imageType) {
    return this.uploadImage(file, {
      name: file.name,
      imageType: imageType,
      isPublic: false
    });
  },

  /**
   * Batch upload multiple images
   */
  async uploadMultiple(files, imageType) {
    const uploads = files.map(file => this.quickUpload(file, imageType));
    return Promise.all(uploads);
  },

  /**
   * Update document images
   */
  async updateDocumentImages(documentId, imageFields) {
    return documentService.updateDocument(documentId, {
      ...imageFields,
      change_summary: 'Updated document images',
    });
  }
};

export default imageService;
