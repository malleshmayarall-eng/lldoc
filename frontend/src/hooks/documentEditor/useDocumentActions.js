import { useCallback } from 'react';
import useParagraphActions from './useParagraphActions';
import useSectionActions from './useSectionActions';
import api from '../../services/api';

/**
 * useDocumentActions
 *
 * Encapsulates all local CRUD behavior for the editor. These helpers mutate
 * the in-memory document tree and mark the editor as dirty.
 *
 * CREATE / DELETE use direct API calls (create-first pattern) so every item
 * gets a real database UUID immediately — no temp IDs, no save-structure.
 * UPDATE is handled by the SaveCoordinator (debounced partial-save).
 */
export const useDocumentActions = ({
  completeDocument,
  setCompleteDocument,
  setHasChanges,
  sectionMap,
  paragraphMap,
  latexCodeMap,
  tableMap,
  imageComponentMap,
  fileComponentMap,
  sectionParagraphs,
  sectionLatexCodes,
  sectionTables,
  sectionImages,
  sectionFiles,
  sectionComponents,
}) => {
  const {
    addSection,
    updateSection,
    deleteSection,
    updateSectionTree,
  } = useSectionActions({
    completeDocument,
    setCompleteDocument,
    setHasChanges,
  });

  const {
    addParagraph,
    updateParagraph,
    deleteParagraph,
    reorderParagraphs,
  } = useParagraphActions({
    completeDocument,
    setCompleteDocument,
    setHasChanges,
    updateSectionTree,
  });

  /**
   * Add a dropped image into the targeted section.
   * CREATE-FIRST: Calls the backend API immediately to get a real UUID.
   */
  const handleImageDrop = useCallback(
    async (sectionId, imageData) => {
      if (!completeDocument || !sectionId) return null;

      const isRealSectionId = typeof sectionId === 'string' && sectionId.length >= 32 && !sectionId.startsWith('temp_');
      if (!isRealSectionId) {
        console.error('❌ Cannot create image component: sectionId must be a real UUID');
        return null;
      }

      const imageReferenceId = imageData.image_reference || imageData.image_reference_id || imageData.id;
      if (!imageReferenceId) {
        console.error('❌ Cannot create image component: no image_reference_id');
        return null;
      }

      try {
        // POST to /api/documents/image-components/ → real UUID back
        const created = await api.post('/documents/image-components/', {
          section_id: sectionId,
          image_reference_id: imageReferenceId,
          caption: imageData.caption || '',
          alt_text: imageData.alt_text || '',
          alignment: imageData.alignment || 'center',
          size_mode: imageData.size_mode || 'medium',
          order: imageData.order ?? 0,
          component_type: imageData.component_type || 'figure',
        });

        const newImage = {
          ...created.data,
          id: created.data.id,
        };

        const updated = { ...completeDocument };
        const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
          if (section.id === sectionId || section.client_id === sectionId) {
            const nextImages = [...(section.image_components || []), newImage];
            return { section: { ...section, image_components: nextImages }, updated: true };
          }
          return { section, updated: false };
        });

        if (didUpdate) {
          updated.sections = nextSections;
          setCompleteDocument(updated);
          setHasChanges(true);
          return newImage;
        }

        return null;
      } catch (error) {
        console.error('❌ Failed to create image component via API:', error);
        return null;
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges]
  );

  /**
   * Delete a table from a section.
   * DELETE-FIRST: Calls the backend API immediately, then removes from local state.
   */
  const deleteTable = useCallback(
    async (sectionId, tableId) => {
      if (!completeDocument || !sectionId || !tableId) return;

      // Call DELETE API for real UUIDs
      const isRealId = typeof tableId === 'string' && tableId.length >= 32 && !tableId.startsWith('temp_');
      if (isRealId) {
        try {
          await api.delete(`/documents/tables/${tableId}/`);
        } catch (error) {
          console.error('❌ Failed to delete table via API:', error);
        }
      }

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        if (section.id === sectionId || section.client_id === sectionId) {
          const nextTables = (section.tables || []).filter(
            (t) => (t.id || t.client_id) !== tableId
          );
          const nextTableComponents = (section.table_components || []).filter(
            (t) => (t.id || t.client_id) !== tableId
          );
          return {
            section: { ...section, tables: nextTables, table_components: nextTableComponents },
            updated: true,
          };
        }
        return { section, updated: false };
      });

      if (didUpdate) {
        updated.sections = nextSections;
        setCompleteDocument(updated);
        setHasChanges(true);
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges, updateSectionTree]
  );

  /**
   * Update a table in a section (local state only).
   * SaveCoordinator handles persistence via partial-save.
   */
  const updateTable = useCallback(
    (sectionId, tableId, updates) => {
      if (!completeDocument || !sectionId || !tableId) return;

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        if (section.id === sectionId || section.client_id === sectionId) {
          const nextTables = (section.tables || []).map((t) =>
            (t.id || t.client_id) === tableId ? { ...t, ...updates } : t
          );
          return { section: { ...section, tables: nextTables, table_components: nextTables }, updated: true };
        }
        return { section, updated: false };
      });

      if (didUpdate) {
        updated.sections = nextSections;
        setCompleteDocument(updated);
        setHasChanges(true);
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges, updateSectionTree]
  );

  /**
   * Delete an image component from a section.
   * DELETE-FIRST: Calls the backend API immediately, then removes from local state.
   */
  const deleteImageComponent = useCallback(
    async (sectionId, imageId) => {
      if (!completeDocument || !sectionId || !imageId) return;

      // Call DELETE API for real UUIDs
      const isRealId = typeof imageId === 'string' && imageId.length >= 32 && !imageId.startsWith('temp_');
      if (isRealId) {
        try {
          await api.delete(`/documents/image-components/${imageId}/`);
        } catch (error) {
          console.error('❌ Failed to delete image component via API:', error);
        }
      }

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        if (section.id === sectionId || section.client_id === sectionId) {
          const nextImages = (section.image_components || []).filter(
            (img) => (img.id || img.client_id) !== imageId
          );
          const nextImagesFallback = (section.images || []).filter(
            (img) => (img.id || img.client_id) !== imageId
          );
          return {
            section: { ...section, image_components: nextImages, images: nextImagesFallback },
            updated: true,
          };
        }
        return { section, updated: false };
      });

      if (didUpdate) {
        updated.sections = nextSections;
        setCompleteDocument(updated);
        setHasChanges(true);
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges, updateSectionTree]
  );

  /**
   * Delete a file component from a section.
   * DELETE-FIRST: Calls the backend API immediately, then removes from local state.
   */
  const deleteFileComponent = useCallback(
    async (sectionId, fileId) => {
      if (!completeDocument || !sectionId || !fileId) return;

      // Call DELETE API for real UUIDs
      const isRealId = typeof fileId === 'string' && fileId.length >= 32 && !fileId.startsWith('temp_');
      if (isRealId) {
        try {
          await api.delete(`/documents/file-components/${fileId}/`);
        } catch (error) {
          console.error('❌ Failed to delete file component via API:', error);
        }
      }

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        if (section.id === sectionId || section.client_id === sectionId) {
          const nextFiles = (section.file_components || []).filter(
            (f) => (f.id || f.client_id) !== fileId
          );
          const nextFilesFallback = (section.files || []).filter(
            (f) => (f.id || f.client_id) !== fileId
          );
          return {
            section: { ...section, file_components: nextFiles, files: nextFilesFallback },
            updated: true,
          };
        }
        return { section, updated: false };
      });

      if (didUpdate) {
        updated.sections = nextSections;
        setCompleteDocument(updated);
        setHasChanges(true);
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges, updateSectionTree]
  );

  /**
   * Lookup helpers for fast access to cached entities.
   */
  const getSectionById = useCallback((sectionId) => sectionMap.get(sectionId), [sectionMap]);
  const getParagraphById = useCallback((paragraphId) => paragraphMap.get(paragraphId), [paragraphMap]);
  const getLatexCodeById = useCallback((latexId) => latexCodeMap.get(latexId), [latexCodeMap]);
  const getTableById = useCallback((tableId) => tableMap.get(tableId), [tableMap]);
  const getImageComponentById = useCallback((imageId) => imageComponentMap.get(imageId), [imageComponentMap]);
  const getFileComponentById = useCallback((fileId) => fileComponentMap.get(fileId), [fileComponentMap]);

  /**
   * Return all components for a given section, grouped by type.
   *
   * This is kept for legacy callers that expect separate arrays.
   */
  const getComponentsInSection = useCallback(
    (sectionId) => ({
      paragraphs: sectionParagraphs.get(sectionId) || [],
      latexCodes: sectionLatexCodes.get(sectionId) || [],
      tables: sectionTables.get(sectionId) || [],
      images: sectionImages.get(sectionId) || [],
      files: sectionFiles.get(sectionId) || [],
    }),
    [sectionParagraphs, sectionLatexCodes, sectionTables, sectionImages, sectionFiles]
  );

  /**
   * Return ordered, unified components for a section.
   *
   * This is the preferred helper for the new hierarchical editor model.
   */
  const getOrderedComponentsInSection = useCallback(
    (sectionId) => sectionComponents?.get(sectionId) || [],
    [sectionComponents]
  );

  return {
    addSection,
    updateSection,
    deleteSection,
    addParagraph,
    updateParagraph,
    deleteParagraph,
    reorderParagraphs,
    handleImageDrop,
    deleteTable,
    updateTable,
    deleteImageComponent,
    deleteFileComponent,
    getSectionById,
    getParagraphById,
    getLatexCodeById,
    getTableById,
    getImageComponentById,
    getFileComponentById,
    getComponentsInSection,
    getOrderedComponentsInSection,
  };
};

export default useDocumentActions;
