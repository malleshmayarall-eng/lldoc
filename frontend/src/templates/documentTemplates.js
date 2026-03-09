/**
 * Document Display Templates System
 * 
 * Complete template configurations controlling:
 * - Page layout (size, margins, orientation)
 * - Typography (fonts, sizes, spacing, line heights)
 * - Element visibility and positioning
 * - Section numbering and formatting
 * - Paragraph styling and spacing
 * - Image handling and placement
 * - Color schemes and borders
 * 
 * Each template is a complete JavaScript configuration controlling
 * how the document is rendered on the frontend.
 */

// ============================================================================
// LEGAL DOCUMENT TEMPLATE
// ============================================================================
export const legalTemplate = {
  id: 'legal',
  name: 'Legal Document',
  description: 'Formal legal documents with strict formatting standards',
  
  // Page Configuration
  page: {
    size: 'legal', // 8.5" × 14"
    orientation: 'portrait',
    margins: {
      top: 72, // 1 inch = 72 points
      right: 72,
      bottom: 72,
      left: 108, // 1.5 inch for binding
    },
    backgroundColor: '#FFFFFF',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-center',
    pageNumberFormat: (page, total) => `Page ${page} of ${total}`,
  },
  
  // Typography System
  typography: {
    // Font Families
    fonts: {
      heading: '"Times New Roman", Times, serif',
      body: '"Times New Roman", Times, serif',
      monospace: '"Courier New", Courier, monospace',
    },
    
    // Base Sizes (in pixels)
    baseFontSize: 12,
    baseLineHeight: 1.8, // Double spacing for legal
    
    // Heading Sizes (multipliers of base size)
    headingSizes: {
      h1: 1.5,   // 18px - Document Title
      h2: 1.25,  // 15px - Main Sections
      h3: 1.15,  // 14px - Subsections
      h4: 1.0,   // 12px - Sub-subsections
      h5: 1.0,   // 12px
      h6: 1.0,   // 12px
    },
    
    // Font Weights
    fontWeights: {
      heading: 'bold',
      body: 'normal',
      emphasis: 'bold',
    },
    
    // Text Transform
    textTransform: {
      h1: 'uppercase',
      h2: 'uppercase',
      h3: 'none',
      h4: 'none',
    },
    
    // Letter Spacing
    letterSpacing: {
      h1: '0.05em',
      h2: '0.03em',
      h3: 'normal',
      body: 'normal',
    },
  },
  
  // Section Configuration
  sections: {
    showNumbering: true,
    numberingStyle: 'decimal', // 1, 1.1, 1.1.1
    numberingSeparator: '.',
    includeParentNumbers: true,
    
    // Spacing
    spacing: {
      beforeSection: 24,
      afterSection: 12,
      beforeSubsection: 18,
      afterSubsection: 10,
    },
    
    // Indentation by depth
    indentation: {
      0: 0,    // Root sections - no indent
      1: 36,   // First level subsections
      2: 54,   // Second level
      3: 72,   // Third level
      4: 90,   // Fourth level
    },
    
    // Borders and Decorations
    decoration: {
      showBorder: false,
      borderWidth: 0,
      borderColor: '#000000',
      underline: true,
      underlineColor: '#000000',
      underlineWidth: 1,
    },
  },
  
  // Paragraph Configuration
  paragraphs: {
    // Spacing
    spacing: {
      before: 12,
      after: 12,
      between: 0, // Space between paragraphs in same section
    },
    
    // Indentation
    firstLineIndent: 36, // 0.5 inch
    blockIndent: 0,
    
    // Text Alignment
    textAlign: 'justify',
    
    // Line Height
    lineHeight: 1.8, // Double spacing
    
    // Text Styling
    textDecoration: 'none',
    fontStyle: 'normal',
  },
  
  // Image Configuration
  images: {
    enabled: true,
    defaultAlignment: 'center',
    defaultSize: 'medium',
    showCaptions: true,
    captionPosition: 'below',
    captionFontSize: 10,
    captionStyle: 'italic',
    
    // Spacing around images
    spacing: {
      before: 12,
      after: 12,
      left: 12,
      right: 12,
    },
    
    // Size Constraints
    maxWidth: '100%',
    maxHeight: 600,
    
    // Border
    border: {
      enabled: false,
      width: 1,
      color: '#000000',
      style: 'solid',
    },
  },
  
  // Element Visibility
  visibility: {
    showSectionNumbers: true,
    showParagraphNumbers: false,
    showImages: true,
    showAttachments: true,
    showMetadata: false,
    showReferences: true,
    showFootnotes: true,
    showHeaders: true,
    showFooters: true,
  },
  
  // Document Header
  header: {
    enabled: true,
    height: 54,
    content: (document) => document.title,
    fontSize: 10,
    fontStyle: 'italic',
    textAlign: 'right',
    borderBottom: true,
    borderColor: '#000000',
    borderWidth: 1,
  },
  
  // Document Footer
  footer: {
    enabled: true,
    height: 54,
    fontSize: 10,
    textAlign: 'center',
    borderTop: true,
    borderColor: '#000000',
    borderWidth: 1,
  },
  
  // Color Scheme
  colors: {
    text: '#000000',
    heading: '#000000',
    background: '#FFFFFF',
    border: '#000000',
    link: '#0000EE',
    linkVisited: '#551A8B',
    emphasis: '#000000',
  },
  
  // Special Elements
  specialElements: {
    // Footnotes
    footnotes: {
      enabled: true,
      position: 'bottom',
      fontSize: 10,
      separator: true,
      separatorWidth: 1,
      separatorColor: '#000000',
    },
    
    // References
    references: {
      enabled: true,
      style: 'numeric', // [1], [2], etc.
      showInline: true,
      showBibliography: true,
    },
    
    // Table of Contents
    toc: {
      enabled: true,
      maxDepth: 3,
      showPageNumbers: true,
      dotLeader: true,
    },
  },
};

