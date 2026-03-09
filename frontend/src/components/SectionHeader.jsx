import React, { useRef, useEffect, useState } from 'react';
import { ChevronRight, Table } from 'lucide-react';

/**
 * SectionHeader - Clean section title display
 * Auto-resizing title that looks like the actual output
 */
const SectionHeader = ({ 
  section, 
  sectionNumber,
  isExpanded,
  onToggle,
  editable = false,
  onTitleChange,
  onTypeChange,
  onOpenMetadata,
  depth = 0,
  numbering,
}) => {
  // Local state for title editing (like paragraphs)
  const [localTitle, setLocalTitle] = useState(section.title || '');
  const sectionId = section?.id || section?.client_id;
  
  const SECTION_TYPES = [
    { value: 'header', label: 'Document Header' },
    { value: 'preamble', label: 'Preamble' },
    { value: 'definitions', label: 'Definitions' },
    { value: 'body', label: 'Main Body' },
    { value: 'clause', label: 'Clause/Article' },
    { value: 'schedule', label: 'Schedule/Exhibit' },
    { value: 'signature', label: 'Signature Block' },
    { value: 'other', label: 'Other' }
  ];

  // Sync local title with prop changes from parent
  useEffect(() => {
    setLocalTitle(section.title || '');
  }, [section.title]);

  // Determine font size variable based on depth
  const getFontSizeVar = () => {
    if (depth === 0) return 'var(--doc-h2-size, 1.5em)';
    if (depth === 1) return 'var(--doc-h3-size, 1.25em)';
    return 'var(--doc-h4-size, 1.1em)';
  };

  const resolvedNumbering = numbering 
    || section?.custom_metadata?.numbering 
    || section?.numbering 
    || (typeof section?.order === 'number' ? `${section.order + 1}` : '');

  const fontSizeStyle = { fontSize: getFontSizeVar() };
  
  const textareaRef = useRef(null);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (textareaRef.current && editable) {
      const textarea = textareaRef.current;
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to fit content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [localTitle, editable]);

  // Handle blur - save title to parent
  const handleBlur = () => {
    if (localTitle !== section.title && onTitleChange) {
      onTitleChange(localTitle);
    }
  };

  return (
    <div
      className="flex items-start gap-2 mb-1 group"
      data-metadata-anchor="section"
      data-metadata-id={sectionId}
    >
      {editable && onToggle && (
        <button
          onClick={onToggle}
          className="p-0.5 hover:bg-gray-100 rounded transition-colors mt-1 flex-shrink-0"
        >
          <ChevronRight 
            size={16} 
            className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        </button>
      )}
      
      <div className="flex-1 min-w-0 flex flex-col">
        {editable && (
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <select
              value={section.section_type || 'clause'}
              onChange={(e) => onTypeChange && onTypeChange(e.target.value)}
              className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:text-blue-600"
            >
              {SECTION_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (!sectionId) return;
                onOpenMetadata?.({
                  type: 'section',
                  id: sectionId,
                  label: section?.title || 'Section',
                  metadata: section?.metadata || {},
                });
              }}
              className="p-0.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 rounded"
              title="Edit section metadata"
            >
              <Table size={10} />
            </button>
          </div>
        )}
        
        <div className="flex items-baseline gap-1.5">
          {resolvedNumbering && (
            <span className="text-sm font-mono text-gray-500 flex-shrink-0">
              {resolvedNumbering}
            </span>
          )}

          {editable ? (
            <textarea
              ref={textareaRef}
              value={localTitle}
              onChange={(e) => {
                setLocalTitle(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onBlur={handleBlur}
              placeholder={`Section Title`}
              style={{ ...fontSizeStyle, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
              className="w-full font-bold text-gray-900 bg-transparent border-none focus:outline-none focus:ring-0 placeholder-gray-300 p-0 resize-none overflow-hidden leading-snug break-words"
              rows={1}
            />
          ) : (
            <h2 
              className="font-bold text-gray-900 leading-snug break-words"
              style={{ ...fontSizeStyle, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
            >
              {section.title || `Untitled Section`}
            </h2>
          )}
        </div>
      </div>
    </div>
  );
};

export default SectionHeader;

