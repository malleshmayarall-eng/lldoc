import React, { useState, useRef } from 'react';
import {
  Upload,
  X,
  FileText,
  AlertCircle,
  CheckCircle,
  Loader
} from 'lucide-react';
import { documentFileService } from '../services/documentFileService';
import attachmentService from '../services/attachmentService';
import './DocumentUploadModal.css';

/**
 * DocumentUploadModal - Upload files with metadata
 */
const DocumentUploadModal = ({
  onClose,
  onUploadComplete,
  documentId = null,
  defaultAccessLevel = 'user',
  defaultCategory = null
}) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  
  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(defaultCategory || '');
  const [accessLevel, setAccessLevel] = useState(defaultAccessLevel);
  const [isConfidential, setIsConfidential] = useState(false);
  const [version, setVersion] = useState('1.0');
  const [tags, setTags] = useState('');
  
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      if (!name) {
        setName(selectedFile.name);
      }
      setError(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      if (!name) {
        setName(droppedFile.name);
      }
      setError(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    if (!name.trim()) {
      setError('Please provide a name');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setUploadProgress(0);

      // Parse tags
      const tagArray = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const metadata = {
        name: name.trim(),
        description: description.trim(),
        category: category || undefined,
        access_level: accessLevel,
        is_confidential: isConfidential,
        version: version.trim(),
        tags: tagArray,
        document: documentId || undefined,
        metadata: {
          original_filename: file.name,
          uploaded_from: 'document-editor'
        }
      };

      // Simulate progress (real progress would need axios onUploadProgress)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      const uploadedFile = await attachmentService.upload(file, {
        name: metadata.name,
        description: metadata.description,
        file_kind: 'document',
        scope: metadata.access_level === 'team' ? 'team' : metadata.access_level === 'organization' ? 'organization' : 'user',
        document: metadata.document,
        tags: metadata.tags,
      });
      
      // Normalise response — attachmentService.upload returns { status, attachment } or object directly
      const result = uploadedFile?.attachment || uploadedFile;
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      setSuccess(true);

      // Wait a moment to show success, then callback
      setTimeout(() => {
        onUploadComplete(result);
        onClose();
      }, 1000);

    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.response?.data?.detail || err.message || 'Upload failed');
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const categories = documentFileService.getCategories();
  const accessLevels = documentFileService.getAccessLevels();

  return (
    <div className="document-upload-modal-overlay" onClick={onClose}>
      <div className="document-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Upload size={24} />
            Upload Document File
          </h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-content">
          {/* File Drop Zone */}
          <div
            className={`file-drop-zone ${file ? 'has-file' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => !file && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.xml,.zip,.rar"
            />
            
            {file ? (
              <div className="file-preview">
                <div className="file-icon-large">
                  {documentFileService.getFileIcon(
                    documentFileService.getFileTypeFromExtension(file.name)
                  )}
                </div>
                <div className="file-details">
                  <p className="file-name">{file.name}</p>
                  <p className="file-size">
                    {documentFileService.formatFileSize(file.size)}
                  </p>
                </div>
                <button
                  className="remove-file-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setName('');
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="drop-zone-placeholder">
                <div className="drop-icon">
                  <Upload size={40} />
                </div>
                <p className="drop-text">Drag & drop your file here</p>
                <p className="drop-subtext">or</p>
                <button
                  type="button"
                  className="browse-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Browse files
                </button>
                <div className="drop-chip-row">
                  <span className="drop-chip">PDF</span>
                  <span className="drop-chip">Word</span>
                  <span className="drop-chip">Excel</span>
                  <span className="drop-chip">PowerPoint</span>
                  <span className="drop-chip">More</span>
                </div>
              </div>
            )}
          </div>

          {/* Upload Form */}
          {file && !uploading && !success && (
            <div className="upload-form">
              <div className="form-group">
                <label>File Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter file name"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the file"
                  className="form-textarea"
                  rows={3}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="form-select"
                  >
                    <option value="">Select category (optional)</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Version</label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="e.g., 1.0, Draft, Final"
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Access Level *</label>
                <div className="access-level-options">
                  {accessLevels.map(level => (
                    <label key={level.value} className="radio-option">
                      <input
                        type="radio"
                        name="access_level"
                        value={level.value}
                        checked={accessLevel === level.value}
                        onChange={(e) => setAccessLevel(e.target.value)}
                      />
                      <span className="radio-label">
                        <span className="icon">{level.icon}</span>
                        {level.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g., legal, contract, 2026"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isConfidential}
                    onChange={(e) => setIsConfidential(e.target.checked)}
                  />
                  <span>Mark as confidential 🔒</span>
                </label>
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {uploading && (
            <div className="upload-progress">
              <div className="progress-icon">
                {success ? (
                  <CheckCircle size={48} className="success-icon" />
                ) : (
                  <Loader size={48} className="loading-icon" />
                )}
              </div>
              <p className="progress-text">
                {success ? 'Upload complete!' : 'Uploading...'}
              </p>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="progress-percent">{uploadProgress}%</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="error-message">
              <AlertCircle size={18} />
              {error}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        {!uploading && !success && (
          <div className="modal-footer">
            <button className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button 
              className="upload-btn"
              onClick={handleUpload}
              disabled={!file || !name.trim()}
            >
              <Upload size={18} />
              Upload File
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentUploadModal;
