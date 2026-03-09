/**
 * Template System Examples
 * Complete examples of using the document template system
 */

import { getTemplate, getAllTemplates, applyTemplateToPageSettings } from '../templates';
import TemplatedDocument from '../components/TemplatedDocument';
import TemplateSelector from '../components/TemplateSelector';

// ============================================
// Example 1: Basic Template Usage
// ============================================

export function Example1_BasicUsage() {
  const [selectedTemplate, setSelectedTemplate] = React.useState('legal_contract');
  
  // Sample document data (from backend API)
  const document = {
    id: 123,
    title: 'Software License Agreement',
    version: '1.0',
    created_at: '2024-01-04',
    sections: [
      {
        id: 1,
        title: 'Grant of License',
        content: 'The Licensor grants to Licensee a non-exclusive, non-transferable license...',
        order: 0,
        depth_level: 1,
        paragraphs: [
          {
            id: 10,
            content: 'Subject to the terms and conditions of this Agreement...',
            order: 0,
          }
        ],
        children: [
          {
            id: 2,
            title: 'Scope of License',
            content: 'The license granted herein includes...',
            order: 0,
            depth_level: 2,
            paragraphs: [],
            children: [],
          }
        ],
      }
    ],
  };
  
  return (
    <div>
      <TemplateSelector 
        currentTemplateId={selectedTemplate}
        onTemplateChange={setSelectedTemplate}
      />
      
      <TemplatedDocument
        document={document}
        sections={document.sections}
        templateId={selectedTemplate}
      />
    </div>
  );
}

// ============================================
// Example 2: Programmatic Template Access
// ============================================

export function Example2_ProgrammaticAccess() {
  // Get specific template
  const legalTemplate = getTemplate('legal_contract');
  console.log('Legal template:', legalTemplate);
  
  // Access template properties
  console.log('Font family:', legalTemplate.fonts.paragraph.family);
  console.log('Page size:', legalTemplate.page.size);
  console.log('Margins:', legalTemplate.page.margins);
  
  // Get all available templates
  const allTemplates = getAllTemplates();
  console.log('Available templates:', allTemplates.map(t => t.name));
  
  // Convert to page settings
  const pageSettings = applyTemplateToPageSettings(legalTemplate);
  console.log('Page settings:', pageSettings);
}

// ============================================
// Example 3: Custom Template Creation
// ============================================

export const CUSTOM_TEMPLATE = {
  id: 'quarterly_report',
  name: 'Quarterly Report',
  description: 'Corporate quarterly report format',
  
  page: {
    size: 'letter',
    orientation: 'portrait',
    margins: { top: 60, right: 60, bottom: 60, left: 60 },
    background: '#ffffff',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-right',
    showHeader: true,
    showFooter: true,
  },
  
  fonts: {
    title: {
      family: 'Helvetica',
      size: 24,
      weight: 'bold',
      color: '#1a1a1a',
      transform: 'none',
      align: 'left',
      lineHeight: 1.2,
      spacing: -1,
    },
    sectionTitle: {
      family: 'Helvetica',
      size: 18,
      weight: 'bold',
      color: '#0066cc',
      transform: 'none',
      align: 'left',
      lineHeight: 1.3,
      spacing: 0,
    },
    subsectionTitle: {
      family: 'Helvetica',
      size: 14,
      weight: '600',
      color: '#333333',
      transform: 'none',
      align: 'left',
      lineHeight: 1.3,
      spacing: 0,
    },
    paragraph: {
      family: 'Helvetica',
      size: 11,
      weight: 'normal',
      color: '#1a1a1a',
      align: 'left',
      lineHeight: 1.6,
      spacing: 0,
      indent: {
        first: 0,
        left: 0,
        right: 0,
      },
    },
  },
  
  spacing: {
    beforeTitle: 0,
    afterTitle: 30,
    beforeSection: 24,
    afterSection: 12,
    beforeParagraph: 10,
    afterParagraph: 10,
    betweenSections: 20,
  },
  
  numbering: {
    showNumbers: true,
    style: 'numeric',
    separator: '.',
    includeInTitle: false,
    formats: {
      level1: (num) => `${num}`,
      level2: (num) => `${num}`,
      level3: (num) => `${num}`,
      level4: (num) => `${num}`,
    },
  },
  
  showElements: {
    logo: true,
    metadata: true,
    versions: true,
    comments: true,
    issues: true,
    toolbar: true,
    sidebar: true,
    references: true,
    images: true,
    attachments: true,
  },
  
  header: {
    enabled: true,
    content: {
      left: 'Q4 2024 Report',
      center: '',
      right: '{{document.date}}',
    },
    style: {
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: '#666666',
      borderBottom: '2px solid #0066cc',
      padding: 10,
    },
  },
  
  footer: {
    enabled: true,
    content: {
      left: 'Confidential',
      center: '',
      right: 'Page {{page.number}}',
    },
    style: {
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: '#999999',
      borderTop: '1px solid #e0e0e0',
      padding: 10,
    },
  },
};

