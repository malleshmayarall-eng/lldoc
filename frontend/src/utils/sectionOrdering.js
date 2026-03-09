export const buildSectionComponents = (section) => {
  const sources = [
    ['paragraph', section?.paragraphs],
    ['latex_code', section?.latex_codes || section?.latex_code_components || section?.latexCodes],
    ['table', section?.tables || section?.table_components],
    ['image', section?.image_components],
    ['file', section?.file_components],
    ['section_reference', section?.section_references || section?.references],
    ['document_reference', section?.document_references],
    ['comment', section?.comments],
  ];

  const baseComponents = Array.isArray(section?.components) ? [...section.components] : [];
  const seen = new Set(
    baseComponents.map((component) => component?.id ?? component?.data?.id ?? component?.data?.client_id).filter(Boolean)
  );

  sources.forEach(([type, list]) => {
    (list || []).forEach((item, index) => {
      const key = item?.id ?? item?.client_id ?? `${type}-${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      baseComponents.push({
        type,
        data: item,
        order: item?.order ?? item?.order_index ?? index,
        id: key,
      });
    });
  });

  return baseComponents.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

export const reorderComponents = (components, fromIndex, toIndex) => {
  const list = [...components];
  if (fromIndex === toIndex) return list;
  if (toIndex < 0 || toIndex >= list.length) return list;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list.map((component, index) => {
    const next = { ...component, order: index };
    if (next.data) {
      next.data.order = index;
      next.data.order_index = index;
    }
    return next;
  });
};

export const appendComponent = (components, component) => {
  const nextOrder = Math.max(-1, ...components.map((item) => item?.order ?? -1)) + 1;
  const next = { ...component, order: nextOrder };
  if (next.data) {
    next.data.order = nextOrder;
    next.data.order_index = nextOrder;
  }
  return [...components, next];
};

export const insertComponentAt = (components, component, insertAfter) => {
  const ordered = [...components].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const insertIndex = typeof insertAfter === 'number'
    ? Math.min(Math.max(insertAfter + 1, 0), ordered.length)
    : ordered.length;
  const nextList = [...ordered];
  nextList.splice(insertIndex, 0, { ...component });
  return nextList.map((item, index) => {
    const next = { ...item, order: index };
    if (next.data) {
      next.data.order = index;
      next.data.order_index = index;
    }
    return next;
  });
};
