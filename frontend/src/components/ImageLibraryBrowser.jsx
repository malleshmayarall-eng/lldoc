import React, { useState, useEffect } from 'react';
import { 
  Image as ImageIcon, 
  Upload, 
  Search, 
  Filter,
  X,
  Check,
  Grid,
  List,
  Calendar,
  Tag
} from 'lucide-react';
import { imageService } from '../services/imageService';
import ImageUploadModal from './ImageUploadModal';
import './ImageLibraryBrowser.css';

/**
 * ImageLibraryBrowser - Browse and select images from the user's library
 * Used when adding images to documents
 */
const ImageLibraryBrowser = ({ 
  onSelectImage, 
  onClose,
  multiSelect = false,
  showUpload = true 
}) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [selectedImages, setSelectedImages] = useState([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    try {
      setLoading(true);
      const data = await imageService.getImages();
      // Handle different response formats
      let imageArray = [];
      if (Array.isArray(data)) {
        imageArray = data;
      } else if (data && data.results && Array.isArray(data.results)) {
        imageArray = data.results;
      } else if (data && typeof data === 'object') {
        imageArray = [];
      }
      
      setImages(imageArray);
    } catch (error) {
      console.error('❌ Failed to load images:', error);
      console.error('❌ Error details:', error.response?.data || error.message);
      setError(error.response?.data?.detail || error.message || 'Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUploaded = (uploadedImage) => {
    console.log('📸 Image uploaded, adding to library:', uploadedImage);
    
    // The uploadedImage from imageService.uploadImage should already have fixed URLs
    // But we'll add it to the beginning of the list
    setImages(prev => [uploadedImage, ...prev]);
    setUploadModalOpen(false);
  };

  const filteredImages = images.filter(image => {
    const matchesSearch = !searchTerm || 
      image.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      image.caption?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      image.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType = filterType === 'all' || image.image_type === filterType;

    return matchesSearch && matchesType;
  });

  const handleImageClick = (image) => {
    if (multiSelect) {
      setSelectedImages(prev => {
        const isSelected = prev.some(img => img.id === image.id);
        if (isSelected) {
          return prev.filter(img => img.id !== image.id);
        } else {
          return [...prev, image];
        }
      });
    } else {
      onSelectImage(image);
    }
  };

  const handleConfirmSelection = () => {
    if (multiSelect && selectedImages.length > 0) {
      onSelectImage(selectedImages);
    }
  };

  const isImageSelected = (imageId) => {
    return selectedImages.some(img => img.id === imageId);
  };

  const imageTypes = [
    { value: 'all', label: 'All Types' },
    { value: 'figure', label: 'Figures' },
    { value: 'diagram', label: 'Diagrams' },
    { value: 'logo', label: 'Logos' },
    { value: 'signature', label: 'Signatures' },
    { value: 'stamp', label: 'Stamps' },
    { value: 'exhibit', label: 'Exhibits' },
    { value: 'screenshot', label: 'Screenshots' },
    { value: 'photo', label: 'Photos' },
    { value: 'other', label: 'Other' },
  ];

  const renderImageCard = (image) => {
    const isSelected = isImageSelected(image.id);

    return (
      <div
        key={image.id}
        className={`image-card ${isSelected ? 'selected' : ''} ${viewMode}`}
        onClick={() => handleImageClick(image)}
      >
        {multiSelect && (
          <div className={`selection-indicator ${isSelected ? 'selected' : ''}`}>
            {isSelected && <Check size={16} />}
          </div>
        )}
        
        <div className="image-preview">
          <img 
            src={image.thumbnail_url || image.image_url} 
            alt={image.name} 
            loading="lazy"
            onError={(e) => {
              console.error('Failed to load image:', image.name, {
                thumbnail_url: image.thumbnail_url,
                image_url: image.image_url,
                image: image.image,
                thumbnail: image.thumbnail
              });
              e.target.style.display = 'none';
            }}
          />
        </div>

        <div className="image-info">
          <h4 className="image-name">{image.name}</h4>
          
          {image.image_type && (
            <span className={`image-type-tag ${image.image_type}`}>
              {image.image_type}
            </span>
          )}

          {viewMode === 'list' && (
            <>
              {image.caption && (
                <p className="image-caption">{image.caption}</p>
              )}
              <div className="image-meta">
                {image.width && image.height && (
                  <span className="dimensions">
                    {image.width} × {image.height}
                  </span>
                )}
                {image.file_size && (
                  <span className="file-size">
                    {formatFileSize(image.file_size)}
                  </span>
                )}
                {image.created_at && (
                  <span className="upload-date">
                    <Calendar size={12} />
                    {new Date(image.created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              {image.tags && image.tags.length > 0 && (
                <div className="image-tags">
                  {image.tags.map((tag, idx) => (
                    <span key={idx} className="tag">
                      <Tag size={10} />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="image-library-browser">
      <div className="browser-header">
        <div className="header-top">
          <h3>
            <ImageIcon size={20} />
            Image Library
          </h3>
          <button onClick={onClose} className="close-btn">
            <X size={20} />
          </button>
        </div>

        <div className="browser-controls">
          <div className="search-bar">
            <Search size={18} />
            <input
              type="text"
              placeholder="Search images..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="filter-controls">
            <Filter size={18} />
            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
              className="type-filter"
            >
              {imageTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div className="view-toggle">
            <button
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <Grid size={18} />
            </button>
            <button
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={18} />
            </button>
          </div>

          {showUpload && (
            <button 
              className="upload-btn"
              onClick={() => setUploadModalOpen(true)}
            >
              <Upload size={18} />
              Upload New
            </button>
          )}
        </div>
      </div>

      <div className="browser-body">
        {/* Debug info */}
        <div style={{padding: '10px', background: '#f0f0f0', fontSize: '12px', fontFamily: 'monospace'}}>
          <div>Total images in state: {images.length}</div>
          <div>Filtered images: {filteredImages.length}</div>
          <div>Search term: "{searchTerm}"</div>
          <div>Filter type: {filterType}</div>
          <div>Loading: {loading ? 'true' : 'false'}</div>
          {error && <div style={{color: 'red', fontWeight: 'bold'}}>Error: {error}</div>}
        </div>
        
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading images...</p>
          </div>
        ) : filteredImages.length === 0 ? (
          <div className="empty-state">
            <ImageIcon size={48} />
            <h4>No Images Found</h4>
            <p>
              {searchTerm || filterType !== 'all' 
                ? 'Try adjusting your search or filters'
                : 'Upload your first image to get started'
              }
            </p>
            {showUpload && !searchTerm && filterType === 'all' && (
              <button 
                className="upload-btn primary"
                onClick={() => setUploadModalOpen(true)}
              >
                <Upload size={18} />
                Upload Image
              </button>
            )}
          </div>
        ) : (
          <div className={`images-container ${viewMode}`}>
            {filteredImages.map(renderImageCard)}
          </div>
        )}
      </div>

      {multiSelect && selectedImages.length > 0 && (
        <div className="browser-footer">
          <p>{selectedImages.length} image{selectedImages.length !== 1 ? 's' : ''} selected</p>
          <div className="footer-actions">
            <button 
              onClick={() => setSelectedImages([])}
              className="clear-btn"
            >
              Clear Selection
            </button>
            <button 
              onClick={handleConfirmSelection}
              className="confirm-btn"
            >
              <Check size={18} />
              Add Selected Images
            </button>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {uploadModalOpen && (
        <ImageUploadModal
          onClose={() => setUploadModalOpen(false)}
          onImageUploaded={handleImageUploaded}
        />
      )}
    </div>
  );
};

export default ImageLibraryBrowser;
