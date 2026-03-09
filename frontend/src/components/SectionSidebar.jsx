import React, { useState, useEffect } from 'react';
import { Search, BookOpen, ChevronRight, ChevronDown, Link2, Copy, Loader2, X } from 'lucide-react';
import { documentService } from '../services/documentService';
import './SectionSidebar.css';

/**
 * SectionSidebar - Sidebar showing all accessible sections for drag & drop
 * Supports both Section Reference (link) and Section Clone (copy content)
 */
const SectionSidebar = ({ currentDocumentId, isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [expandedDocs, setExpandedDocs] = useState(new Set());
  const [error, setError] = useState(null);

  // Load all accessible documents with their sections
  useEffect(() => {
    const loadDocuments = async () => {
      if (!isOpen) return;

      try {
        setLoading(true);
        setError(null);
        
        // Get all documents
        const docs = await documentService.getDocuments();
        
        // Filter out current document if needed, or keep it for internal references
        // const filtered = docs.filter(doc => doc.id !== currentDocumentId);
        
        // Load complete data for each document to get sections
        const docsWithSections = await Promise.all(
          docs.map(async (doc) => {
            try {
              const completeDoc = await documentService.getCompleteDocument(doc.id);
              return {
                ...doc,
                sections: completeDoc.sections || []
              };
            } catch (err) {
              console.error(`Error loading sections for doc ${doc.id}:`, err);
              return {
                ...doc,
                sections: []
              };
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

    loadDocuments();
  }, [isOpen, currentDocumentId]);

  const toggleDocExpanded = (docId) => {
    const newExpanded = new Set(expandedDocs);
    if (newExpanded.has(docId)) {
      newExpanded.delete(docId);
    } else {
      newExpanded.add(docId);
    }
    setExpandedDocs(newExpanded);
  };

  // Handle drag start - attach section data
  const handleDragStart = (e, section, document, dragType) => {
    const dragData = {
      type: dragType, // 'section-reference' or 'section-clone'
      section: section,
      document: {
        id: document.id,
        title: document.title,
        owner: document.owner
      }
    };

    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = dragType === 'section-reference' ? 'link' : 'copy';
    
    // Visual feedback
    e.target.classList.add('dragging');
  };

  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging');
  };

  // Recursive section renderer
  const renderSection = (section, document, level = 0) => {
    const matchesSearch = !searchQuery || 
      section.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.content?.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch && level === 0) {
      // Check if any children match
      const hasMatchingChild = section.children?.some(child => 
        child.title?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (!hasMatchingChild) return null;
    }

    return (
      <div key={section.id} className="section-sidebar-item" style={{ paddingLeft: `${level * 16}px` }}>
        <div className="section-row">
          <div className="section-main">
            <BookOpen size={14} className="section-icon" />
            <div className="section-info">
              <span className="section-title">{section.title || 'Untitled'}</span>
              <span className="section-id">{section.id}</span>
            </div>
          </div>
          
          <div className="section-actions">
            {/* Reference Button (creates link) */}
            <button
              draggable
              onDragStart={(e) => handleDragStart(e, section, document, 'section-reference')}
              onDragEnd={handleDragEnd}
              className="drag-action reference-action"
              title="Drag to create reference (link)"
            >
              <Link2 size={14} />
            </button>
            
            {/* Clone Button (copies content) */}
            <button
              draggable
              onDragStart={(e) => handleDragStart(e, section, document, 'section-clone')}
              onDragEnd={handleDragEnd}
              className="drag-action clone-action"
              title="Drag to clone (copy content)"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        {/* Render children */}
        {section.children && section.children.length > 0 && (
          <div className="subsections">
            {section.children.map(child => renderSection(child, document, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const filteredDocuments = documents.filter(doc => {
    if (!searchQuery) return true;
    
    // Check document title
    if (doc.title?.toLowerCase().includes(searchQuery.toLowerCase())) return true;
    
    // Check if any section matches
    const hasSectionMatch = (sections) => {
      return sections?.some(section => 
        section.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        section.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (section.children && hasSectionMatch(section.children))
      );
    };
    
    return hasSectionMatch(doc.sections);
  });

  if (!isOpen) return null;

  return (
    <>
      <div className="section-sidebar-overlay" onClick={onClose} />
      <div className="section-sidebar">
        {/* Header */}
        <div className="section-sidebar-header">
          <h3>
            <BookOpen size={20} />
            Sections Library
          </h3>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="section-sidebar-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search sections..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Instructions */}
        <div className="section-sidebar-instructions">
          <div className="instruction-item">
            <Link2 size={14} className="ref-icon" />
            <span>Reference: Link to original section</span>
          </div>
          <div className="instruction-item">
            <Copy size={14} className="clone-icon" />
            <span>Clone: Copy section content</span>
          </div>
        </div>

        {/* Content */}
        <div className="section-sidebar-content">
          {loading ? (
            <div className="loading-state">
              <Loader2 size={24} className="spin" />
              <p>Loading sections...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <p>{error}</p>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={48} />
              <p>No sections found</p>
            </div>
          ) : (
            filteredDocuments.map(doc => (
              <div key={doc.id} className="document-group">
                <button
                  className="document-header"
                  onClick={() => toggleDocExpanded(doc.id)}
                >
                  {expandedDocs.has(doc.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="doc-title">{doc.title}</span>
                  <span className="section-count">
                    {doc.sections?.length || 0} sections
                  </span>
                </button>

                {expandedDocs.has(doc.id) && doc.sections && (
                  <div className="document-sections">
                    {doc.sections.map(section => renderSection(section, doc))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer Help */}
        <div className="section-sidebar-footer">
          <p>💡 Drag sections to the + button or drop zones</p>
        </div>
      </div>
    </>
  );
};

export default SectionSidebar;
