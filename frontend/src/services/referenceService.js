import api from './api';

/**
 * Reference Service
 * Adds cross-references between sections and paragraphs, with optional inline insertion.
 */
export const referenceService = {
  /**
   * Add a cross-reference and optionally insert inline text.
   *
   * @param {Object} params
   * @param {string} params.docId - Document ID
   * @param {'section'|'paragraph'} params.sourceType - Source entity type
   * @param {string} params.sourceId - Source entity ID
   * @param {'section'|'paragraph'} params.targetType - Target entity type
   * @param {string} params.targetId - Target entity ID
   * @param {string} [params.referenceText] - Custom text (auto-generated if omitted)
   * @param {'inline'|'parenthetical'|'footnote'} [params.style='inline'] - Reference style
   * @param {number} [params.position] - Optional character position to insert inline text
   * @param {boolean} [params.insertInline=true] - Whether to also insert the reference text into content
   */
  async addCrossReference({
    docId,
    sourceType,
    sourceId,
    targetType,
    targetId,
    referenceText,
    style = 'inline',
    position,
    insertInline = true,
  }) {
    if (!docId) throw new Error('docId is required');
    if (!sourceType || !sourceId) throw new Error('sourceType/sourceId required');
    if (!targetType || !targetId) throw new Error('targetType/targetId required');

    // Fetch source + target in parallel
    const [sourceRes, targetRes] = await Promise.all([
      sourceType === 'section'
        ? api.get(`/documents/sections/${sourceId}/`)
        : api.get(`/documents/paragraphs/${sourceId}/`),
      targetType === 'section'
        ? api.get(`/documents/sections/${targetId}/`)
        : api.get(`/documents/paragraphs/${targetId}/`),
    ]);

    const sourceData = sourceRes.data;
    const targetData = targetRes.data;

    // Auto-generate reference text if not provided
    const autoText = referenceText
      || (targetType === 'section'
        ? `See Section ${targetData.custom_metadata?.numbering || targetData.title || targetId}`
        : `See paragraph ${targetData.custom_metadata?.numbering || targetId}`);

    const reference = {
      id: `ref_${Date.now()}`,
      type: targetType,
      target_id: targetId,
      target_title: targetData.title || targetData.content_text?.substring(0, 80),
      text: autoText,
      style,
      clickable: true,
      created_at: new Date().toISOString(),
    };

    if (typeof position === 'number') reference.position = position;
    if (targetType === 'paragraph') {
      reference.target_section_id = targetData.section;
      reference.target_paragraph_number = targetData.custom_metadata?.numbering;
    } else {
      reference.target_numbering = targetData.custom_metadata?.numbering;
    }

    const currentRefs = sourceData.custom_metadata?.references || [];
    const updatedRefs = [...currentRefs, reference];

    const insertAt = (content, pos, text) => {
      if (typeof pos !== 'number' || pos < 0 || pos > content.length) return content;
      return `${content.slice(0, pos)}${text}${content.slice(pos)}`;
    };

    if (sourceType === 'section') {
      const content = sourceData.content || sourceData.content_text || '';
      const newContent = insertInline && content ? insertAt(content, position ?? content.length, autoText) : content;

      const payload = {
        section_id: sourceId,
        edits: {
          custom_metadata: {
            ...sourceData.custom_metadata,
            references: updatedRefs,
          },
          ...(newContent ? { content: newContent } : {}),
        },
      };

      const res = await api.post(`/documents/${docId}/edit-section/`, payload);
      return res.data;
    }

    if (sourceType === 'paragraph') {
      const content = sourceData.content || sourceData.content_text || '';
      const newContent = insertInline && content ? insertAt(content, position ?? content.length, autoText) : content;

      const payload = {
        paragraph_id: sourceId,
        edits: {
          custom_metadata: {
            ...sourceData.custom_metadata,
            references: updatedRefs,
          },
          ...(newContent ? { content: newContent } : {}),
        },
      };

      const res = await api.post(`/documents/${docId}/edit-paragraph/`, payload);
      return res.data;
    }

    throw new Error('sourceType must be "section" or "paragraph"');
  },
};

export default referenceService;
