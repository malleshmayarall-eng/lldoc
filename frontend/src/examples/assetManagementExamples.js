/**
 * Complete Examples: Document Assets Management
 * 
 * This file contains practical examples of using ImageUploader and FileAttachmentManager
 * with the DocumentMetadataEditor and edit-full API.
 */

import documentService from './services/documentService';
import { buildImages, buildFiles, buildEditFullPayload } from './utils/documentFieldBuilder';

// ============================================================================
// EXAMPLE 1: Upload Logo and Link to Document
// ============================================================================

export const example1_uploadLogo = async (documentId, logoFile) => {
  try {
    // 1. Validate file
    if (!logoFile.type.startsWith('image/')) {
      throw new Error('File must be an image');
    }
    if (logoFile.size > 5 * 1024 * 1024) {
      throw new Error('File size must be less than 5MB');
    }

    // 2. Simulate upload (replace with actual API call)
    const uploadedImageId = await simulateImageUpload(logoFile);
    console.log('Uploaded logo with ID:', uploadedImageId);

    // 3. Link to document using edit-full API
    const updates = buildImages({ logoImageId: uploadedImageId });
    
    await documentService.editFull(documentId, {
      ...updates,
      change_summary: 'Added company logo',
    });

    console.log('Logo linked to document successfully!');
    return uploadedImageId;

  } catch (error) {
    console.error('Failed to upload logo:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 2: Upload Multiple Attachments
// ============================================================================

export const example2_uploadMultipleAttachments = async (documentId, files) => {
  try {
    const attachments = [];

    // 1. Process each file
    for (const file of files) {
      // Validate
      if (file.size > 10 * 1024 * 1024) {
        console.warn(`Skipping ${file.name}: exceeds 10MB limit`);
        continue;
      }

      // Simulate upload
      const filePath = await simulateFileUpload(file);

      // Create attachment object
      attachments.push({
        name: file.name,
        file_path: filePath,
        type: determineAttachmentType(file.name),
        size: file.size,
      });
    }

    // 2. Update document with all attachments
    const updates = buildFiles({ attachments });
    
    await documentService.editFull(documentId, {
      ...updates,
      change_summary: `Added ${attachments.length} attachments`,
    });

    console.log(`Successfully uploaded ${attachments.length} attachments`);
    return attachments;

  } catch (error) {
    console.error('Failed to upload attachments:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 3: Complete Document Setup with All Assets
// ============================================================================

export const example3_completeDocumentSetup = async (documentId) => {
  try {
    // Prepare all assets
    const assets = {
      // Images
      logo: await fetchFile('/assets/company-logo.png'),
      watermark: await fetchFile('/assets/confidential-watermark.png'),
      headerIcon: await fetchFile('/assets/header-icon.png'),
      
      // Attachments
      exhibit: await fetchFile('/documents/exhibit-a.pdf'),
      schedule: await fetchFile('/documents/payment-schedule.xlsx'),
      appendix: await fetchFile('/documents/technical-specs.docx'),
    };

    // Upload all images
    const logoId = await simulateImageUpload(assets.logo);
    const watermarkId = await simulateImageUpload(assets.watermark);
    const headerIconId = await simulateImageUpload(assets.headerIcon);

    // Upload all files
    const exhibitPath = await simulateFileUpload(assets.exhibit);
    const schedulePath = await simulateFileUpload(assets.schedule);
    const appendixPath = await simulateFileUpload(assets.appendix);

    // Build complete update
    const updates = buildEditFullPayload({
      // Images
      ...buildImages({
        logoImageId: logoId,
        watermarkImageId: watermarkId,
        headerIconId: headerIconId,
      }),
      
      // Files
      ...buildFiles({
        attachments: [
          {
            name: 'Exhibit A - Financial Statements',
            file_path: exhibitPath,
            type: 'exhibit',
            size: assets.exhibit.size,
          },
          {
            name: 'Schedule 1 - Payment Terms',
            file_path: schedulePath,
            type: 'schedule',
            size: assets.schedule.size,
          },
          {
            name: 'Appendix A - Technical Specifications',
            file_path: appendixPath,
            type: 'appendix',
            size: assets.appendix.size,
          },
        ],
      }),
      
      change_summary: 'Complete document setup with all assets',
    });

    // Apply all updates at once
    await documentService.editFull(documentId, updates);

    console.log('Document fully configured with all assets!');

  } catch (error) {
    console.error('Failed to setup document:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 4: Replace Attachment with New Version
// ============================================================================

export const example4_replaceAttachmentVersion = async (
  documentId,
  existingAttachments,
  attachmentIndex,
  newFile
) => {
  try {
    // 1. Get existing attachment
    const oldAttachment = existingAttachments[attachmentIndex];
    console.log('Replacing:', oldAttachment.name);

    // 2. Upload new version
    const newFilePath = await simulateFileUpload(newFile);

    // 3. Update attachment with new version
    const updatedAttachments = [...existingAttachments];
    updatedAttachments[attachmentIndex] = {
      ...oldAttachment,
      file_path: newFilePath,
      size: newFile.size,
      version: (oldAttachment.version || 1) + 1,
      updated_at: new Date().toISOString(),
      // Store old version in history
      previous_version: {
        file_path: oldAttachment.file_path,
        size: oldAttachment.size,
        replaced_at: new Date().toISOString(),
      },
    };

    // 4. Update document
    const updates = buildFiles({ attachments: updatedAttachments });
    
    await documentService.editFull(documentId, {
      ...updates,
      change_summary: `Updated ${oldAttachment.name} to v${updatedAttachments[attachmentIndex].version}`,
    });

    console.log('Attachment version updated successfully!');
    return updatedAttachments[attachmentIndex];

  } catch (error) {
    console.error('Failed to replace attachment:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 5: Download Attachment
// ============================================================================

export const example5_downloadAttachment = async (attachment) => {
  try {
    console.log('Downloading:', attachment.name);

    // In production, this would be an API call:
    // const response = await axios.get(
    //   `/api/attachments/${attachment.file_id}/download/`,
    //   { responseType: 'blob' }
    // );

    // For now, simulate download
    const downloadUrl = attachment.file_path || `#download-${attachment.name}`;
    
    // Create download link
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = attachment.name;
    link.click();

    console.log('Download started');

  } catch (error) {
    console.error('Failed to download attachment:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 6: Preview Attachment
// ============================================================================

export const example6_previewAttachment = async (attachment) => {
  try {
    const ext = attachment.name.split('.').pop()?.toLowerCase();
    
    // Check if previewable
    const previewableTypes = ['pdf', 'txt', 'jpg', 'jpeg', 'png', 'gif'];
    if (!previewableTypes.includes(ext)) {
      throw new Error('Preview not available for this file type');
    }

    console.log('Previewing:', attachment.name);

    // In production, this would be an API call:
    // const response = await axios.get(
    //   `/api/attachments/${attachment.file_id}/preview/`,
    //   { responseType: 'blob' }
    // );
    // const previewUrl = URL.createObjectURL(response.data);

    // For now, use file path
    const previewUrl = attachment.file_path;

    // Open in modal or new tab
    if (ext === 'pdf') {
      window.open(previewUrl, '_blank');
    } else {
      // Show in modal
      return { url: previewUrl, type: ext };
    }

  } catch (error) {
    console.error('Failed to preview attachment:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 7: Bulk Update Images
// ============================================================================

export const example7_bulkUpdateImages = async (documentId, images) => {
  try {
    const imageIds = {};

    // Upload all images
    if (images.logo) {
      imageIds.logoImageId = await simulateImageUpload(images.logo);
    }
    if (images.watermark) {
      imageIds.watermarkImageId = await simulateImageUpload(images.watermark);
    }
    if (images.headerIcon) {
      imageIds.headerIconId = await simulateImageUpload(images.headerIcon);
    }
    if (images.footerIcon) {
      imageIds.footerIconId = await simulateImageUpload(images.footerIcon);
    }

    // Update document with all images
    const updates = buildImages(imageIds);
    
    await documentService.editFull(documentId, {
      ...updates,
      change_summary: `Updated ${Object.keys(imageIds).length} document images`,
    });

    console.log('All images updated successfully!');
    return imageIds;

  } catch (error) {
    console.error('Failed to update images:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 8: Remove Attachment
// ============================================================================

export const example8_removeAttachment = async (
  documentId,
  existingAttachments,
  attachmentIndex
) => {
  try {
    const removedAttachment = existingAttachments[attachmentIndex];
    console.log('Removing:', removedAttachment.name);

    // Filter out the attachment
    const updatedAttachments = existingAttachments.filter(
      (_, index) => index !== attachmentIndex
    );

    // Update document
    const updates = buildFiles({ attachments: updatedAttachments });
    
    await documentService.editFull(documentId, {
      ...updates,
      change_summary: `Removed attachment: ${removedAttachment.name}`,
    });

    console.log('Attachment removed successfully!');
    return updatedAttachments;

  } catch (error) {
    console.error('Failed to remove attachment:', error);
    throw error;
  }
};

// ============================================================================
// EXAMPLE 9: Using in React Component
// ============================================================================

export const Example9_ReactComponent = () => {
  const [documentId] = useState(123);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);

  const handleMetadataSaved = async () => {
    console.log('Metadata saved!');
    setShowMetadataEditor(false);
    
    // Reload document
    const doc = await documentService.getDocument(documentId);
    console.log('Updated document:', doc);
  };

  return (
    <div>
      <button onClick={() => setShowMetadataEditor(true)}>
        Edit Document Assets
      </button>

      {showMetadataEditor && (
        <DocumentMetadataEditor
          documentId={documentId}
          onClose={() => setShowMetadataEditor(false)}
          onSaved={handleMetadataSaved}
        />
      )}
    </div>
  );
};

// ============================================================================
// EXAMPLE 10: Programmatic Asset Management
// ============================================================================

export const example10_programmaticAssetManagement = async (documentId) => {
  try {
    // 1. Load current document
    const doc = await documentService.getDocument(documentId);
    console.log('Current assets:', {
      images: {
        logo: doc.logo_image_id,
        watermark: doc.watermark_image_id,
      },
      attachments: doc.attachments?.length || 0,
    });

    // 2. Check if logo exists, if not add it
    if (!doc.logo_image_id) {
      const logoFile = await fetchFile('/assets/default-logo.png');
      const logoId = await simulateImageUpload(logoFile);
      
      await documentService.editFull(documentId, {
        ...buildImages({ logoImageId: logoId }),
        change_summary: 'Added default logo',
      });
      
      console.log('Added default logo');
    }

    // 3. Check if required exhibits exist
    const requiredExhibits = ['Exhibit A', 'Schedule 1'];
    const existingExhibits = doc.attachments?.filter(a => 
      requiredExhibits.some(req => a.name.includes(req))
    ) || [];

    if (existingExhibits.length < requiredExhibits.length) {
      console.log('Missing required exhibits!');
      // Add missing exhibits...
    }

    // 4. Validate image sizes
    const images = [
      { type: 'logo', id: doc.logo_image_id },
      { type: 'watermark', id: doc.watermark_image_id },
    ];

    for (const image of images) {
      if (image.id) {
        // In production, check image size via API
        console.log(`Validating ${image.type}...`);
      }
    }

    console.log('Asset validation complete!');

  } catch (error) {
    console.error('Failed to manage assets:', error);
    throw error;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

async function simulateImageUpload(file) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const uuid = 'img-' + Math.random().toString(36).substr(2, 9);
      console.log(`Simulated upload of ${file.name} -> ${uuid}`);
      resolve(uuid);
    }, 500);
  });
}

async function simulateFileUpload(file) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const path = `uploads/documents/${file.name}`;
      console.log(`Simulated upload of ${file.name} -> ${path}`);
      resolve(path);
    }, 500);
  });
}

function determineAttachmentType(fileName) {
  const lowerName = fileName.toLowerCase();
  
  if (lowerName.includes('exhibit')) return 'exhibit';
  if (lowerName.includes('schedule')) return 'schedule';
  if (lowerName.includes('appendix')) return 'appendix';
  if (lowerName.includes('annex')) return 'annex';
  
  return 'other';
}

async function fetchFile(path) {
  // Simulate fetching a file
  return {
    name: path.split('/').pop(),
    type: path.endsWith('.png') ? 'image/png' : 'application/pdf',
    size: Math.random() * 1000000,
  };
}

// ============================================================================
// Export All Examples
// ============================================================================

export const assetManagementExamples = {
  example1_uploadLogo,
  example2_uploadMultipleAttachments,
  example3_completeDocumentSetup,
  example4_replaceAttachmentVersion,
  example5_downloadAttachment,
  example6_previewAttachment,
  example7_bulkUpdateImages,
  example8_removeAttachment,
  example9_reactComponent: Example9_ReactComponent,
  example10_programmaticAssetManagement,
};

export default assetManagementExamples;
