import { useMemo } from 'react';

/**
 * Flatten a nested section tree into a single array.
 *
 * Keeping this helper outside the hook ensures we can reuse it and keeps
 * the useMemo body readable.
 */
const flattenSections = (sections, result = []) => {
  sections.forEach((section) => {
    result.push(section);
    if (section.children?.length > 0) {
      flattenSections(section.children, result);
    }
  });
  return result;
};

/**
 * Normalize a component entry into a common shape that the editor can render.
 * This keeps the editor flexible as new component types are introduced.
 */
const normalizeComponent = (type, data, fallbackOrder, raw = {}) => ({
  type,
  data,
  order: data?.order ?? raw?.order ?? fallbackOrder ?? 0,
  id: data?.id ?? raw?.id ?? `${type}-${fallbackOrder ?? 0}`,
});

/**
 * Build a unified list of section components.
 *
 * The new API can provide `section.components` (already unified). If that list
 * isn't present, we compose a unified list from legacy arrays.
 */
const buildSectionComponents = (section) => {
  if (Array.isArray(section?.components)) {
    return section.components
      .map((component, index) => {
        if (component?.type && component?.data) {
          return normalizeComponent(
            component.type,
            component.data,
            index,
            component
          );
        }

        return normalizeComponent(
          component?.type || component?.component_type || component?.kind || 'unknown',
          component?.data || component,
          index,
          component
        );
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  const sources = [
    ['paragraph', section?.paragraphs],
    ['latex_code', section?.latex_codes || section?.latex_code_components || section?.latexCodes],
    ['table', section?.tables],
    ['image', section?.image_components],
    ['file', section?.file_components],
    ['section_reference', section?.section_references || section?.references],
    ['document_reference', section?.document_references],
    ['comment', section?.comments],
  ];

  const components = [];
  sources.forEach(([type, list]) => {
    (list || []).forEach((item, index) => {
      components.push(normalizeComponent(type, item, index, item));
    });
  });

  return components.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

/**
 * useDocumentDerivedData
 *
 * Computes read-only, derived data from the complete document:
 * - flattened sections
 * - aggregated component lists
 * - maps for O(1) lookup
 * - unified section components
 * - stats + metadata
 */
export const useDocumentDerivedData = (completeDocument) => {
  // Base sections array.
  const sections = useMemo(() => completeDocument?.sections || [], [completeDocument]);

  // Flattened sections for quick iteration and indexing.
  const flatSections = useMemo(() => flattenSections(sections), [sections]);

  // Aggregate component lists for totals and lookups.
  const allParagraphs = useMemo(() => flatSections.flatMap((s) => s.paragraphs || []), [flatSections]);
  const allLatexCodes = useMemo(
    () => flatSections.flatMap((s) => s.latex_codes || s.latex_code_components || s.latexCodes || []),
    [flatSections]
  );
  const allTables = useMemo(() => flatSections.flatMap((s) => s.tables || []), [flatSections]);
  const allImageComponents = useMemo(() => flatSections.flatMap((s) => s.image_components || []), [flatSections]);
  const allFileComponents = useMemo(() => flatSections.flatMap((s) => s.file_components || []), [flatSections]);

  // Unified section components (hierarchical, ordered by `order`).
  const sectionComponents = useMemo(() => {
    const map = new Map();
    flatSections.forEach((section) => {
      map.set(section.id, buildSectionComponents(section));
    });
    return map;
  }, [flatSections]);

  const allComponents = useMemo(
    () => flatSections.flatMap((section) => sectionComponents.get(section.id) || []),
    [flatSections, sectionComponents]
  );

  // Map builders keep lookups fast when editing or rendering.
  const sectionMap = useMemo(() => new Map(flatSections.map((s) => [s.id, s])), [flatSections]);
  const paragraphMap = useMemo(() => new Map(allParagraphs.map((p) => [p.id, p])), [allParagraphs]);
  const latexCodeMap = useMemo(() => new Map(allLatexCodes.map((l) => [l.id, l])), [allLatexCodes]);
  const tableMap = useMemo(() => new Map(allTables.map((t) => [t.id, t])), [allTables]);
  const imageComponentMap = useMemo(() => new Map(allImageComponents.map((img) => [img.id, img])), [allImageComponents]);
  const fileComponentMap = useMemo(() => new Map(allFileComponents.map((f) => [f.id, f])), [allFileComponents]);

  // Section-scoped maps for fast per-section lookups.
  const sectionParagraphs = useMemo(() => {
    const map = new Map();
    flatSections.forEach((section) => map.set(section.id, section.paragraphs || []));
    return map;
  }, [flatSections]);

  const sectionLatexCodes = useMemo(() => {
    const map = new Map();
    flatSections.forEach((section) =>
      map.set(
        section.id,
        section.latex_codes || section.latex_code_components || section.latexCodes || []
      )
    );
    return map;
  }, [flatSections]);

  const sectionTables = useMemo(() => {
    const map = new Map();
    flatSections.forEach((section) => map.set(section.id, section.tables || []));
    return map;
  }, [flatSections]);

  const sectionImages = useMemo(() => {
    const map = new Map();
    flatSections.forEach((section) => map.set(section.id, section.image_components || []));
    return map;
  }, [flatSections]);

  const sectionFiles = useMemo(() => {
    const map = new Map();
    flatSections.forEach((section) => map.set(section.id, section.file_components || []));
    return map;
  }, [flatSections]);

  // Stats are derived from the complete document when missing.
  const stats = useMemo(
    () =>
      completeDocument?.stats || {
        total_sections: flatSections.length,
        total_paragraphs: allParagraphs.length,
        total_latex_codes: allLatexCodes.length,
        total_tables: allTables.length,
        total_images: allImageComponents.length,
        total_files: allFileComponents.length,
      },
    [completeDocument, flatSections, allParagraphs, allLatexCodes, allTables, allImageComponents, allFileComponents]
  );

  const metadata = useMemo(() => completeDocument?.metadata || {}, [completeDocument]);
  const comments = useMemo(() => completeDocument?.comments || [], [completeDocument]);
  const issues = useMemo(() => completeDocument?.issues || [], [completeDocument]);
  const attachments = useMemo(() => completeDocument?.attachments || [], [completeDocument]);

  return {
    sections,
    flatSections,
    allParagraphs,
  allLatexCodes,
    allTables,
    allImageComponents,
    allFileComponents,
    allComponents,
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
    stats,
    metadata,
    comments,
    issues,
    attachments,
  };
};

export default useDocumentDerivedData;
