/**
 * Component Integration Examples
 * Quick code snippets for using SectionTree, TextFormatToolbar, and ReferenceDialog
 */

import React, { useState } from 'react';
import { DocumentSectionTree } from '../components/SectionTree';
import TextFormatToolbar from '../components/TextFormatToolbar';
import ReferenceDialog from '../components/ReferenceDialog';

// ============================================================================
// EXAMPLE 1: Basic Section Tree
// ============================================================================

export function BasicSectionTreeExample() {
  const [document] = useState({
    title: 'Service Agreement',
    children: [
      {
        id: 's1',
        title: 'Definitions',
        custom_metadata: { numbering: '1' },
        paragraphs: [],
        children: [
          {
            id: 's1.1',
            title: 'Terms',
            custom_metadata: { numbering: '1.1' },
            children: []
          }
        ]
      },
      {
        id: 's2',
        title: 'Scope of Services',
        custom_metadata: { numbering: '2' },
        children: []
      }
    ]
  });

  const [selectedSectionId, setSelectedSectionId] = useState(null);

  return (
    <div className="w-80 bg-white border rounded-lg p-4">
      <DocumentSectionTree
        document={document}
        selectedSectionId={selectedSectionId}
        onSelectSection={(section) => setSelectedSectionId(section.id)}
        onAddSection={() => alert('Add root section')}
        onAddSubsection={(parentId, depth) => 
          alert(`Add subsection to ${parentId} at depth ${depth}`)
        }
        onEditSection={(section) => alert(`Edit: ${section.title}`)}
        onDeleteSection={(sectionId) => alert(`Delete: ${sectionId}`)}
      />
    </div>
  );
}

// ============================================================================
// EXAMPLE 2: Text Format Toolbar with Text Selection
// ============================================================================