// ============================================================================
// CONTRACT TEMPLATE
// ============================================================================
export const contractTemplate = {
  id: 'contract',
  name: 'Contract',
  description: 'Business contracts with professional formatting',
  
  page: {
    size: 'letter',
    orientation: 'portrait',
    margins: {
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    },
    backgroundColor: '#FFFFFF',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-right',
    pageNumberFormat: (page, total) => `${page}/${total}`,
  },
  
  typography: {
    fonts: {
      heading: '"Arial", "Helvetica", sans-serif',
      body: '"Arial", "Helvetica", sans-serif',
      monospace: '"Courier New", Courier, monospace',
    },
    baseFontSize: 11,
    baseLineHeight: 1.6,
    headingSizes: {
      h1: 2.0,   // 22px
      h2: 1.5,   // 16.5px
      h3: 1.25,  // 13.75px
      h4: 1.1,   // 12.1px
      h5: 1.0,
      h6: 1.0,
    },
    fontWeights: {
      heading: 'bold',
      body: 'normal',
      emphasis: 'bold',
    },
    textTransform: {
      h1: 'uppercase',
      h2: 'uppercase',
      h3: 'capitalize',
      h4: 'none',
    },
    letterSpacing: {
      h1: '0.1em',
      h2: '0.05em',
      h3: 'normal',
      body: 'normal',
    },
  },
  
  sections: {
    showNumbering: true,
    numberingStyle: 'decimal',
    numberingSeparator: '.',
    includeParentNumbers: true,
    spacing: {
      beforeSection: 20,
      afterSection: 10,
      beforeSubsection: 16,
      afterSubsection: 8,
    },
    indentation: {
      0: 0,
      1: 24,
      2: 48,
      3: 72,
      4: 96,
    },
    decoration: {
      showBorder: true,
      borderWidth: 2,
      borderColor: '#2563eb',
      underline: false,
    },
  },
  
  paragraphs: {
    spacing: {
      before: 10,
      after: 10,
      between: 6,
    },
    firstLineIndent: 0,
    blockIndent: 0,
    textAlign: 'left',
    lineHeight: 1.6,
    textDecoration: 'none',
    fontStyle: 'normal',
  },
  
  images: {
    enabled: true,
    defaultAlignment: 'center',
    defaultSize: 'medium',
    showCaptions: true,
    captionPosition: 'below',
    captionFontSize: 9,
    captionStyle: 'italic',
    spacing: {
      before: 16,
      after: 16,
      left: 16,
      right: 16,
    },
    maxWidth: '100%',
    maxHeight: 500,
    border: {
      enabled: true,
      width: 1,
      color: '#cbd5e1',
      style: 'solid',
    },
  },
  
  visibility: {
    showSectionNumbers: true,
    showParagraphNumbers: false,
    showImages: true,
    showAttachments: true,
    showMetadata: true,
    showReferences: true,
    showFootnotes: true,
    showHeaders: true,
    showFooters: true,
  },
  
  header: {
    enabled: true,
    height: 60,
    content: (document) => `${document.title} - CONFIDENTIAL`,
    fontSize: 9,
    fontStyle: 'normal',
    textAlign: 'center',
    borderBottom: true,
    borderColor: '#2563eb',
    borderWidth: 2,
  },
  
  footer: {
    enabled: true,
    height: 48,
    fontSize: 9,
    textAlign: 'center',
    borderTop: true,
    borderColor: '#cbd5e1',
    borderWidth: 1,
  },
  
  colors: {
    text: '#1e293b',
    heading: '#0f172a',
    background: '#FFFFFF',
    border: '#2563eb',
    link: '#2563eb',
    linkVisited: '#7c3aed',
    emphasis: '#0f172a',
  },
  
  specialElements: {
    footnotes: {
      enabled: true,
      position: 'bottom',
      fontSize: 9,
      separator: true,
      separatorWidth: 1,
      separatorColor: '#cbd5e1',
    },
    references: {
      enabled: true,
      style: 'numeric',
      showInline: true,
      showBibliography: true,
    },
    toc: {
      enabled: true,
      maxDepth: 4,
      showPageNumbers: true,
      dotLeader: true,
    },
  },
};

