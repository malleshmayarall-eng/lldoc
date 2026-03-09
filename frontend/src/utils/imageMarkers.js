/**
 * Image Marker Utility Functions
 * 
 * Handles parsing and manipulation of image markers in paragraph text.
 * 
 * SUPPORTED FORMATS:
 * 1. Legacy format: {{img:IMAGE_ID|ALIGNMENT|SIZE|CAPTION}}
 * 2. Backend format: {{image:imageRefId:inlineImageId|altText}}
 */

/**
 * Regex pattern for backend-style image markers
 * Format: {{image:imageRefId:inlineImageId|altText}}
 * 
 * Groups:
 * 1. imageRefId - UUID of the DocumentImage (reference to uploaded file)
 * 2. inlineImageId - Unique ID for this specific inline instance  
 * 3. altText - Alternative text for accessibility
 * 
 * Example: {{image:123e4567-e89b-12d3-a456-426614174000:img_20260105_001|Product diagram}}
 */
// Extended backend-style marker with optional props after alt text:
// {{image:<imageRefId>:<inlineImageId>|<altText>?k=v&k2=v2}}
//
// Capture groups:
//  1) imageRefId
//  2) inlineImageId
//  3) altText (may be empty)
//  4) props (may be empty)
//
// Notes:
// - We keep the legacy `|alt` separator for backward compatibility.
// - Props are query-string-like and should be URL-encoded.
// - We intentionally allow non-UUID inline IDs for backwards compatibility
//   (some existing code uses `img_${Date.now()}...`).
export const IMAGE_MARKER_REGEX = /\{\{image:([^:]+):([^\|\}]+)(?:\|([^\?\}]*))?(?:\?([^\}]*))?\}\}/g;

/**
 * Parse a query-string-like props segment (k=v&k2=v2) into an object.
 * Values are URL-decoded. Keys are kept as-is.
 */
export function parseMarkerProps(propsString) {
  if (!propsString) return {};
  const out = {};
  const pairs = String(propsString).split('&').filter(Boolean);
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    const rawKey = idx >= 0 ? pair.slice(0, idx) : pair;
    const rawValue = idx >= 0 ? pair.slice(idx + 1) : '';
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawValue);
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Serialize an object into a query-string-like props segment.
 * Keys and values are URL-encoded.
 */