// ============================================
// Example 4: Template-Based Rendering
// ============================================

export function Example4_ConditionalRendering({ document, sections }) {
  const [templateId, setTemplateId] = React.useState('business_proposal');
  const template = getTemplate(templateId);
  
  // Conditionally show elements based on template
  const shouldShowComments = template.showElements.comments;
  const shouldShowVersions = template.showElements.versions;
  
  return (
    <div>
      {/* Template Selector */}
      <div className="mb-4">
        <label>Choose Template:</label>
        <select 
          value={templateId} 
          onChange={(e) => setTemplateId(e.target.value)}
          className="ml-2 border rounded px-2 py-1"
        >
          <option value="legal_contract">Legal Contract</option>
          <option value="business_proposal">Business Proposal</option>
          <option value="academic_paper">Academic Paper</option>
          <option value="memo">Internal Memo</option>
        </select>
      </div>
      
      {/* Conditional UI Elements */}
      {shouldShowVersions && (
        <div className="version-info">
          Version: {document.version}
        </div>
      )}
      
      {shouldShowComments && (
        <div className="comments-panel">
          {/* Comments UI */}
        </div>
      )}
      
      {/* Document Render */}
      <TemplatedDocument
        document={document}
        sections={sections}
        templateId={templateId}
      />
    </div>
  );
}

// ============================================
// Example 5: Dynamic Template Modification
// ============================================

