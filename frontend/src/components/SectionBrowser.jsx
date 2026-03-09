import React, { useState, useEffect } from 'react';
import { Search, BookOpen, FileText, X, Loader2, ChevronRight, ChevronDown, GripVertical, AlignLeft, Table as TableIcon, Image as ImageIcon } from 'lucide-react';
import { sectionReferenceService } from '../services/sectionReferenceService';
import { documentService } from '../services/documentService';
import './SectionBrowser.css';

/**
 * SectionBrowser - Sidebar for browsing and dragging sections from accessible documents
 * Supports hierarchical navigation and drag & drop for both entire sections and subsections
 */
const SectionBrowser = ({
  currentDocumentId,
  onSelect,
  onClose,
  isOpen = true
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [expandedDocuments, setExpandedDocuments] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [error, setError] = useState(null);

  // Load all accessible documents with their sections
  useEffect(() => {
    const loadDocuments = async () => {
      try {
        setLoading(true);
        const docs = await documentService.getDocuments();
        // Filter out current document (can't reference self)
        const filtered = docs.filter(doc => doc.id !== currentDocumentId);
        
        // Load sections for each document
        const docsWithSections = await Promise.all(
          filtered.map(async (doc) => {
            try {
              const fullDoc = await documentService.getCompleteDocument(doc.id);
              return { ...doc, sections: fullDoc.sections || [] };
            } catch (err) {
              console.error(`Failed to load sections for ${doc.id}:`, err);
              return { ...doc, sections: [] };
            }
          })
        );
        
        setDocuments(docsWithSections);
      } catch (err) {
        console.error('Error loading documents:', err);
        setError('Failed to load documents');
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      loadDocuments();
    }
  }, [currentDocumentId, isOpen]);

  const toggleDocument = (docId) => {
    setExpandedDocuments(prev => ({
      ...prev,
      [docId]: !prev[docId]
    }));
  };

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  const handleDragStart = (e, section, document) => {
    const dragData = {
      type: 'section-reference',
      contentType: section.type || 'section', // 'section', 'paragraph', 'table', 'image'
      section: {
        id: section.id,
        title: section.title,
        content: section.content,
        paragraphs: section.paragraphs || [],
        tables: section.tables || [],
        image_components: section.image_components || [],
        children: section.children || []
      },
      document: {
        id: document.id,
        title: document.title,
        owner: document.owner
      },
      // Specific content data
      ...(section.paragraphId && { paragraphId: section.paragraphId, paragraphContent: section.paragraphContent }),
      ...(section.tableId && { tableId: section.tableId, tableData: section.tableData }),
      ...(section.imageId && { imageId: section.imageId, imageData: section.imageData })
    };
    
    console.log('🚀 Drag started from SectionBrowser:', dragData);
    
    // Set ONLY JSON data, don't set text/plain to avoid confusion
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copyLink'; // Allow both copy and link operations
    
    // Set a custom drag image for better UX
    const dragElement = e.currentTarget;
    if (dragElement) {
      e.dataTransfer.setDragImage(dragElement, 0, 0);
    }
  };

  const handleSectionClick = (section, document) => {
    if (onSelect) {
      onSelect({
        referenced_section: section.id,
        referenced_document: document.id,
        section_data: section,
        document_data: document
      });
    }
  };

  // Recursive search through sections
  const searchInSections = (sections, query) => {
    const results = [];
    
    const search = (sectionList, parentMatched = false) => {
      sectionList.forEach(section => {
        const titleMatch = section.title?.toLowerCase().includes(query.toLowerCase());
        const matched = titleMatch || parentMatched;
        
        if (matched) {
          results.push(section);
        }
        
        if (section.children && section.children.length > 0) {
          search(section.children, matched);
        }
      });
    };
    
    search(sections);
    return results;
  };

  // Filter documents and sections based on search
  const getFilteredContent = () => {
    if (!searchQuery.trim()) {
      return documents;
    }

    return documents
      .map(doc => {
        const titleMatch = doc.title?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchingSections = searchInSections(doc.sections || [], searchQuery);
        
        if (titleMatch || matchingSections.length > 0) {
          return {
            ...doc,
            sections: titleMatch ? doc.sections : matchingSections,
            _matchedByTitle: titleMatch
          };
        }
        return null;
      })
      .filter(Boolean);
  };

  const renderSection = (section, document, level = 0) => {
    const hasChildren = section.children && section.children.length > 0;
    const hasParagraphs = section.paragraphs && section.paragraphs.length > 0;
    const hasTables = section.tables && section.tables.length > 0;
    const hasImages = section.image_components && section.image_components.length > 0;
    const hasContent = hasChildren || hasParagraphs || hasTables || hasImages;
    const isExpanded = expandedSections[section.id];
    
    return (
      <div key={section.id} className="border-b border-gray-100 last:border-0">
        {/* Section Header - Draggable */}
        <div 
          className="flex items-center gap-2 p-2 hover:bg-violet-50 cursor-move group transition-colors"
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          draggable
          onDragStart={(e) => handleDragStart(e, section, document)}
        >
          {hasContent && (
            <button 
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                toggleSection(section.id);
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          
          <GripVertical size={14} className="text-gray-300 group-hover:text-violet-500 flex-shrink-0" />
          <BookOpen size={14} className="text-violet-500 flex-shrink-0" />
          
          <div 
            className="flex-1 min-w-0"
            onClick={() => handleSectionClick(section, document)}
          >
            <span className="text-sm text-gray-700 truncate block font-medium">{section.title || 'Untitled'}</span>
          </div>
          
          {/* Content indicators */}
          <div className="flex items-center gap-1 text-xs text-gray-400">
            {hasParagraphs && <span>{section.paragraphs.length}p</span>}
            {hasTables && <span>{section.tables.length}t</span>}
            {hasImages && <span>{section.image_components.length}i</span>}
          </div>
        </div>
        
        {/* Expanded Content */}
        {isExpanded && hasContent && (
          <div>
            {/* Paragraphs */}
            {hasParagraphs && section.paragraphs.map((paragraph, idx) => (
              <div
                key={`para-${paragraph.id || idx}`}
                className="flex items-center gap-2 p-2 hover:bg-blue-50 cursor-move group transition-colors border-b border-gray-50 last:border-0"
                style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}
                draggable
                onDragStart={(e) => handleDragStart(e, { 
                  ...section, 
                  type: 'paragraph',
                  paragraphId: paragraph.id,
                  paragraphContent: paragraph.content_text || paragraph.edited_text || ''
                }, document)}
              >
                <GripVertical size={12} className="text-gray-300 group-hover:text-blue-500 flex-shrink-0" />
                <AlignLeft size={12} className="text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-600 truncate block">
                    {paragraph.content_text || paragraph.edited_text || 'Empty paragraph'}
                  </span>
                </div>
              </div>
            ))}
            
            {/* Tables */}
            {hasTables && section.tables.map((table, idx) => (
              <div
                key={`table-${table.id || idx}`}
                className="flex items-center gap-2 p-2 hover:bg-green-50 cursor-move group transition-colors border-b border-gray-50 last:border-0"
                style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}
                draggable
                onDragStart={(e) => handleDragStart(e, { 
                  ...section, 
                  type: 'table',
                  tableId: table.id,
                  tableData: table
                }, document)}
              >
                <GripVertical size={12} className="text-gray-300 group-hover:text-green-500 flex-shrink-0" />
                <TableIcon size={12} className="text-green-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-600 truncate block">
                    Table ({table.rows?.length || 0} rows)
                  </span>
                </div>
              </div>
            ))}
            
            {/* Images */}
            {hasImages && section.image_components.map((image, idx) => (
              <div
                key={`img-${image.id || idx}`}
                className="flex items-center gap-2 p-2 hover:bg-purple-50 cursor-move group transition-colors border-b border-gray-50 last:border-0"
                style={{ paddingLeft: `${(level + 1) * 16 + 12}px` }}
                draggable
                onDragStart={(e) => handleDragStart(e, { 
                  ...section, 
                  type: 'image',
                  imageId: image.id,
                  imageData: image
                }, document)}
              >
                <GripVertical size={12} className="text-gray-300 group-hover:text-purple-500 flex-shrink-0" />
                <ImageIcon size={12} className="text-purple-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-600 truncate block">
                    {image.caption || 'Image'}
                  </span>
                </div>
              </div>
            ))}
            
            {/* Child Sections (Recursive) */}
            {hasChildren && section.children.map(child => renderSection(child, document, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const filteredContent = getFilteredContent();

  // When used in activeSidebar, don't render backdrop or wrapper
  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search documents and sections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
            autoFocus
          />
        </div>
      </div>

      {/* Help Text */}
      <div className="px-3 py-2 bg-violet-50 border-b border-violet-100">
        <p className="text-xs text-violet-700">
          <strong>💡 Drag sections</strong> into paragraphs to create references
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Loader2 size={24} className="animate-spin mb-2" />
            <p className="text-sm">Loading documents...</p>
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        ) : filteredContent.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <FileText size={48} className="mb-3" />
            <p className="text-sm">No documents or sections found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredContent.map(doc => {
              const isExpanded = expandedDocuments[doc.id];
              const hasSections = doc.sections && doc.sections.length > 0;
              
              return (
                <div key={doc.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div 
                    className="flex items-center gap-2 p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => toggleDocument(doc.id)}
                  >
                    <button className="text-gray-400 hover:text-gray-600">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <FileText size={18} className="text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">{doc.title}</div>
                      <div className="text-xs text-gray-500">
                        {hasSections ? `${doc.sections.length} section${doc.sections.length !== 1 ? 's' : ''}` : 'No sections'}
                      </div>
                    </div>
                  </div>
                  
                  {isExpanded && hasSections && (
                    <div className="border-t border-gray-100">
                      {/* Only render top-level sections (sections without parent_section_id) */}
                      {doc.sections
                        .filter(section => !section.parent_section_id)
                        .map(section => renderSection(section, doc, 0))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SectionBrowser;
