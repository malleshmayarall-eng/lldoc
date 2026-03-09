/**
 * COMPLETE EDITOR TEMPLATES
 * Controls EVERYTHING: UI, tools, page settings, features, panels, etc.
 * Each template defines a complete editing experience
 */

export const EDITOR_TEMPLATES = {
  // ==========================================
  // LEGAL DOCUMENT EDITOR
  // ==========================================
  legal_editor: {
    id: 'legal_editor',
    name: 'Legal Document Editor',
    description: 'Full-featured editor for legal contracts and agreements',
    
    // Editor Mode Configuration
    editor: {
      mode: 'legal',                    // legal, business, academic, simple
      allowedSectionTypes: ['clause', 'article', 'schedule', 'exhibit'],
      maxDepth: 5,                      // Max section nesting
      defaultSectionType: 'clause',
      autoNumbering: true,
      trackChanges: true,
      versionControl: true,
      collaborationMode: false,
    },
    
    // Page Configuration
    page: {
      allowedSizes: ['letter', 'legal', 'a4'],
      defaultSize: 'letter',
      orientation: 'portrait',
      allowOrientationChange: false,
      margins: {
        top: 72,
        right: 72,
        bottom: 72,
        left: 72,
        adjustable: true,              // Can user adjust margins?
        minMargin: 36,
        maxMargin: 144,
      },
      zoom: {
        default: 100,
        min: 50,
        max: 200,
        step: 10,
      },
      background: '#ffffff',
      showGrid: false,
      showRulers: true,
    },
    
    // Toolbar Configuration
    toolbar: {
      enabled: true,
      position: 'top',                  // top, floating
      sticky: true,
      buttons: {
        // Document actions
        save: { enabled: true, shortcut: 'Cmd+S' },
        export: { enabled: true, formats: ['pdf', 'docx', 'txt'] },
        print: { enabled: true },
        
        // View controls
        preview: { enabled: true },
        zoom: { enabled: true },
        fullscreen: { enabled: true },
        
        // Content actions
        addSection: { enabled: true, types: ['clause', 'article'] },
        addParagraph: { enabled: true },
        addTable: { enabled: false },
        addImage: { enabled: true },
        
        // Formatting
        bold: { enabled: true },
        italic: { enabled: true },
        underline: { enabled: true },
        highlight: { enabled: true },
        
        // Legal-specific
        addReference: { enabled: true },
        addFootnote: { enabled: true },
        insertClause: { enabled: true },
        crossReference: { enabled: true },
        
        // Collaboration
        comments: { enabled: true },
        trackChanges: { enabled: true },
        compare: { enabled: true },
      },
    },
    
    // Sidebar Panels Configuration
    sidebars: {
      enabled: true,
      defaultOpen: 'document',          // Which sidebar opens by default
      position: 'right',
      width: 384,                        // pixels
      resizable: true,
      panels: {
        document: {
          enabled: true,
          icon: 'FileText',
          label: 'Document',
          features: ['metadata', 'properties', 'versions'],
        },
        sections: {
          enabled: true,
          icon: 'List',
          label: 'Outline',
          features: ['tree', 'reorder', 'navigate'],
          showDepth: true,
          showNumbering: true,
        },
        references: {
          enabled: true,
          icon: 'Link2',
          label: 'References',
          features: ['citations', 'footnotes', 'cross-refs'],
        },
        images: {
          enabled: true,
          icon: 'ImageIcon',
          label: 'Images',
          features: ['upload', 'gallery', 'inline'],
        },
        attachments: {
          enabled: true,
          icon: 'Paperclip',
          label: 'Attachments',
          features: ['upload', 'download', 'preview'],
        },
        comments: {
          enabled: true,
          icon: 'MessageSquare',
          label: 'Comments',
          features: ['add', 'reply', 'resolve'],
        },
        issues: {
          enabled: true,
          icon: 'AlertCircle',
          label: 'Issues',
          features: ['validation', 'errors', 'warnings'],
        },
        layout: {
          enabled: true,
          icon: 'Layout',
          label: 'Layout',
          features: ['page-size', 'margins', 'spacing'],
        },
      },
    },
    
    // Context Menu Configuration
    contextMenu: {
      section: {
        enabled: true,
        actions: ['edit', 'delete', 'duplicate', 'move-up', 'move-down', 'add-subsection', 'add-sibling', 'convert-type'],
      },
      paragraph: {
        enabled: true,
        actions: ['edit', 'delete', 'duplicate', 'format', 'add-comment'],
      },
      text: {
        enabled: true,
        actions: ['copy', 'paste', 'format', 'add-reference', 'add-comment', 'define-term'],
      },
    },
    
    // Keyboard Shortcuts
    shortcuts: {
      enabled: true,
      customizable: false,
      mappings: {
        'Cmd+S': 'save',
        'Cmd+P': 'print',
        'Cmd+Z': 'undo',
        'Cmd+Shift+Z': 'redo',
        'Cmd+B': 'bold',
        'Cmd+I': 'italic',
        'Cmd+U': 'underline',
        'Cmd+K': 'add-reference',
        'Cmd+Enter': 'add-section',
        'Tab': 'indent',
        'Shift+Tab': 'outdent',
      },
    },
    
    // Typography & Styling
    typography: {
      fonts: {
        title: {
          family: 'Times New Roman',
          size: 18,
          weight: 'bold',
          color: '#000000',
          transform: 'uppercase',
          align: 'center',
          lineHeight: 1.5,
          editable: false,
        },
        sectionTitle: {
          family: 'Times New Roman',
          size: 14,
          weight: 'bold',
          color: '#000000',
          transform: 'none',
          align: 'left',
          lineHeight: 1.4,
          editable: true,
        },
        paragraph: {
          family: 'Times New Roman',
          size: 12,
          weight: 'normal',
          color: '#000000',
          align: 'justify',
          lineHeight: 1.6,
          editable: true,
          indent: {
            first: 0,
            left: 0,
            right: 0,
          },
        },
      },
      spacing: {
        beforeTitle: 40,
        afterTitle: 30,
        beforeSection: 24,
        afterSection: 12,
        beforeParagraph: 8,
        afterParagraph: 8,
        editable: true,
      },
      numbering: {
        enabled: true,
        style: 'legal',
        format: {
          level1: (num) => `${num}.`,
          level2: (num, parent) => `${parent}.${num}`,
          level3: (num, parent) => `${parent}.${num}`,
          level4: (num, parent) => `${parent}(${String.fromCharCode(96 + num)})`,
        },
        customizable: false,
      },
    },
    
    // Headers & Footers
    headerFooter: {
      header: {
        enabled: true,
        editable: true,
        height: 60,
        content: {
          left: '',
          center: '{{document.title}}',
          right: '',
        },
        showOnFirstPage: false,
      },
      footer: {
        enabled: true,
        editable: true,
        height: 60,
        content: {
          left: '{{document.version}}',
          center: 'Page {{page.number}} of {{page.total}}',
          right: '{{document.date}}',
        },
        showOnFirstPage: true,
      },
    },
    
    // Features & Capabilities
    features: {
      autosave: {
        enabled: true,
        interval: 30000,              // 30 seconds
      },
      spellcheck: {
        enabled: true,
        language: 'en-US',
      },
      grammar: {
        enabled: true,
      },
      findReplace: {
        enabled: true,
        regex: true,
      },
      export: {
        formats: ['pdf', 'docx', 'txt', 'html'],
        includeMetadata: true,
      },
      import: {
        formats: ['docx', 'txt', 'md'],
      },
      collaboration: {
        realtime: false,
        comments: true,
        suggestions: true,
      },
    },
    
    // Validation Rules
    validation: {
      enabled: true,
      rules: {
        requiredFields: ['title'],
        minSections: 1,
        maxSections: 100,
        maxDepth: 5,
        sectionTitleRequired: true,
        paragraphContentRequired: true,
      },
      showWarnings: true,
      blockSaveOnErrors: false,
    },
  },

  // ==========================================
  // BUSINESS DOCUMENT EDITOR
  // ==========================================
  business_editor: {
    id: 'business_editor',
    name: 'Business Document Editor',
    description: 'Modern editor for business proposals and reports',
    
    editor: {
      mode: 'business',
      allowedSectionTypes: ['section', 'chapter', 'part'],
      maxDepth: 4,
      defaultSectionType: 'section',
      autoNumbering: true,
      trackChanges: false,
      versionControl: true,
      collaborationMode: true,
    },
    
    page: {
      allowedSizes: ['letter', 'a4'],
      defaultSize: 'letter',
      orientation: 'portrait',
      allowOrientationChange: true,
      margins: {
        top: 60,
        right: 60,
        bottom: 60,
        left: 60,
        adjustable: true,
        minMargin: 24,
        maxMargin: 120,
      },
      zoom: {
        default: 100,
        min: 75,
        max: 150,
        step: 25,
      },
      background: '#ffffff',
      showGrid: true,
      showRulers: false,
    },
    
    toolbar: {
      enabled: true,
      position: 'top',
      sticky: true,
      buttons: {
        save: { enabled: true, shortcut: 'Cmd+S' },
        export: { enabled: true, formats: ['pdf', 'pptx', 'docx'] },
        print: { enabled: true },
        
        preview: { enabled: true },
        zoom: { enabled: true },
        fullscreen: { enabled: true },
        
        addSection: { enabled: true, types: ['section', 'chapter'] },
        addParagraph: { enabled: true },
        addTable: { enabled: true },
        addImage: { enabled: true },
        addChart: { enabled: true },
        
        bold: { enabled: true },
        italic: { enabled: true },
        underline: { enabled: true },
        highlight: { enabled: true },
        color: { enabled: true },
        
        bulletList: { enabled: true },
        numberedList: { enabled: true },
        alignment: { enabled: true },
        
        comments: { enabled: true },
        trackChanges: { enabled: false },
        compare: { enabled: false },
      },
    },
    
    sidebars: {
      enabled: true,
      defaultOpen: 'sections',
      position: 'right',
      width: 320,
      resizable: true,
      panels: {
        document: { enabled: true, icon: 'FileText', label: 'Document', features: ['metadata', 'properties'] },
        sections: { enabled: true, icon: 'List', label: 'Outline', features: ['tree', 'reorder'] },
        references: { enabled: false },
        images: { enabled: true, icon: 'ImageIcon', label: 'Media', features: ['upload', 'gallery', 'charts'] },
        attachments: { enabled: true, icon: 'Paperclip', label: 'Files', features: ['upload', 'download'] },
        comments: { enabled: true, icon: 'MessageSquare', label: 'Comments', features: ['add', 'reply', 'resolve'] },
        issues: { enabled: false },
        layout: { enabled: true, icon: 'Layout', label: 'Design', features: ['themes', 'colors', 'spacing'] },
      },
    },
    
    contextMenu: {
      section: {
        enabled: true,
        actions: ['edit', 'delete', 'duplicate', 'add-subsection', 'add-sibling', 'change-style'],
      },
      paragraph: {
        enabled: true,
        actions: ['edit', 'delete', 'format', 'add-comment', 'convert-to-list'],
      },
      text: {
        enabled: true,
        actions: ['copy', 'paste', 'format', 'add-link', 'add-comment'],
      },
    },
    
    shortcuts: {
      enabled: true,
      customizable: true,
      mappings: {
        'Cmd+S': 'save',
        'Cmd+B': 'bold',
        'Cmd+I': 'italic',
        'Cmd+U': 'underline',
        'Cmd+K': 'add-link',
        'Cmd+/': 'add-comment',
      },
    },
    
    typography: {
      fonts: {
        title: {
          family: 'Arial',
          size: 24,
          weight: 'bold',
          color: '#1a73e8',
          transform: 'none',
          align: 'left',
          lineHeight: 1.3,
          editable: true,
        },
        sectionTitle: {
          family: 'Arial',
          size: 16,
          weight: 'bold',
          color: '#202124',
          transform: 'none',
          align: 'left',
          lineHeight: 1.4,
          editable: true,
        },
        paragraph: {
          family: 'Arial',
          size: 11,
          weight: 'normal',
          color: '#202124',
          align: 'left',
          lineHeight: 1.6,
          editable: true,
          indent: { first: 0, left: 0, right: 0 },
        },
      },
      spacing: {
        beforeTitle: 0,
        afterTitle: 40,
        beforeSection: 30,
        afterSection: 16,
        beforeParagraph: 12,
        afterParagraph: 12,
        editable: true,
      },
      numbering: {
        enabled: true,
        style: 'numeric',
        format: {
          level1: (num) => `${num}`,
          level2: (num) => `${num}`,
          level3: (num) => `${num}`,
          level4: (num) => `${num}`,
        },
        customizable: true,
      },
    },
    
    headerFooter: {
      header: { enabled: false },
      footer: {
        enabled: true,
        editable: true,
        height: 40,
        content: {
          left: '',
          center: '',
          right: 'Page {{page.number}}',
        },
        showOnFirstPage: false,
      },
    },
    
    features: {
      autosave: { enabled: true, interval: 60000 },
      spellcheck: { enabled: true, language: 'en-US' },
      grammar: { enabled: true },
      findReplace: { enabled: true, regex: false },
      export: { formats: ['pdf', 'pptx', 'docx'], includeMetadata: false },
      import: { formats: ['docx', 'pptx', 'md'] },
      collaboration: { realtime: true, comments: true, suggestions: true },
    },
    
    validation: {
      enabled: true,
      rules: {
        requiredFields: ['title'],
        minSections: 0,
        maxSections: 50,
        maxDepth: 4,
      },
      showWarnings: true,
      blockSaveOnErrors: false,
    },
  },

  // ==========================================
  // ACADEMIC PAPER EDITOR
  // ==========================================
  academic_editor: {
    id: 'academic_editor',
    name: 'Academic Paper Editor',
    description: 'Strict editor for academic papers and research',
    
    editor: {
      mode: 'academic',
      allowedSectionTypes: ['section', 'subsection'],
      maxDepth: 4,
      defaultSectionType: 'section',
      autoNumbering: true,
      trackChanges: false,
      versionControl: true,
      collaborationMode: false,
    },
    
    page: {
      allowedSizes: ['letter', 'a4'],
      defaultSize: 'letter',
      orientation: 'portrait',
      allowOrientationChange: false,
      margins: {
        top: 96,
        right: 96,
        bottom: 96,
        left: 96,
        adjustable: false,              // Fixed margins for academic
        minMargin: 96,
        maxMargin: 96,
      },
      zoom: {
        default: 100,
        min: 100,
        max: 150,
        step: 25,
      },
      background: '#ffffff',
      showGrid: false,
      showRulers: false,
    },
    
    toolbar: {
      enabled: true,
      position: 'top',
      sticky: true,
      buttons: {
        save: { enabled: true, shortcut: 'Cmd+S' },
        export: { enabled: true, formats: ['pdf', 'docx'] },
        print: { enabled: true },
        
        preview: { enabled: true },
        zoom: { enabled: false },
        fullscreen: { enabled: true },
        
        addSection: { enabled: true, types: ['section', 'subsection'] },
        addParagraph: { enabled: true },
        addTable: { enabled: true },
        addImage: { enabled: true },
        
        bold: { enabled: true },
        italic: { enabled: true },
        underline: { enabled: false },
        highlight: { enabled: false },
        
        addCitation: { enabled: true },
        addFootnote: { enabled: true },
        addBibliography: { enabled: true },
        
        comments: { enabled: false },
        trackChanges: { enabled: false },
      },
    },
    
    sidebars: {
      enabled: true,
      defaultOpen: 'references',
      position: 'right',
      width: 400,
      resizable: false,
      panels: {
        document: { enabled: true, icon: 'FileText', label: 'Manuscript', features: ['metadata', 'wordcount'] },
        sections: { enabled: true, icon: 'List', label: 'Structure', features: ['tree'] },
        references: { enabled: true, icon: 'BookOpen', label: 'References', features: ['citations', 'bibliography'] },
        images: { enabled: true, icon: 'ImageIcon', label: 'Figures', features: ['upload', 'caption'] },
        attachments: { enabled: false },
        comments: { enabled: false },
        issues: { enabled: true, icon: 'AlertCircle', label: 'Validation', features: ['citations', 'formatting'] },
        layout: { enabled: false },
      },
    },
    
    contextMenu: {
      section: {
        enabled: true,
        actions: ['edit', 'delete', 'add-subsection'],
      },
      paragraph: {
        enabled: true,
        actions: ['edit', 'delete', 'add-citation'],
      },
      text: {
        enabled: true,
        actions: ['copy', 'paste', 'add-citation'],
      },
    },
    
    shortcuts: {
      enabled: true,
      customizable: false,
      mappings: {
        'Cmd+S': 'save',
        'Cmd+B': 'bold',
        'Cmd+I': 'italic',
        'Cmd+Shift+C': 'add-citation',
      },
    },
    
    typography: {
      fonts: {
        title: {
          family: 'Times New Roman',
          size: 14,
          weight: 'bold',
          color: '#000000',
          transform: 'none',
          align: 'center',
          lineHeight: 2.0,
          editable: false,
        },
        sectionTitle: {
          family: 'Times New Roman',
          size: 12,
          weight: 'bold',
          color: '#000000',
          transform: 'none',
          align: 'left',
          lineHeight: 2.0,
          editable: false,
        },
        paragraph: {
          family: 'Times New Roman',
          size: 12,
          weight: 'normal',
          color: '#000000',
          align: 'left',
          lineHeight: 2.0,
          editable: false,
          indent: { first: 36, left: 0, right: 0 },
        },
      },
      spacing: {
        beforeTitle: 0,
        afterTitle: 24,
        beforeSection: 24,
        afterSection: 0,
        beforeParagraph: 0,
        afterParagraph: 0,
        editable: false,
      },
      numbering: {
        enabled: true,
        style: 'numeric',
        format: {
          level1: (num) => `${num}.`,
          level2: (num, parent) => `${parent}.${num}`,
          level3: (num, parent) => `${parent}.${num}`,
          level4: (num, parent) => `${parent}.${num}`,
        },
        customizable: false,
      },
    },
    
    headerFooter: {
      header: {
        enabled: true,
        editable: false,
        height: 40,
        content: {
          left: '',
          center: '',
          right: '{{page.number}}',
        },
        showOnFirstPage: false,
      },
      footer: { enabled: false },
    },
    
    features: {
      autosave: { enabled: true, interval: 120000 },
      spellcheck: { enabled: true, language: 'en-US' },
      grammar: { enabled: true },
      findReplace: { enabled: true, regex: false },
      export: { formats: ['pdf', 'docx'], includeMetadata: true },
      import: { formats: ['docx', 'txt'] },
      collaboration: { realtime: false, comments: false, suggestions: false },
    },
    
    validation: {
      enabled: true,
      rules: {
        requiredFields: ['title', 'abstract'],
        minSections: 3,
        maxSections: 20,
        maxDepth: 4,
        sectionTitleRequired: true,
        citationsRequired: true,
      },
      showWarnings: true,
      blockSaveOnErrors: true,
    },
  },

  // ==========================================
  // SIMPLE NOTE EDITOR
  // ==========================================
  simple_editor: {
    id: 'simple_editor',
    name: 'Simple Note Editor',
    description: 'Minimal editor for quick notes and memos',
    
    editor: {
      mode: 'simple',
      allowedSectionTypes: ['section'],
      maxDepth: 2,
      defaultSectionType: 'section',
      autoNumbering: false,
      trackChanges: false,
      versionControl: false,
      collaborationMode: false,
    },
    
    page: {
      allowedSizes: ['letter'],
      defaultSize: 'letter',
      orientation: 'portrait',
      allowOrientationChange: false,
      margins: {
        top: 48,
        right: 48,
        bottom: 48,
        left: 48,
        adjustable: false,
        minMargin: 48,
        maxMargin: 48,
      },
      zoom: {
        default: 100,
        min: 100,
        max: 100,
        step: 25,
      },
      background: '#ffffff',
      showGrid: false,
      showRulers: false,
    },
    
    toolbar: {
      enabled: true,
      position: 'top',
      sticky: false,
      buttons: {
        save: { enabled: true, shortcut: 'Cmd+S' },
        export: { enabled: true, formats: ['txt', 'pdf'] },
        print: { enabled: true },
        
        preview: { enabled: false },
        zoom: { enabled: false },
        fullscreen: { enabled: true },
        
        addSection: { enabled: true, types: ['section'] },
        addParagraph: { enabled: true },
        
        bold: { enabled: true },
        italic: { enabled: true },
        
        bulletList: { enabled: true },
        numberedList: { enabled: true },
      },
    },
    
    sidebars: {
      enabled: false,
      panels: {},
    },
    
    contextMenu: {
      section: {
        enabled: true,
        actions: ['edit', 'delete'],
      },
      paragraph: {
        enabled: true,
        actions: ['edit', 'delete'],
      },
      text: {
        enabled: true,
        actions: ['copy', 'paste'],
      },
    },
    
    shortcuts: {
      enabled: true,
      customizable: false,
      mappings: {
        'Cmd+S': 'save',
        'Cmd+B': 'bold',
        'Cmd+I': 'italic',
      },
    },
    
    typography: {
      fonts: {
        title: {
          family: 'Arial',
          size: 16,
          weight: 'bold',
          color: '#000000',
          transform: 'none',
          align: 'left',
          lineHeight: 1.4,
          editable: true,
        },
        sectionTitle: {
          family: 'Arial',
          size: 14,
          weight: 'bold',
          color: '#000000',
          transform: 'none',
          align: 'left',
          lineHeight: 1.4,
          editable: true,
        },
        paragraph: {
          family: 'Arial',
          size: 12,
          weight: 'normal',
          color: '#000000',
          align: 'left',
          lineHeight: 1.5,
          editable: true,
          indent: { first: 0, left: 0, right: 0 },
        },
      },
      spacing: {
        beforeTitle: 0,
        afterTitle: 20,
        beforeSection: 16,
        afterSection: 8,
        beforeParagraph: 8,
        afterParagraph: 8,
        editable: false,
      },
      numbering: {
        enabled: false,
      },
    },
    
    headerFooter: {
      header: { enabled: false },
      footer: { enabled: false },
    },
    
    features: {
      autosave: { enabled: true, interval: 30000 },
      spellcheck: { enabled: true, language: 'en-US' },
      grammar: { enabled: false },
      findReplace: { enabled: true, regex: false },
      export: { formats: ['txt', 'pdf'], includeMetadata: false },
      import: { formats: ['txt'] },
      collaboration: { realtime: false, comments: false, suggestions: false },
    },
    
    validation: {
      enabled: false,
    },
  },
};

