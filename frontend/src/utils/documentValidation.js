/**
 * Document validation helpers.
 *
 * These functions are kept in a standalone module so the editor can easily
 * enable/disable validation without touching save logic.
 */
export const validateDocumentStructure = (document) => {
  const errors = [];

  if (!document?.title || document.title.trim() === '') {
    errors.push('Document title is required');
  }

  if (!document?.sections || document.sections.length === 0) {
    errors.push('Document must have at least one section');
  }

  const validateSectionRecursive = (section, indexPath = '') => {
    const sectionLabel = indexPath ? `Section ${indexPath}` : 'Section';

    if (!section?.title || section.title.trim() === '') {
      errors.push(`${sectionLabel} is missing a title`);
    }

    const hasParagraphs = Array.isArray(section?.paragraphs) && section.paragraphs.length > 0;
    const hasChildren = Array.isArray(section?.children) && section.children.length > 0;

    if (!hasParagraphs && !hasChildren) {
      errors.push(`Section "${section?.title || 'Untitled'}" has no content (no paragraphs or subsections)`);
    }

    section?.paragraphs?.forEach((para, pIndex) => {
      if (!para?.content_text || para.content_text.trim() === '') {
        errors.push(`Paragraph ${pIndex + 1} in section "${section?.title || 'Untitled'}" is empty`);
      }
    });

    section?.children?.forEach((child, childIndex) => {
      const childPath = indexPath ? `${indexPath}.${childIndex + 1}` : `${childIndex + 1}`;
      validateSectionRecursive(child, childPath);
    });
  };

  document?.sections?.forEach((section, index) => validateSectionRecursive(section, String(index + 1)));

  return {
    valid: errors.length === 0,
    errors,
  };
};

export default {
  validateDocumentStructure,
};
