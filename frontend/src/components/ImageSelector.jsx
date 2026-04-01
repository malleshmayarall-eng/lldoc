import { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, Check } from 'lucide-react';
import attachmentService from '../services/attachmentService';
import { getImageUrl, validateImageFile } from '../utils/imageUtils';

/**
 * Simple image selector component for selecting images by type
 * Used in document editor sidebar for selecting logo, watermark, background, etc.
 */
const ImageSelector = ({ 
  imageType = 'logo', 
  selectedImageId, 
  onImageSelect,
  label,
  showUpload = true 
}) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Load images of specific type
  useEffect(() => {
    loadImages();
  }, [imageType]);

  const loadImages = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await attachmentService.list({ file_kind: 'image', image_type: imageType });
      const list = Array.isArray(response) ? response : response?.results || [];
      setImages(list);
    } catch (err) {
      console.error('Error loading images:', err);
      setError('Failed to load images');
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle file upload
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const uploadResponse = await attachmentService.upload(file, {
        name: file.name,
        file_kind: 'image',
        image_type: imageType,
        scope: 'user',
      });

      const newImage = uploadResponse?.attachment || uploadResponse;
      
      // Add to list and select it
      setImages(prev => [newImage, ...prev]);
      if (onImageSelect) {
        onImageSelect(newImage.id);
      }

      e.target.value = '';
    } catch (err) {
      console.error('Error uploading:', err);
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const typeLabels = {
    logo: 'Logo',
    watermark: 'Watermark',
    background: 'Background',
    header_icon: 'Header Icon',
    footer_icon: 'Footer Icon',
    signature: 'Signature',
    stamp: 'Stamp',
    diagram: 'Diagram',
    figure: 'Figure',
    chart: 'Chart',
    screenshot: 'Screenshot',
    photo: 'Photo',
    scanned_page: 'Scanned Page',
    picture: 'Picture',
    embedded: 'Embedded',
    other: 'Other'
  };

  return (
    <div className="space-y-2">
      {/* Label */}
      <label className="block text-sm font-medium text-gray-700">
        {label || typeLabels[imageType] || imageType}
      </label>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
          {error}
        </div>
      )}

      {/* Image Grid */}
      <div className="grid grid-cols-3 gap-2">
        {/* Upload Button */}
        {showUpload && (
          <div className="aspect-square border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 transition-colors">
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
              id={`upload-${imageType}`}
            />
            <label
              htmlFor={`upload-${imageType}`}
              className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
            >
              <Upload className={`w-6 h-6 ${uploading ? 'text-blue-600 animate-pulse' : 'text-gray-400'}`} />
              <span className="text-xs text-gray-500 mt-1">
                {uploading ? 'Uploading...' : 'Upload'}
              </span>
            </label>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="aspect-square border border-gray-200 rounded-lg flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Existing Images */}
        {images.map(image => (
          <div
            key={image.id}
            onClick={() => onImageSelect && onImageSelect(image.id)}
            className={`relative aspect-square border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
              selectedImageId === image.id
                ? 'border-blue-500 shadow-md ring-2 ring-blue-200'
                : 'border-gray-200 hover:border-blue-300'
            }`}
            title={image.name}
          >
            <img
              src={getImageUrl(image, true)}
              alt={image.name}
              className="w-full h-full object-cover"
            />
            {selectedImageId === image.id && (
              <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                <div className="bg-blue-600 rounded-full p-1">
                  <Check className="w-4 h-4 text-white" />
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Empty State */}
        {!loading && images.length === 0 && !showUpload && (
          <div className="col-span-3 text-center py-4 text-gray-500 text-sm">
            <ImageIcon className="w-8 h-8 mx-auto mb-1 text-gray-300" />
            No images available
          </div>
        )}
      </div>

      {/* Selected Image Info */}
      {selectedImageId && (
        <div className="text-xs text-gray-600">
          {images.find(img => img.id === selectedImageId)?.name || 'Image selected'}
        </div>
      )}
    </div>
  );
};

export default ImageSelector;
