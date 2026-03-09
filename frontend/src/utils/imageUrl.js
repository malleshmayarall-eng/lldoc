/**
 * Image URL utilities
 * Ensures all image URLs point to the correct backend server
 */

const BACKEND_BASE = 'http://localhost:8000';

/**
 * Resolve image URL to absolute backend URL
 * @param {string} url - Image URL from API (absolute or relative)
 * @returns {string} Full absolute URL pointing to backend
 */
export const resolveImageUrl = (url) => {
  if (!url) {
    console.log('⚠️ resolveImageUrl: empty URL');
    return '';
  }
  
  // Already absolute URL (starts with http:// or https://)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    console.log('✅ resolveImageUrl: already absolute ->', url);
    return url;
  }
  
  // Relative URL - prepend backend base
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const resolved = `${BACKEND_BASE}${cleanUrl}`;
  console.log('🔧 resolveImageUrl: resolved', url, '->', resolved);
  return resolved;
};

/**
 * Get image URL from image object with fallback fields
 * @param {Object} image - Image object from API
 * @param {boolean} useThumbnail - Use thumbnail_url if available
 * @returns {string} Resolved absolute URL
 */
export const getImageUrl = (image, useThumbnail = false) => {
  if (!image) {
    console.log('⚠️ getImageUrl: no image object');
    return '';
  }
  
  const url = useThumbnail 
    ? (image.thumbnail_url || image.url || image.image_url || image.image)
    : (image.url || image.image_url || image.image || image.thumbnail_url);
  
  console.log('📸 getImageUrl:', { 
    useThumbnail, 
    thumbnail_url: image.thumbnail_url,
    url: image.url,
    image_url: image.image_url,
    image: image.image,
    selected: url
  });
  
  return resolveImageUrl(url);
};

export default {
  resolveImageUrl,
  getImageUrl,
  BACKEND_BASE
};
