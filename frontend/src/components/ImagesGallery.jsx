import { useState, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, Trash2, Eye, User, FileText, Users, Search, Filter } from 'lucide-react';
import DraggableImageItem from './DraggableImageItem';
import { imageService } from '../services/imageService';
import { validateImageFile } from '../utils/imageUtils';

/**
 * Images Gallery Component
 * Shows user uploads, document uploads, and team uploads with upload capabilities
 */
const ImagesGallery = ({ documentId, onClose }) => {
  const [activeTab, setActiveTab] = useState('document'); // 'user', 'document', 'team'
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    name: '',
    image_type: 'picture',
    caption: ''
  });

  // Load images based on active tab
  useEffect(() => {
    loadImages();
  }, [activeTab]);

  const loadImages = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        upload_scope: activeTab
      };
      
      if (activeTab === 'document' && documentId) {
        params.document = documentId;
      }

      const response = await imageService.getImages(params);
      const imageData = Array.isArray(response) ? response : response?.results || [];
      setImages(imageData);
    } catch (err) {
      console.error('Error loading images:', err);
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  // Handle file upload
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
      await imageService.uploadImage(file, {
        name: uploadForm.name || file.name,
        imageType: uploadForm.image_type,
        caption: uploadForm.caption || undefined,
        documentId: activeTab === 'document' ? documentId : undefined,
        uploadScope: activeTab,
      });

      // Reset form
      setUploadForm({
        name: '',
        image_type: 'picture',
        caption: ''
      });
      
      e.target.value = '';
      
      // Reload images
      await loadImages();
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Delete image
  const handleDelete = async (imageId) => {
    if (!window.confirm('Delete this image?')) return;

    try {
  await imageService.deleteImage(imageId);
      await loadImages();
    } catch (err) {
      console.error('Delete error:', err);
      setError('Failed to delete image');
    }
  };

  // Filter images by search term
  const filteredImages = images.filter(img => 
    !searchTerm || 
    img.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    img.caption?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    img.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const tabConfig = {
    user: {
      icon: User,
      label: 'My Uploads',
      color: 'blue',
      description: 'Private images visible only to you'
    },
    document: {
      icon: FileText,
      label: 'Document',
      color: 'green',
      description: 'Shared with document collaborators'
    },
    team: {
      icon: Users,
      label: 'Team',
      color: 'purple',
      description: 'Available to all team members'
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-5xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-pink-50 to-purple-50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-pink-600 rounded-lg">
              <ImageIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Images Gallery</h3>
              <p className="text-sm text-gray-600">Manage and upload images</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 bg-gray-50">
          {Object.entries(tabConfig).map(([key, config]) => {
            const Icon = config.icon;
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center space-x-2 px-4 py-3 border-b-2 transition-colors ${
                  isActive
                    ? `border-${config.color}-600 text-${config.color}-600 bg-white`
                    : 'border-transparent text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{config.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Description & Upload */}
        <div className="p-4 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-700">
              <strong>{tabConfig[activeTab].label}:</strong> {tabConfig[activeTab].description}
            </p>
            
            {/* Quick Upload */}
            <div className="flex items-center space-x-2">
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
                id="quick-upload"
              />
              <label
                htmlFor="quick-upload"
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                  uploading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-pink-600 hover:bg-pink-700 text-white'
                }`}
              >
                <Upload className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {uploading ? 'Uploading...' : 'Quick Upload'}
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search images by name, caption, or tags..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Images Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600"></div>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="text-center py-20">
              <ImageIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h4 className="text-lg font-medium text-gray-600 mb-2">
                No images found
              </h4>
              <p className="text-sm text-gray-500 mb-4">
                {searchTerm 
                  ? `No images match "${searchTerm}"`
                  : `Upload your first image to ${tabConfig[activeTab].label.toLowerCase()}`
                }
              </p>
              <label
                htmlFor="quick-upload"
                className="inline-flex items-center space-x-2 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Image</span>
              </label>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-gray-700">
                  {filteredImages.length} image{filteredImages.length !== 1 ? 's' : ''}
                </h4>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredImages.map(image => (
                  <DraggableImageItem
                    key={image.id}
                    image={image}
                  >
                    <div
                      className="group relative border-2 border-gray-200 rounded-lg overflow-hidden hover:border-pink-400 transition-all cursor-pointer"
                      onClick={() => {
                        setSelectedImage(image);
                        setShowPreview(true);
                      }}
                    >
                    {/* Image */}
                    <div className="aspect-square bg-gray-100">
                      <img
                        src={image.thumbnail_url || image.url || image.image}
                        alt={image.name}
                        className="w-full h-full object-cover"
                      />
                    </div>                      {/* Info */}
                      <div className="p-2 bg-white">
                        <div className="text-xs font-medium text-gray-900 truncate" title={image.name}>
                          {image.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {image.width && image.height && (
                            <span>{image.width}×{image.height}</span>
                          )}
                        </div>
                        {image.caption && (
                          <div className="text-xs text-gray-600 mt-1 truncate" title={image.caption}>
                            {image.caption}
                          </div>
                        )}
                        {image.tags && image.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {image.tags.slice(0, 2).map((tag, idx) => (
                              <span
                                key={idx}
                                className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                            {image.tags.length > 2 && (
                              <span className="text-xs text-gray-500">
                                +{image.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions (on hover) */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedImage(image);
                            setShowPreview(true);
                          }}
                          className="p-1.5 bg-white rounded-lg shadow-lg hover:bg-gray-100"
                          title="Preview"
                      >
                        <Eye className="w-4 h-4 text-gray-700" />
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

                    {/* Usage Badge */}
                    {image.usage_count > 0 && (
                      <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                        Used: {image.usage_count}
                      </div>
                    )}
                  </div>
                  </DraggableImageItem>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
          <div className="flex items-center justify-between">
            <div>
              💾 Max file size: 10MB • 🖼️ Formats: JPEG, PNG, GIF, WEBP
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <div className="max-w-4xl max-h-full bg-white rounded-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 bg-gray-100 flex justify-between items-center">
              <div>
                <h4 className="font-semibold text-gray-900">{selectedImage.name}</h4>
                <p className="text-sm text-gray-600">
                  {selectedImage.width}×{selectedImage.height} • {selectedImage.format} • {(selectedImage.file_size / 1024).toFixed(1)}KB
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="p-2 hover:bg-gray-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 max-h-96 overflow-auto">
              <img
                src={selectedImage.url || selectedImage.image}
                alt={selectedImage.name}
                className="max-w-full h-auto mx-auto"
              />
            </div>
            {selectedImage.caption && (
              <div className="p-4 bg-gray-50 text-sm text-gray-700">
                <strong>Caption:</strong> {selectedImage.caption}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImagesGallery;
