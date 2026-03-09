import { useState, useEffect, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Trash2, Eye, Globe, Lock, Tag } from 'lucide-react';
import { imageService } from '../services/imageService';
import { getImageUrl, validateImageFile } from '../utils/imageUtils';

const IMAGE_TYPES = [
  { value: 'logo', label: 'Company/Organization Logo', icon: '🏢' },
  { value: 'watermark', label: 'Watermark Image', icon: '💧' },
  { value: 'background', label: 'Background Image', icon: '🖼️' },
  { value: 'header_icon', label: 'Header Icon', icon: '⬆️' },
  { value: 'footer_icon', label: 'Footer Icon', icon: '⬇️' },
  { value: 'signature', label: 'Signature Image', icon: '✍️' },
  { value: 'stamp', label: 'Stamp/Seal', icon: '🔖' },
  { value: 'diagram', label: 'Diagram', icon: '📊' },
  { value: 'figure', label: 'Figure', icon: '🧩' },
  { value: 'chart', label: 'Chart', icon: '�' },
  { value: 'screenshot', label: 'Screenshot', icon: '📸' },
  { value: 'photo', label: 'Photo', icon: '📷' },
  { value: 'scanned_page', label: 'Scanned Page', icon: '📄' },
  { value: 'picture', label: 'General Picture', icon: '🖼️' },
  { value: 'embedded', label: 'Embedded Image', icon: '📎' },
  { value: 'other', label: 'Other', icon: '�️' }
];

