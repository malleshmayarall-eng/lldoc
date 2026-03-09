import React from 'react';
import SectionHeader from './SectionHeader';
import SimpleParagraphEditor from './SimpleParagraphEditor';
import { Plus, Trash2 } from 'lucide-react';
import { mergeMetadataSources } from '../utils/metadataMerge';

/**
 * DocumentSection - Section with paragraphs
 * Clean, minimal design like Microsoft Word
 */
const DocumentSection = ({
  section,
  sectionIndex,
  documentMetadata,
  editable = false,
  isExpanded = true,
  onToggleExpand,
  onTitleChange,
  onParagraphChange,
  onAddParagraph,
  onDeleteSection,
  onImageDrop,
  onImageSelect,
  onImageDelete,
  onImageToggleVisibility,
}) => {
  return (
    <div className="document-section mb-8 pb-8 border-b border-gray-200 last:border-b-0">
      {/* Section Header */}
      <SectionHeader
        section={section}
        sectionNumber={sectionIndex + 1}
        isExpanded={isExpanded}
        onToggle={onToggleExpand}
        editable={editable}
        onTitleChange={onTitleChange}
      />
      
      {/* Section Content */}
      {isExpanded && (
        <div className="section-content pl-0 md:pl-6">
          {/* Paragraphs */}
          {section.paragraphs && section.paragraphs.length > 0 ? (
            section.paragraphs.map((paragraph, pIndex) => (
              <SimpleParagraphEditor
                key={paragraph.id || pIndex}
                paragraph={paragraph}
                documentMetadata={documentMetadata}
                sectionId={section.id || section.client_id}
                onUpdate={(updates) => onParagraphChange(sectionIndex, pIndex, updates)}
              />
            ))
          ) : (
            <p className="text-gray-400 italic text-sm mb-4">No paragraphs yet</p>
          )}
          
          {/* Add Paragraph Button */}
          {editable && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={onAddParagraph}
                className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Plus size={16} />
                Add Paragraph
              </button>
              
              <button
                onClick={onDeleteSection}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-auto"
              >
                <Trash2 size={16} />
                Delete Section
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentSection;