export function stringifyMarkerProps(props = {}) {
  if (!props || typeof props !== 'object') return '';
  const entries = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '');
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `${encodeURIComponent(String(k))}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/**
 * Regex pattern for legacy image markers
 * Format: {{img:123|center|50%|Figure 1}}
 * 
 * Groups:
 * 1. IMAGE_ID (required)
 * 2. ALIGNMENT (optional)
 * 3. SIZE (optional)
 * 4. CAPTION (optional)
 */
export const IMAGE_MARKER_PATTERN = /\{\{img:([^|}]+)(?:\|([^|}]+))?(?:\|([^|}]+))?(?:\|([^}]*))?\}\}/g;

/**
 * Parse all image markers from text
 * @param {string} text - Text containing image markers
 * @returns {Array<Object>} Array of parsed markers
 */
export function parseImageMarkers(text) {
  if (!text) return [];
  
  const markers = [];
  const pattern = new RegExp(IMAGE_MARKER_PATTERN);
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    markers.push({
      // Full marker text
      fullMatch: match[0],
      
      // Position in text
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      
      // Parsed components
      imageId: match[1].trim(),
      alignment: match[2]?.trim() || 'center',
      size: match[3]?.trim() || '50%',
      caption: match[4]?.trim() || null,
      
      // Original match for debugging
      _match: match
    });
  }
  
  return markers;
}

/**
 * Build an image marker string
 * @param {Object} options - Marker options
 * @param {string|number} options.imageId - Image ID (required)
 * @param {string} options.alignment - Alignment (left, center, right, inline)
 * @param {string} options.size - Size (50%, 300px, small, medium, large, full)
 * @param {string} options.caption - Optional caption text
 * @returns {string} Formatted marker
 */
export function buildImageMarker({ imageId, alignment = 'center', size = '50%', caption = null }) {
  if (!imageId) {
    throw new Error('imageId is required to build marker');
  }
  
  let marker = `{{img:${imageId}`;
  
  // Only add components if they differ from defaults
  if (alignment !== 'center' || size !== '50%' || caption) {
    marker += `|${alignment}`;
    
    if (size !== '50%' || caption) {
      marker += `|${size}`;
      
      if (caption) {
        marker += `|${caption}`;
      }
    }
  }
  
  marker += '}}';
  return marker;
}

/**
 * Insert an image marker at a specific position in text
 * @param {string} text - Original text
 * @param {number} position - Character position to insert at
 * @param {Object} markerOptions - Options for buildImageMarker
 * @returns {Object} { text: newText, cursorPosition: newPosition }
 */
export function insertImageMarker(text, position, markerOptions) {
  const marker = buildImageMarker(markerOptions);
  
  const newText = text.slice(0, position) + marker + text.slice(position);
  const newCursorPosition = position + marker.length;
  
  return {
    text: newText,
    cursorPosition: newCursorPosition,
    marker
  };
}

/**
 * Update an existing marker in text
 * @param {string} text - Text containing the marker
 * @param {Object} oldMarker - Marker object from parseImageMarkers
 * @param {Object} newOptions - New marker options
 * @returns {string} Updated text
 */
export function updateImageMarker(text, oldMarker, newOptions) {
  const newMarker = buildImageMarker({
    imageId: newOptions.imageId || oldMarker.imageId,
    alignment: newOptions.alignment || oldMarker.alignment,
    size: newOptions.size || oldMarker.size,
    caption: newOptions.caption !== undefined ? newOptions.caption : oldMarker.caption
  });
  
  return text.slice(0, oldMarker.startIndex) + 
         newMarker + 
         text.slice(oldMarker.endIndex);
}

/**
 * Remove a marker from text
 * @param {string} text - Text containing the marker
 * @param {Object} marker - Marker object from parseImageMarkers
 * @returns {string} Text with marker removed
 */
export function removeImageMarker(text, marker) {
  return text.slice(0, marker.startIndex) + text.slice(marker.endIndex);
}

/**
 * Extract unique image IDs from text
 * @param {string} text - Text containing markers
 * @returns {Array<string>} Unique image IDs
 */
export function extractImageIds(text) {
  const markers = parseImageMarkers(text);
  const ids = markers.map(m => m.imageId);
  return [...new Set(ids)]; // Remove duplicates
}

/**
 * Normalize size parameter to CSS value
 * @param {string} size - Size from marker (50%, 300px, small, medium, large, full)
 * @returns {Object} { type: 'percentage'|'pixels'|'keyword', value: string, cssValue: string }
 */
export function normalizeSize(size) {
  if (!size) {
    return { type: 'percentage', value: '50%', cssValue: 'width: 50%' };
  }
  
  // Percentage
  if (size.endsWith('%')) {
    return { type: 'percentage', value: size, cssValue: `width: ${size}` };
  }
  
  // Pixels
  if (size.endsWith('px')) {
    return { type: 'pixels', value: size, cssValue: `width: ${size}` };
  }
  
  // Keywords
  const keywords = {
    'small': '25%',
    'medium': '50%',
    'large': '75%',
    'full': '100%',
    'auto': 'auto'
  };
  
  if (keywords[size.toLowerCase()]) {
    const cssValue = keywords[size.toLowerCase()];
    return { 
      type: 'keyword', 
      value: size, 
      cssValue: cssValue === 'auto' ? 'width: auto' : `width: ${cssValue}` 
    };
  }
  
  // Fallback to 50%
  return { type: 'percentage', value: '50%', cssValue: 'width: 50%' };
}

/**
 * Get alignment CSS classes
 * @param {string} alignment - Alignment value (left, center, right, inline)
 * @returns {string} CSS classes
 */
export function getAlignmentClasses(alignment) {
  const alignments = {
    'left': 'float-left mr-4 mb-2',
    'center': 'mx-auto block my-4',
    'right': 'float-right ml-4 mb-2',
    'inline': 'inline align-middle'
  };
  
  return alignments[alignment?.toLowerCase()] || alignments.center;
}

/**
 * Validate a marker
 * @param {Object} marker - Marker object from parseImageMarkers
 * @returns {Object} { valid: boolean, errors: Array<string> }
 */
export function validateMarker(marker) {
  const errors = [];
  
  if (!marker.imageId) {
    errors.push('Missing image ID');
  }
  
  const validAlignments = ['left', 'center', 'right', 'inline'];
  if (marker.alignment && !validAlignments.includes(marker.alignment.toLowerCase())) {
    errors.push(`Invalid alignment: ${marker.alignment}. Must be one of: ${validAlignments.join(', ')}`);
  }
  
  // Validate size format
  if (marker.size) {
    const sizePattern = /^(\d+(%|px)|small|medium|large|full|auto)$/i;
    if (!sizePattern.test(marker.size)) {
      errors.push(`Invalid size format: ${marker.size}. Use percentage (50%), pixels (300px), or keyword (small, medium, large, full, auto)`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Find marker at a specific text position
 * @param {string} text - Text containing markers
 * @param {number} position - Character position
 * @returns {Object|null} Marker at position or null
 */
export function findMarkerAtPosition(text, position) {
  const markers = parseImageMarkers(text);
  return markers.find(m => position >= m.startIndex && position <= m.endIndex) || null;
}

/**
 * Count markers in text
 * @param {string} text - Text to analyze
 * @returns {number} Number of markers
 */
export function countMarkers(text) {
  return parseImageMarkers(text).length;
}

/**
 * Replace all markers with a transform function
 * @param {string} text - Original text
 * @param {Function} transform - Function(marker) => string
 * @returns {string} Transformed text
 */
export function replaceMarkers(text, transform) {
  const markers = parseImageMarkers(text);
  let result = text;
  let offset = 0;
  
  // Process markers from start to end
  markers.forEach(marker => {
    const replacement = transform(marker);
    const adjustedStart = marker.startIndex + offset;
    const adjustedEnd = marker.endIndex + offset;
    
    result = result.slice(0, adjustedStart) + replacement + result.slice(adjustedEnd);
    
    // Update offset for next replacement
    offset += replacement.length - marker.fullMatch.length;
  });
  
  return result;
}

// ========================================
// Backend Format Image Marker Functions
// ========================================

/**
 * Extract all unique image reference IDs from text (backend format)
 * @param {string} text - Text content containing image markers
 * @returns {string[]} Array of unique image reference IDs
 * 
 * @example
 * const text = "See {{image:uuid1:img1|Photo}} and {{image:uuid2:img2|Chart}}";
 * const ids = extractImageRefIds(text);
 * // Returns: ['uuid1', 'uuid2']
 */
export function extractImageRefIds(text) {
  if (!text) return [];
  
  const imageIds = new Set();
  const regex = new RegExp(IMAGE_MARKER_REGEX);
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const [, imageRefId] = match;
    imageIds.add(imageRefId);
  }
  
  return Array.from(imageIds);
}

/**
 * Parse backend-style image markers from text
 * @param {string} text - Text content containing image markers
 * @returns {Array<Object>} Array of parsed image marker objects
 * 
 * @example
 * const text = "See {{image:uuid1:img1|Product photo}}";
 * const markers = parseBackendImageMarkers(text);
 * // Returns: [{
 * //   imageRefId: 'uuid1',
 * //   inlineImageId: 'img1',
 * //   altText: 'Product photo',
 * //   position: 4,
 * //   fullMarker: '{{image:uuid1:img1|Product photo}}'
 * // }]
 */
export function parseBackendImageMarkers(text) {
  if (!text) return [];
  
  const markers = [];
  const regex = new RegExp(IMAGE_MARKER_REGEX);
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const [fullMarker, imageRefId, inlineImageId, altText, props] = match;
    const markerProps = parseMarkerProps(props);
    
    markers.push({
      imageRefId,
      inlineImageId,
      altText: altText || '',
      props: markerProps,
      position: match.index,
      startIndex: match.index,
      endIndex: match.index + fullMarker.length,
      fullMarker
    });
  }
  
  return markers;
}

/**
 * Find backend marker at a given character position
 * @param {string} text
 * @param {number} position
 * @returns {object|null}
 */
export function findBackendMarkerAtPosition(text, position) {
  if (!text || typeof position !== 'number') return null;
  const markers = parseBackendImageMarkers(text);
  return markers.find(m => position >= m.startIndex && position <= m.endIndex) || null;
}

/**
 * Replace a single backend marker in text with updated alt/props.
 * @param {string} text
 * @param {object} marker - output from parseBackendImageMarkers (must include startIndex/endIndex)
 * @param {object} newOptions - { altText?, props? }
 * @returns {string}
 */
export function updateBackendImageMarker(text, marker, newOptions = {}) {
  if (!marker || !marker.startIndex || !marker.endIndex) return text;
  const altText = newOptions.altText !== undefined ? newOptions.altText : marker.altText || '';
  const props = newOptions.props !== undefined ? newOptions.props : marker.props || {};
  const newMarker = createBackendImageMarkerWithProps(marker.imageRefId, marker.inlineImageId, altText, props);
  return text.slice(0, marker.startIndex) + newMarker + text.slice(marker.endIndex);
}

/**
 * Create a backend-style image marker string
 * @param {string} imageRefId - UUID of the DocumentImage
 * @param {string} inlineImageId - Unique ID for this inline instance
 * @param {string} altText - Alternative text for accessibility
 * @returns {string} Formatted image marker
 * 
 * @example
 * const marker = createBackendImageMarker('uuid1', 'img_001', 'Product photo');
 * // Returns: '{{image:uuid1:img_001|Product photo}}'
 */
export function createBackendImageMarker(imageRefId, inlineImageId, altText = '') {
  return `{{image:${imageRefId}:${inlineImageId}|${altText}}}`;
}

/**
 * Create a backend-style marker with optional inline props.
 *
 * Format:
 *   {{image:<imageRefId>:<inlineImageId>|<altText>?k=v&k2=v2}}
 */
export function createBackendImageMarkerWithProps(imageRefId, inlineImageId, altText = '', props = null) {
  const qs = stringifyMarkerProps(props || {});
  const suffix = qs ? `?${qs}` : '';
  // Keep the `|` even if altText is empty for compatibility with existing parsing.
  return `{{image:${imageRefId}:${inlineImageId}|${altText}${suffix}}}`;
}

/**
 * Check if text contains any backend-style image markers
 * @param {string} text - Text to check
 * @returns {boolean} True if text contains image markers
 * 
 * @example
 * hasBackendImageMarkers("Normal text"); // false
 * hasBackendImageMarkers("Text with {{image:uuid:id|alt}}"); // true
 */
export function hasBackendImageMarkers(text) {
  if (!text) return false;
  const regex = new RegExp(IMAGE_MARKER_REGEX);
  return regex.test(text);
}

/**
 * Replace backend image markers in text with actual <img> tags
 * @param {string} text - Text content containing image markers
 * @param {Object} imageDataMap - Map of imageRefId to image data objects
 * @returns {string} HTML string with <img> tags replacing markers
 * 
 * @example
 * const text = "See {{image:uuid1:img1|Photo}}";
 * const imageMap = { 'uuid1': { url: '/media/photo.jpg' } };
 * const html = replaceBackendMarkersWithImages(text, imageMap);
 * // Returns: 'See <img src="/media/photo.jpg" alt="Photo" class="inline-image" />'
 */
export function replaceBackendMarkersWithImages(text, imageDataMap) {
  if (!text) return '';
  
  return text.replace(
    IMAGE_MARKER_REGEX,
    (match, imageRefId, inlineImageId, altText) => {
      const imageData = imageDataMap[imageRefId];
      
      if (!imageData || !imageData.url) {
        return `[Image not found: ${altText || inlineImageId}]`;
      }
      
      return `<img src="${imageData.url}" alt="${altText || 'Inline image'}" class="inline-image" style="max-width: 800px; height: auto; display: block; margin: 10px auto;" />`;
    }
  );
}

export default {
  // Legacy format
  IMAGE_MARKER_PATTERN,
  parseImageMarkers,
  buildImageMarker,
  insertImageMarker,
  updateImageMarker,
  removeImageMarker,
  extractImageIds,
  normalizeSize,
  getAlignmentClasses,
  validateMarker,
  findMarkerAtPosition,
  countMarkers,
  replaceMarkers,
  
  // Backend format
  IMAGE_MARKER_REGEX,
  extractImageRefIds,
  parseBackendImageMarkers,
  createBackendImageMarker,
  createBackendImageMarkerWithProps,
  hasBackendImageMarkers,
  replaceBackendMarkersWithImages,
  parseMarkerProps,
  stringifyMarkerProps
};