const ImageUploadPanel = ({ documentId, onImageSelected, selectedImageId }) => {
  const [images, setImages] = useState({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedType, setSelectedType] = useState('logo');
  const [viewMode, setViewMode] = useState('upload'); // 'upload' or 'gallery'
  const [showPreview, setShowPreview] = useState(null);

  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    name: '',
    image_type: 'logo',
    caption: '',
    description: '',
    is_public: false,
    tags: ''
  });

  // Load user's images grouped by type
  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
  const response = await imageService.getImagesByTypes();
  setImages(response.by_type || {});
    } catch (err) {
      console.error('Error loading images:', err);
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // Handle file selection and upload
  const handleFileUpload = async (e) => {
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
      const uploadResponse = await imageService.uploadImage(file, {
        name: uploadForm.name || file.name,
        imageType: uploadForm.image_type,
        caption: uploadForm.caption || undefined,
        description: uploadForm.description || undefined,
        documentId,
        isPublic: uploadForm.is_public,
        tags: uploadForm.tags,
      });

      const uploadedImage = uploadResponse?.image || uploadResponse;
      
      // Reset form
      setUploadForm({
        name: '',
        image_type: 'logo',
        caption: '',
        description: '',
        is_public: false,
        tags: ''
      });
      
      // Reset file input
      e.target.value = '';
      
      // Reload images
      await loadImages();
      
      // Notify parent if callback provided
      if (onImageSelected) {
        onImageSelected(uploadedImage);
      }
      
      // Switch to gallery view
      setViewMode('gallery');
      
    } catch (err) {
      console.error('Error uploading image:', err);
      setError(err.response?.data?.error || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  };

  // Delete image
  const handleDelete = async (imageId) => {
    if (!window.confirm('Are you sure you want to delete this image?')) return;

    try {
  await imageService.deleteImage(imageId);
      await loadImages();
    } catch (err) {
      console.error('Error deleting image:', err);
      setError('Failed to delete image');
    }
  };

  // Toggle public/private
  const togglePublic = async (imageId, isPublic) => {
    try {
      if (isPublic) {
        await imageService.makePrivate(imageId);
      } else {
        await imageService.makePublic(imageId);
      }
      await loadImages();
    } catch (err) {
      console.error('Error toggling image visibility:', err);
      setError('Failed to update image visibility');
    }
  };

  // Filter images by selected type
  const filteredImages = selectedType === 'all' 
    ? Object.values(images).flat()
    : images[selectedType] || [];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-blue-600" />
          Image Manager
        </h3>
        
        {/* View Mode Toggle */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setViewMode('upload')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'upload'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Upload className="w-4 h-4 inline mr-1" />
            Upload
          </button>
          <button
            onClick={() => setViewMode('gallery')}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'gallery'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <ImageIcon className="w-4 h-4 inline mr-1" />
            Gallery
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="float-right">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'upload' ? (
          /* Upload Form */
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Image Name *
              </label>
              <input
                type="text"
                value={uploadForm.name}
                onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Company Logo 2026"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Image Type *
              </label>
              <select
                value={uploadForm.image_type}
                onChange={(e) => setUploadForm({ ...uploadForm, image_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {IMAGE_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.icon} {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Caption
              </label>
              <input
                type="text"
                value={uploadForm.caption}
                onChange={(e) => setUploadForm({ ...uploadForm, caption: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Short caption"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={uploadForm.description}
                onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows="3"
                placeholder="Detailed description"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={uploadForm.tags}
                onChange={(e) => setUploadForm({ ...uploadForm, tags: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., branding, official, 2026"
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_public"
                checked={uploadForm.is_public}
                onChange={(e) => setUploadForm({ ...uploadForm, is_public: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="is_public" className="ml-2 text-sm text-gray-700">
                Make this image public (accessible to all users)
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Image File *
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                  id="image-upload"
                />
                <label
                  htmlFor="image-upload"
                  className="cursor-pointer flex flex-col items-center"
                >
                  <Upload className="w-12 h-12 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">
                    {uploading ? 'Uploading...' : 'Click to upload image'}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">
                    JPEG, PNG, GIF, WEBP (max 10MB)
                  </span>
                </label>
              </div>
            </div>
          </div>
        ) : (
          /* Gallery View */
          <div className="space-y-4">
            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Type
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Types</option>
                {IMAGE_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.icon} {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Image Grid */}
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading images...</div>
            ) : filteredImages.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <ImageIcon className="w-16 h-16 mx-auto mb-2 text-gray-300" />
                <p>No images found</p>
                <button
                  onClick={() => setViewMode('upload')}
                  className="mt-2 text-blue-600 hover:text-blue-700 text-sm"
                >
                  Upload your first image
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredImages.map(image => (
                  <div
                    key={image.id}
                    className={`relative group border-2 rounded-lg overflow-hidden transition-all cursor-pointer ${
                      selectedImageId === image.id
                        ? 'border-blue-500 shadow-lg'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                    onClick={() => onImageSelected && onImageSelected(image)}
                  >
                    {/* Image */}
                    <div className="aspect-square bg-gray-100">
                      <img
                        src={getImageUrl(image, true)}
                        alt={image.name}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Info */}
                    <div className="p-2 bg-white">
                      <div className="text-xs font-medium text-gray-900 truncate">
                        {image.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        {image.is_public ? (
                          <Globe className="w-3 h-3" />
                        ) : (
                          <Lock className="w-3 h-3" />
                        )}
                        <span>{image.width}×{image.height}</span>
                      </div>
                      {image.tags && image.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {image.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions (on hover) */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowPreview(image);
                        }}
                        className="p-1.5 bg-white rounded-lg shadow-lg hover:bg-gray-100"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4 text-gray-700" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePublic(image.id, image.is_public);
                        }}
                        className="p-1.5 bg-white rounded-lg shadow-lg hover:bg-gray-100"
                        title={image.is_public ? 'Make Private' : 'Make Public'}
                      >
                        {image.is_public ? (
                          <Lock className="w-4 h-4 text-gray-700" />
                        ) : (
                          <Globe className="w-4 h-4 text-gray-700" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(image.id);
                        }}
                        className="p-1.5 bg-white rounded-lg shadow-lg hover:bg-red-100"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    </div>

                    {/* Usage Count Badge */}
                    {image.usage_count > 0 && (
                      <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                        Used: {image.usage_count}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowPreview(null)}
        >
          <div className="max-w-4xl max-h-full bg-white rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 bg-gray-100 flex justify-between items-center">
              <div>
                <h4 className="font-semibold text-gray-900">{showPreview.name}</h4>
                <p className="text-sm text-gray-600">
                  {showPreview.width}×{showPreview.height} • {showPreview.format} • {(showPreview.file_size / 1024).toFixed(1)}KB
                </p>
              </div>
              <button
                onClick={() => setShowPreview(null)}
                className="p-2 hover:bg-gray-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 max-h-96 overflow-auto">
              <img
                src={
                  showPreview.url?.startsWith('http')
                    ? showPreview.url
                    : `http://localhost:8000${showPreview.url}`
                }
                alt={showPreview.name}
                className="max-w-full h-auto mx-auto"
              />
            </div>
            {showPreview.caption && (
              <div className="p-4 bg-gray-50 text-sm text-gray-700">
                <strong>Caption:</strong> {showPreview.caption}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUploadPanel;