// ============================================================================
// BUSINESS REPORT TEMPLATE
// ============================================================================
export const reportTemplate = {
  id: 'report',
  name: 'Business Report',
  description: 'Professional business reports with modern styling',
  
  page: {
    size: 'a4',
    orientation: 'portrait',
    margins: {
      top: 96,  // Larger top for header
      right: 72,
      bottom: 72,
      left: 72,
    },
    backgroundColor: '#FFFFFF',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-right',
    pageNumberFormat: (page, total) => `Page ${page} of ${total}`,
  },
  
  typography: {
    fonts: {
      heading: '"Calibri", "Arial", sans-serif',
      body: '"Calibri", "Arial", sans-serif',
      monospace: '"Consolas", "Courier New", monospace',
    },
    baseFontSize: 11,
    baseLineHeight: 1.5,
    headingSizes: {
      h1: 2.2,   // 24.2px
      h2: 1.8,   // 19.8px
      h3: 1.4,   // 15.4px
      h4: 1.2,   // 13.2px
      h5: 1.1,   // 12.1px
      h6: 1.0,
    },
    fontWeights: {
      heading: '600',
      body: 'normal',
      emphasis: '600',
    },
    textTransform: {
      h1: 'none',
      h2: 'none',
      h3: 'none',
      h4: 'none',
    },
    letterSpacing: {
      h1: 'normal',
      h2: 'normal',
      h3: 'normal',
      body: 'normal',
    },
  },
  
  sections: {
    showNumbering: true,
    numberingStyle: 'decimal',
    numberingSeparator: '.',
    includeParentNumbers: true,
    spacing: {
      beforeSection: 24,
      afterSection: 16,
      beforeSubsection: 18,
      afterSubsection: 12,
    },
    indentation: {
      0: 0,
      1: 0,    // No indent for report sections
      2: 0,
      3: 0,
      4: 0,
    },
    decoration: {
      showBorder: false,
      borderWidth: 0,
      borderColor: '#000000',
      underline: false,
    },
  },
  
  paragraphs: {
    spacing: {
      before: 8,
      after: 8,
      between: 4,
    },
    firstLineIndent: 0,
    blockIndent: 0,
    textAlign: 'left',
    lineHeight: 1.5,
    textDecoration: 'none',
    fontStyle: 'normal',
  },
  
  images: {
    enabled: true,
    defaultAlignment: 'center',
    defaultSize: 'large',
    showCaptions: true,
    captionPosition: 'below',
    captionFontSize: 10,
    captionStyle: 'normal',
    spacing: {
      before: 20,
      after: 20,
      left: 20,
      right: 20,
    },
    maxWidth: '100%',
    maxHeight: 700,
    border: {
      enabled: true,
      width: 1,
      color: '#e2e8f0',
      style: 'solid',
    },
  },
  
  visibility: {
    showSectionNumbers: true,
    showParagraphNumbers: false,
    showImages: true,
    showAttachments: true,
    showMetadata: true,
    showReferences: true,
    showFootnotes: true,
    showHeaders: true,
    showFooters: true,
  },
  
  header: {
    enabled: true,
    height: 72,
    content: (document) => document.title,
    fontSize: 10,
    fontStyle: 'normal',
    textAlign: 'left',
    borderBottom: true,
    borderColor: '#2563eb',
    borderWidth: 3,
  },
  
  footer: {
    enabled: true,
    height: 48,
    fontSize: 9,
    textAlign: 'center',
    borderTop: false,
    borderColor: '#cbd5e1',
    borderWidth: 0,
  },
  
  colors: {
    text: '#334155',
    heading: '#0f172a',
    background: '#FFFFFF',
    border: '#2563eb',
    link: '#2563eb',
    linkVisited: '#7c3aed',
    emphasis: '#0f172a',
  },
  
  specialElements: {
    footnotes: {
      enabled: true,
      position: 'bottom',
      fontSize: 9,
      separator: true,
      separatorWidth: 1,
      separatorColor: '#cbd5e1',
    },
    references: {
      enabled: true,
      style: 'apa', // APA citation style
      showInline: true,
      showBibliography: true,
    },
    toc: {
      enabled: true,
      maxDepth: 3,
      showPageNumbers: true,
      dotLeader: true,
    },
  },
};