export function Example5_DynamicModification() {
  const [fontSize, setFontSize] = React.useState(12);
  const [lineHeight, setLineHeight] = React.useState(1.6);
  const [margins, setMargins] = React.useState(72);
  
  // Create dynamic template
  const dynamicTemplate = {
    ...getTemplate('legal_contract'),
    fonts: {
      ...getTemplate('legal_contract').fonts,
      paragraph: {
        ...getTemplate('legal_contract').fonts.paragraph,
        size: fontSize,
        lineHeight: lineHeight,
      },
    },
    page: {
      ...getTemplate('legal_contract').page,
      margins: {
        top: margins,
        right: margins,
        bottom: margins,
        left: margins,
      },
    },
  };
  
  return (
    <div>
      <div className="controls">
        <label>
          Font Size:
          <input 
            type="range" 
            min="10" 
            max="16" 
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          {fontSize}pt
        </label>
        
        <label>
          Line Height:
          <input 
            type="range" 
            min="1.0" 
            max="2.5" 
            step="0.1"
            value={lineHeight}
            onChange={(e) => setLineHeight(Number(e.target.value))}
          />
          {lineHeight}
        </label>
        
        <label>
          Margins:
          <input 
            type="range" 
            min="36" 
            max="144" 
            step="12"
            value={margins}
            onChange={(e) => setMargins(Number(e.target.value))}
          />
          {margins}px ({(margins / 72).toFixed(2)}")
        </label>
      </div>
      
      {/* Use dynamic template (not recommended for production) */}
      {/* Better to create proper template in documentTemplates.js */}
    </div>
  );
}

// ============================================
// Example 6: Template Comparison View
// ============================================

export function Example6_TemplateComparison({ document, sections }) {
  const templates = ['legal_contract', 'business_proposal', 'academic_paper'];
  
  return (
    <div className="grid grid-cols-3 gap-4">
      {templates.map(templateId => (
        <div key={templateId} className="border rounded p-4">
          <h3 className="font-bold mb-2">
            {getTemplate(templateId).name}
          </h3>
          <div style={{ transform: 'scale(0.3)', transformOrigin: 'top left' }}>
            <TemplatedDocument
              document={document}
              sections={sections}
              templateId={templateId}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Example 7: Print/Export with Template
// ============================================

export function Example7_PrintExport({ document, sections, templateId }) {
  const handlePrint = () => {
    const template = getTemplate(templateId);
    
    // Apply template styles to print window
    const printWindow = window.open('', '_blank');
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${document.title}</title>
          <style>
            @page {
              size: ${template.page.size};
              margin: ${template.page.margins.top}px ${template.page.margins.right}px ${template.page.margins.bottom}px ${template.page.margins.left}px;
            }
            body {
              font-family: ${template.fonts.paragraph.family};
              font-size: ${template.fonts.paragraph.size}pt;
              line-height: ${template.fonts.paragraph.lineHeight};
              color: ${template.fonts.paragraph.color};
            }
            h1 {
              font-family: ${template.fonts.title.family};
              font-size: ${template.fonts.title.size}pt;
              font-weight: ${template.fonts.title.weight};
              text-align: ${template.fonts.title.align};
            }
            /* Add more styles based on template */
          </style>
        </head>
        <body>
          <h1>${document.title}</h1>
          <!-- Render content here -->
        </body>
      </html>
    `);
    
    printWindow.document.close();
    printWindow.print();
  };
  
  return (
    <button onClick={handlePrint}>
      Print with {getTemplate(templateId).name} Template
    </button>
  );
}

// ============================================
// Example 8: Template Validation
// ============================================

export function validateTemplate(template) {
  const errors = [];
  
  // Validate required fields
  if (!template.id) errors.push('Template must have an id');
  if (!template.name) errors.push('Template must have a name');
  
  // Validate page settings
  if (!['letter', 'legal', 'a4', 'a3'].includes(template.page?.size)) {
    errors.push('Invalid page size');
  }
  
  // Validate fonts
  if (!template.fonts?.paragraph?.family) {
    errors.push('Paragraph font family is required');
  }
  
  if (template.fonts?.paragraph?.size < 8 || template.fonts?.paragraph?.size > 20) {
    errors.push('Paragraph font size should be between 8 and 20');
  }
  
  // Validate margins
  const margins = template.page?.margins;
  if (margins) {
    if (margins.top + margins.bottom > 500) {
      errors.push('Total vertical margins too large');
    }
    if (margins.left + margins.right > 500) {
      errors.push('Total horizontal margins too large');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Usage
const customTemplate = { /* ... */ };
const validation = validateTemplate(customTemplate);
if (!validation.isValid) {
  console.error('Template validation failed:', validation.errors);
}

// ============================================
// Example 9: Template Inheritance
// ============================================

export function createTemplateVariant(baseTemplateId, overrides) {
  const baseTemplate = getTemplate(baseTemplateId);
  
  return {
    ...baseTemplate,
    ...overrides,
    fonts: {
      ...baseTemplate.fonts,
      ...overrides.fonts,
    },
    page: {
      ...baseTemplate.page,
      ...overrides.page,
    },
    spacing: {
      ...baseTemplate.spacing,
      ...overrides.spacing,
    },
  };
}

// Create a variant of legal_contract with larger font
const largeFontLegal = createTemplateVariant('legal_contract', {
  id: 'legal_contract_large',
  name: 'Legal Contract (Large Print)',
  fonts: {
    paragraph: {
      size: 14, // Larger than standard 12pt
    },
  },
});

// ============================================
// Example 10: Template Presets for Document Types
// ============================================

export const DOCUMENT_TYPE_PRESETS = {
  contract: 'legal_contract',
  proposal: 'business_proposal',
  research: 'academic_paper',
  memo: 'memo',
  report: 'business_proposal',
  thesis: 'academic_paper',
  agreement: 'legal_contract',
};

export function getTemplateForDocumentType(documentType) {
  return DOCUMENT_TYPE_PRESETS[documentType] || 'legal_contract';
}

// Usage in component
function DocumentEditor({ document }) {
  const recommendedTemplate = getTemplateForDocumentType(document.type);
  
  return (
    <TemplatedDocument
      document={document}
      sections={document.sections}
      templateId={recommendedTemplate}
    />
  );
}
