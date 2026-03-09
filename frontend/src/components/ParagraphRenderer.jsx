import React from 'react';
import ParagraphAiRenderer from './ParagraphAiRenderer';

/**
 * ParagraphRenderer - Renders paragraph text  
 * Simplified version - inline images and references removed, use block components instead
 */
const ParagraphRenderer = ({
  paragraph,
  editable = false,
  pageSettings = { size: 'a4', orientation: 'portrait', margins: 24 },
}) => {
  
  return (
    <ParagraphAiRenderer
      paragraph={paragraph}
      className="paragraph-text"
      style={{
        fontSize: `${pageSettings.fontSize || 14}px`,
        lineHeight: 1.6,
        textAlign: 'justify',
        color: '#1f2937',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
};

export default ParagraphRenderer;
