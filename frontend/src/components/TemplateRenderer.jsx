import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getTemplateById, getHeadingFontSize, getSectionIndentation, getSectionNumbering } from '../templates/documentTemplates';
import SimpleParagraphEditor from './SimpleParagraphEditor';
import LatexCodeEditor from './LatexCodeEditor';
import { mergeMetadataSources } from '../utils/metadataMerge';

/**
 * TemplateRenderer - Renders document using template configuration
 * 
 * Applies complete template styling to document sections, paragraphs, images
 * Controls fonts, spacing, dimensions, element visibility based on template
 */
const TemplateRenderer = ({
  document,
  templateId,
  isPreviewMode,
  onUpdate,
  onSectionUpdate,
  onSectionDelete,
  onParagraphUpdate,
  onParagraphDelete,
  onLatexCodeUpdate,
  onOpenMetadata,
  onAddParagraph,
  onImageDrop,
  onImageSelect,
  onImageResize,
  onImageUpdateAlignment,
  onImageDelete,
  onImageToggleVisibility,
  getImageUrl,
  onResolveReference,
  documentId,
  onAddSubsection,
  onAddSiblingSection,
}) => {
  const template = getTemplateById(templateId);
  const [currentPage, setCurrentPage] = useState(1);
  const contentRef = useRef(null);
  const documentMetadata = useMemo(() => (
    mergeMetadataSources(
      document?.document_metadata,
      document?.metadata?.document_metadata,
      document?.custom_metadata,
      document?.metadata?.custom_metadata
    )
  ), [document]);

  // Calculate page dimensions
  const pageWidth = getPageWidth(template.page);
  const pageHeight = getPageHeight(template.page);
  const contentWidth = pageWidth - template.page.margins.left - template.page.margins.right;
  const contentHeight = pageHeight - template.page.margins.top - template.page.margins.bottom;

  // Render section with template styling
  const renderSection = (section, depth = 0, parentNumbers = []) => {
    if (!section) return null;

    const headingLevel = Math.min(depth + 1, 6);
    const fontSize = getHeadingFontSize(template, headingLevel);
    const indentation = getSectionIndentation(template, depth);
    const numbering = getSectionNumbering(template, section, parentNumbers);
    const currentNumbers = template.sections.includeParentNumbers
      ? [...parentNumbers, section.order || 1]
      : [section.order || 1];

    // Section spacing
    const spacingBefore = depth === 0 
      ? template.sections.spacing.beforeSection 
      : template.sections.spacing.beforeSubsection;
    const spacingAfter = depth === 0
      ? template.sections.spacing.afterSection
      : template.sections.spacing.afterSubsection;

    // Section styles
    const sectionStyles = {
      marginLeft: `${indentation}px`,
      marginTop: `${spacingBefore}px`,
      marginBottom: `${spacingAfter}px`,
      color: template.colors.heading,
      fontFamily: template.typography.fonts.heading,
    };

    // Heading styles
    const headingStyles = {
      fontSize: `${fontSize}px`,
      fontWeight: template.typography.fontWeights.heading,
      textTransform: template.typography.textTransform[`h${headingLevel}`] || 'none',
      letterSpacing: template.typography.letterSpacing[`h${headingLevel}`] || 'normal',
      lineHeight: template.typography.baseLineHeight,
      marginBottom: '8px',
      position: 'relative',
    };

    // Decoration styles
    const decorationStyles = {};
    if (template.sections.decoration.showBorder) {
      decorationStyles.borderLeft = `${template.sections.decoration.borderWidth}px solid ${template.sections.decoration.borderColor}`;
      decorationStyles.paddingLeft = '12px';
    }
    if (template.sections.decoration.underline) {
      decorationStyles.borderBottom = `${template.sections.decoration.underlineWidth}px solid ${template.sections.decoration.underlineColor}`;
      decorationStyles.paddingBottom = '4px';
    }

    return (
      <div key={section.id} style={sectionStyles} className="template-section">
        {/* Section Header */}
        <div style={{ ...headingStyles, ...decorationStyles }}>
          {template.visibility.showSectionNumbers && numbering && (
            <span className="section-number" style={{ marginRight: '8px', fontWeight: 'bold' }}>
              {numbering}
            </span>
          )}
          <span className="section-title">{section.title}</span>
        </div>

        {/* Section Content */}
        {section.content && (
          <div 
            style={{
              fontFamily: template.typography.fonts.body,
              fontSize: `${template.typography.baseFontSize}px`,
              lineHeight: template.typography.baseLineHeight,
              color: template.colors.text,
              marginBottom: '8px',
            }}
          >
            {section.content}
          </div>
        )}

        {/* Paragraphs */}
        {template.visibility.showImages && section.paragraphs && section.paragraphs.length > 0 && (
          <div className="section-paragraphs">
            {section.paragraphs.map((paragraph) => renderParagraph(paragraph, section))}
          </div>
        )}

        {/* LaTeX blocks */}
        {section.latex_codes && section.latex_codes.length > 0 && (
          <div className="section-latex mt-2">
            {section.latex_codes.map((latex) => renderLatexCode(latex, section))}
          </div>
        )}

        {/* Child Sections */}
        {section.children && section.children.length > 0 && (
          <div className="section-children">
            {section.children.map((child) => renderSection(child, depth + 1, currentNumbers))}
          </div>
        )}
      </div>
    );
  };

  // Render paragraph with template styling
  const renderParagraph = (paragraph, section) => {
    const paragraphStyles = {
      fontFamily: template.typography.fonts.body,
      fontSize: `${template.typography.baseFontSize}px`,
      lineHeight: template.paragraphs.lineHeight,
      textAlign: template.paragraphs.textAlign,
      color: template.colors.text,
      marginTop: `${template.paragraphs.spacing.before}px`,
      marginBottom: `${template.paragraphs.spacing.after}px`,
      textIndent: `${template.paragraphs.firstLineIndent}px`,
      paddingLeft: `${template.paragraphs.blockIndent}px`,
      textDecoration: template.paragraphs.textDecoration,
      fontStyle: template.paragraphs.fontStyle,
    };
    const paragraphIdentifier = paragraph.id || paragraph.client_id;

    return (
      <div key={paragraphIdentifier} style={paragraphStyles} className="template-paragraph">
        {isPreviewMode ? (
          <div dangerouslySetInnerHTML={{ __html: paragraph.content }} />
        ) : (
          <SimpleParagraphEditor
            paragraph={paragraph}
            documentId={documentId}
            documentMetadata={documentMetadata}
            sectionId={section.id || section.client_id}
            onUpdate={(updates) => onParagraphUpdate(paragraphIdentifier, updates)}
            onOpenMetadata={onOpenMetadata}
          />
        )}
      </div>
    );
  };

  const renderLatexCode = (latexCode, section) => {
    const latexId = latexCode?.id || latexCode?.client_id;
    return (
      <div key={latexId} className="template-latex-block my-3">
        <LatexCodeEditor
          latexCode={latexCode}
          sectionId={section?.id || section?.client_id}
          isPreviewMode={isPreviewMode}
          onUpdate={(updates) => onLatexCodeUpdate?.(latexId, updates)}
          onDelete={undefined}
        />
      </div>
    );
  };

  // Render page
  const renderPage = (pageNumber) => {
    const pageStyles = {
      width: `${pageWidth}px`,
      height: `${pageHeight}px`,
      backgroundColor: template.page.backgroundColor,
      position: 'relative',
      margin: '20px auto',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      overflow: 'hidden',
    };

    const contentStyles = {
      position: 'absolute',
      top: `${template.page.margins.top}px`,
      left: `${template.page.margins.left}px`,
      width: `${contentWidth}px`,
      height: `${contentHeight}px`,
      overflow: 'hidden',
    };

    return (
      <div key={pageNumber} style={pageStyles} className="template-page">
        {/* Header */}
        {template.header.enabled && (
          <div
            style={{
              position: 'absolute',
              top: '0',
              left: '0',
              right: '0',
              height: `${template.header.height}px`,
              padding: `${template.page.margins.top / 2}px ${template.page.margins.left}px 0`,
              fontSize: `${template.header.fontSize}px`,
              fontStyle: template.header.fontStyle,
              textAlign: template.header.textAlign,
              borderBottom: template.header.borderBottom
                ? `${template.header.borderWidth}px solid ${template.header.borderColor}`
                : 'none',
              color: template.colors.text,
            }}
          >
            {template.header.content(document)}
          </div>
        )}

        {/* Content Area */}
        <div style={contentStyles}>
          {document.sections && document.sections.map((section) => renderSection(section))}
        </div>

        {/* Footer */}
        {template.footer.enabled && (
          <div
            style={{
              position: 'absolute',
              bottom: '0',
              left: '0',
              right: '0',
              height: `${template.footer.height}px`,
              padding: `0 ${template.page.margins.left}px ${template.page.margins.bottom / 2}px`,
              fontSize: `${template.footer.fontSize}px`,
              textAlign: template.footer.textAlign,
              borderTop: template.footer.borderTop
                ? `${template.footer.borderWidth}px solid ${template.footer.borderColor}`
                : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: template.colors.text,
            }}
          >
            {template.page.showPageNumbers && template.page.pageNumberFormat(pageNumber, 1)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      ref={contentRef}
      className="template-renderer"
      style={{
        fontFamily: template.typography.fonts.body,
        backgroundColor: '#f5f5f5',
        minHeight: '100vh',
        padding: '20px',
      }}
    >
      {renderPage(currentPage)}
    </div>
  );
};

// Helper functions
function getPageWidth(pageConfig) {
  const dimensions = {
    a4: { width: 794, height: 1123 },
    a3: { width: 1123, height: 1587 },
    letter: { width: 816, height: 1056 },
    legal: { width: 816, height: 1344 },
  };
  
  const dim = dimensions[pageConfig.size] || dimensions.a4;
  return pageConfig.orientation === 'portrait' ? dim.width : dim.height;
}

function getPageHeight(pageConfig) {
  const dimensions = {
    a4: { width: 794, height: 1123 },
    a3: { width: 1123, height: 1587 },
    letter: { width: 816, height: 1056 },
    legal: { width: 816, height: 1344 },
  };
  
  const dim = dimensions[pageConfig.size] || dimensions.a4;
  return pageConfig.orientation === 'portrait' ? dim.height : dim.width;
}

export default TemplateRenderer;