export function TextFormatToolbarExample() {
  const [selectedRange, setSelectedRange] = useState(null);
  const [content, setContent] = useState('This is some sample text that can be formatted.');
  const [formatting, setFormatting] = useState({
    font_family: 'Arial',
    font_size: 12,
    alignment: 'left',
    styles: []
  });

  const handleTextSelection = (e) => {
    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    if (start !== end) {
      setSelectedRange([start, end]);
    }
  };

  const handleApplyFormat = (formatData) => {
    console.log('Applying format:', formatData);
    
    // Update formatting state
    const newFormatting = { ...formatting };
    
    switch (formatData.type) {
      case 'style':
        newFormatting.styles = [
          ...formatting.styles,
          { range: formatData.range, style: formatData.style }
        ];
        break;
      case 'alignment':
        newFormatting.alignment = formatData.alignment;
        break;
      case 'font':
        newFormatting.font_family = formatData.fontFamily;
        break;
      case 'fontSize':
        newFormatting.font_size = formatData.fontSize;
        break;
      case 'color':
        newFormatting.styles = [
          ...formatting.styles,
          { range: formatData.range, color: formatData.color }
        ];
        break;
    }
    
    setFormatting(newFormatting);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <TextFormatToolbar
        selectedRange={selectedRange}
        currentFormatting={formatting}
        onApplyFormat={handleApplyFormat}
        onInsertImage={() => alert('Insert image')}
        onInsertLink={() => alert('Insert link')}
      />
      
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onSelect={handleTextSelection}
        className="w-full h-64 p-4 border border-gray-300 rounded-lg resize-none"
        placeholder="Type or select text to format..."
      />
      
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <h4 className="font-semibold mb-2">Current Formatting:</h4>
        <pre className="text-xs overflow-auto">
          {JSON.stringify(formatting, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE 3: Reference Dialog
// ============================================================================

export function ReferenceDialogExample() {
  const [showDialog, setShowDialog] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [references, setReferences] = useState([]);

  const sourceSection = {
    id: 's1',
    title: 'Payment Terms',
    custom_metadata: { numbering: '1' }
  };

  const availableSections = [
    {
      id: 's2',
      title: 'Definitions',
      custom_metadata: { numbering: '2' },
      children: [
        {
          id: 's2.1',
          title: 'Payment',
          custom_metadata: { numbering: '2.1' },
          children: []
        }
      ]
    },
    {
      id: 's3',
      title: 'Termination',
      custom_metadata: { numbering: '3' },
      children: []
    }
  ];

  const handleAddReference = (reference) => {
    setReferences([...references, reference]);
    setShowDialog(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={selectedText}
          onChange={(e) => setSelectedText(e.target.value)}
          placeholder="Enter text to reference..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
        />
        <button
          onClick={() => setShowDialog(true)}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Add Reference
        </button>
      </div>

      {references.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold mb-2">Added References:</h4>
          <ul className="space-y-2">
            {references.map((ref, idx) => (
              <li key={idx} className="text-sm">
                <strong>{ref.text}</strong> → Section {ref.target_numbering} ({ref.target_title})
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReferenceDialog
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
        sourceSection={sourceSection}
        availableSections={availableSections}
        onAddReference={handleAddReference}
        selectedText={selectedText}
      />
    </div>
  );
}

// ============================================================================
// EXAMPLE 4: Combined - All Three Components
// ============================================================================

export function CombinedExample() {
  const [document] = useState({
    title: 'Legal Document',
    children: [
      { id: 's1', title: 'Introduction', custom_metadata: { numbering: '1' }, children: [] },
      { id: 's2', title: 'Terms', custom_metadata: { numbering: '2' }, children: [] }
    ]
  });

  const [selectedSection, setSelectedSection] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);
  const [showRefDialog, setShowRefDialog] = useState(false);
  const [content, setContent] = useState('');

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left: Section Tree */}
      <div className="w-80 bg-white border-r p-4 overflow-y-auto">
        <DocumentSectionTree
          document={document}
          selectedSectionId={selectedSection?.id}
          onSelectSection={setSelectedSection}
        />
      </div>

      {/* Right: Editor */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="bg-white border-b p-3">
          <TextFormatToolbar
            selectedRange={selectedRange}
            onApplyFormat={(data) => console.log('Format:', data)}
            onInsertLink={() => setShowRefDialog(true)}
          />
        </div>

        {/* Content */}
        <div className="flex-1 p-8">
          {selectedSection ? (
            <div className="max-w-4xl mx-auto bg-white shadow-lg rounded-lg p-8">
              <h2 className="text-2xl font-bold mb-4">{selectedSection.title}</h2>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onSelect={(e) => {
                  const start = e.target.selectionStart;
                  const end = e.target.selectionEnd;
                  if (start !== end) setSelectedRange([start, end]);
                }}
                className="w-full h-96 p-4 border rounded-lg resize-none"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a section to edit
            </div>
          )}
        </div>
      </div>

      {/* Reference Dialog */}
      <ReferenceDialog
        isOpen={showRefDialog}
        onClose={() => setShowRefDialog(false)}
        sourceSection={selectedSection}
        availableSections={document.children || []}
        onAddReference={(ref) => console.log('New reference:', ref)}
      />
    </div>
  );
}

// ============================================================================
// EXAMPLE 5: API Integration
// ============================================================================

export function APIIntegrationExample() {
  const docId = 'doc-123';
  const [selectedSection, setSelectedSection] = useState(null);

  // Apply formatting to backend
  const handleApplyFormat = async (formatData) => {
    const currentMetadata = selectedSection?.custom_metadata || {};
    const currentFormatting = currentMetadata.formatting || {};
    
    // Build new formatting
    let newFormatting = { ...currentFormatting };
    
    if (formatData.type === 'style') {
      newFormatting.styles = [
        ...(currentFormatting.styles || []),
        { range: formatData.range, style: formatData.style }
      ];
    }

    // Save to backend
    try {
      const response = await fetch(`/api/documents/${docId}/edit_section/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id: selectedSection.id,
          edits: {
            custom_metadata: {
              ...currentMetadata,
              formatting: newFormatting
            }
          }
        })
      });
      
      if (response.ok) {
        console.log('Formatting saved!');
      }
    } catch (err) {
      console.error('Error saving format:', err);
    }
  };

  // Add reference to backend
  const handleAddReference = async (reference) => {
    const currentMetadata = selectedSection?.custom_metadata || {};
    const currentReferences = currentMetadata.references || [];

    try {
      const response = await fetch(`/api/documents/${docId}/edit_section/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_id: selectedSection.id,
          edits: {
            custom_metadata: {
              ...currentMetadata,
              references: [...currentReferences, reference]
            }
          }
        })
      });
      
      if (response.ok) {
        console.log('Reference added!');
      }
    } catch (err) {
      console.error('Error adding reference:', err);
    }
  };

  return (
    <div className="p-4">
      <h3 className="text-lg font-bold mb-4">API Integration Pattern</h3>
      <p className="text-sm text-gray-600">
        Check browser console for API calls when using formatting or references
      </p>
      <div className="mt-4 p-4 bg-gray-50 border rounded-lg">
        <pre className="text-xs overflow-auto">
{`// Formatting API Call
POST /api/documents/{docId}/edit_section/
{
  "section_id": "s1",
  "edits": {
    "custom_metadata": {
      "formatting": {
        "styles": [
          { "range": [0, 5], "style": "bold" }
        ]
      }
    }
  }
}

// Reference API Call
POST /api/documents/{docId}/edit_section/
{
  "section_id": "s1",
  "edits": {
    "custom_metadata": {
      "references": [
        {
          "id": "ref_001",
          "type": "section",
          "target_id": "s2",
          "text": "See Section 2"
        }
      ]
    }
  }
}`}
        </pre>
      </div>
    </div>
  );
}
