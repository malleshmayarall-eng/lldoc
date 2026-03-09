import React, { useState } from 'react';
import { Plus, FileText, Table, Image, MessageSquare, File, BookOpen, Link, Copy, Code } from 'lucide-react';

/**
 * AddContentButton - Modern floating add button that appears between sections/paragraphs
 * Shows a menu with options to add different content types
 */
const AddContentButton = ({ 
  onAddParagraph,
  onAddLatexCode,
  onAddTable,
  onAddImage,
  onAddDocument,
  onAddSectionReference,
  onAddComment,
  onCopySection, // New: handler for copying entire section content
  position = 'between', // 'between' | 'end'
  className = ''
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sectionDropData, setSectionDropData] = useState(null); // Holds dropped section data
  const [showDropDialog, setShowDropDialog] = useState(false); // Show reference/copy dialog

  // Debug: Log dialog state changes
  React.useEffect(() => {
    // console.log('🔍 Dialog state changed:', { showDropDialog, hasSectionData: !!sectionDropData });
  }, [showDropDialog, sectionDropData]);

  // Handle drag over - show visual feedback
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  // Handle drop - automatically add image, paragraph, or section based on what's dropped
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      // CRITICAL: Check JSON data FIRST before text/plain
      // Section drops will have application/json, text drops only have text/plain
      const jsonData = e.dataTransfer.getData('application/json');
      console.log('🎯 Drop detected on + button');
      console.log('📦 JSON data:', jsonData);
      console.log('📝 Text data:', e.dataTransfer.getData('text/plain'));
      console.log('📁 Files:', e.dataTransfer.files.length);
      
      // Priority 1: JSON data (sections, images from library)
      if (jsonData && jsonData.trim()) {
        try {
          const dragData = JSON.parse(jsonData);
          console.log('✅ Parsed drag data:', dragData);
          
          // Check if it's a section drop - show dialog to choose reference or copy
          if (dragData.type === 'section-reference') {
            console.log('📖 SECTION DROPPED! Opening dialog...');
            setSectionDropData(dragData);
            setShowDropDialog(true);
            console.log('✅ Dialog state updated');
            // IMPORTANT: Return immediately, don't process as text
            return;
          }
          
          // Check if it's an image drop from library
          if (dragData.id || dragData.image_url) {
            console.log('🖼️ Image dropped on + button, adding image component:', dragData);
            if (onAddImage) {
              onAddImage(dragData);
            }
            return;
          }
        } catch (err) {
          console.error('❌ Failed to parse JSON drag data:', err);
          // Continue to check other data types
        }
      }

      // Priority 2: File drops (images, documents)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const imageFile = Array.from(e.dataTransfer.files).find(f => f.type?.startsWith('image/'));
        if (imageFile && onAddImage) {
          console.log('🖼️ Image file dropped on + button:', imageFile.name);
          onAddImage({ file: imageFile });
          return;
        }
      }

      // Priority 3: Plain text drops (ONLY if no JSON data was present)
      const droppedText = e.dataTransfer.getData('text/plain');
      if (droppedText && droppedText.trim() && onAddParagraph && !jsonData) {
        console.log('📝 Plain text dropped on + button, creating paragraph');
        onAddParagraph(droppedText.trim());
        return;
      }

      console.log('⚠️ Unknown drop type or no handler available');
    } catch (error) {
      console.error('❌ Error handling drop on + button:', error);
    }
  };

  const menuItems = [
    {
      icon: FileText,
      label: 'Paragraph',
      description: 'Add text content',
      onClick: () => {
        onAddParagraph?.();
        setShowMenu(false);
      },
      color: 'blue'
    },
    {
      icon: Code,
      label: 'LaTeX block',
      description: 'Insert LaTeX code',
      onClick: () => {
        onAddLatexCode?.();
        setShowMenu(false);
      },
      color: 'emerald',
      disabled: !onAddLatexCode
    },
    {
      icon: Table,
      label: 'Table',
      description: 'Add data table',
      onClick: () => {
        onAddTable?.();
        setShowMenu(false);
      },
      color: 'purple'
    },
    {
      icon: Image,
      label: 'Image',
      description: 'Upload or insert',
      onClick: () => {
        onAddImage?.();
        setShowMenu(false);
      },
      color: 'green',
      disabled: !onAddImage
    },
    {
      icon: File,
      label: 'Document',
      description: 'Embed file',
      onClick: () => {
        onAddDocument?.();
        setShowMenu(false);
      },
      color: 'indigo',
      disabled: !onAddDocument
    },
    {
      icon: BookOpen,
      label: 'Section Reference',
      description: 'Reference section',
      onClick: () => {
        onAddSectionReference?.();
        setShowMenu(false);
      },
      color: 'violet',
      disabled: !onAddSectionReference
    },
    {
      icon: MessageSquare,
      label: 'Comment',
      description: 'Add a note',
      onClick: () => {
        onAddComment?.();
        setShowMenu(false);
      },
      color: 'orange',
      disabled: !onAddComment
    }
  ];

  return (
    <div 
      className={`add-content-button-wrapper ${className}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="add-content-line" />
      
      <div className={`add-content-button-container ${isDragOver ? 'drag-over' : ''}`}>
        <button
          className={`add-content-button ${showMenu ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
          onClick={() => setShowMenu(!showMenu)}
          title="Add content (or drag & drop here)"
        >
          <Plus size={14} className={showMenu ? 'rotate' : ''} />
        </button>

        {isDragOver && (
          <div className="drop-hint">
            Drop here to add
          </div>
        )}

        {showMenu && (
          <>
            <div 
              className="add-content-backdrop" 
              onClick={() => setShowMenu(false)}
            />
            <div className="add-content-menu">
              {menuItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={index}
                    className={`add-content-menu-item ${item.color} ${item.disabled ? 'disabled' : ''}`}
                    onClick={item.disabled ? undefined : item.onClick}
                    disabled={item.disabled}
                  >
                    <div className="menu-item-icon">
                      <Icon size={20} />
                    </div>
                    <div className="menu-item-content">
                      <div className="menu-item-label">{item.label}</div>
                      <div className="menu-item-description">{item.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="add-content-line" />
      
      {/* Dialog: Reference or Copy Section */}
      {showDropDialog && sectionDropData && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
          style={{ zIndex: 9999 }}
          onClick={() => {
            console.log('🚫 Dialog backdrop clicked, closing...');
            setShowDropDialog(false);
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => {
              e.stopPropagation();
              console.log('✋ Dialog content clicked, not closing');
            }}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Add Section Content
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              How would you like to add "{sectionDropData.section.title}"?
            </p>
            
            <div className="space-y-3">
              {/* Reference Option */}
              <button
                onClick={() => {
                  if (onAddSectionReference) {
                    onAddSectionReference({
                      referenced_section: sectionDropData.section.id,
                      referenced_document: sectionDropData.document.id,
                      section_data: sectionDropData.section,
                      document_data: sectionDropData.document
                    });
                  }
                  setShowDropDialog(false);
                  setSectionDropData(null);
                }}
                className="w-full p-4 border-2 border-violet-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all text-left group"
              >
                <div className="flex items-start gap-3">
                  <Link className="text-violet-500 mt-0.5 flex-shrink-0" size={20} />
                  <div>
                    <div className="font-semibold text-gray-900 group-hover:text-violet-700">
                      Reference Section
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Create a live link to the original section. Changes in the source will be reflected here.
                    </div>
                  </div>
                </div>
              </button>
              
              {/* Copy Option */}
              <button
                onClick={() => {
                  if (onCopySection) {
                    onCopySection(sectionDropData);
                  }
                  setShowDropDialog(false);
                  setSectionDropData(null);
                }}
                className="w-full p-4 border-2 border-blue-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
              >
                <div className="flex items-start gap-3">
                  <Copy className="text-blue-500 mt-0.5 flex-shrink-0" size={20} />
                  <div>
                    <div className="font-semibold text-gray-900 group-hover:text-blue-700">
                      Copy Section Content
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Duplicate all content (paragraphs, tables, images) as independent elements.
                    </div>
                  </div>
                </div>
              </button>
            </div>
            
            <button
              onClick={() => {
                setShowDropDialog(false);
                setSectionDropData(null);
              }}
              className="mt-4 w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddContentButton;
