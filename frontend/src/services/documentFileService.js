import api from './api';
import { API_CONFIG } from '../config/app.config';

/**
 * Document File Service
 * Handles file storage + file component CRUD.
 *
 * Architecture (2025):
 * - Creates/deletes go through direct REST endpoints (real UUID on creation).
 * - Updates are handled by SaveCoordinator → partial-save (debounced).
 * - No more save-structure, temp IDs, or buildPartialSavePayload in this service.
 */
/**
 * Fix relative file URLs to point to backend
 */
const fixFileUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  return `${API_CONFIG.BACKEND_URL}${url.startsWith('/') ? url : '/' + url}`;
};

const fixFileUrls = (file) => {
  return {
    ...file,
    file: fixFileUrl(file.file),
    file_url: fixFileUrl(file.file_url || file.file),
  };
};

const stripUndefined = (payload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

const buildFilePayload = (data, { includeId = true } = {}) => {
  if (!data) return {};

  const fileReferenceId =
    data.file_reference_id ||
    data.file_reference ||
    data.file_reference?.id ||
    data.file_reference?.uuid ||
    data.file?.id ||
    data.file_id ||
    data.document_file_id;

  const payload = {
    id: includeId ? data.id : undefined,
    file_reference_id: fileReferenceId,
    label: data.label,
    description: data.description,
    caption: data.caption,
    component_type: data.component_type ?? data.componentType,
    display_mode: data.display_mode ?? data.displayMode,
    alignment: data.alignment,
    show_description: data.show_description ?? data.showDescription,
    show_file_type: data.show_file_type ?? data.showFileType,
    show_file_size: data.show_file_size ?? data.showFileSize,
    show_filename: data.show_filename ?? data.showFilename,
    show_label: data.show_label ?? data.showLabel,
    preview_enabled: data.preview_enabled ?? data.previewEnabled,
    download_enabled: data.download_enabled ?? data.downloadEnabled,
    width_percent: data.width_percent ?? data.widthPercent,
    height_pixels: data.height_pixels ?? data.heightPixels,
    reference_number: data.reference_number ?? data.referenceNumber,
  show_download_link: data.show_download_link ?? data.showDownloadLink,
  show_download_button: data.show_download_button ?? data.showDownloadButton,
  show_preview: data.show_preview ?? data.showPreview,
  open_in_new_tab: data.open_in_new_tab ?? data.openInNewTab,
    margin_top: data.margin_top ?? data.marginTop,
    margin_bottom: data.margin_bottom ?? data.marginBottom,
    margin_left: data.margin_left ?? data.marginLeft,
    margin_right: data.margin_right ?? data.marginRight,
    page_range: data.page_range ?? data.pageRange,
    order: data.order ?? data.order_index ?? data.orderIndex,
  };

  return stripUndefined(payload);
};

/**
 * Document File Service
 * Handles all document file-related API operations
 */
export const documentFileService = {
  /**
   * Get a single file by ID
   */
  async getFile(fileId) {
    const response = await api.get(`/documents/files/${fileId}/`);
    return fixFileUrls(response.data);
  },

  /**
   * Get available PDF layers for a file
   */
  async getPdfLayers(fileId) {
    const response = await api.get(`/documents/files/${fileId}/pdf-layers/`);
    return response.data;
  },

  /**
   * Fetch a specific PDF layer (HTML or PDF stream)
   */
  async getPdfLayer(fileId, { layer = 'images', pageRange } = {}) {
    const params = new URLSearchParams();
    if (layer) params.append('layer', layer);
    if (pageRange) params.append('page_range', pageRange);

    const response = await api.get(
      `/documents/files/${fileId}/pdf-layer/?${params.toString()}`
    );
    return response.data;
  },

  /**
   * Get all files (with optional filters)
   */
  async getFiles(filters = {}) {
    const params = new URLSearchParams();
    
    if (filters.search) params.append('search', filters.search);
    if (filters.file_type) params.append('file_type', filters.file_type);
    if (filters.category) params.append('category', filters.category);
    if (filters.access_level) params.append('access_level', filters.access_level);
    if (filters.tags) params.append('tags', filters.tags);
    if (filters.ordering) params.append('ordering', filters.ordering);

    const response = await api.get(`/documents/files/?${params.toString()}`);
    
    // Handle paginated response
    if (response.data.results) {
      return {
        ...response.data,
        results: response.data.results.map(fixFileUrls)
      };
    }
    
    // Handle array response
    if (Array.isArray(response.data)) {
      return response.data.map(fixFileUrls);
    }
    
    return response.data;
  },

  /**
   * Get user's personal library
   */
  async getMyLibrary(filters = {}) {
    const params = new URLSearchParams();
    
    if (filters.search) params.append('search', filters.search);
    if (filters.file_type) params.append('file_type', filters.file_type);
    if (filters.category) params.append('category', filters.category);
    if (filters.ordering) params.append('ordering', filters.ordering);

    const response = await api.get(`/documents/files/my-library/?${params.toString()}`);
    
    if (response.data.results) {
      return {
        ...response.data,
        results: response.data.results.map(fixFileUrls)
      };
    }

    if (response.data.files && Array.isArray(response.data.files)) {
      return {
        ...response.data,
        files: response.data.files.map(fixFileUrls)
      };
    }
    
    if (Array.isArray(response.data)) {
      return response.data.map(fixFileUrls);
    }
    
    return response.data;
  },

  /**
   * Upload a new file
   */
  async uploadFile(file, metadata = {}) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', metadata.name || file.name);
    formData.append('file_type', metadata.file_type || this.getFileTypeFromExtension(file.name));
    
    // Optional metadata
    if (metadata.description) formData.append('description', metadata.description);
    if (metadata.category) formData.append('category', metadata.category);
    if (metadata.access_level) formData.append('access_level', metadata.access_level || 'user');
    if (metadata.is_confidential !== undefined) formData.append('is_confidential', metadata.is_confidential);
    if (metadata.version) formData.append('version', metadata.version);
    if (metadata.document) formData.append('document', metadata.document);
    
    if (metadata.tags && metadata.tags.length > 0) {
      formData.append('tags', JSON.stringify(metadata.tags));
    }
    
    if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
      formData.append('metadata', JSON.stringify(metadata.metadata));
    }

    const response = await api.post('/documents/files/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return fixFileUrls(response.data);
  },

  /**
   * Update file metadata
   */
  async updateFile(fileId, updates) {
    const response = await api.patch(`/documents/files/${fileId}/`, updates);
    return fixFileUrls(response.data);
  },

  /**
   * Delete a file
   */
  async deleteFile(fileId) {
    await api.delete(`/documents/files/${fileId}/`);
  },

  /**
   * Track file download
   */
  async trackDownload(fileId) {
    const response = await api.post(`/documents/files/${fileId}/download/`);
    return response.data;
  },

  /**
   * Get file usage locations
   */
  async getFileUsages(fileId) {
    const response = await api.get(`/documents/files/${fileId}/usages/`);
    return response.data;
  },

  /**
   * Get file statistics
   */
  async getFileStats() {
    const response = await api.get('/documents/files/stats/');
    return response.data;
  },

  /**
   * Get file type from extension
   */
  getFileTypeFromExtension(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    
    const typeMap = {
      // Documents
      'pdf': 'pdf',
      'doc': 'doc',
      'docx': 'docx',
      'txt': 'txt',
      'rtf': 'rtf',
      'odt': 'odt',
      'md': 'md',
      
      // Spreadsheets
      'xls': 'xls',
      'xlsx': 'xlsx',
      'csv': 'csv',
      'ods': 'ods',
      
      // Presentations
      'ppt': 'ppt',
      'pptx': 'pptx',
      'odp': 'odp',
      
      // Data
      'json': 'json',
      'xml': 'xml',
      
      // Archives
      'zip': 'zip',
      'rar': 'rar',
      '7z': '7z',
      'tar': 'tar',
      'gz': 'gz',
    };
    
    return typeMap[ext] || 'other';
  },

  /**
   * Get file icon based on type
   */
  getFileIcon(fileType) {
    const iconMap = {
      'pdf': '📄',
      'doc': '📝',
      'docx': '📝',
      'txt': '📄',
      'rtf': '📄',
      'odt': '📄',
      'md': '📄',
      'xls': '📊',
      'xlsx': '📊',
      'csv': '📊',
      'ods': '📊',
      'ppt': '📽️',
      'pptx': '📽️',
      'odp': '📽️',
      'json': '📋',
      'xml': '📋',
      'zip': '🗜️',
      'rar': '🗜️',
      '7z': '🗜️',
      'tar': '🗜️',
      'gz': '🗜️',
    };
    
    return iconMap[fileType] || '📁';
  },

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (!bytes) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  },

  /**
   * Get file categories
   */
  getCategories() {
    return [
      'contract', 'agreement', 'amendment', 'exhibit', 'schedule',
      'addendum', 'appendix', 'attachment', 'memo', 'letter',
      'notice', 'filing', 'brief', 'motion', 'order',
      'pleading', 'discovery', 'evidence', 'report', 'form',
      'template', 'reference', 'other'
    ];
  },

  /**
   * Get access levels
   */
  getAccessLevels() {
    return [
      { value: 'user', label: 'Personal (Only Me)', icon: '👤' },
      { value: 'team', label: 'Team (My Team)', icon: '👥' },
      { value: 'organization', label: 'Organization (Everyone)', icon: '🏢' }
    ];
  }
};