// ============================================================================
// LETTER TEMPLATE
// ============================================================================
export const letterTemplate = {
  id: 'letter',
  name: 'Formal Letter',
  description: 'Formal business letters with classic styling',
  
  page: {
    size: 'letter',
    orientation: 'portrait',
    margins: {
      top: 108, // 1.5 inches
      right: 72,
      bottom: 72,
      left: 72,
    },
    backgroundColor: '#FFFFFF',
    showPageNumbers: false,
    pageNumberPosition: 'bottom-center',
    pageNumberFormat: (page) => `${page}`,
  },
  
  typography: {
    fonts: {
      heading: '"Georgia", "Times New Roman", serif',
      body: '"Georgia", "Times New Roman", serif',
      monospace: '"Courier New", Courier, monospace',
    },
    baseFontSize: 12,
    baseLineHeight: 1.6,
    headingSizes: {
      h1: 1.5,
      h2: 1.3,
      h3: 1.2,
      h4: 1.1,
      h5: 1.0,
      h6: 1.0,
    },
    fontWeights: {
      heading: 'bold',
      body: 'normal',
      emphasis: 'bold',
    },
    textTransform: {
      h1: 'none',
      h2: 'none',
      h3: 'none',
      h4: 'none',
    },
    letterSpacing: {
      h1: 'normal',
      h2: 'normal',
      h3: 'normal',
      body: 'normal',
    },
  },
  
  sections: {
    showNumbering: false,
    numberingStyle: 'none',
    numberingSeparator: '',
    includeParentNumbers: false,
    spacing: {
      beforeSection: 16,
      afterSection: 12,
      beforeSubsection: 12,
      afterSubsection: 8,
    },
    indentation: {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    },
    decoration: {
      showBorder: false,
      borderWidth: 0,
      borderColor: '#000000',
      underline: false,
    },
  },
  
  paragraphs: {
    spacing: {
      before: 12,
      after: 12,
      between: 0,
    },
    firstLineIndent: 0,
    blockIndent: 0,
    textAlign: 'left',
    lineHeight: 1.6,
    textDecoration: 'none',
    fontStyle: 'normal',
  },
  
  images: {
    enabled: false, // Typically no images in formal letters
    defaultAlignment: 'center',
    defaultSize: 'small',
    showCaptions: false,
    captionPosition: 'below',
    captionFontSize: 10,
    captionStyle: 'italic',
    spacing: {
      before: 12,
      after: 12,
      left: 12,
      right: 12,
    },
    maxWidth: '80%',
    maxHeight: 400,
    border: {
      enabled: false,
      width: 0,
      color: '#000000',
      style: 'none',
    },
  },
  
  visibility: {
    showSectionNumbers: false,
    showParagraphNumbers: false,
    showImages: false,
    showAttachments: false,
    showMetadata: false,
    showReferences: false,
    showFootnotes: false,
    showHeaders: false,
    showFooters: false,
  },
  
  header: {
    enabled: false,
    height: 0,
    content: () => '',
    fontSize: 0,
    fontStyle: 'normal',
    textAlign: 'left',
    borderBottom: false,
    borderColor: '#000000',
    borderWidth: 0,
  },
  
  footer: {
    enabled: false,
    height: 0,
    fontSize: 0,
    textAlign: 'center',
    borderTop: false,
    borderColor: '#000000',
    borderWidth: 0,
  },
  
  colors: {
    text: '#000000',
    heading: '#000000',
    background: '#FFFFFF',
    border: '#000000',
    link: '#0000EE',
    linkVisited: '#551A8B',
    emphasis: '#000000',
  },
  
  specialElements: {
    footnotes: {
      enabled: false,
      position: 'bottom',
      fontSize: 10,
      separator: false,
      separatorWidth: 0,
      separatorColor: '#000000',
    },
    references: {
      enabled: false,
      style: 'none',
      showInline: false,
      showBibliography: false,
    },
    toc: {
      enabled: false,
      maxDepth: 0,
      showPageNumbers: false,
      dotLeader: false,
    },
  },
};

