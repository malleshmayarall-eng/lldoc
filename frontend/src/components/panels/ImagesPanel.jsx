import { useState } from 'react';
import { Image as ImageIcon, Save } from 'lucide-react';
import ImageSelector from '../ImageSelector';

/**
 * Images Panel for Document Editor Sidebar
 * Manages logo, watermark, background, header/footer icons
 */
const ImagesPanel = ({ images, onChange, onSave }) => {
  const [localImages, setLocalImages] = useState(images || {
    logo_image_id: '',
    watermark_image_id: '',
    background_image_id: '',
    header_icon_id: '',
    footer_icon_id: ''
  });

  const [hasChanges, setHasChanges] = useState(false);

  const handleImageChange = (field, imageId) => {
    const updated = { ...localImages, [field]: imageId };
    setLocalImages(updated);
    setHasChanges(true);
    
    // Auto-propagate to parent if onChange provided
    if (onChange) {
      onChange(updated);
    }
  };

  const handleSave = async () => {
    if (onSave) {
      await onSave(localImages);
      setHasChanges(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-purple-600" />
            Document Images
          </h3>
          {hasChanges && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          )}
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Upload and select images for your document
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Logo */}
        <ImageSelector
          imageType="logo"
          label="Company/Organization Logo"
          selectedImageId={localImages.logo_image_id}
          onImageSelect={(id) => handleImageChange('logo_image_id', id)}
          showUpload={true}
        />

        {/* Watermark */}
        <ImageSelector
          imageType="watermark"
          label="Watermark"
          selectedImageId={localImages.watermark_image_id}
          onImageSelect={(id) => handleImageChange('watermark_image_id', id)}
          showUpload={true}
        />

        {/* Background */}
        <ImageSelector
          imageType="background"
          label="Background Image"
          selectedImageId={localImages.background_image_id}
          onImageSelect={(id) => handleImageChange('background_image_id', id)}
          showUpload={true}
        />

        {/* Header Icon */}
        <ImageSelector
          imageType="header_icon"
          label="Header Icon"
          selectedImageId={localImages.header_icon_id}
          onImageSelect={(id) => handleImageChange('header_icon_id', id)}
          showUpload={true}
        />

        {/* Footer Icon */}
        <ImageSelector
          imageType="footer_icon"
          label="Footer Icon"
          selectedImageId={localImages.footer_icon_id}
          onImageSelect={(id) => handleImageChange('footer_icon_id', id)}
          showUpload={true}
        />
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="text-xs text-gray-600 space-y-1">
          <p>📌 <strong>Tip:</strong> Click to upload new images or select from existing ones</p>
          <p>💾 Maximum file size: 10MB</p>
          <p>🖼️ Supported formats: JPEG, PNG, GIF, WEBP</p>
        </div>
      </div>
    </div>
  );
};

export default ImagesPanel;
