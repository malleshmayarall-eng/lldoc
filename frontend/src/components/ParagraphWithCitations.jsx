import React, { useState, useEffect } from 'react';
import { formatWithCitations, generateCitationList, CITATION_STYLES } from '../utils/citationFormatter';
import { BookOpen, Hash, List, FileText } from 'lucide-react';

/**
 * ParagraphWithCitations Component
 * 
 * Displays paragraph text with inline reference markers converted to citations
 * Shows citation list below the paragraph with proper formatting
 */
const ParagraphWithCitations = ({
  paragraph,
  citationStyle = CITATION_STYLES.FOOTNOTE,
  showCitationList = true,
  onReferenceClick,
}) => {
  const [formattedContent, setFormattedContent] = useState({ text: '', citations: [] });

  useEffect(() => {
    if (!paragraph) return;

    const { effective_content, inline_references } = paragraph;
    
    // Format text with citations
    const formatted = formatWithCitations(
      effective_content,
      inline_references || [],
      citationStyle
    );
    
    setFormattedContent(formatted);
  }, [paragraph, citationStyle]);

  const handleCitationClick = (e) => {
    const target = e.target.closest('[data-ref-id]');
    if (!target) return;

    const refId = target.dataset.refId;
    const citation = formattedContent.citations.find(c => c.refId === refId);
    
    if (citation && onReferenceClick) {
      onReferenceClick(citation);
    }
  };

  if (!paragraph) return null;

  return (
    <div className="paragraph-with-citations">
      {/* Paragraph Text with Inline Citations */}
      <div 
        className="paragraph-text"
        dangerouslySetInnerHTML={{ __html: formattedContent.text }}
        onClick={handleCitationClick}
      />

      {/* Citation List */}
      {showCitationList && formattedContent.citations.length > 0 && (
        <div className="citations-section mt-4 pt-4 border-t border-gray-300">
          {formattedContent.citations.map((citation, index) => (
            <div 
              key={citation.refId || index}
              className="citation-item mb-2 pl-4 text-sm text-gray-700 hover:bg-gray-50 rounded"
              dangerouslySetInnerHTML={{ __html: citation.formattedCitation }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * SectionWithCitations Component
 * 
 * Displays section with all paragraphs and their citations
 * Can show citations per paragraph or consolidated at section bottom
 */
export const SectionWithCitations = ({
  section,
  citationStyle = CITATION_STYLES.FOOTNOTE,
  consolidateCitations = false,
  onReferenceClick,
}) => {
  const [allCitations, setAllCitations] = useState([]);

  useEffect(() => {
    if (!section || !consolidateCitations) return;

    // Collect all citations from all paragraphs
    const citations = [];
    let citationNumber = 1;

    section.paragraphs?.forEach(para => {
      const { effective_content, inline_references } = para;
      const formatted = formatWithCitations(
        effective_content,
        inline_references || [],
        citationStyle
      );
      
      formatted.citations.forEach(citation => {
        citations.push({
          ...citation,
          id: citationNumber++,
          paragraphId: para.id,
        });
      });
    });

    setAllCitations(citations);
  }, [section, citationStyle, consolidateCitations]);

  if (!section) return null;

  return (
    <div className="section-with-citations">
      {/* Section Title */}
      <h3 className="section-title text-xl font-bold mb-4">
        {section.title}
      </h3>

      {/* Section Content */}
      {section.content && (
        <div className="section-content mb-4 text-gray-700">
          {section.content}
        </div>
      )}

      {/* Paragraphs */}
      <div className="section-paragraphs space-y-4">
        {section.paragraphs?.map(para => (
          <ParagraphWithCitations
            key={para.id}
            paragraph={para}
            citationStyle={citationStyle}
            showCitationList={!consolidateCitations}
            onReferenceClick={onReferenceClick}
          />
        ))}
      </div>

      {/* Consolidated Citations */}
      {consolidateCitations && allCitations.length > 0 && (
        <div className="section-citations mt-6 pt-6 border-t-2 border-gray-400">
          <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BookOpen size={20} />
            Section References
          </h4>
          <div className="space-y-2">
            {allCitations.map((citation, index) => (
              <div 
                key={citation.refId || index}
                className="citation-item pl-4 text-sm text-gray-700 hover:bg-gray-50 rounded p-2"
                dangerouslySetInnerHTML={{ __html: citation.formattedCitation }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Child Sections */}
      {section.children && section.children.length > 0 && (
        <div className="section-children mt-6 ml-6">
          {section.children.map(child => (
            <SectionWithCitations
              key={child.id}
              section={child}
              citationStyle={citationStyle}
              consolidateCitations={consolidateCitations}
              onReferenceClick={onReferenceClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * CitationStyleSelector Component
 * 
 * Dropdown to select citation style
 */
export const CitationStyleSelector = ({ currentStyle, onStyleChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const styles = [
    { 
      id: CITATION_STYLES.FOOTNOTE, 
      name: 'Footnotes', 
      icon: Hash,
      description: 'Numbered references at bottom of paragraph',
    },
    { 
      id: CITATION_STYLES.ENDNOTE, 
      name: 'Endnotes', 
      icon: FileText,
      description: 'Numbered references at end of section',
    },
    { 
      id: CITATION_STYLES.INLINE, 
      name: 'Inline', 
      icon: List,
      description: '(See Section X) inline format',
    },
    { 
      id: CITATION_STYLES.NUMBERED, 
      name: 'Numbered', 
      icon: Hash,
      description: 'Sequential numbering throughout',
    },
    { 
      id: CITATION_STYLES.LABELED, 
      name: 'Labeled', 
      icon: BookOpen,
      description: '[Label] references with names',
    },
    { 
      id: CITATION_STYLES.DEFINITION, 
      name: 'Definition', 
      icon: BookOpen,
      description: 'Hover tooltips with definitions',
    },
  ];

  const currentStyleData = styles.find(s => s.id === currentStyle) || styles[0];

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <currentStyleData.icon size={16} className="text-gray-600" />
        <div className="flex flex-col items-start">
          <span className="text-xs text-gray-500">Citation Style</span>
          <span className="text-sm font-semibold text-gray-900">
            {currentStyleData.name}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl z-20 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-3">
              <div className="text-sm font-bold">Citation Styles</div>
              <div className="text-xs opacity-90">Choose how references are displayed</div>
            </div>

            <div className="p-2 max-h-96 overflow-y-auto">
              {styles.map((style) => (
                <button
                  key={style.id}
                  onClick={() => {
                    onStyleChange(style.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-3 rounded-lg transition-all mb-1 ${
                    currentStyle === style.id
                      ? 'bg-blue-50 border-2 border-blue-500'
                      : 'hover:bg-gray-50 border-2 border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <style.icon 
                      size={20} 
                      className={currentStyle === style.id ? 'text-blue-600' : 'text-gray-400'}
                    />
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900 text-sm">
                        {style.name}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {style.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * DocumentWithCitations Component
 * 
 * Full document renderer with citation support
 */
export const DocumentWithCitations = ({
  document,
  citationStyle = CITATION_STYLES.FOOTNOTE,
  consolidateCitations = false,
  onReferenceClick,
}) => {
  if (!document) return null;

  return (
    <div className="document-with-citations max-w-4xl mx-auto p-8">
      {/* Document Title */}
      <h1 className="document-title text-3xl font-bold mb-6">
        {document.title}
      </h1>

      {/* Document Metadata */}
      {document.description && (
        <div className="document-description text-gray-600 mb-8">
          {document.description}
        </div>
      )}

      {/* Sections */}
      <div className="document-sections space-y-8">
        {document.sections?.map(section => (
          <SectionWithCitations
            key={section.id}
            section={section}
            citationStyle={citationStyle}
            consolidateCitations={consolidateCitations}
            onReferenceClick={onReferenceClick}
          />
        ))}
      </div>
    </div>
  );
};

export default ParagraphWithCitations;