// ============================================================================
// MODERN TEMPLATE
// ============================================================================
export const modernTemplate = {
  id: 'modern',
  name: 'Modern',
  description: 'Clean, modern design with vibrant colors',
  
  page: {
    size: 'a4',
    orientation: 'portrait',
    margins: {
      top: 72,
      right: 60,
      bottom: 60,
      left: 60,
    },
    backgroundColor: '#FAFAFA',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-center',
    pageNumberFormat: (page) => `${page}`,
  },
  
  typography: {
    fonts: {
      heading: '"Inter", "SF Pro Display", -apple-system, sans-serif',
      body: '"Inter", "SF Pro Text", -apple-system, sans-serif',
      monospace: '"JetBrains Mono", "Fira Code", monospace',
    },
    baseFontSize: 10.5,
    baseLineHeight: 1.7,
    headingSizes: {
      h1: 2.5,
      h2: 2.0,
      h3: 1.6,
      h4: 1.3,
      h5: 1.1,
      h6: 1.0,
    },
    fontWeights: {
      heading: '700',
      body: '400',
      emphasis: '600',
    },
    textTransform: {
      h1: 'none',
      h2: 'none',
      h3: 'none',
      h4: 'none',
    },
    letterSpacing: {
      h1: '-0.02em',
      h2: '-0.01em',
      h3: 'normal',
      body: 'normal',
    },
  },
  
  sections: {
    showNumbering: true,
    numberingStyle: 'decimal',
    numberingSeparator: '.',
    includeParentNumbers: true,
    spacing: {
      beforeSection: 28,
      afterSection: 16,
      beforeSubsection: 20,
      afterSubsection: 12,
    },
    indentation: {
      0: 0,
      1: 20,
      2: 40,
      3: 60,
      4: 80,
    },
    decoration: {
      showBorder: true,
      borderWidth: 3,
      borderColor: '#3b82f6',
      underline: false,
    },
  },
  
  paragraphs: {
    spacing: {
      before: 10,
      after: 10,
      between: 6,
    },
    firstLineIndent: 0,
    blockIndent: 0,
    textAlign: 'left',
    lineHeight: 1.7,
    textDecoration: 'none',
    fontStyle: 'normal',
  },
  
  images: {
    enabled: true,
    defaultAlignment: 'center',
    defaultSize: 'large',
    showCaptions: true,
    captionPosition: 'below',
    captionFontSize: 9,
    captionStyle: 'normal',
    spacing: {
      before: 24,
      after: 24,
      left: 24,
      right: 24,
    },
    maxWidth: '100%',
    maxHeight: 800,
    border: {
      enabled: true,
      width: 0,
      color: 'transparent',
      style: 'none',
    },
  },
  
  visibility: {
    showSectionNumbers: true,
    showParagraphNumbers: false,
    showImages: true,
    showAttachments: true,
    showMetadata: true,
    showReferences: true,
    showFootnotes: true,
    showHeaders: true,
    showFooters: true,
  },
  
  header: {
    enabled: true,
    height: 60,
    content: (document) => document.title,
    fontSize: 9,
    fontStyle: 'normal',
    textAlign: 'center',
    borderBottom: true,
    borderColor: '#e5e7eb',
    borderWidth: 1,
  },
  
  footer: {
    enabled: true,
    height: 48,
    fontSize: 9,
    textAlign: 'center',
    borderTop: true,
    borderColor: '#e5e7eb',
    borderWidth: 1,
  },
  
  colors: {
    text: '#374151',
    heading: '#111827',
    background: '#FAFAFA',
    border: '#3b82f6',
    link: '#3b82f6',
    linkVisited: '#8b5cf6',
    emphasis: '#111827',
  },
  
  specialElements: {
    footnotes: {
      enabled: true,
      position: 'bottom',
      fontSize: 8.5,
      separator: true,
      separatorWidth: 1,
      separatorColor: '#e5e7eb',
    },
    references: {
      enabled: true,
      style: 'numeric',
      showInline: true,
      showBibliography: true,
    },
    toc: {
      enabled: true,
      maxDepth: 4,
      showPageNumbers: true,
      dotLeader: true,
    },
  },
};

