import { useCallback } from 'react';
import { paragraphService } from '../../services/paragraphs/paragraphService';

/**
 * useParagraphActions
 *
 * Encapsulates paragraph CRUD inside a section. Uses immutable tree updates
 * so editing one paragraph cannot affect other sections.
 *
 * CREATE / DELETE use direct API calls (create-first pattern) so every
 * paragraph gets a real database UUID immediately — no temp IDs.
 * UPDATE is handled by the SaveCoordinator (debounced partial-save).
 */
export const useParagraphActions = ({
  completeDocument,
  setCompleteDocument,
  setHasChanges,
  updateSectionTree,
}) => {
  /**
   * Add a paragraph to a section.
   * CREATE-FIRST: Calls the backend API immediately to get a real UUID.
   *
   * Accepts either text content or a full paragraph object.
   */
  const addParagraph = useCallback(
    async (sectionId, paragraphData = {}, options = {}) => {
      if (!completeDocument || !sectionId) return null;

      const resolvedData = typeof paragraphData === 'string'
        ? { content: paragraphData }
        : (paragraphData && typeof paragraphData === 'object' ? paragraphData : {});
      const insertAfter = typeof options.insertAfter === 'number'
        ? options.insertAfter
        : (typeof resolvedData.insertAfter === 'number' ? resolvedData.insertAfter : null);

      // Only call API for real section IDs
      const isRealSectionId = typeof sectionId === 'string' && sectionId.length >= 32 && !sectionId.startsWith('temp_');
      if (!isRealSectionId) {
        console.error('❌ Cannot create paragraph: sectionId must be a real UUID, got:', sectionId);
        return null;
      }

      try {
        // POST to /api/documents/paragraphs/ → real UUID back
        const created = await paragraphService.createParagraph(sectionId, {
          content: resolvedData?.content ?? '',
          content_text: resolvedData?.content ?? '',
          order: resolvedData?.order,
          paragraph_type: resolvedData?.style || resolvedData?.paragraph_type || 'standard',
          topic: resolvedData?.topic ?? '',
        });

        const newParagraph = {
          ...created,
          id: created.id,
          content: created.content_text ?? created.content ?? resolvedData?.content ?? '',
          order: created.order ?? resolvedData?.order,
          style: resolvedData?.style || 'normal',
          topic: created.topic ?? resolvedData?.topic ?? '',
          metadata: resolvedData?.metadata ?? [],
        };

        const bumpOrders = (items = [], startOrder) => items.map((item) => {
          const current = item?.order ?? item?.order_index;
          if (typeof current === 'number' && current >= startOrder) {
            return { ...item, order: current + 1, order_index: current + 1 };
          }
          return item;
        });

        const insertComponentAt = (components = [], component, insertAfterIndex, order) => {
          const ordered = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          const insertIndex = typeof insertAfterIndex === 'number'
            ? Math.min(Math.max(insertAfterIndex + 1, 0), ordered.length)
            : ordered.length;
          const nextList = [...ordered];
          nextList.splice(insertIndex, 0, { ...component, order });
          return nextList.map((item, index) => {
            const next = { ...item, order: index };
            if (next.data) {
              next.data.order = index;
              next.data.order_index = index;
            }
            return next;
          });
        };

        const updated = { ...completeDocument };
        const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
          if (section.id === sectionId || section.client_id === sectionId) {
            const existingParagraphs = section.paragraphs || [];
            const orderedComponents = Array.isArray(section.components)
              ? [...section.components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              : null;
            const resolvedInsertAfterOrder = typeof insertAfter === 'number' && orderedComponents?.[insertAfter]
              ? orderedComponents[insertAfter].order
              : insertAfter;
            const nextOrder = typeof newParagraph.order === 'number'
              ? newParagraph.order
              : (typeof resolvedInsertAfterOrder === 'number'
                ? resolvedInsertAfterOrder + 1
                : existingParagraphs.length);
            const paragraphOrder = [...existingParagraphs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const rawInsertIndex = typeof resolvedInsertAfterOrder === 'number'
              ? paragraphOrder.findIndex((para) => (para.order ?? 0) > resolvedInsertAfterOrder)
              : paragraphOrder.length;
            const normalizedInsertIndex = rawInsertIndex === -1
              ? paragraphOrder.length
              : Math.max(0, rawInsertIndex);

            const bumpedParagraphs = bumpOrders(existingParagraphs, nextOrder);
            const nextParagraphs = [...bumpedParagraphs];
            nextParagraphs.splice(normalizedInsertIndex, 0, { ...newParagraph, order: nextOrder });

            const updatedComponents = Array.isArray(section.components)
              ? insertComponentAt(
                  bumpOrders(section.components, nextOrder),
                  { type: 'paragraph', data: { ...newParagraph, order: nextOrder }, id: newParagraph.id },
                  insertAfter,
                  nextOrder
                )
              : section.components;

            return {
              section: {
                ...section,
                paragraphs: nextParagraphs,
                components: updatedComponents,
                tables: bumpOrders(section.tables || section.table_components || [], nextOrder),
                table_components: bumpOrders(section.table_components || section.tables || [], nextOrder),
                image_components: bumpOrders(section.image_components || [], nextOrder),
                file_components: bumpOrders(section.file_components || [], nextOrder),
                section_references: bumpOrders(section.section_references || section.references || [], nextOrder),
                document_references: bumpOrders(section.document_references || [], nextOrder),
                comments: bumpOrders(section.comments || [], nextOrder),
              },
              updated: true,
            };
          }
          return { section, updated: false };
        });

        if (didUpdate) {
          updated.sections = nextSections;
          setCompleteDocument(updated);
          setHasChanges(true);
          return newParagraph;
        }

        return null;
      } catch (error) {
        console.error('❌ Failed to create paragraph via API:', error);
        return null;
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges, updateSectionTree]
  );

  /**
   * Update a paragraph by id (or client_id).
   */
  const updateParagraph = useCallback(
    (paragraphId, updates) => {
      if (!completeDocument || !paragraphId) return;

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        const paraIndex = section.paragraphs?.findIndex(
          (p) => p.id === paragraphId || p.client_id === paragraphId
        );

        if (paraIndex >= 0) {
          const nextParagraphs = [...(section.paragraphs || [])];
          nextParagraphs[paraIndex] = { ...nextParagraphs[paraIndex], ...updates };
          return { section: { ...section, paragraphs: nextParagraphs }, updated: true };
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
   * Delete a paragraph by id (or client_id).
   * DELETE-FIRST: Calls the backend API immediately, then removes from local state.
   */
  const deleteParagraph = useCallback(
    async (paragraphId) => {
      if (!completeDocument || !paragraphId) return;

      // Only call DELETE API for real UUIDs
      const isRealId = typeof paragraphId === 'string' && paragraphId.length >= 32 && !paragraphId.startsWith('temp_');
      if (isRealId) {
        try {
          await paragraphService.deleteParagraph(paragraphId);
        } catch (error) {
          console.error('❌ Failed to delete paragraph via API:', error);
          // Still remove from local state
        }
      }

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        const paraIndex = section.paragraphs?.findIndex(
          (p) => p.id === paragraphId || p.client_id === paragraphId
        );

        if (paraIndex >= 0) {
          const nextParagraphs = [...(section.paragraphs || [])];
          nextParagraphs.splice(paraIndex, 1);
          // Update order for remaining paragraphs (0-based)
          nextParagraphs.forEach((p, idx) => {
            p.order = idx;
          });
          return { section: { ...section, paragraphs: nextParagraphs }, updated: true };
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
   * Reorder paragraphs within a section
   */
  const reorderParagraphs = useCallback(
    (sectionId, fromIndex, toIndex) => {
      if (!completeDocument || !sectionId || fromIndex === toIndex) return;

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        if (section.id === sectionId || section.client_id === sectionId) {
          const nextParagraphs = [...(section.paragraphs || [])];
          const [movedPara] = nextParagraphs.splice(fromIndex, 1);
          nextParagraphs.splice(toIndex, 0, movedPara);
          
          // Update order for ALL paragraphs (0-based, critical for backend)
          nextParagraphs.forEach((p, idx) => {
            p.order = idx;
          });
          
          return { section: { ...section, paragraphs: nextParagraphs }, updated: true };
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

  return {
    addParagraph,
    updateParagraph,
    deleteParagraph,
    reorderParagraphs,
  };
};

export default useParagraphActions;
