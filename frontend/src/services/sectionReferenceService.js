export const sectionReferenceService = {
  createReferenceObject(data) {
    return {
      client_id: data.client_id || `temp_ref_${Date.now()}`,
      source_section: data.source_section || data.sourceSection,
      target_document: data.target_document || data.targetDocument,
      target_section: data.target_section || data.targetSection,
      reference_type: data.reference_type || data.referenceType || 'embed',
      order: data.order ?? 0,
      show_title: data.show_title ?? data.showTitle ?? true,
      show_content: data.show_content ?? data.showContent ?? true,
    };
  },
};

export default sectionReferenceService;