// ============================================================================
// TEMPLATE REGISTRY
// ============================================================================
const templates = {
  legal: legalTemplate,
  contract: contractTemplate,
  report: reportTemplate,
  letter: letterTemplate,
  modern: modernTemplate,
};

// ============================================================================
// TEMPLATE UTILITIES
// ============================================================================

/**
 * Get all available templates
 */
export const getAllTemplates = () => {
  return Object.values(templates);
};

/**
 * Get template by ID
 */
export const getTemplateById = (id) => {
  return templates[id] || templates.legal; // Default to legal
};

/**
 * Get template display name
 */
export const getTemplateName = (id) => {
  const template = getTemplateById(id);
  return template.name;
};

/**
 * Apply template to get computed styles
 */
export const applyTemplate = (templateId, document) => {
  const template = getTemplateById(templateId);
  
  return {
    ...template,
    // Compute dynamic values
    computedStyles: {
      documentTitle: template.header.content(document),
      pageWidth: getPageWidth(template.page),
      pageHeight: getPageHeight(template.page),
      contentWidth: getContentWidth(template.page),
      contentHeight: getContentHeight(template.page),
    },
  };
};

/**
 * Get page width in pixels
 */
const getPageWidth = (pageConfig) => {
  const dimensions = {
    a4: { width: 794, height: 1123 },
    a3: { width: 1123, height: 1587 },
    letter: { width: 816, height: 1056 },
    legal: { width: 816, height: 1344 },
  };
  
  const dim = dimensions[pageConfig.size] || dimensions.a4;
  return pageConfig.orientation === 'portrait' ? dim.width : dim.height;
};

/**
 * Get page height in pixels
 */
const getPageHeight = (pageConfig) => {
  const dimensions = {
    a4: { width: 794, height: 1123 },
    a3: { width: 1123, height: 1587 },
    letter: { width: 816, height: 1056 },
    legal: { width: 816, height: 1344 },
  };
  
  const dim = dimensions[pageConfig.size] || dimensions.a4;
  return pageConfig.orientation === 'portrait' ? dim.height : dim.width;
};

/**
 * Get content width (page width minus margins)
 */
const getContentWidth = (pageConfig) => {
  const pageWidth = getPageWidth(pageConfig);
  return pageWidth - pageConfig.margins.left - pageConfig.margins.right;
};

/**
 * Get content height (page height minus margins and header/footer)
 */
const getContentHeight = (pageConfig) => {
  const pageHeight = getPageHeight(pageConfig);
  return pageHeight - pageConfig.margins.top - pageConfig.margins.bottom;
};

/**
 * Get font size for heading level
 */
export const getHeadingFontSize = (template, level) => {
  const sizeKey = `h${level}`;
  const multiplier = template.typography.headingSizes[sizeKey] || 1;
  return template.typography.baseFontSize * multiplier;
};

/**
 * Get section indentation for depth
 */
export const getSectionIndentation = (template, depth) => {
  return template.sections.indentation[depth] || 0;
};

/**
 * Get section numbering string
 */
export const getSectionNumbering = (template, section, parentNumbers = []) => {
  if (!template.sections.showNumbering) {
    return '';
  }
  
  const numbers = template.sections.includeParentNumbers
    ? [...parentNumbers, section.order || 1]
    : [section.order || 1];
  
  return numbers.join(template.sections.numberingSeparator);
};

export default templates;
