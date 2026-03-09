import React, { useMemo } from 'react';
import { applyPlaceholdersToHtml, applySuggestionHighlight } from '../utils/paragraphAiPlaceholderRenderer';

const ParagraphAiRenderer = ({
  paragraph,
  className = 'paragraph-text',
  activeSuggestion = null,
  style,
  documentMetadata, // Only document metadata now
}) => {
  const baseText = paragraph?.edited_text || paragraph?.content || paragraph?.content_text || '';

  const renderedHtml = useMemo(() => {
    const html = applyPlaceholdersToHtml(baseText, documentMetadata || {});
    if (activeSuggestion) {
      return applySuggestionHighlight(html, activeSuggestion);
    }
    return html;
  }, [baseText, documentMetadata, activeSuggestion]);

  if (!paragraph) return null;

  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderedHtml || '' }}
    />
  );
};

export default ParagraphAiRenderer;
