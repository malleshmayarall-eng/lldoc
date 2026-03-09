/**
 * Metadata Store
 * Zustand store for managing document metadata state
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import metadataService from '../services/metadataService';

const useMetadataStore = create(
  devtools(
    (set, get) => ({
      // ---------------------------------------------------------------------------
      // State
      // ---------------------------------------------------------------------------
      metadata: {},              // Current document metadata
      schema: null,              // Metadata schema
      history: [],               // Change history
      loading: false,            // Loading state
      error: null,               // Error state
      lastUpdated: null,         // Last update timestamp
      documentId: null,          // Current document ID

      // ---------------------------------------------------------------------------
      // Actions: Load Metadata
      // ---------------------------------------------------------------------------

      /**
       * Load all metadata for a document
       */
      loadMetadata: async (documentId, options = {}) => {
        set({ loading: true, error: null, documentId });
        
        try {
          const data = await metadataService.getMetadata(documentId, options);
          set({
            metadata: {
              document_metadata: data.document_metadata || {},
              custom_metadata: data.custom_metadata || {}
            },
            lastUpdated: data.extracted_at,
            loading: false,
            error: null
          });
          return data;
        } catch (error) {
          const errorMessage = error.response?.status === 404 
            ? 'Metadata endpoint not found. Please check backend URL configuration.'
            : error.response?.data?.detail || error.message || 'Failed to load metadata';
          
          set({
            error: errorMessage,
            loading: false
          });
          console.error('Metadata load error:', error);
          throw error;
        }
      },

      /**
       * Load metadata schema
       */
      loadSchema: async (documentId) => {
        try {
          const data = await metadataService.getSchema(documentId);
          set({ schema: data.schema });
          return data.schema;
        } catch (error) {
          console.error('Failed to load schema:', error);
          throw error;
        }
      },

      /**
       * Load metadata history
       */
      loadHistory: async (documentId, options = {}) => {
        try {
          const data = await metadataService.getHistory(documentId, options);
          set({ history: data.history || [] });
          return data.history;
        } catch (error) {
          console.error('Failed to load history:', error);
          throw error;
        }
      },

      /**
       * Extract specific fields
       */
      extractFields: async (documentId, fields) => {
        set({ loading: true, error: null });
        
        try {
          const data = await metadataService.extractFields(documentId, fields);
          set({ loading: false });
          return data.extracted_fields;
        } catch (error) {
          set({
            error: error.response?.data?.detail || error.message,
            loading: false
          });
          throw error;
        }
      },

      // ---------------------------------------------------------------------------
      // Actions: Update Metadata
      // ---------------------------------------------------------------------------

      /**
       * Update metadata (upload)
       */
      updateMetadata: async (documentId, metadata, options = {}) => {
        set({ loading: true, error: null });
        
        try {
          const data = await metadataService.uploadMetadata(documentId, metadata, options);
          
          // Reload metadata after update
          await get().loadMetadata(documentId);
          
          set({ loading: false });
          return data;
        } catch (error) {
          set({
            error: error.response?.data?.detail || error.message,
            loading: false
          });
          throw error;
        }
      },

      /**
       * Upload metadata (alias for updateMetadata for clearer API naming)
       * Uses POST /api/documents/{id}/metadata/upload/
       * 
       * @example
       * uploadMetadata(docId, {
       *   'dates.invoice_date': '2026-03-18',
       *   'dates.due_date': '2026-03-25'
       * }, { target: 'document_metadata', merge: true });
       */
      uploadMetadata: async (documentId, metadata, options = {}) => {
        return get().updateMetadata(documentId, metadata, options);
      },

      /**
       * Update a single field
       * @param {string} documentId - Document UUID
       * @param {string} fieldPath - Dot notation field path (e.g., 'dates.invoice_date')
       * @param {*} value - Field value
       * @param {string} target - 'document_metadata' or 'custom_metadata' (default: 'document_metadata')
       * 
       * @example
       * updateField(docId, 'dates.invoice_date', '2026-03-18', 'document_metadata');
       * updateField(docId, 'Invoice No', 'INV-2026-001', 'custom_metadata');
       */
      updateField: async (documentId, fieldPath, value, target = 'document_metadata') => {
        return get().updateMetadata(documentId, { [fieldPath]: value }, {
          target,
          merge: true,
          createChangelog: true
        });
      },

      /**
       * Bulk update multiple fields
       * @param {string} documentId - Document UUID
       * @param {Object} metadata - Metadata object with dot-notation field paths
       * @param {Object} options - Update options
       * @param {string} options.target - 'document_metadata' or 'custom_metadata'
       * @param {boolean} options.createChangelog - Create changelog entry
       * 
       * @example
       * bulkUpdate(docId, {
       *   'dates.invoice_date': '2026-03-18',
       *   'financial.grand_total': 75520
       * }, { target: 'document_metadata', createChangelog: true });
       */
      bulkUpdate: async (documentId, metadata, options = {}) => {
        set({ loading: true, error: null });
        
        try {
          const data = await metadataService.bulkUpdate(documentId, metadata, options);
          
          // Reload metadata after update
          await get().loadMetadata(documentId);
          
          set({ loading: false });
          return data;
        } catch (error) {
          set({
            error: error.response?.data?.detail || error.message,
            loading: false
          });
          throw error;
        }
      },

      /**
       * Merge metadata
       */
      mergeMetadata: async (documentId, metadata, target = 'both') => {
        set({ loading: true, error: null });
        
        try {
          const data = await metadataService.mergeMetadata(documentId, metadata, target);
          
          // Reload metadata after merge
          await get().loadMetadata(documentId);
          
          set({ loading: false });
          return data;
        } catch (error) {
          set({
            error: error.response?.data?.detail || error.message,
            loading: false
          });
          throw error;
        }
      },

      /**
       * Remove metadata fields
       */
      removeFields: async (documentId, fields, target = 'both') => {
        set({ loading: true, error: null });
        
        try {
          const data = await metadataService.removeFields(documentId, fields, target);
          
          // Reload metadata after removal
          await get().loadMetadata(documentId);
          
          set({ loading: false });
          return data;
        } catch (error) {
          set({
            error: error.response?.data?.detail || error.message,
            loading: false
          });
          throw error;
        }
      },

      // ---------------------------------------------------------------------------
      // Getters
      // ---------------------------------------------------------------------------

      /**
       * Get a specific field value from current metadata
       */
      getFieldValue: (fieldPath) => {
        const { metadata } = get();
        const parts = fieldPath.split('.');
        let value = metadata.document_metadata;
        
        for (const part of parts) {
          if (value && typeof value === 'object') {
            value = value[part];
          } else {
            // Try custom metadata
            value = metadata.custom_metadata;
            for (const p of parts) {
              if (value && typeof value === 'object') {
                value = value[p];
              } else {
                return undefined;
              }
            }
            break;
          }
        }
        
        return value;
      },

      /**
       * Get all structured metadata
       */
      getStructuredMetadata: () => {
        return get().metadata.document_metadata || {};
      },

      /**
       * Get all custom metadata
       */
      getCustomMetadata: () => {
        return get().metadata.custom_metadata || {};
      },

      /**
       * Check if metadata is loaded
       */
      isLoaded: () => {
        const { metadata } = get();
        return metadata && (
          Object.keys(metadata.document_metadata || {}).length > 0 ||
          Object.keys(metadata.custom_metadata || {}).length > 0
        );
      },

      // ---------------------------------------------------------------------------
      // Utility Actions
      // ---------------------------------------------------------------------------

      /**
       * Clear metadata state
       */
      clearMetadata: () => {
        set({
          metadata: {},
          schema: null,
          history: [],
          error: null,
          lastUpdated: null,
          documentId: null
        });
      },

      /**
       * Clear error
       */
      clearError: () => {
        set({ error: null });
      },

      /**
       * Refresh metadata
       */
      refresh: async () => {
        const { documentId } = get();
        if (documentId) {
          await get().loadMetadata(documentId);
        }
      }
    }),
    { name: 'MetadataStore' }
  )
);

export default useMetadataStore;
