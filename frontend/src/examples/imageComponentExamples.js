/**
 * Example: Using Image Components in DocumentDrafter
 * 
 * This file shows how the image components are integrated
 */

import { useState, useEffect } from 'react';
import ImageSelector from '../components/ImageSelector';
import ImagesPanel from '../components/panels/ImagesPanel';
import ImageUploadPanel from '../components/ImageUploadPanel';
import { imageService } from '../services';

// ============================================================================
// Example 1: Simple Image Selector (Single Type)
// ============================================================================

const LogoSelectorExample = () => {
  const [logoId, setLogoId] = useState('');

  return (
    <div className="p-4">
      <h3>Select Company Logo</h3>
      <ImageSelector
        imageType="logo"
        label="Company Logo"
        selectedImageId={logoId}
        onImageSelect={(id) => {
          setLogoId(id);
          console.log('Selected logo:', id);
        }}
        showUpload={true}
      />
      <p className="mt-2 text-sm text-gray-600">
        Selected ID: {logoId || 'None'}
      </p>
    </div>
  );
};

// ============================================================================
// Example 2: Multiple Image Types
// ============================================================================

const MultipleImageSelectorsExample = () => {
  const [logoId, setLogoId] = useState('');
  const [watermarkId, setWatermarkId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');

  const handleSave = async () => {
    // Save to backend
    await imageService.updateDocumentImages('doc-id', {
      logo_image_id: logoId,
      watermark_image_id: watermarkId,
      background_image_id: backgroundId
    });
  };

  return (
    <div className="p-4 space-y-6">
      <h2>Document Images</h2>

      {/* Logo */}
      <ImageSelector
        imageType="logo"
        selectedImageId={logoId}
        onImageSelect={setLogoId}
      />

      {/* Watermark */}
      <ImageSelector
        imageType="watermark"
        selectedImageId={watermarkId}
        onImageSelect={setWatermarkId}
      />

      {/* Background */}
      <ImageSelector
        imageType="background"
        selectedImageId={backgroundId}
        onImageSelect={setBackgroundId}
      />

      <button
        onClick={handleSave}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg"
      >
        Save Images
      </button>
    </div>
  );
};

// ============================================================================
// Example 3: Complete Images Panel (Used in DocumentDrafter)
// ============================================================================

const ImagesPanelExample = ({ documentId }) => {
  const [images, setImages] = useState({
    logo_image_id: '',
    watermark_image_id: '',
    background_image_id: '',
    header_icon_id: '',
    footer_icon_id: ''
  });

  return (
    <ImagesPanel
      images={images}
      onChange={(updatedImages) => {
        setImages(updatedImages);
        console.log('Images changed:', updatedImages);
      }}
      onSave={async (updatedImages) => {
        // Save to backend via API
        await imageService.updateDocumentImages(documentId, updatedImages);
        console.log('Saved:', updatedImages);
      }}
    />
  );
};

// ============================================================================
// Example 4: Full Image Upload Panel (Gallery + Upload)
// ============================================================================

const ImageGalleryExample = ({ documentId }) => {
  const [selectedImageId, setSelectedImageId] = useState('');

  return (
    <div className="h-screen">
      <ImageUploadPanel
        documentId={documentId}
        selectedImageId={selectedImageId}
        onImageSelected={(image) => {
          setSelectedImageId(image.id);
          console.log('Selected image:', image);
          // Use image.id to update document
        }}
      />
    </div>
  );
};

// ============================================================================
// Example 5: Programmatic Upload
// ============================================================================

const ProgrammaticUploadExample = () => {
  const handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      // Upload image
      const result = await imageService.uploadImage(file, {
        name: 'My Logo',
        imageType: 'logo',
        caption: 'Company logo',
        isPublic: false,
        tags: ['branding', 'official']
      });

      const imageId = result.image.id;
      console.log('Uploaded image ID:', imageId);

      // Now use imageId to update document
      await imageService.updateDocumentImages('doc-id', {
        logo_image_id: imageId
      });

    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
      />
    </div>
  );
};

// ============================================================================
// Example 6: Quick Upload (Simplified)
// ============================================================================

const QuickUploadExample = () => {
  const handleQuickUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      // Quick upload - minimal params
      const result = await imageService.quickUpload(file, 'logo');
      const imageId = result.image.id;
      console.log('Quick upload successful:', imageId);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <input
      type="file"
      accept="image/*"
      onChange={handleQuickUpload}
    />
  );
};

// ============================================================================
// Example 7: Get Images by Type
// ============================================================================

const GetImagesByTypeExample = () => {
  const [logos, setLogos] = useState([]);

  const loadLogos = async () => {
    try {
      const data = await imageService.getImagesByType('logo');
      setLogos(data.images);
    } catch (error) {
      console.error('Failed to load logos:', error);
    }
  };

  useEffect(() => {
    loadLogos();
  }, []);

  return (
    <div>
      <h3>Available Logos ({logos.length})</h3>
      <div className="grid grid-cols-3 gap-2">
        {logos.map(logo => (
          <div key={logo.id}>
            <img src={logo.thumbnail_url} alt={logo.name} />
            <p>{logo.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Example 8: DocumentDrafter Integration (Actual Usage)
// ============================================================================

const DocumentDrafterIntegration = () => {
  // In DocumentDrafter.jsx, the integration looks like this:

  /*
  // 1. Import
  import ImagesPanel from '../components/panels/ImagesPanel';
  import { Image as ImageIcon } from 'lucide-react';

  // 2. State (already exists)
  const [images, setImages] = useState({
    logo_image_id: '',
    watermark_image_id: '',
    background_image_id: '',
    header_icon_id: '',
    footer_icon_id: ''
  });

  // 3. Load images from document
  const loadDocument = async () => {
    const doc = await documentService.getDocument(id);
    setImages({
      logo_image_id: doc.logo_image_id || '',
      watermark_image_id: doc.watermark_image_id || '',
      background_image_id: doc.background_image_id || '',
      header_icon_id: doc.header_icon_id || '',
      footer_icon_id: doc.footer_icon_id || ''
    });
  };

  // 4. Add tab to properties panel
  {
    key: 'images',
    label: 'Images',
    icon: ImageIcon
  }

  // 5. Add panel content
  {activePropertyTab === 'images' && (
    <ImagesPanel
      images={images}
      onChange={setImages}
      onSave={async (updatedImages) => {
        await api.patch(`/documents/${id}/edit-full/`, {
          ...updatedImages,
          change_summary: 'Updated document images'
        });
        setImages(updatedImages);
      }}
    />
  )}
  */
};

export {
  LogoSelectorExample,
  MultipleImageSelectorsExample,
  ImagesPanelExample,
  ImageGalleryExample,
  ProgrammaticUploadExample,
  QuickUploadExample,
  GetImagesByTypeExample,
  DocumentDrafterIntegration
};
