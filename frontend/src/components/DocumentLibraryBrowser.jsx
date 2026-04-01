import React, { useState, useEffect } from 'react';
import { 
  FileText,
  Upload, 
  Search, 
  Filter,
  X,
  Check,
  Grid,
  List,
  Calendar,
  Tag,
  Download,
  Eye,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { documentFileService } from '../services/documentFileService';
import attachmentService from '../services/attachmentService';
import DocumentUploadModal from './DocumentUploadModal';
import './DocumentLibraryBrowser.css';

/**
 * DocumentLibraryBrowser - Browse and select files from the user's library
 * Used when adding files to documents
 */
const DocumentLibraryBrowser = ({ 
  onSelectFile,
  onSelectDocument, // Alias for onSelectFile
  onClose,
  multiSelect = false,
  showUpload = true,
  allowedFileTypes = null, // Array of allowed file types, null = all
  documentId = null, // Current document ID for context
  embedded = false,
}) => {
  // Use onSelectDocument if provided, otherwise fallback to onSelectFile
  const handleSelect = onSelectDocument || onSelectFile;
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('-created_at'); // Default: newest first
  const [pageRangeModalOpen, setPageRangeModalOpen] = useState(false);
  const [activePdfFile, setActivePdfFile] = useState(null);
  const [pdfLayerImages, setPdfLayerImages] = useState([]);
  const [pdfLayerLoading, setPdfLayerLoading] = useState(false);
  const [pdfLayerError, setPdfLayerError] = useState(null);
  const [pageRangeInput, setPageRangeInput] = useState('');
  const [selectedPages, setSelectedPages] = useState([]);

  useEffect(() => {
    loadFiles();
  }, [sortBy]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await attachmentService.list({
        file_kind: 'document',
        sort: sortBy,
      });
      
      // Handle different response formats
      let fileArray = [];
      if (Array.isArray(data)) {
        fileArray = data;
      } else if (data && data.results && Array.isArray(data.results)) {
        fileArray = data.results;
      } else if (data && data.files && Array.isArray(data.files)) {
        fileArray = data.files;
      } else if (data?.data?.files && Array.isArray(data.data.files)) {
        fileArray = data.data.files;
      }
      
      // Normalise attachment fields to file fields expected by the grid
      fileArray = fileArray.map((a) => ({
        ...a,
        file: a.file || a.url,
        file_url: a.file || a.url,
        file_type: a.file_kind_display || a.mime_type?.split('/').pop() || 'document',
        file_size_display: a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : '',
      }));

      setFiles(fileArray);
    } catch (error) {
      console.error('❌ Failed to load files:', error);
      setError(error.response?.data?.detail || error.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUploaded = (uploadedFile) => {
    console.log('📎 File uploaded, adding to library:', uploadedFile);
    setFiles(prev => [uploadedFile, ...prev]);
    setUploadModalOpen(false);
  };

  const filteredFiles = files.filter(file => {
    // Search filter
    const matchesSearch = !searchTerm || 
      file.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      file.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      file.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

    // File type filter
    const matchesType = filterType === 'all' || file.file_type === filterType;
    
    // Category filter
    const matchesCategory = filterCategory === 'all' || file.category === filterCategory;
    
    // Allowed file types (if specified)
    const matchesAllowed = !allowedFileTypes || allowedFileTypes.includes(file.file_type);

    return matchesSearch && matchesType && matchesCategory && matchesAllowed;
  });

  const handleFileClick = (file) => {
    if (multiSelect) {
      setSelectedFiles(prev => {
        const isSelected = prev.some(f => f.id === file.id);
        if (isSelected) {
          return prev.filter(f => f.id !== file.id);
        } else {
          return [...prev, file];
        }
      });
    } else {
      const isPdf = file?.file_type === 'pdf';
      if (isPdf) {
        openPageRangeModal(file);
        return;
      }
      handleSelect(file);
    }
  };

  const parsePageRange = (rangeText, totalPages) => {
    if (!rangeText || !totalPages) return [];
    const pages = new Set();
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
          const to = Math.max(1, Math.min(totalPages, Math.max(start, end)));
          for (let page = from; page <= to; page += 1) {
            pages.add(page);
          }
        }
      } else {
        const page = Number.parseInt(part, 10);
        if (!Number.isNaN(page) && page >= 1 && page <= totalPages) {
          pages.add(page);
        }
      }
    });

    return Array.from(pages).sort((a, b) => a - b);
  };

  const formatPageRange = (pages) => {
    if (!pages.length) return '';
    const sorted = [...pages].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i <= sorted.length; i += 1) {
      const current = sorted[i];
      if (current === prev + 1) {
        prev = current;
        continue;
      }
      if (start === prev) {
        ranges.push(`${start}`);
      } else {
        ranges.push(`${start}-${prev}`);
      }
      start = current;
      prev = current;
    }

    return ranges.join(',');
  };

  const openPageRangeModal = async (file) => {
    setActivePdfFile(file);
    setPageRangeModalOpen(true);
    setPdfLayerError(null);
    setPageRangeInput(file?.page_range || file?.pageRange || '');
    setSelectedPages([]);

    try {
      setPdfLayerLoading(true);
      const layerResponse = await documentFileService.getPdfLayer(file.id, { layer: 'images' });
      const html = layerResponse?.html || '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const images = Array.from(doc.querySelectorAll('img')).map((img) => img.outerHTML);
      setPdfLayerImages(images);

      if (file?.page_range || file?.pageRange) {
        setSelectedPages(parsePageRange(file.page_range || file.pageRange, images.length));
      }
    } catch (layerError) {
      console.error('Failed to load PDF layer preview:', layerError);
      setPdfLayerError(layerError?.response?.data?.detail || 'Failed to load PDF preview');
      setPdfLayerImages([]);
    } finally {
      setPdfLayerLoading(false);
    }
  };

  const closePageRangeModal = () => {
    setPageRangeModalOpen(false);
    setActivePdfFile(null);
    setPdfLayerImages([]);
    setPdfLayerError(null);
    setPageRangeInput('');
    setSelectedPages([]);
  };

  const handleApplyPageRangeInput = () => {
    const totalPages = pdfLayerImages.length || 0;
    const parsed = parsePageRange(pageRangeInput, totalPages);
    setSelectedPages(parsed);
    if (parsed.length) {
      setPageRangeInput(formatPageRange(parsed));
    }
  };

  const handleTogglePage = (pageNumber) => {
    setSelectedPages((prev) => {
      const next = prev.includes(pageNumber)
        ? prev.filter((page) => page !== pageNumber)
        : [...prev, pageNumber];
      setPageRangeInput(formatPageRange(next));
      return next;
    });
  };

  const handleConfirmPageRange = () => {
    if (!activePdfFile) return;
    const trimmed = pageRangeInput.trim();
    const finalRange = trimmed || formatPageRange(selectedPages);
    handleSelect({
      ...activePdfFile,
      page_range: finalRange || undefined,
      pageRange: finalRange || undefined,
    });
    closePageRangeModal();
  };

  const handleConfirmSelection = () => {
    if (selectedFiles.length > 0) {
      handleSelect(selectedFiles);
    }
  };

  const handleDelete = async (file, e) => {
    e.stopPropagation();
    
    if (!window.confirm(`Are you sure you want to delete "${file.name}"?`)) {
      return;
    }

    try {
      await documentFileService.deleteFile(file.id);
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file. It may be in use in documents.');
    }
  };

  const handleDownload = async (file, e) => {
    e.stopPropagation();
    
    try {
      await documentFileService.trackDownload(file.id);
      window.open(file.file_url, '_blank');
    } catch (error) {
      console.error('Failed to download file:', error);
    }
  };

  const fileTypeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'pdf', label: 'PDF' },
    { value: 'docx', label: 'Word' },
    { value: 'xlsx', label: 'Excel' },
    { value: 'pptx', label: 'PowerPoint' },
    { value: 'txt', label: 'Text' },
    { value: 'csv', label: 'CSV' },
    { value: 'json', label: 'JSON' },
    { value: 'xml', label: 'XML' },
    { value: 'zip', label: 'Archive' }
  ];

  const categoryOptions = [
    { value: 'all', label: 'All Categories' },
    { value: 'contract', label: 'Contract' },
    { value: 'agreement', label: 'Agreement' },
    { value: 'exhibit', label: 'Exhibit' },
    { value: 'schedule', label: 'Schedule' },
    { value: 'template', label: 'Template' },
    { value: 'reference', label: 'Reference' },
    { value: 'other', label: 'Other' }
  ];

  const sortOptions = [
    { value: '-created_at', label: 'Newest First' },
    { value: 'created_at', label: 'Oldest First' },
    { value: 'name', label: 'Name (A-Z)' },
    { value: '-name', label: 'Name (Z-A)' },
    { value: '-download_count', label: 'Most Downloaded' },
    { value: '-usage_count', label: 'Most Used' },
    { value: '-file_size', label: 'Largest First' },
    { value: 'file_size', label: 'Smallest First' }
  ];

  const showHeaderUpload = showUpload;

  return (
    <div className={`document-library-browser ${embedded ? 'embedded' : ''}`}>
      <div className={`browser-header ${embedded ? 'embedded' : ''}`}>
        {!embedded && (
          <div className="header-top">
            <h2>
              <FileText size={24} />
              Document Library
            </h2>
            <button className="close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        )}

        <div className="header-controls">
          <div className="search-bar">
            <Search size={18} />
            <input
              style={{ color: 'black' }}
              type="text"
              placeholder="Search files by name, description, or tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-controls">
            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
              className="filter-select"
            >
              {fileTypeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <select 
              value={filterCategory} 
              onChange={(e) => setFilterCategory(e.target.value)}
              className="filter-select"
            >
              {categoryOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="filter-select"
            >
              {sortOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="view-controls">
            <button
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <Grid size={18} />
            </button>
            <button
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={18} />
            </button>
          </div>

          {showHeaderUpload && (
            <button 
              className="upload-btn"
              onClick={() => setUploadModalOpen(true)}
            >
              <Upload size={18} />
              Upload File
            </button>
          )}
        </div>
      </div>

      <div className="browser-content">
        {error && (
          <div className="error-message">
            <X size={18} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading files...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="empty-state">
            <FileText size={64} />
            <h3>No files found</h3>
            <p>
              {searchTerm || filterType !== 'all' || filterCategory !== 'all'
                ? 'Try adjusting your filters'
                : 'Upload your first file to get started'}
            </p>
            {showUpload && !showHeaderUpload && (
              <button 
                className="upload-btn-large"
                onClick={() => setUploadModalOpen(true)}
              >
                <Upload size={20} />
                Upload File
              </button>
            )}
          </div>
        ) : (
          <div className={`files-${viewMode}`}>
            {filteredFiles.map(file => (
              <div
                key={file.id}
                className={`file-card ${
                  selectedFiles.some(f => f.id === file.id) ? 'selected' : ''
                }`}
                onClick={() => handleFileClick(file)}
              >
                {multiSelect && (
                  <div className="selection-indicator">
                    {selectedFiles.some(f => f.id === file.id) && (
                      <Check size={16} />
                    )}
                  </div>
                )}

                <div className="file-icon">
                  {documentFileService.getFileIcon(file.file_type)}
                </div>

                <div className="file-info">
                  <h4 className="file-name">{file.name}</h4>
                  
                  <div className="file-meta">
                    <span className="file-type">
                      {file.file_type.toUpperCase()}
                    </span>
                    <span className="file-size">
                      {documentFileService.formatFileSize(file.file_size)}
                    </span>
                    {file.category && (
                      <span className="file-category">
                        {file.category}
                      </span>
                    )}
                  </div>

                  {file.description && (
                    <p className="file-description">{file.description}</p>
                  )}

                  {file.tags && file.tags.length > 0 && (
                    <div className="file-tags">
                      {file.tags.slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="tag">
                          <Tag size={12} />
                          {tag}
                        </span>
                      ))}
                      {file.tags.length > 3 && (
                        <span className="tag-more">+{file.tags.length - 3}</span>
                      )}
                    </div>
                  )}

                  <div className="file-stats">
                    <span title="Downloads">
                      <Download size={14} />
                      {file.download_count || 0}
                    </span>
                    <span title="Used in documents">
                      <Eye size={14} />
                      {file.usage_count || 0}
                    </span>
                    <span title="Upload date">
                      <Calendar size={14} />
                      {new Date(file.created_at || file.uploaded_at || file.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="file-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="action-btn"
                    onClick={(e) => handleDownload(file, e)}
                    title="Download"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(file.file_url, '_blank');
                    }}
                    title="Open in new tab"
                  >
                    <ExternalLink size={16} />
                  </button>
                  <button
                    className="action-btn danger"
                    onClick={(e) => handleDelete(file, e)}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {file.is_confidential && (
                  <div className="confidential-badge" title="Confidential">
                    🔒
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {multiSelect && selectedFiles.length > 0 && (
        <div className="browser-footer">
          <div className="selection-info">
            {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
          </div>
          <div className="footer-actions">
            <button 
              className="cancel-btn"
              onClick={() => setSelectedFiles([])}
            >
              Clear Selection
            </button>
            <button 
              className="confirm-btn"
              onClick={handleConfirmSelection}
            >
              <Check size={18} />
              Add Selected Files
            </button>
          </div>
        </div>
      )}

      {uploadModalOpen && (
        <DocumentUploadModal
          onClose={() => setUploadModalOpen(false)}
          onUploadComplete={handleFileUploaded}
          documentId={documentId}
        />
      )}

      {pageRangeModalOpen && (
        <div className="pdf-range-modal-overlay">
          <div className="pdf-range-modal">
            <div className="pdf-range-modal-header">
              <div>
                <h3>Select PDF pages</h3>
                <p className="pdf-range-subtitle">
                  {activePdfFile?.name || 'PDF'} • Choose pages or enter a range (e.g. 1-3,5)
                </p>
              </div>
              <button className="close-btn" onClick={closePageRangeModal}>
                <X size={18} />
              </button>
            </div>

            <div className="pdf-range-controls">
              <div className="pdf-range-input-group">
                <label htmlFor="page-range-input">Page range</label>
                <input
                  id="page-range-input"
                  type="text"
                  value={pageRangeInput}
                  onChange={(e) => setPageRangeInput(e.target.value)}
                  placeholder="1-3,5"
                />
                <button type="button" className="apply-range-btn" onClick={handleApplyPageRangeInput}>
                  Apply
                </button>
              </div>
              <div className="pdf-range-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    const totalPages = pdfLayerImages.length || 0;
                    const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);
                    setSelectedPages(allPages);
                    setPageRangeInput(formatPageRange(allPages));
                  }}
                >
                  Select all pages
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setSelectedPages([]);
                    setPageRangeInput('');
                  }}
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="pdf-range-preview">
              {pdfLayerLoading && <div className="pdf-range-loading">Loading PDF preview…</div>}
              {pdfLayerError && <div className="pdf-range-error">{pdfLayerError}</div>}
              {!pdfLayerLoading && !pdfLayerError && pdfLayerImages.length === 0 && (
                <div className="pdf-range-empty">No preview available.</div>
              )}
              {!pdfLayerLoading && pdfLayerImages.length > 0 && (
                <div className="pdf-range-grid">
                  {pdfLayerImages.map((imgHtml, index) => {
                    const pageNumber = index + 1;
                    const isSelected = selectedPages.includes(pageNumber);
                    return (
                      <button
                        type="button"
                        key={`pdf-page-${pageNumber}`}
                        className={`pdf-page-thumb ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleTogglePage(pageNumber)}
                      >
                        <div className="pdf-page-number">Page {pageNumber}</div>
                        <div
                          className="pdf-page-image"
                          dangerouslySetInnerHTML={{ __html: imgHtml }}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pdf-range-footer">
              <button type="button" className="secondary-btn" onClick={closePageRangeModal}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={handleConfirmPageRange}>
                Attach PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentLibraryBrowser;
