import React, { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  FileText,
  Download,
  ExternalLink,
  Eye,
  Info,
  Trash2,
  Edit2,
  Move,
  ChevronUp,
  ChevronDown,
  Loader2,
  MessageSquare,
  X
} from 'lucide-react';
import { documentFileService, documentFileComponentService } from '../services/documentFileService';
import { documentService } from '../services/documentService';
import { useCompleteDocument } from '../hooks/useCompleteDocument';
import './DocumentFileComponent.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * DocumentFileComponent - Renders a file component in a document
 * Supports multiple display modes: link, embed, download, reference, icon
 * NEW: Supports embedding referenced documents with their full content
 */
const DocumentFileComponent = ({
  component,
  onDelete,
  onEdit,
  onReorder,
  onMoveUp,
  onMoveDown,
  editable = true,
  showControls = true
}) => {
  const [downloading, setDownloading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDocumentPreview, setShowDocumentPreview] = useState(false);
  const [referencedDocId, setReferencedDocId] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const pagesContainerRef = useRef(null);
  const [pageWidth, setPageWidth] = useState(640);
  const [pageError, setPageError] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState({
    display_mode: component.display_mode || 'link',
    label: component.label || '',
    description: component.description || '',
    alignment: component.alignment || 'left',
    show_description: component.show_description ?? Boolean(component.description),
    show_file_type: component.show_file_type ?? true,
    show_file_size: component.show_file_size ?? true,
    show_filename: component.show_filename ?? false,
  show_label: component.show_label ?? true,
  preview_enabled: component.preview_enabled ?? component.show_preview ?? component.file_metadata?.file_type === 'pdf',
    download_enabled: component.download_enabled ?? true,
    width_percent: component.width_percent ?? 100,
    height_pixels: component.height_pixels ?? 600,
  });

  // Use Complete Document API hook for referenced documents
  const {
    document: referencedDocument,
    loading: loadingDocument,
    error: documentError,
    stats,
    comments,
    issues,
    attachments,
    getComponentsInSection,
    isLoaded,
    hasError
  } = useCompleteDocument(referencedDocId);

  // Determine referenced document ID from component data
  useEffect(() => {
    const determineReferencedDocId = async () => {
      // Check if component has a referenced_document_id or if metadata indicates it's a document
      let docId = component.referenced_document_id || 
                  component.file_metadata?.referenced_document_id;
      
      // If no direct reference but we have a file_reference, fetch the file details
      if (!docId && component.file_reference) {
        try {
          const fileDetails = await documentFileService.getFile(component.file_reference);
          docId = fileDetails.referenced_document_id || fileDetails.document;
        } catch (error) {
          console.log('Could not fetch file details:', error);
        }
      }
      
      setReferencedDocId(docId);
    };

    determineReferencedDocId();
  }, [component.referenced_document_id, component.file_metadata?.referenced_document_id, component.file_reference]);

  useEffect(() => {
    const updateWidth = () => {
      if (pagesContainerRef.current) {
        const nextWidth = pagesContainerRef.current.clientWidth;
        if (nextWidth) setPageWidth(nextWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    setPageCount(0);
    setPageError(null);
  }, [component.file_url, component.file_metadata?.file_url, component.file_metadata?.file, component.file]);

  const handleDownload = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      setDownloading(true);
      await documentFileService.trackDownload(component.file_reference);
      window.open(component.file_url, '_blank');
    } catch (error) {
      console.error('Failed to download file:', error);
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    setSettingsDraft({
      display_mode: component.display_mode || 'link',
      label: component.label || '',
      description: component.description || '',
      alignment: component.alignment || 'left',
      show_description: component.show_description ?? Boolean(component.description),
      show_file_type: component.show_file_type ?? true,
      show_file_size: component.show_file_size ?? true,
      show_filename: component.show_filename ?? false,
    show_label: component.show_label ?? true,
    preview_enabled: component.preview_enabled ?? component.show_preview ?? component.file_metadata?.file_type === 'pdf',
      download_enabled: component.download_enabled ?? true,
      width_percent: component.width_percent ?? 100,
      height_pixels: component.height_pixels ?? 600,
    });
  }, [
    component.display_mode,
    component.label,
    component.description,
    component.alignment,
    component.show_description,
    component.show_file_type,
    component.show_file_size,
    component.show_filename,
    component.show_label,
    component.preview_enabled,
    component.download_enabled,
    component.width_percent,
    component.height_pixels,
    component.file_metadata?.file_type,
  ]);

  const handleDelete = () => {
    if (window.confirm(`Remove "${component.label || component.file_metadata?.name}" from document?`)) {
      onDelete?.(component);
    }
  };

  const getIcon = () => {
    return documentFileService.getFileIcon(component.file_metadata?.file_type);
  };

  const renderLinkMode = () => {
    const hasReferencedDoc = referencedDocument || loadingDocument;
    
    return (
      <div className={`file-component-link ${component.alignment || 'left'}`}>
        <a
          href={component.file_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleDownload}
          className="file-link"
        >
          <div className="file-link-icon">{getIcon()}</div>
          <div className="file-link-content">
            <div className="file-link-label">
              {component.label || component.file_metadata?.name}
              {component.reference_number && (
                <span className="reference-number">[{component.reference_number}]</span>
              )}
              {hasReferencedDoc && (
                <span className="text-xs text-blue-600 ml-2">📄 Document</span>
              )}
            </div>
            {component.show_description && component.description && (
              <div className="file-link-description">{component.description}</div>
            )}
            {(component.show_file_size || component.show_file_type) && (
              <div className="file-link-meta">
                {component.show_file_type && (
                  <span className="meta-item">
                    {component.file_metadata?.file_type?.toUpperCase()}
                  </span>
                )}
                {component.show_file_size && (
                  <span className="meta-item">
                    {component.file_metadata?.file_size_display}
                  </span>
                )}
              </div>
            )}
          </div>
          <ExternalLink size={18} className="external-icon" />
        </a>
        
        {/* Show preview toggle button if document is loaded */}
        {hasReferencedDoc && (
          <button
            className="toggle-preview-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowDocumentPreview(!showDocumentPreview);
            }}
            title={showDocumentPreview ? "Hide preview" : "Show preview"}
          >
            <Eye size={16} />
            {showDocumentPreview ? "Hide Document" : "Show Document"}
          </button>
        )}
        
        {/* Show document preview if toggled */}
        {showDocumentPreview && hasReferencedDoc && (
          <div className="document-preview-inline">
            {renderReferencedDocumentContent()}
          </div>
        )}
      </div>
    );
  };

  const renderReferencedDocumentContent = () => {
    if (loadingDocument) {
      return (
        <div className="referenced-document-loading">
          <Loader2 className="animate-spin" size={24} />
          <p>Loading referenced document...</p>
        </div>
      );
    }

    if (hasError || documentError) {
      return (
        <div className="referenced-document-error">
          <p>❌ Error loading document: {documentError || 'Unknown error'}</p>
        </div>
      );
    }

    if (!referencedDocument) {
      return null;
    }

    // Recursive function to render sections with all components
    const renderSection = (section, depth = 0) => {
      // Get all components in this section, sorted by order
      const components = getComponentsInSection(section.id);

      return (
        <div 
          key={section.id} 
          className="referenced-section" 
          style={{ marginLeft: `${depth * 20}px` }}
        >
          <h4 className="section-title" style={{ fontSize: `${1.25 - (depth * 0.1)}rem` }}>
            {section.title}
          </h4>
          
          {/* Render all components in order */}
          {components.map((component, idx) => {
            const key = `${component.type}-${component.data.id || idx}`;
            
            switch (component.type) {
              case 'paragraph':
                return (
                  <div key={key} className="referenced-paragraph">
                    {component.data.content_text || component.data.edited_text || component.data.content || ''}
                    {/* Render inline images if present */}
                    {component.data.inline_images?.map((img, imgIdx) => (
                      <div key={`inline-img-${imgIdx}`} className="referenced-inline-image" style={{ textAlign: img.alignment || 'center' }}>
                        <img src={img.image_url} alt={img.alt_text || 'Inline image'} style={{ maxWidth: '100%', height: 'auto' }} />
                        {img.caption && <div className="inline-image-caption">{img.caption}</div>}
                      </div>
                    ))}
                  </div>
                );

              case 'table':
                return (
                  <div key={key} className="referenced-table">
                    {component.data.title && <div className="table-title">{component.data.title}</div>}
                    <table className="doc-table">
                      {component.data.column_headers && (
                        <thead>
                          <tr>
                            {component.data.column_headers.map((header, hIdx) => (
                              <th key={hIdx}>{header}</th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {component.data.table_data?.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {component.data.caption && (
                      <div className="table-caption">{component.data.caption}</div>
                    )}
                  </div>
                );

              case 'image':
                return (
                  <div key={key} className="referenced-image-component" style={{ textAlign: component.data.alignment || 'center' }}>
                    <img 
                      src={component.data.image_url} 
                      alt={component.data.alt_text || component.data.caption || 'Image'} 
                      className={`size-${component.data.size_mode || 'medium'}`}
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                    {component.data.caption && (
                      <div className="image-caption">{component.data.caption}</div>
                    )}
                  </div>
                );

              case 'file':
                return (
                  <div key={key} className="referenced-file-component">
                    <div className="file-attachment">
                      <FileText size={20} />
                      <div className="file-info">
                        <div className="file-label">{component.data.label || component.data.file_name}</div>
                        {component.data.description && (
                          <div className="file-desc">{component.data.description}</div>
                        )}
                        <div className="file-meta">
                          {component.data.file_type?.toUpperCase()} • {documentFileService.formatFileSize(component.data.file_size)}
                        </div>
                      </div>
                      {component.data.file_url && (
                        <a 
                          href={component.data.file_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="file-download-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={16} />
                        </a>
                      )}
                    </div>
                  </div>
                );

              default:
                return null;
            }
          })}

          {/* Recursively render children sections */}
          {section.children?.map((child) => renderSection(child, depth + 1))}
        </div>
      );
    };

    // Render the referenced document's content
    return (
      <div className="referenced-document-content">
        <div className="referenced-document-header">
          <h3>{referencedDocument.title}</h3>
          {referencedDocument.author && (
            <p className="text-sm text-gray-600">By {referencedDocument.author}</p>
          )}
          
          {/* Document statistics */}
          {stats && (
            <div className="doc-stats">
              {stats.sections_count > 0 && <span>📄 {stats.sections_count} sections</span>}
              {stats.paragraphs_count > 0 && <span>📝 {stats.paragraphs_count} paragraphs</span>}
              {stats.tables_count > 0 && <span>📊 {stats.tables_count} tables</span>}
              {stats.image_components_count > 0 && <span>🖼️ {stats.image_components_count} images</span>}
              {stats.file_components_count > 0 && <span>📎 {stats.file_components_count} files</span>}
              {stats.inline_images_count > 0 && <span>🎨 {stats.inline_images_count} inline images</span>}
              {comments && comments.length > 0 && <span><MessageSquare size={14} style={{ display: 'inline' }} /> {comments.length} comments</span>}
              {issues && issues.length > 0 && <span>⚠️ {issues.length} issues</span>}
            </div>
          )}

          {/* Metadata */}
          {referencedDocument.metadata && (
            <div className="doc-metadata">
              {referencedDocument.metadata.version_number && (
                <span className="version-badge">v{referencedDocument.metadata.version_number}</span>
              )}
              {referencedDocument.metadata.is_draft && (
                <span className="draft-badge">DRAFT</span>
              )}
            </div>
          )}
        </div>

        {/* Render all root sections */}
        {referencedDocument.sections?.map((section) => renderSection(section, 0))}

        {/* Show comments section if present */}
        {comments && comments.length > 0 && (
          <div className="referenced-comments">
            <h4>
              <MessageSquare size={18} style={{ display: 'inline', marginRight: '0.5rem' }} />
              Comments ({comments.length})
            </h4>
            {comments.slice(0, 5).map((comment) => (
              <div key={comment.id} className="comment-item">
                <div className="comment-header">
                  <strong>{comment.author_name || 'Anonymous'}</strong>
                  <span className="comment-date">
                    {new Date(comment.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="comment-content">{comment.content}</div>
                {comment.replies && comment.replies.length > 0 && (
                  <div className="comment-replies">
                    {comment.replies.map((reply) => (
                      <div key={reply.id} className="reply-item">
                        <strong>{reply.author_name}</strong>: {reply.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {comments.length > 5 && (
              <div className="text-sm text-gray-500 mt-2">
                + {comments.length - 5} more comments
              </div>
            )}
          </div>
        )}

        {/* Show issues if present */}
        {issues && issues.length > 0 && (
          <div className="referenced-issues">
            <h4>⚠️ Issues ({issues.length})</h4>
            {issues.map((issue) => (
              <div key={issue.id} className="issue-item" data-severity={issue.severity}>
                <div className="issue-type">{issue.issue_type}</div>
                <div className="issue-description">{issue.description}</div>
                {issue.location && <div className="issue-location">📍 {issue.location}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Show attachments if present */}
        {attachments && attachments.length > 0 && (
          <div className="referenced-attachments">
            <h4>📎 Attachments</h4>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="attachment-item">
                <FileText size={16} />
                <span>{attachment.name || attachment.file_name}</span>
                <span className="attachment-meta">
                  {attachment.file_type?.toUpperCase()} • {documentFileService.formatFileSize(attachment.file_size)}
                </span>
                <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                  <Download size={14} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderEmbedMode = () => {
    // If this is a referenced document, render its content
    if (referencedDocument || loadingDocument || documentError) {
      return (
        <div className={`file-component-embed document-embed ${component.alignment || 'center'}`}>
          {component.label && (
            <div className="embed-label">
              {component.label}
              {component.reference_number && (
                <span className="reference-number">[{component.reference_number}]</span>
              )}
            </div>
          )}
          <div className="embed-container-document">
            {renderReferencedDocumentContent()}
          </div>
          {component.show_description && component.description && (
            <div className="embed-description">{component.description}</div>
          )}
        </div>
      );
    }

    // Only PDF files can be embedded
    if (component.file_metadata?.file_type !== 'pdf') {
      return renderLinkMode(); // Fallback to link mode
    }

    return (
      <div className={`file-component-embed ${component.alignment || 'center'}`}>
        {component.label && (
          <div className="embed-label">
            {component.label}
            {component.reference_number && (
              <span className="reference-number">[{component.reference_number}]</span>
            )}
          </div>
        )}
        <div 
          className="embed-container"
          style={{
            width: `${component.width_percent || 100}%`,
            height: `${component.height_pixels || 600}px`
          }}
        >
          <embed
            src={component.file_url}
            type="application/pdf"
            width="100%"
            height="100%"
          />
        </div>
        {component.show_description && component.description && (
          <div className="embed-description">{component.description}</div>
        )}
      </div>
    );
  };

  const renderDownloadMode = () => (
    <div className={`file-component-download ${component.alignment || 'center'}`}>
      {component.label && (
        <div className="download-label">
          {component.label}
          {component.reference_number && (
            <span className="reference-number">[{component.reference_number}]</span>
          )}
        </div>
      )}
      <button
        className="download-button"
        onClick={handleDownload}
        disabled={downloading}
      >
        <div className="download-icon">{getIcon()}</div>
        <div className="download-content">
          <div className="download-title">
            {component.show_filename 
              ? component.file_metadata?.name 
              : (component.label || 'Download File')}
          </div>
          <div className="download-meta">
            {component.show_file_type && (
              <span>{component.file_metadata?.file_type?.toUpperCase()}</span>
            )}
            {component.show_file_size && (
              <span>{component.file_metadata?.file_size_display}</span>
            )}
          </div>
        </div>
        <Download size={24} className="download-arrow" />
      </button>
      {component.show_description && component.description && (
        <div className="download-description">{component.description}</div>
      )}
    </div>
  );

  const renderReferenceMode = () => {
    // If referenced document is available, show title and section count
    const docInfo = referencedDocument ? (
      <div className="reference-doc-info">
        <span className="text-sm text-blue-600">📄 {referencedDocument.title}</span>
        {referencedDocument.sections && (
          <span className="text-xs text-gray-500"> • {referencedDocument.sections.length} sections</span>
        )}
      </div>
    ) : null;

    return (
      <div className={`file-component-reference ${component.alignment || 'left'}`}>
        <div className="reference-marker">
          {component.reference_number || '•'}
        </div>
        <div className="reference-content">
          <div className="reference-label">{component.label || component.file_metadata?.name}</div>
          {docInfo}
          {component.show_description && component.description && (
            <div className="reference-description">{component.description}</div>
          )}
          {(component.show_file_type || component.show_file_size) && (
            <div className="reference-meta">
              {component.show_file_type && (
                <span>{component.file_metadata?.file_type?.toUpperCase()}</span>
              )}
              {component.show_file_size && (
                <span>{component.file_metadata?.file_size_display}</span>
              )}
            </div>
          )}
        </div>
        {(component.show_download_link ?? component.show_download_button) && (
          <button
            className="reference-download"
            onClick={handleDownload}
            title="Download"
          >
            <Download size={16} />
          </button>
        )}
      </div>
    );
  };

  const renderPagesMode = () => {
    const fileUrl =
      component.file_url ||
      component.file_metadata?.file_url ||
      component.file_metadata?.file ||
      component.file;

    const parsePageRange = (rangeText, totalPages) => {
      if (!rangeText || !totalPages) return [];
      const result = new Set();
      const parts = String(rangeText)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

      parts.forEach((part) => {
        if (part.includes('-')) {
          const [startRaw, endRaw] = part.split('-');
          const start = Number.parseInt(startRaw, 10);
          const end = Number.parseInt(endRaw, 10);
          if (!Number.isNaN(start) && !Number.isNaN(end)) {
            const from = Math.max(1, Math.min(start, end));
            const to = Math.min(totalPages, Math.max(start, end));
            for (let page = from; page <= to; page += 1) {
              result.add(page);
            }
          }
        } else {
          const page = Number.parseInt(part, 10);
          if (!Number.isNaN(page) && page >= 1 && page <= totalPages) {
            result.add(page);
          }
        }
      });

      return Array.from(result).sort((a, b) => a - b);
    };

    if (!fileUrl) {
      return (
        <div className={`file-component-pages ${component.alignment || 'center'}`}>
          <div className="pages-loading">No file URL available for preview.</div>
        </div>
      );
    }

    if (component.file_metadata?.file_type && component.file_metadata?.file_type !== 'pdf') {
      return renderLinkMode();
    }

    return (
      <div className={`file-component-pages ${component.alignment || 'center'}`}>
        {component.label && (
          <div className="pages-label">
            {component.label}
            {component.reference_number && (
              <span className="reference-number">[{component.reference_number}]</span>
            )}
          </div>
        )}
        <div className="pages-container" ref={pagesContainerRef}>
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages }) => {
              setPageError(null);
              setPageCount(numPages);
            }}
            onLoadError={(error) => {
              console.error('Failed to load PDF:', error);
              setPageError('Failed to load PDF preview.');
              setPageCount(0);
            }}
            onSourceError={(error) => {
              console.error('Failed to load PDF source:', error);
              setPageError('Failed to load PDF source.');
              setPageCount(0);
            }}
            loading={<div className="pages-loading">Loading pages…</div>}
            error={<div className="pages-loading">Failed to load PDF.</div>}
          >
            {pageError && (
              <div className="pages-loading">{pageError}</div>
            )}
            {(() => {
              const rangePages = parsePageRange(component.page_range ?? component.pageRange, pageCount);
              const fallbackPages = Array.from({ length: pageCount || 0 }, (_, i) => i + 1);
              const pagesToRender = rangePages.length > 0 ? rangePages : fallbackPages;
              return pagesToRender.map((pageNumber) => (
                <div key={`page-${pageNumber}`} className="page-card">
                  <Page
                    pageNumber={pageNumber}
                    width={pageWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </div>
              ));
            })()}
          </Document>
        </div>
        {component.show_description && component.description && (
          <div className="pages-description">{component.description}</div>
        )}
      </div>
    );
  };

  const renderIconMode = () => (
    <div className={`file-component-icon ${component.alignment || 'left'}`}>
      <button
        className="icon-button"
        onClick={handleDownload}
        title={component.label || component.file_metadata?.name}
      >
        <div className="icon-symbol">{getIcon()}</div>
        {component.show_label && (
          <div className="icon-label">
            {component.label || component.file_metadata?.name}
          </div>
        )}
      </button>
    </div>
  );

  const renderContent = () => {
    switch (component.display_mode) {
      case 'pages':
        return renderPagesMode();
      case 'embed':
        return renderEmbedMode();
      case 'download':
        return renderDownloadMode();
      case 'reference':
        return renderReferenceMode();
      case 'icon':
        return renderIconMode();
      case 'link':
      default:
        return renderLinkMode();
    }
  };

  const handleSettingsSave = async () => {
    const componentId = component.id || component.client_id;
    if (!componentId) return;

    const updates = {
      display_mode: settingsDraft.display_mode,
      label: settingsDraft.label?.trim() || null,
      description: settingsDraft.description?.trim() || null,
      alignment: settingsDraft.alignment,
      show_description: settingsDraft.show_description,
      show_file_type: settingsDraft.show_file_type,
      show_file_size: settingsDraft.show_file_size,
      show_filename: settingsDraft.show_filename,
      show_label: settingsDraft.show_label,
      preview_enabled: settingsDraft.preview_enabled,
      download_enabled: settingsDraft.download_enabled,
      width_percent: settingsDraft.display_mode === 'embed' ? Number(settingsDraft.width_percent || 100) : undefined,
      height_pixels: settingsDraft.display_mode === 'embed' ? Number(settingsDraft.height_pixels || 600) : undefined,
    };

    await onEdit?.(componentId, updates);
    setShowSettings(false);
  };

  return (
    <div 
      className={`document-file-component ${editable ? 'editable' : ''}`}
      data-component-id={component.id}
      data-order={component.order}
    >
      {editable && showControls && (
        <div className="component-controls">
          <button
            className="control-btn"
            onClick={onMoveUp}
            title="Move up"
            disabled={!onMoveUp}
          >
            <ChevronUp size={16} />
          </button>
          <button
            className="control-btn"
            onClick={onMoveDown}
            title="Move down"
            disabled={!onMoveDown}
          >
            <ChevronDown size={16} />
          </button>
          <button
            className="control-btn"
            onClick={() => setShowDetails(!showDetails)}
            title="File details"
          >
            <Info size={16} />
          </button>
          <button
            className="control-btn"
            onClick={() => setShowSettings(true)}
            title="Edit settings"
          >
            <Edit2 size={16} />
          </button>
          <button
            className="control-btn"
            onClick={() => onReorder?.(component)}
            title="Reorder"
          >
            <Move size={16} />
          </button>
          <button
            className="control-btn danger"
            onClick={handleDelete}
            title="Remove from document"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {renderContent()}

      {showSettings && (
        <div className="file-settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="file-settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="file-settings-header">
              <h4>Edit file display</h4>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="file-settings-body">
              <div className="field-row">
                <label>Display mode</label>
                <select
                  value={settingsDraft.display_mode}
                  onChange={(e) => setSettingsDraft(prev => ({ ...prev, display_mode: e.target.value }))}
                >
                  <option value="link">Link</option>
                  <option value="pages">Pages (PDF)</option>
                  <option value="embed">Embed</option>
                  <option value="download">Download</option>
                  <option value="reference">Reference</option>
                  <option value="icon">Icon</option>
                </select>
              </div>

              <div className="field-row">
                <label>Label</label>
                <input
                  type="text"
                  value={settingsDraft.label}
                  onChange={(e) => setSettingsDraft(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="Exhibit A"
                />
              </div>

              <div className="field-row">
                <label>Description</label>
                <textarea
                  value={settingsDraft.description}
                  onChange={(e) => setSettingsDraft(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                />
              </div>

              <div className="field-row">
                <label>Alignment</label>
                <select
                  value={settingsDraft.alignment}
                  onChange={(e) => setSettingsDraft(prev => ({ ...prev, alignment: e.target.value }))}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>

              {settingsDraft.display_mode === 'embed' && (
                <div className="field-grid">
                  <div className="field-row">
                    <label>Width (%)</label>
                    <input
                      type="number"
                      min="40"
                      max="100"
                      value={settingsDraft.width_percent}
                      onChange={(e) => setSettingsDraft(prev => ({ ...prev, width_percent: e.target.value }))}
                    />
                  </div>
                  <div className="field-row">
                    <label>Height (px)</label>
                    <input
                      type="number"
                      min="200"
                      value={settingsDraft.height_pixels}
                      onChange={(e) => setSettingsDraft(prev => ({ ...prev, height_pixels: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              <div className="field-grid">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.show_description}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, show_description: e.target.checked }))}
                  />
                  Show description
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.show_file_type}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, show_file_type: e.target.checked }))}
                  />
                  Show file type
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.show_file_size}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, show_file_size: e.target.checked }))}
                  />
                  Show file size
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.show_filename}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, show_filename: e.target.checked }))}
                  />
                  Show filename
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.show_label}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, show_label: e.target.checked }))}
                  />
                  Show label
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.preview_enabled}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, preview_enabled: e.target.checked }))}
                  />
                  Enable preview
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settingsDraft.download_enabled}
                    onChange={(e) => setSettingsDraft(prev => ({ ...prev, download_enabled: e.target.checked }))}
                  />
                  Enable download
                </label>
              </div>
            </div>

            <div className="file-settings-footer">
              <button className="secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="primary" onClick={handleSettingsSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showDetails && component.file_metadata && (
        <div className="file-details-panel">
          <h4>File Details</h4>
          <dl>
            <dt>Name:</dt>
            <dd>{component.file_metadata.name}</dd>
            
            <dt>Type:</dt>
            <dd>{component.file_metadata.file_type?.toUpperCase()}</dd>
            
            <dt>Size:</dt>
            <dd>{component.file_metadata.file_size_display}</dd>
            
            {component.file_metadata.category && (
              <>
                <dt>Category:</dt>
                <dd>{component.file_metadata.category}</dd>
              </>
            )}
            
            {component.file_metadata.version && (
              <>
                <dt>Version:</dt>
                <dd>{component.file_metadata.version}</dd>
              </>
            )}
            
            <dt>Uploaded:</dt>
            <dd>{new Date(component.file_metadata.created_at).toLocaleString()}</dd>
            
            <dt>Downloads:</dt>
            <dd>{component.file_metadata.download_count || 0}</dd>
          </dl>
        </div>
      )}

      {component.is_confidential && (
        <div className="confidential-indicator">
          🔒 Confidential
        </div>
      )}
    </div>
  );
};

export default DocumentFileComponent;
