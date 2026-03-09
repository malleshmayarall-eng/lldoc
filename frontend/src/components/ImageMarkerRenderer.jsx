import React, { useEffect, useState, useMemo } from 'react';
import { parseImageMarkers, extractImageIds, normalizeSize, getAlignmentClasses } from '../utils/imageMarkers';
import { imageService } from '../services';

/**
 * Renders paragraph text with embedded image markers
 * Parses {{img:...}} markers and displays images inline
 */
const ImageMarkerRenderer = ({ 
  text = '', 
  editable = false,
  onImageUpdate,
  onImageDelete,
  className = ''
}) => {
  const [images, setImages] = useState({});
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  
  // Parse markers from text
  const markers = useMemo(() => parseImageMarkers(text), [text]);
  
  // Extract unique image IDs
  const imageIds = useMemo(() => extractImageIds(text), [text]);
  
  // Load images when IDs change
  useEffect(() => {
    if (imageIds.length === 0) {
      setImages({});
      setLoading(false);
      return;
    }
    
    loadImages(imageIds);
  }, [imageIds]);
  
  const loadImages = async (ids) => {
    setLoading(true);
    setErrors({});
    
    try {
      // Batch fetch images using new endpoint
      const { images: imageData, not_found } = await imageService.batchGetImages(ids);
      
      // Create lookup object
      const imageLookup = {};
      imageData.forEach(img => {
        imageLookup[img.id] = img;
      });
      
      // Track not found images
      const newErrors = {};
      not_found.forEach(id => {
        newErrors[id] = 'Image not found';
      });
      
      setImages(imageLookup);
      setErrors(newErrors);
    } catch (error) {
      console.error('Failed to load images:', error);
      
      // Mark all as error
      const newErrors = {};
      ids.forEach(id => {
        newErrors[id] = error.message || 'Failed to load image';
      });
      setErrors(newErrors);
    } finally {
      setLoading(false);
    }
  };
  
  const renderContent = () => {
    if (markers.length === 0) {
      return <span className="whitespace-pre-wrap">{text}</span>;
    }
    
    const elements = [];
    let cursor = 0;
    
    markers.forEach((marker, idx) => {
      // Add text before marker
      if (marker.startIndex > cursor) {
        const textContent = text.substring(cursor, marker.startIndex);
        elements.push(
          <span key={`text-${idx}`} className="whitespace-pre-wrap">
            {textContent}
          </span>
        );
      }
      
      // Render image or placeholder
      elements.push(
        <ImageRenderer
          key={`image-${marker.imageId}-${idx}`}
          marker={marker}
          imageData={images[marker.imageId]}
          error={errors[marker.imageId]}
          loading={loading}
          editable={editable}
          onUpdate={(updates) => onImageUpdate?.(marker, updates)}
          onDelete={() => onImageDelete?.(marker)}
        />
      );
      
      cursor = marker.endIndex;
    });
    
    // Add remaining text
    if (cursor < text.length) {
      const textContent = text.substring(cursor);
      elements.push(
        <span key="text-end" className="whitespace-pre-wrap">
          {textContent}
        </span>
      );
    }
    
    return elements;
  };
  
  if (loading && markers.length === 0) {
    return (
      <div className={`text-gray-400 italic ${className}`}>
        Loading images...
      </div>
    );
  }
  
  return (
    <div className={`image-marker-renderer ${className}`}>
      {renderContent()}
    </div>
  );
};

/**
 * Renders a single image from a marker
 */
const ImageRenderer = ({ 
  marker, 
  imageData, 
  error, 
  loading,
  editable,
  onUpdate,
  onDelete 
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // If loading, show placeholder
  if (loading) {
    return (
      <span className="inline-flex items-center px-3 py-1 bg-gray-100 rounded text-gray-500 text-sm">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading image {marker.imageId}...
      </span>
    );
  }
  
  // If error or not found, show error placeholder
  if (error || !imageData) {
    return (
      <span className="inline-flex items-center px-3 py-1 bg-red-100 text-red-600 rounded text-sm">
        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Image {marker.imageId} not found
      </span>
    );
  }
  
  // Normalize size and alignment
  const { cssValue } = normalizeSize(marker.size);
  const alignmentClasses = getAlignmentClasses(marker.alignment);
  
  // Build container classes
  const containerClasses = [
    'inline-image-container',
    'relative',
    marker.alignment === 'center' ? 'block' : 'inline-block',
    alignmentClasses
  ].join(' ');
  
  return (
    <span 
      className={containerClasses}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <img
        src={imageData.url}
        alt={marker.caption || imageData.alt_text || `Image ${marker.imageId}`}
        className="inline-image max-w-full h-auto"
        style={{ 
          width: cssValue.split(': ')[1],
          display: marker.alignment === 'inline' ? 'inline' : 'block'
        }}
        data-image-id={marker.imageId}
        data-alignment={marker.alignment}
        data-size={marker.size}
      />
      
      {/* Caption */}
      {marker.caption && (
        <figcaption className="text-sm text-gray-600 text-center mt-1 italic">
          {marker.caption}
        </figcaption>
      )}
      
      {/* Edit controls (if editable and hovered) */}
      {editable && isHovered && (
        <div className="absolute top-0 right-0 bg-white rounded shadow-lg p-1 flex gap-1 z-10">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 hover:bg-gray-100 rounded"
            title="Edit image"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1 hover:bg-red-100 text-red-600 rounded"
            title="Delete image"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
      
      {/* Edit dialog */}
      {isEditing && (
        <ImageEditDialog
          marker={marker}
          imageData={imageData}
          onSave={(updates) => {
            onUpdate(updates);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      )}
    </span>
  );
};

/**
 * Dialog for editing image properties
 */
const ImageEditDialog = ({ marker, imageData, onSave, onCancel }) => {
  const [alignment, setAlignment] = useState(marker.alignment);
  const [size, setSize] = useState(marker.size);
  const [caption, setCaption] = useState(marker.caption || '');
  
  const handleSave = () => {
    onSave({
      alignment,
      size,
      caption: caption.trim() || null
    });
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-96">
        <h3 className="text-lg font-semibold mb-4">Edit Image</h3>
        
        {/* Alignment */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Alignment</label>
          <div className="flex gap-2">
            {['left', 'center', 'right', 'inline'].map(align => (
              <button
                key={align}
                onClick={() => setAlignment(align)}
                className={`px-3 py-1 rounded border ${
                  alignment === align 
                    ? 'bg-blue-500 text-white border-blue-500' 
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {align.charAt(0).toUpperCase() + align.slice(1)}
              </button>
            ))}
          </div>
        </div>
        
        {/* Size */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Size</label>
          <div className="flex gap-2 mb-2">
            {['small', 'medium', 'large', 'full'].map(s => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`px-3 py-1 rounded border text-sm ${
                  size === s 
                    ? 'bg-blue-500 text-white border-blue-500' 
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="50%, 300px, small, medium, large, full"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        {/* Caption */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Caption (optional)</label>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Figure 1: Description"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageMarkerRenderer;
