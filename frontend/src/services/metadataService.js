/**
 * Document Metadata Service
 * Handles all metadata operations for documents
 * Based on DOCUMENT_METADATA_SYSTEM.md specification
 */

import api from './api';

export const metadataService = {
  // ---------------------------------------------------------------------------
  // GET: Retrieve Metadata
  // ---------------------------------------------------------------------------
  
  /**
   * Get all metadata for a document
   * @param {string} documentId - Document UUID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Metadata response
   */
  getMetadata: async (documentId, options = {}) => {
    const params = {};
    
    if (options.fields && options.fields.length > 0) {
      params.fields = options.fields.join(',');
    }
    if (options.includeCustom !== undefined) {
      params.include_custom = options.includeCustom;
    }
    if (options.includeStructured !== undefined) {
      params.include_structured = options.includeStructured;
    }
    if (options.format) {
      params.format = options.format;
    }
    
    const response = await api.get(`/documents/${documentId}/metadata/`, { params });
    return response.data;
  },

  /**
   * Extract specific metadata fields using dot notation
   * @param {string} documentId - Document UUID
   * @param {string[]} fields - Array of field paths
   * @returns {Promise<Object>} Extracted fields
   */
  extractFields: async (documentId, fields) => {
    if (!fields || fields.length === 0) {
      throw new Error('Fields array is required for extraction');
    }
    
    const response = await api.get(`/documents/${documentId}/metadata/extract/`, {
      params: { fields: fields.join(',') }
    });
    return response.data;
  },

  /**
   * Get metadata schema for a document
   * @param {string} documentId - Document UUID
   * @returns {Promise<Object>} Schema structure
   */
  getSchema: async (documentId) => {
    const response = await api.get(`/documents/${documentId}/metadata/schema/`);
    return response.data;
  },

  /**
   * Get metadata change history
   * @param {string} documentId - Document UUID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} History entries
   */
  getHistory: async (documentId, options = {}) => {
    const params = {};
    
    if (options.limit) {
      params.limit = options.limit;
    }
    if (options.field) {
      params.field = options.field;
    }
    
    const response = await api.get(`/documents/${documentId}/metadata/history/`, { params });
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // POST/PUT/PATCH: Update Metadata
  // ---------------------------------------------------------------------------

  /**
   * Upload or update document metadata
   * @param {string} documentId - Document UUID
   * @param {Object} metadata - Metadata object with dot-notation field paths
   * @param {Object} options - Upload options
   * @param {string} options.target - 'document_metadata' or 'custom_metadata' (required)
   * @param {boolean} options.merge - Merge with existing metadata (default: true)
   * @param {boolean} options.createChangelog - Create changelog entry (default: false)
   * @returns {Promise<Object>} Update response
   * 
   * @example
   * // Structured metadata
   * await uploadMetadata(docId, {
   *   'dates.invoice_date': '2026-03-18',
   *   'financial.grand_total': 75520
   * }, { target: 'document_metadata', createChangelog: true });
   * 
   * // Custom metadata
   * await uploadMetadata(docId, {
   *   'Invoice No': 'INV-2026-001',
   *   'bank_name': 'Axis Bank'
   * }, { target: 'custom_metadata' });
   */
  uploadMetadata: async (documentId, metadata, options = {}) => {
    const payload = {
      metadata,
      target: options.target || 'document_metadata',
      merge: options.merge ?? true,
      create_changelog: options.createChangelog ?? false
    };
    
    const response = await api.post(`/documents/${documentId}/metadata/upload/`, payload);
    return response.data;
  },

  /**
   * Bulk update multiple metadata fields
   * @param {string} documentId - Document UUID
   * @param {Object} metadata - Metadata object with dot-notation field paths
   * @param {Object} options - Update options
   * @param {string} options.target - 'document_metadata' or 'custom_metadata' (required)
   * @param {boolean} options.createChangelog - Create changelog entry (default: false)
   * @returns {Promise<Object>} Bulk update response
   * 
   * @example
   * await bulkUpdate(docId, {
   *   'dates.invoice_date': '2026-03-18',
   *   'dates.due_date': '2026-03-25',
   *   'financial.grand_total': 75520
   * }, { target: 'document_metadata', createChangelog: true });
   */
  bulkUpdate: async (documentId, metadata, options = {}) => {
    const payload = {
      metadata,
      target: options.target || 'document_metadata',
      create_changelog: options.createChangelog ?? false
    };
    
    const response = await api.put(`/documents/${documentId}/metadata/bulk-update/`, payload);
    return response.data;
  },

  /**
   * Merge metadata while preserving existing fields
   * @param {string} documentId - Document UUID
   * @param {Object} metadata - Nested metadata object to merge
   * @param {string} target - 'document_metadata' or 'custom_metadata' (default: 'document_metadata')
   * @returns {Promise<Object>} Merge response
   * 
   * @example
   * await mergeMetadata(docId, {
   *   dates: { invoice_date: '2026-03-18' }
   * }, 'document_metadata');
   */
  mergeMetadata: async (documentId, metadata, target = 'document_metadata') => {
    const payload = { metadata, target };
    const response = await api.patch(`/documents/${documentId}/metadata/merge/`, payload);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // DELETE: Remove Metadata
  // ---------------------------------------------------------------------------

  /**
   * Remove specific metadata fields
   * @param {string} documentId - Document UUID
   * @param {string[]} fields - Field paths to remove (dot-notation)
   * @param {string} target - 'document_metadata', 'custom_metadata', or 'both' (default: 'both')
   * @returns {Promise<Object>} Removal response
   * 
   * @example
   * await removeFields(docId, ['dates.invoice_date', 'financial.subtotal']);
   * await removeFields(docId, ['Invoice No'], 'custom_metadata');
   */
  removeFields: async (documentId, fields, target = 'both') => {
    const params = {
      fields: fields.join(',')
    };
    
    if (target && target !== 'both') {
      params.target = target;
    }
    
    const response = await api.delete(`/documents/${documentId}/metadata/remove/`, { params });
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Update a single metadata field
   * @param {string} documentId - Document UUID
   * @param {string} fieldPath - Dot notation field path (e.g., 'dates.invoice_date')
   * @param {*} value - Field value
   * @param {string} target - 'document_metadata' or 'custom_metadata' (default: 'document_metadata')
   * @returns {Promise<Object>} Update response
   * 
   * @example
   * await updateField(docId, 'dates.invoice_date', '2026-03-18', 'document_metadata');
   * await updateField(docId, 'Invoice No', 'INV-2026-001', 'custom_metadata');
   */
  updateField: async (documentId, fieldPath, value, target = 'document_metadata') => {
    const metadata = { [fieldPath]: value };
    return metadataService.uploadMetadata(documentId, metadata, {
      target,
      merge: true,
      createChangelog: true
    });
  },

  /**
   * Get specific field value
   * @param {string} documentId - Document UUID
   * @param {string} fieldPath - Dot notation field path
   * @returns {Promise<*>} Field value
   */
  getField: async (documentId, fieldPath) => {
    const result = await metadataService.extractFields(documentId, [fieldPath]);
    return result.extracted_fields?.[fieldPath];
  },

  /**
   * Check if fields exist
   * @param {string} documentId - Document UUID
   * @param {string[]} fields - Field paths to check
   * @returns {Promise<Object>} Exists status for each field
   */
  checkFieldsExist: async (documentId, fields) => {
    try {
      const result = await metadataService.extractFields(documentId, fields);
      const exists = {};
      fields.forEach(field => {
        exists[field] = !result.missing_fields?.includes(field);
      });
      return exists;
    } catch (error) {
      console.error('Error checking fields:', error);
      return {};
    }
  },

  /**
   * Validate metadata structure before upload
   * @param {Object} metadata - Metadata to validate
   * @returns {Object} Validation result
   */
  validateMetadata: (metadata) => {
    const errors = [];
    const warnings = [];

    if (!metadata || typeof metadata !== 'object') {
      errors.push('Metadata must be an object');
      return { valid: false, errors, warnings };
    }

    // Validate date fields
    const dateFields = ['dates.effective_date', 'dates.expiration_date', 'dates.execution_date'];
    Object.keys(metadata).forEach(key => {
      if (dateFields.some(df => key.includes(df))) {
        const dateValue = metadata[key];
        if (dateValue && !isValidDate(dateValue)) {
          warnings.push(`Invalid date format for ${key}: ${dateValue}. Expected YYYY-MM-DD`);
        }
      }
    });

    return { valid: errors.length === 0, errors, warnings };
  },

  /**
   * Parse flat metadata to nested structure
   * @param {Object} flatMetadata - Flat metadata with dot notation
   * @returns {Object} Nested metadata structure
   */
  parseToNested: (flatMetadata) => {
    const nested = {};
    
    Object.keys(flatMetadata).forEach(key => {
      const parts = key.split('.');
      let current = nested;
      
      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          current[part] = flatMetadata[key];
        } else {
          current[part] = current[part] || {};
          current = current[part];
        }
      });
    });
    
    return nested;
  },

  /**
   * Flatten nested metadata to dot notation
   * @param {Object} nestedMetadata - Nested metadata structure
   * @param {string} prefix - Key prefix for recursion
   * @returns {Object} Flat metadata with dot notation
   */
  flattenMetadata: (nestedMetadata, prefix = '') => {
    const flat = {};
    
    Object.keys(nestedMetadata).forEach(key => {
      const value = nestedMetadata[key];
      const newKey = prefix ? `${prefix}.${key}` : key;
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flat, metadataService.flattenMetadata(value, newKey));
      } else {
        flat[newKey] = value;
      }
    });
    
    return flat;
  }
};

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Validate date string format (YYYY-MM-DD)
 */
function isValidDate(dateString) {
  if (typeof dateString !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

export default metadataService;
