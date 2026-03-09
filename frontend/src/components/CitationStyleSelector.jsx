import React from 'react';
import { CITATION_STYLES } from '../utils/citationFormatter';

/**
 * Citation Style Selector
 * Allows users to choose how citations should be displayed
 */
const CitationStyleSelector = ({ currentStyle, onStyleChange }) => {
  const styles = [
    { value: CITATION_STYLES.FOOTNOTE, label: 'Footnotes', icon: '¹' },
    { value: CITATION_STYLES.INLINE, label: 'Inline', icon: '()' },
    { value: CITATION_STYLES.DEFINITION, label: 'Definitions', icon: '?' },
    { value: CITATION_STYLES.NUMBERED, label: 'Numbered', icon: '[1]' },
  ];

  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
      {styles.map(style => (
        <button
          key={style.value}
          onClick={() => onStyleChange(style.value)}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
            currentStyle === style.value
              ? 'bg-blue-100 text-blue-700 shadow-sm'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
          title={style.label}
        >
          <span className="mr-1.5">{style.icon}</span>
          {style.label}
        </button>
      ))}
    </div>
  );
};

export default CitationStyleSelector;
