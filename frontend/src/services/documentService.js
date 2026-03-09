import api from './api';
import { API_ENDPOINTS } from '@constants/api';
import { etagFetchJSON, StaleDataError } from '../utils/etagFetch';
import { etagManager } from '../utils/etagManager';

export const documentService = {
  // ---------------------------------------------------------------------------
  // Listing & retrieval
  // ---------------------------------------------------------------------------
  getDocuments: async (params = {}) => {
    const response = await api.get('/documents/', { params });
    return response.data;
  },

  getDocument: async (id) => {
    const response = await api.get(`/documents/${id}/`);
    // Store ETag if present
    const etag = response.headers?.etag || response.headers?.get?.('etag');
    if (etag) {
      etagManager.setETag(id, etag);
    }
    return response.data;
  },

  getCompleteDocument: async (id) => {
    const response = await api.get(`/documents/${id}/complete/`);
    // Store ETag if present
    const etag = response.headers?.etag || response.headers?.get?.('etag');
    if (etag) {
      etagManager.setETag(id, etag);
      etagManager.setCache(id, response.data);
    }
    return response.data;
  },

  // Backwards-compatible alias
  fetchCompleteStructure: async (id) => {
    return documentService.getCompleteDocument(id);
  },

  getDocumentGraph: async (id) => {
    const response = await api.get(`/documents/${id}/graph/`);
    return response.data;
  },

  renderLatex: async (documentId, payload = {}) => {
    const response = await api.post(`/documents/${documentId}/latex/render/`, payload);
    return response.data;
  },

  getMyDocuments: async () => {
    const response = await api.get('/documents/my-documents/');
    return response.data;
  },

  getOrganizationDocuments: async () => {
    const response = await api.get('/documents/organization-documents/');
    return response.data;
  },

  getSharedWithMe: async () => {
    const response = await api.get('/documents/shared-with-me/');
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------
  createDocument: async (documentData) => {
    const response = await api.post('/documents/', documentData);
    return response.data;
  },

  importDocument: async (title, content) => {
    // Note: trailing slash required by backend APPEND_SLASH
    const response = await api.post('/documents/import/', { title, content });
    return response.data;
  },

  createFromTemplate: async (templateData) => {
    const response = await api.post('/documents/create-from-template/', templateData);
    return response.data;
  },

  createStructured: async (documentData) => {
    const response = await api.post('/documents/create-structured/', documentData);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Updates
  // ---------------------------------------------------------------------------
  updateDocument: async (id, documentData, changeSummary = 'Updated via editor') => {
    // Add If-Match header for safe updates
    const etag = etagManager.getETag(id);
    const config = etag ? { headers: { 'If-Match': etag } } : {};
    
    try {
      const response = await api.patch(`/documents/${id}/edit-full/`, {
        ...documentData,
        change_summary: documentData?.change_summary || changeSummary,
      }, config);
      
      // Update ETag from response
      const newEtag = response.headers?.etag || response.headers?.get?.('etag');
      if (newEtag) {
        etagManager.setETag(id, newEtag);
      }
      
      return response.data;
    } catch (error) {
      // Handle 412 Precondition Failed
      if (error.response?.status === 412) {
        etagManager.clearETag(id);
        throw new StaleDataError('Document has been modified. Please refresh and try again.');
      }
      throw error;
    }
  },

  // ---------------------------------------------------------------------------
  // Partial save (change envelope)
  // ---------------------------------------------------------------------------
  partialSave: async (id, payload) => {
    const etag = etagManager.getETag(id);
    const config = etag ? { headers: { 'If-Match': etag } } : {};

    try {
      const response = await api.post(`/documents/${id}/partial-save/`, payload, config);

      const newEtag = response.headers?.etag || response.headers?.get?.('etag');
      if (newEtag) {
        etagManager.setETag(id, newEtag);
      }

      return response.data;
    } catch (error) {
      if (error.response?.status === 412) {
        etagManager.clearETag(id);
        throw new StaleDataError('Document has been modified. Please refresh and try again.');
      }
      throw error;
    }
  },

  // Delete document
  deleteDocument: async (id) => {
    const response = await api.delete(`/documents/${id}/`);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Document Status
  // ---------------------------------------------------------------------------
  getDocumentStatus: async (id) => {
    const response = await api.get(API_ENDPOINTS.DOCUMENTS.DOCUMENT_STATUS(id));
    return response.data;
  },

  updateDocumentStatus: async (id, newStatus) => {
    const response = await api.patch(API_ENDPOINTS.DOCUMENTS.DOCUMENT_STATUS(id), {
      status: newStatus,
    });
    return response.data;
  },

  // Change log & versioning
  getChangelog: async (id, params = {}) => {
    const response = await api.get(`/documents/${id}/changelog/`, { params });
    return response.data;
  },

  createVersion: async (id, payload) => {
    const response = await api.post(`/documents/${id}/create-version/`, payload);
    return response.data;
  },

  getVersions: async (id, params = {}) => {
    const response = await api.get(`/documents/${id}/versions/`, { params });
    return response.data;
  },

  getVersion: async (id, versionId, params = {}) => {
    const response = await api.get(`/documents/${id}/versions/${versionId}/`, { params });
    return response.data;
  },

  restoreVersion: async (id, versionId) => {
    const response = await api.post(`/documents/${id}/restore-version/`, { version_id: versionId });
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Misc helpers
  // ---------------------------------------------------------------------------
  analyzeDocument: async (id, analysisType = 'full') => {
    const response = await api.post(`/documents/${id}/analyze/`, { analysis_type: analysisType });
    return response.data;
  },

  exportDocument: async (id, format = 'docx') => {
    const response = await api.get(`/documents/${id}/export/`, {
      params: { format },
      responseType: 'blob',
    });
    return response.data;
  },

  uploadDocument: async (file, title, organizationId) => {
    const formData = new FormData();
    formData.append('source_file', file);
    formData.append('title', title);
    if (organizationId) {
      formData.append('organization', organizationId);
    }

    const response = await api.post('/documents/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getTemplates: async () => {
    const response = await api.get('/documents/templates/');
    return response.data;
  },

  getTemplateDetails: async (templateName) => {
    const response = await api.get(`/documents/templates/${templateName}/`);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Dashboard APIs
  // ---------------------------------------------------------------------------
  getDashboardOverview: async (params = {}) => {
    const response = await api.get('/documents/dashboard/overview/', { params });
    return response.data;
  },

  getMyDocumentsDashboard: async (params = {}) => {
    const response = await api.get('/documents/dashboard/my-documents/', { params });
    return response.data;
  },

  getWorkflowsDashboard: async (params = {}) => {
    const response = await api.get('/documents/dashboard/workflows/', { params });
    return response.data;
  },

  getSharedDashboard: async (params = {}) => {
    const response = await api.get('/documents/dashboard/shared/', { params });
    return response.data;
  },

  searchDashboard: async (query, params = {}) => {
    const response = await api.get('/documents/dashboard/search/', {
      params: { q: query, ...params }
    });
    return response.data;
  },

  getDashboardStats: async (params = {}) => {
    const response = await api.get('/documents/dashboard/stats/', { params });
    return response.data;
  },

  getRecentActivity: async (params = {}) => {
    const response = await api.get('/documents/dashboard/recent-activity/', { params });
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Image slots (placeholder mapping)
  // ---------------------------------------------------------------------------
  getImageSlots: async (documentId) => {
    const response = await api.get(API_ENDPOINTS.DOCUMENTS.IMAGE_SLOTS(documentId));
    return response.data;
  },

  mapImage: async (documentId, placeholderName, imageId) => {
    const response = await api.post(API_ENDPOINTS.DOCUMENTS.MAP_IMAGE(documentId), {
      placeholder_name: placeholderName,
      image_id: imageId,
    });
    return response.data;
  },
};

export default documentService;
