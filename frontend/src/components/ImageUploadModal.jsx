import React, { useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, Loader } from 'lucide-react';
import attachmentService from '../services/attachmentService';
import { validateImageFile } from '../utils/imageUtils';
import './ImageUploadModal.css';

/**
 * ImageUploadModal - Upload new images to the library
 */
const ImageUploadModal = ({ onClose, onImageUploaded }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    caption: '',
    image_type: 'figure',
    tags: ''
  });
  const fileInputRef = useRef(null);

  const imageTypes = [
    { value: 'logo', label: 'Logo' },
    { value: 'watermark', label: 'Watermark' },
    { value: 'background', label: 'Background' },
    { value: 'header_icon', label: 'Header Icon' },
    { value: 'footer_icon', label: 'Footer Icon' },
    { value: 'signature', label: 'Signature' },
    { value: 'stamp', label: 'Stamp' },
    { value: 'diagram', label: 'Diagram' },
    { value: 'figure', label: 'Figure' },
    { value: 'chart', label: 'Chart' },
    { value: 'screenshot', label: 'Screenshot' },
    { value: 'photo', label: 'Photo' },
    { value: 'scanned_page', label: 'Scanned Page' },
    { value: 'picture', label: 'Picture' },
    { value: 'embedded', label: 'Embedded' },
    { value: 'other', label: 'Other' }
  ];

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    const validationError = validateImageFile(selectedFile);
    if (validationError) {
      alert(validationError);
      return;
    }

    setFile(selectedFile);

    // Auto-fill name from filename if empty
    if (!formData.name) {
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '');
      setFormData(prev => ({ ...prev, name: nameWithoutExt }));
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      // Simulate file input change
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(droppedFile);
      fileInputRef.current.files = dataTransfer.files;
      handleFileSelect({ target: { files: [droppedFile] } });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a file');
      return;
    }

    if (!formData.name.trim()) {
      alert('Please enter a name for the image');
      return;
    }

    setUploading(true);

    try {
      // Parse tags
      const tagsArray = formData.tags 
        ? formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag)
        : [];

      // Use attachmentService upload method
      const result = await attachmentService.upload(file, {
        name: formData.name.trim(),
        file_kind: 'image',
        image_type: formData.image_type,
        description: formData.caption.trim() || undefined,
        tags: tagsArray,
        scope: 'user',
      });

      // Normalise — upload returns { status, attachment } or the attachment directly
      const uploadedImage = result?.attachment || result;
      
      console.log('✅ Image uploaded successfully:', uploadedImage);
      
      // Call the callback with the uploaded image
      if (onImageUploaded) {
        onImageUploaded(uploadedImage);
      }

      // Close modal
      onClose();
    } catch (error) {
      console.error('❌ Upload failed:', error);
      alert(error.response?.data?.detail || error.response?.data?.image?.[0] || 'Failed to upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-upload-modal-overlay" onClick={onClose}>
      <div className="image-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h3>
            <Upload size={20} />
            Upload New Image
          </h3>
          <button onClick={onClose} className="close-btn" disabled={uploading}>
            <X size={20} />
          </button>
        </div>

        <div className="upload-modal-body">
          {/* File Drop Zone */}
          <div
            className={`file-drop-zone ${file ? 'has-file' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              disabled={uploading}
            />

            {preview ? (
              <div className="preview-container">
                <img src={preview} alt="Preview" className="preview-image" />
                <button
                  className="change-file-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  disabled={uploading}
                >
                  Change File
                </button>
              </div>
            ) : (
              <div className="drop-zone-content">
                <ImageIcon size={48} />
                <p className="drop-zone-title">Click to select or drag & drop</p>
                <p className="drop-zone-subtitle">PNG, JPG, GIF, WebP (max 10MB)</p>
              </div>
            )}
          </div>

          {/* Form Fields */}
          {file && (
            <div className="upload-form">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Company Logo"
                  disabled={uploading}
                  required
                />
              </div>

              <div className="form-group">
                <label>Caption</label>
                <textarea
                  value={formData.caption}
                  onChange={(e) => setFormData({ ...formData, caption: e.target.value })}
                  placeholder="Optional description of the image"
                  rows={2}
                  disabled={uploading}
                />
              </div>

              <div className="form-group">
                <label>Type</label>
                <select
                  value={formData.image_type}
                  onChange={(e) => setFormData({ ...formData, image_type: e.target.value })}
                  disabled={uploading}
                >
                  {imageTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Tags</label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="Separate with commas: branding, logo, header"
                  disabled={uploading}
                />
              </div>
            </div>
          )}
        </div>

        <div className="upload-modal-footer">
          <button
            onClick={onClose}
            className="cancel-btn"
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            className="upload-btn"
            disabled={!file || uploading}
          >
            {uploading ? (
              <>
                <Loader size={18} className="spinning" />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={18} />
                Upload Image
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageUploadModal;