/**
 * Get editor template by ID
 */
export function getEditorTemplate(templateId) {
  return EDITOR_TEMPLATES[templateId] || EDITOR_TEMPLATES.legal_editor;
}

/**
 * Get all available editor templates
 */
export function getAllEditorTemplates() {
  return Object.values(EDITOR_TEMPLATES);
}

/**
 * Check if a feature is enabled in template
 */
export function isFeatureEnabled(template, feature) {
  const parts = feature.split('.');
  let current = template;
  
  for (const part of parts) {
    if (!current || typeof current !== 'object') return false;
    current = current[part];
  }
  
  return current === true;
}

/**
 * Get toolbar buttons that are enabled
 */
export function getEnabledToolbarButtons(template) {
  if (!template.toolbar?.enabled) return [];
  
  return Object.entries(template.toolbar.buttons)
    .filter(([_, config]) => config.enabled)
    .map(([name, config]) => ({ name, ...config }));
}

/**
 * Get enabled sidebar panels
 */
export function getEnabledSidebarPanels(template) {
  if (!template.sidebars?.enabled) return [];
  
  return Object.entries(template.sidebars.panels)
    .filter(([_, config]) => config.enabled)
    .map(([id, config]) => ({ id, ...config }));
}

/**
 * Get allowed page sizes for template
 */
export function getAllowedPageSizes(template) {
  return template.page?.allowedSizes || ['letter'];
}

/**
 * Check if action is allowed in context
 */
export function isContextActionAllowed(template, context, action) {
  return template.contextMenu?.[context]?.actions?.includes(action) || false;
}

export default EDITOR_TEMPLATES;
