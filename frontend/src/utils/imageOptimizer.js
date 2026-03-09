/**
 * Image Optimizer - Calculate optimal image sizes for document pages
 * 
 * Ensures images fit within page bounds while maintaining aspect ratio
 * Provides multiple sizing strategies based on content type
 */

export const IMAGE_SIZE_PRESETS = {
  FULL_WIDTH: 'full_width',       // 100% of content width
  HALF_WIDTH: 'half_width',       // 50% of content width
  THIRD_WIDTH: 'third_width',     // 33% of content width
  QUARTER_WIDTH: 'quarter_width', // 25% of content width
  AUTO: 'auto',                   // Smart sizing based on aspect ratio
  ORIGINAL: 'original'            // Original size (capped at page width)
};

/**
 * Calculate optimal image dimensions for a page
 * 
 * @param {Object} params
 * @param {number} params.imageWidth - Original image width in pixels
 * @param {number} params.imageHeight - Original image height in pixels
 * @param {number} params.pageWidth - Page width in pixels
 * @param {number} params.pageHeight - Page height in pixels
 * @param {number} params.margins - Page margins in pixels (both sides)
 * @param {string} params.preset - Size preset from IMAGE_SIZE_PRESETS
 * @param {number} params.maxHeightRatio - Max height as ratio of page (default 0.6)
 * @returns {Object} { width, height, scale, fits }
 */
export const calculateOptimalImageSize = ({
  imageWidth,
  imageHeight,
  pageWidth,
  pageHeight,
  margins = 24,
  preset = IMAGE_SIZE_PRESETS.AUTO,
  maxHeightRatio = 0.6
}) => {
  // Calculate available content area
  const contentWidth = pageWidth - (margins * 2);
  const maxContentHeight = (pageHeight - (margins * 2)) * maxHeightRatio;
  
  // Calculate aspect ratio
  const aspectRatio = imageWidth / imageHeight;
  
  let targetWidth = contentWidth;
  let targetHeight = targetWidth / aspectRatio;
  
  // Apply preset sizing
  switch (preset) {
    case IMAGE_SIZE_PRESETS.FULL_WIDTH:
      targetWidth = contentWidth;
      targetHeight = targetWidth / aspectRatio;
      break;
      
    case IMAGE_SIZE_PRESETS.HALF_WIDTH:
      targetWidth = contentWidth * 0.5;
      targetHeight = targetWidth / aspectRatio;
      break;
      
    case IMAGE_SIZE_PRESETS.THIRD_WIDTH:
      targetWidth = contentWidth * 0.33;
      targetHeight = targetWidth / aspectRatio;
      break;
      
    case IMAGE_SIZE_PRESETS.QUARTER_WIDTH:
      targetWidth = contentWidth * 0.25;
      targetHeight = targetWidth / aspectRatio;
      break;
      
    case IMAGE_SIZE_PRESETS.ORIGINAL:
      targetWidth = Math.min(imageWidth, contentWidth);
      targetHeight = targetWidth / aspectRatio;
      break;
      
    case IMAGE_SIZE_PRESETS.AUTO:
    default:
      // Smart sizing based on aspect ratio
      if (aspectRatio > 2) {
        // Wide image (panorama) - use full width
        targetWidth = contentWidth;
        targetHeight = targetWidth / aspectRatio;
      } else if (aspectRatio > 1.5) {
        // Landscape - use 80% width
        targetWidth = contentWidth * 0.8;
        targetHeight = targetWidth / aspectRatio;
      } else if (aspectRatio > 0.8) {
        // Square-ish - use 60% width
        targetWidth = contentWidth * 0.6;
        targetHeight = targetWidth / aspectRatio;
      } else {
        // Portrait - constrain by height
        targetHeight = Math.min(maxContentHeight, imageHeight);
        targetWidth = targetHeight * aspectRatio;
      }
      break;
  }
  
  // Ensure height doesn't exceed maximum
  if (targetHeight > maxContentHeight) {
    targetHeight = maxContentHeight;
    targetWidth = targetHeight * aspectRatio;
  }
  
  // Ensure width doesn't exceed content width
  if (targetWidth > contentWidth) {
    targetWidth = contentWidth;
    targetHeight = targetWidth / aspectRatio;
  }
  
  // Calculate scale factor
  const scale = targetWidth / imageWidth;
  
  // Check if image fits on page
  const fits = targetHeight <= maxContentHeight && targetWidth <= contentWidth;
  
  return {
    width: Math.round(targetWidth),
    height: Math.round(targetHeight),
    scale: scale,
    fits: fits,
    aspectRatio: aspectRatio,
    isLandscape: aspectRatio > 1,
    isPortrait: aspectRatio < 1,
    isSquare: Math.abs(aspectRatio - 1) < 0.1
  };
};

