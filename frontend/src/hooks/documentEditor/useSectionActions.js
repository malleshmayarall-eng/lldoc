import { useCallback } from 'react';
import { sectionService } from '../../services/sectionService';

/**
 * useSectionActions
 *
 * Isolates all section-level operations (add/update/delete) and the immutable
 * tree helpers they rely on. This keeps section mutations robust and prevents
 * shared-reference bugs where one section edit leaks into another.
 *
 * CREATE / DELETE use direct API calls (create-first pattern) so every item
 * gets a real database UUID immediately — no temp IDs, no save-structure.
 * UPDATE is handled by the SaveCoordinator (debounced partial-save).
 */
export const useSectionActions = ({
  completeDocument,
  setCompleteDocument,
  setHasChanges,
}) => {
  /**
   * Update a section tree immutably and return the updated list.
   */
  const updateSectionTree = (sections, updater) => {
    let didUpdate = false;

    const nextSections = sections.map((section) => {
      const { section: updatedSection, updated } = updater(section);

      if (updated) {
        didUpdate = true;
        return updatedSection;
      }

      if (section.children?.length > 0) {
        const [nextChildren, childUpdated] = updateSectionTree(section.children, updater);
        if (childUpdated) {
          didUpdate = true;
          return { ...section, children: nextChildren };
        }
      }

      return section;
    });

    return [didUpdate ? nextSections : sections, didUpdate];
  };

  /**
   * Remove a section from the tree immutably.
   */
  const removeSectionFromTree = (sections, matcher) => {
    let didRemove = false;

    const nextSections = sections.reduce((acc, section) => {
      if (matcher(section)) {
        didRemove = true;
        return acc;
      }

      if (section.children?.length > 0) {
        const [nextChildren, childRemoved] = removeSectionFromTree(section.children, matcher);
        if (childRemoved) {
          didRemove = true;
          acc.push({ ...section, children: nextChildren });
          return acc;
        }
      }

      acc.push(section);
      return acc;
    }, []);

    return [didRemove ? nextSections : sections, didRemove];
  };

  /**
   * Insert a section into a target list and normalize its order values.
   */
  const insertSectionIntoList = (list, newSection, insertIndex) => {
    const safeIndex = typeof insertIndex === 'number' && insertIndex >= 0
      ? Math.min(insertIndex, list.length)
      : list.length;

    list.splice(safeIndex, 0, newSection);
    list.forEach((section, index) => {
      section.order = index;
    });
  };

  /**
   * Add a new section (root or nested) at a specific position.
   * CREATE-FIRST: Calls the backend API immediately to get a real UUID.
   */
  const addSection = useCallback(
    async (sectionDataOrType, insertIndex = -1, parentId = null, depthLevel) => {
      if (!completeDocument) return null;

      const isTypeString = typeof sectionDataOrType === 'string';
      const baseData = isTypeString ? {} : (sectionDataOrType || {});
      const sectionType = isTypeString ? sectionDataOrType : baseData.section_type;

      const order = typeof insertIndex === 'number' && insertIndex >= 0
        ? insertIndex
        : (baseData.order ?? 0);

      // Resolve the real parent UUID (skip temp/client IDs)
      let resolvedParentId = null;
      if (parentId) {
        // If parentId looks like a real UUID, use it
        const isRealId = typeof parentId === 'string' && parentId.length >= 32 && !parentId.startsWith('temp_');
        resolvedParentId = isRealId ? parentId : null;
      }

      try {
        // POST to /api/documents/{docId}/sections/ → real UUID back
        const created = await sectionService.createSection(completeDocument.id, {
          document: completeDocument.id,
          title: baseData.title || 'Section Name Here ..',
          content_text: baseData.content_text || '',
          order,
          depth_level: depthLevel ?? baseData.depth_level ?? 1,
          section_type: sectionType || 'clause',
          metadata: baseData.metadata ?? [],
          parent: resolvedParentId,
        });

        const newSection = {
          ...created,
          id: created.id,
          title: created.title || baseData.title || 'Section Name Here ..',
          content_text: created.content_text || '',
          order: created.order ?? order,
          depth_level: created.depth_level ?? depthLevel ?? 1,
          section_type: created.section_type || sectionType || 'clause',
          metadata: created.metadata ?? [],
          paragraphs: [],
          tables: [],
          image_components: [],
          file_components: [],
          children: [],
        };

        const updated = { ...completeDocument };

        if (parentId) {
          const [nextSections, didInsert] = updateSectionTree(updated.sections || [], (section) => {
            if (section.id === parentId || section.client_id === parentId) {
              const children = [...(section.children || [])];
              insertSectionIntoList(children, newSection, insertIndex);
              return { section: { ...section, children }, updated: true };
            }
            return { section, updated: false };
          });

          if (didInsert) {
            updated.sections = nextSections;
            setCompleteDocument(updated);
            setHasChanges(true);
            return newSection;
          }

          return null;
        }

        const rootSections = [...(updated.sections || [])];
        insertSectionIntoList(rootSections, newSection, insertIndex);
        updated.sections = rootSections;

        setCompleteDocument(updated);
        setHasChanges(true);
        return newSection;
      } catch (error) {
        console.error('❌ Failed to create section via API:', error);
        return null;
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges]
  );

  /**
   * Update section metadata (title, type, numbering, etc.).
   */
  const updateSection = useCallback(
    (sectionId, updates) => {
      if (!completeDocument || !sectionId) return;

      const updated = { ...completeDocument };
      const [nextSections, didUpdate] = updateSectionTree(updated.sections || [], (section) => {
        if (section.id === sectionId || section.client_id === sectionId) {
          return { section: { ...section, ...updates }, updated: true };
        }
        return { section, updated: false };
      });

      if (didUpdate) {
        updated.sections = nextSections;
        setCompleteDocument(updated);
        setHasChanges(true);
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges]
  );

  /**
   * Remove a section from the document tree.
   * DELETE-FIRST: Calls the backend API immediately, then removes from local state.
   */
  const deleteSection = useCallback(
    async (sectionId) => {
      if (!completeDocument || !sectionId) return;

      // Only call DELETE API for real UUIDs (not temp IDs)
      const isRealId = typeof sectionId === 'string' && sectionId.length >= 32 && !sectionId.startsWith('temp_');
      if (isRealId) {
        try {
          await sectionService.deleteSection(sectionId);
        } catch (error) {
          console.error('❌ Failed to delete section via API:', error);
          // Still remove from local state even if API fails (could be already deleted)
        }
      }

      const updated = { ...completeDocument };
      const [nextSections, didRemove] = removeSectionFromTree(
        updated.sections || [],
        (section) => section.id === sectionId || section.client_id === sectionId
      );

      if (didRemove) {
        updated.sections = nextSections;
        setCompleteDocument(updated);
        setHasChanges(true);
      }
    },
    [completeDocument, setCompleteDocument, setHasChanges]
  );

  return {
    addSection,
    updateSection,
    deleteSection,
    updateSectionTree,
  };
};

export default useSectionActions;