// ==========================================
// FILE COMPONENT SERVICE
// ==========================================

export const documentFileComponentService = {
  /**
   * Create a file component via direct POST (returns real UUID immediately).
   * @deprecated Use createComponent() directly.
   */
  async createDocumentComponent(_documentId, sectionId, componentData) {
    return this.createComponent(sectionId, componentData);
  },

  /**
   * Create a file component in a section
   */
  async createComponent(sectionId, componentData) {
    const response = await api.post('/documents/file-components/', {
      section_id: sectionId,
      ...componentData
    });
    return response.data;
  },

  // Backwards-compatible aliases (some consumers expect different method names)
  async createComponentLegacy(sectionId, componentData) {
    return await this.createComponent(sectionId, componentData);
  },

  /**
   * Get component by ID
   */
  async getComponent(componentId) {
    const response = await api.get(`/documents/file-components/${componentId}/`);
    return response.data;
  },

  async getSectionDocumentComponents(sectionId) {
    return await this.getSectionComponents(sectionId);
  },

  /**
   * Update component
   */
  async updateComponent(componentId, updates) {
    const response = await api.patch(`/documents/file-components/${componentId}/`, updates);
    return response.data;
  },

  async updateDocumentComponent(_documentId, _sectionId, componentId, updates) {
    return this.updateComponent(componentId, updates);
  },

  /**
   * Delete component
   */
  async deleteComponent(componentId) {
    await api.delete(`/documents/file-components/${componentId}/`);
  },

  async deleteDocumentComponent(_documentId, _sectionId, componentId) {
    await this.deleteComponent(componentId);
    return { success: true };
  },

  /**
   * Reorder component
   */
  async reorderComponent(componentId, newOrder) {
    const response = await api.post(`/documents/file-components/${componentId}/reorder/`, {
      order: newOrder
    });
    return response.data;
  },

  /**
   * Update display properties
   */
  async updateDisplay(componentId, displayProps) {
    const response = await api.patch(`/documents/file-components/${componentId}/update-display/`, displayProps);
    return response.data;
  },

  /**
   * Get section's file components
   */
  async getSectionComponents(sectionId) {
    const response = await api.get(`/documents/sections/${sectionId}/file-components/`);
    return response.data;
  },

  /**
   * Get display modes
   */
  getDisplayModes() {
    return [
      { value: 'link', label: 'Link', description: 'Clickable download link', icon: '🔗' },
      { value: 'embed', label: 'Embed', description: 'Embedded viewer (PDF only)', icon: '📄' },
      { value: 'download', label: 'Download Button', description: 'Prominent download button', icon: '⬇️' },
      { value: 'reference', label: 'Reference', description: 'Metadata only, no direct access', icon: '📌' },
      { value: 'icon', label: 'Icon', description: 'Compact icon view', icon: '🔍' }
    ];
  }
};

export default documentFileService;