/**
 * Get recommended preset for an image based on its characteristics
 * 
 * @param {number} aspectRatio - Image aspect ratio (width/height)
 * @param {number} originalWidth - Original image width
 * @param {number} contentWidth - Available content width
 * @returns {string} Recommended preset
 */
export const getRecommendedPreset = (aspectRatio, originalWidth, contentWidth) => {
  // Very wide images
  if (aspectRatio > 2.5) return IMAGE_SIZE_PRESETS.FULL_WIDTH;
  
  // Large landscape images
  if (aspectRatio > 1.5 && originalWidth > contentWidth) return IMAGE_SIZE_PRESETS.FULL_WIDTH;
  
  // Medium landscape
  if (aspectRatio > 1.2) return IMAGE_SIZE_PRESETS.HALF_WIDTH;
  
  // Portrait or small images
  if (aspectRatio < 0.8 || originalWidth < contentWidth * 0.5) return IMAGE_SIZE_PRESETS.THIRD_WIDTH;
  
  // Default
  return IMAGE_SIZE_PRESETS.AUTO;
};

/**
 * Calculate image size from metadata
 * 
 * @param {Object} image - Image object with width/height or naturalWidth/naturalHeight
 * @param {Object} pageSettings - Page settings from DocumentDrafter
 * @param {string} preset - Optional preset override
 * @returns {Object} Calculated dimensions
 */
export const calculateImageSizeFromMetadata = (image, pageSettings, preset = null) => {
  const pageConfig = PAGE_DIMENSIONS[pageSettings.size];
  const pageWidth = pageSettings.orientation === 'portrait' 
    ? pageConfig.widthPx 
    : pageConfig.heightPx;
  const pageHeight = pageSettings.orientation === 'portrait'
    ? pageConfig.heightPx
    : pageConfig.widthPx;
  
  const imageWidth = image.naturalWidth || image.width || 800;
  const imageHeight = image.naturalHeight || image.height || 600;
  
  const aspectRatio = imageWidth / imageHeight;
  const contentWidth = pageWidth - (pageSettings.margins * 2);
  
  const recommendedPreset = preset || getRecommendedPreset(aspectRatio, imageWidth, contentWidth);
  
  return calculateOptimalImageSize({
    imageWidth,
    imageHeight,
    pageWidth,
    pageHeight,
    margins: pageSettings.margins,
    preset: recommendedPreset
  });
};

/**
 * Page dimensions reference (96 DPI)
 */
const PAGE_DIMENSIONS = {
  a4: { widthPx: 794, heightPx: 1123 },
  a3: { widthPx: 1123, heightPx: 1587 },
  letter: { widthPx: 816, heightPx: 1056 },
  legal: { widthPx: 816, heightPx: 1344 }
};

/**
 * Apply optimal sizing to an image element
 * 
 * @param {HTMLImageElement} imgElement - The image DOM element
 * @param {Object} pageSettings - Page settings
 * @param {string} preset - Optional preset
 */
export const applyOptimalSizing = (imgElement, pageSettings, preset = null) => {
  if (!imgElement || !imgElement.complete) return;
  
  const dimensions = calculateImageSizeFromMetadata(imgElement, pageSettings, preset);
  
  imgElement.style.width = `${dimensions.width}px`;
  imgElement.style.height = `${dimensions.height}px`;
  imgElement.style.objectFit = 'contain';
  
  return dimensions;
};

/**
 * Get CSS style object for optimal image sizing
 * 
 * @param {Object} image - Image metadata
 * @param {Object} pageSettings - Page settings
 * @param {string} preset - Optional preset
 * @returns {Object} CSS style object
 */
export const getOptimalImageStyle = (image, pageSettings, preset = null) => {
  const dimensions = calculateImageSizeFromMetadata(image, pageSettings, preset);
  
  return {
    width: `${dimensions.width}px`,
    height: `${dimensions.height}px`,
    maxWidth: '100%',
    objectFit: 'contain',
    display: 'block'
  };
};

export default {
  IMAGE_SIZE_PRESETS,
  calculateOptimalImageSize,
  getRecommendedPreset,
  calculateImageSizeFromMetadata,
  applyOptimalSizing,
  getOptimalImageStyle
};
