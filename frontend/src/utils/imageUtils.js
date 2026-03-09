import { API_CONFIG } from '../config/app.config';

export const VALID_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

const normalizeUrlInput = (input) => {
  if (!input) return null;

  if (typeof URL !== 'undefined' && input instanceof URL) {
    return input.toString();
  }

  if (Array.isArray(input)) {
    return input.find((item) => typeof item === 'string') || null;
  }

  if (typeof input === 'object') {
    if (typeof input.url === 'string') return input.url;
    if (typeof input.href === 'string') return input.href;
  }

  return typeof input === 'string' ? input : null;
};

export const fixImageUrl = (input) => {
  const url = normalizeUrlInput(input);
  if (!url) return url;
  if (url.startsWith('http')) return url;

  const base = (API_CONFIG.BACKEND_URL || '').replace(/\/$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
};

export const fixImageUrls = (image) => {
  if (!image || typeof image !== 'object') return image;

  const fixed = {
    ...image,
    url: fixImageUrl(image.url),
    image: fixImageUrl(image.image),
    image_url: fixImageUrl(image.image_url || image.image),
    thumbnail_url: fixImageUrl(image.thumbnail_url || image.thumbnail),
  };

  if (image.thumbnail !== undefined) {
    fixed.thumbnail = fixImageUrl(image.thumbnail);
  }

  return fixed;
};

export const getImageUrl = (image, useThumbnail = false) => {
  if (!image) return '';

  const url = useThumbnail
    ? image.thumbnail_url || image.url || image.image_url || image.image
    : image.url || image.image_url || image.image || image.thumbnail_url;

  return fixImageUrl(url) || '';
};

export const validateImageFile = (file) => {
  if (!file) return 'No file selected';
  if (!VALID_IMAGE_MIME_TYPES.includes(file.type)) {
    return 'Invalid file type. Use JPEG, JPG, PNG, GIF, or WEBP';
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return 'File too large. Maximum size is 10MB';
  }
  return null;
};

export const buildImageUploadFormData = (file, options = {}) => {
  if (!file) return null;

  const {
    name,
    imageType,
    caption,
    description,
    documentId,
    isPublic,
    tags,
    uploadScope,
  } = options;

  const formData = new FormData();
  formData.append('image', file);
  formData.append('name', name || file.name);

  if (imageType) {
    formData.append('image_type', imageType);
  }

  if (uploadScope) {
    formData.append('upload_scope', uploadScope);
  }

  if (caption) formData.append('caption', caption);
  if (description) formData.append('description', description);
  if (documentId) formData.append('document', documentId);

  if (typeof isPublic === 'boolean') {
    formData.append('is_public', isPublic ? 'true' : 'false');
  }

  if (tags) {
    const tagsArray = Array.isArray(tags)
      ? tags
      : tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);

    if (tagsArray.length > 0) {
      formData.append('tags', JSON.stringify(tagsArray));
    }
  }

  return formData;
};
