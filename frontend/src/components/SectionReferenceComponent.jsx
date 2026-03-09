import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Trash2,
  Edit2,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
  Link2
} from 'lucide-react';
import { sectionReferenceService } from '../services/sectionReferenceService';
import './SectionReferenceComponent.css';

/**
 * SectionReferenceComponent - Renders a section reference in a document
 * Displays a section from another document that the user has access to
 * Supports full content view or preview/link mode
 */
const SectionReferenceComponent = ({
  reference,
  onDelete,
  onEdit,
  onReorder,
  editable = true,
  showControls = true
}) => {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(reference?.include_full_content || false);
  const [showDetails, setShowDetails] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [error, setError] = useState(null);

  // Load preview data if full content should be shown
  useEffect(() => {
    const loadPreview = async () => {
      if (reference?.include_full_content && !previewData) {
        try {
          setLoading(true);
          const data = await sectionReferenceService.getPreview(reference.id);
          setPreviewData(data);
        } catch (err) {
          console.error('Error loading section reference preview:', err);
          setError('Failed to load referenced section');
        } finally {
          setLoading(false);
        }
      }
    };

    loadPreview();
  }, [reference?.id, reference?.include_full_content, previewData]);

  const handleDelete = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('Remove this section reference?')) {
      onDelete?.();
    }
  };

  const toggleExpanded = () => {
    setExpanded(!expanded);
  };

  if (!reference) {
    return (
      <div className="section-reference-component error">
        <p>Section reference not found</p>
      </div>
    );
  }

  const sectionData = reference.referenced_section_data || reference.referenced_section;
  const documentData = reference.referenced_document_data || reference.referenced_document;

  return (
    <div className="section-reference-component">
      {/* Header */}
      <div className="section-reference-header">
        <div className="section-reference-icon">
          <Link2 size={20} />
        </div>
        
        <div className="section-reference-info">
          <div className="section-reference-title">
            <button
              className="expand-button"
              onClick={toggleExpanded}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <BookOpen size={16} className="title-icon" />
            <span className="section-title">{sectionData?.title || 'Untitled Section'}</span>
          </div>
          
          <div className="reference-meta">
            <span className="source-document">
              <FileText size={12} />
              {documentData?.title || 'Unknown Document'}
            </span>
            {reference.position_description && (
              <span className="position-hint">• {reference.position_description}</span>
            )}
          </div>
          
          {reference.note && (
            <div className="reference-note">
              <Info size={12} />
              <span>{reference.note}</span>
            </div>
          )}
        </div>

        {/* Controls */}
        {editable && showControls && (
          <div className="section-reference-controls">
            <button
              className="control-btn"
              onClick={() => setShowDetails(!showDetails)}
              title="Details"
            >
              <Info size={16} />
            </button>
            
            {onEdit && (
              <button
                className="control-btn"
                onClick={onEdit}
                title="Edit reference"
              >
                <Edit2 size={16} />
              </button>
            )}
            
            <button
              className="control-btn delete-btn"
              onClick={handleDelete}
              title="Remove reference"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="section-reference-content">
          {loading ? (
            <div className="loading-state">
              <Loader2 size={20} className="spin" />
              <span>Loading section content...</span>
            </div>
          ) : error ? (
            <div className="error-state">
              <p>{error}</p>
            </div>
          ) : previewData || sectionData ? (
            <div className="referenced-section-preview">
              {/* Section Content */}
              <div className="section-content-wrapper">
                {(previewData?.referenced_section_data?.content || sectionData?.content) && (
                  <div className="section-text">
                    {previewData?.referenced_section_data?.content || sectionData?.content}
                  </div>
                )}
                
                {/* Subsections if any */}
                {(previewData?.referenced_section_data?.children || sectionData?.children)?.length > 0 && (
                  <div className="subsections">
                    <h4>Subsections:</h4>
                    {(previewData?.referenced_section_data?.children || sectionData?.children).map((child, idx) => (
                      <div key={idx} className="subsection-item">
                        <strong>{child.title}</strong>
                        {child.content && <p>{child.content}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Source Attribution */}
              <div className="reference-attribution">
                <ExternalLink size={14} />
                <span>
                  From: <strong>{documentData?.title}</strong>
                  {documentData?.owner && ` by ${documentData.owner}`}
                </span>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>No content available</p>
            </div>
          )}
        </div>
      )}

      {/* Details Panel */}
      {showDetails && (
        <div className="section-reference-details">
          <h4>Reference Details</h4>
          <div className="details-grid">
            <div className="detail-item">
              <label>Referenced Section:</label>
              <span>{sectionData?.id}</span>
            </div>
            <div className="detail-item">
              <label>From Document:</label>
              <span>{documentData?.title}</span>
            </div>
            <div className="detail-item">
              <label>Created:</label>
              <span>{new Date(reference.created_at).toLocaleDateString()}</span>
            </div>
            <div className="detail-item">
              <label>Created By:</label>
              <span>{reference.created_by_username || reference.created_by}</span>
            </div>
            {reference.modified_at && (
              <div className="detail-item">
                <label>Last Modified:</label>
                <span>{new Date(reference.modified_at).toLocaleDateString()}</span>
              </div>
            )}
            <div className="detail-item">
              <label>Display Mode:</label>
              <span>{reference.include_full_content ? 'Full Content' : 'Preview'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionReferenceComponent;
