const PLACEHOLDER_REGEX = /\[([A-Z0-9_.-]+)\]/g;
const DOUBLE_PLACEHOLDER_REGEX = /\[\[([^\]]+?)\]\]/g;
const COMBINED_PLACEHOLDER_REGEX = /\[\[([^\]]+?)\]\]|\[([A-Z0-9_.-]+)\]/g;
const SCOPE_KEYS = ['document', 'section', 'paragraph'];

// ── Image placeholder support ──────────────────────────────────────────
// Matches [[image:something]] — the captured group is the name/UUID after "image:"
const IMAGE_PLACEHOLDER_REGEX = /\[\[image:([^\]]+)\]\]/g;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const normalizePlaceholderKey = (key) => {
  if (!key) return '';
  const trimmed = String(key).trim();
  const lastSegment = trimmed.split('.').pop() || trimmed;
  return lastSegment
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
};

const getKeyVariants = (key) => {
  if (!key) return [];
  const trimmed = String(key).trim();
  const parts = trimmed.split('.');
  const lastSegment = parts[parts.length - 1] || trimmed;
  const normalized = normalizePlaceholderKey(trimmed);
  const normalizedLast = normalizePlaceholderKey(lastSegment);
  const upper = normalized.toUpperCase();
  const upperLast = normalizedLast.toUpperCase();
  return Array.from(
    new Set([trimmed, lastSegment, normalized, normalizedLast, upper, upperLast].filter(Boolean)),
  );
};

const addMetadataValue = (output, key, value) => {
  if (!key) return;
  getKeyVariants(key).forEach((variant) => {
    if (!(variant in output)) {
      output[variant] = value;
    }
  });
};

const flattenMetadata = (metadata, output = {}, prefix = '') => {
  if (!metadata) return output;

  if (Array.isArray(metadata)) {
    metadata.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const key = row.key ?? row.name ?? row.label;
      const value = row.value ?? row.val ?? row.content ?? row.display;
      if (key) {
        const compositeKey = prefix ? `${prefix}.${key}` : key;
        addMetadataValue(output, compositeKey, value);
      }
    });
    return output;
  }

  if (typeof metadata === 'object') {
    Object.entries(metadata).forEach(([key, value]) => {
      const compositeKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        flattenMetadata(value, output, compositeKey);
      } else {
        addMetadataValue(output, compositeKey, value);
      }
    });
  }

  return output;
};

const escapeHtml = (value) => {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// ── Image placeholder rendering functions (must be after escapeHtml) ───

/**
 * Build an <img> tag for a resolved image UUID.
 */
const buildImageTag = (uuid, url, name) => {
  const safeName = escapeHtml(name || 'Image');
  return `<img src="${escapeHtml(url)}" alt="${safeName}" data-image-uuid="${escapeHtml(uuid)}" class="image-placeholder-rendered" style="max-width: 100%; height: auto; display: block; margin: 8px auto; border-radius: 4px;" />`;
};

/**
 * Build a styled placeholder chip for an unmapped named image slot.
 */
const buildImagePlaceholderChip = (name) => {
  const safeName = escapeHtml(name);
  return `<span class="image-placeholder-chip" data-image-slot="${safeName}" contenteditable="false" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px; font-size: 12px; color: #92400e; cursor: default;">🖼️ ${safeName}</span>`;
};

/**
 * Replace [[image:...]] patterns in text with <img> tags or placeholder chips.
 * Must be called BEFORE the generic placeholder replacement.
 */
const replaceImagePlaceholders = (text, imageUrlMap) => {
  if (!text || !text.includes('[[image:')) return text;
  return text.replace(IMAGE_PLACEHOLDER_REGEX, (match, identifier) => {
    const trimmed = (identifier || '').trim();
    if (!trimmed) return match;

    if (UUID_RE.test(trimmed)) {
      // It's a UUID — try to resolve to an <img> tag
      const url = imageUrlMap?.[trimmed];
      if (url) {
        return buildImageTag(trimmed, url, trimmed);
      }
      // UUID but no URL available — show a loading-style chip
      return `<span class="image-placeholder-chip" contenteditable="false" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: #e0e7ff; border: 1px solid #818cf8; border-radius: 4px; font-size: 12px; color: #3730a3; cursor: default;">🖼️ Loading image…</span>`;
    }

    // Named slot — show placeholder chip
    return buildImagePlaceholderChip(trimmed);
  });
};

const buildPlaceholderSpan = ({ key, rawToken, displayValue, scope }) => {
  const safeValue = escapeHtml(displayValue);
  const placeholderKey = scope ? `${scope}.${key}` : key;
  const raw = rawToken || `[${placeholderKey}]`;
  const safeRaw = escapeHtml(raw);
  return `<span class="paragraph-placeholder" data-placeholder="${escapeHtml(placeholderKey)}" data-placeholder-raw="${safeRaw}" contenteditable="false">${safeValue}</span>`;
};

const parsePlaceholderToken = (rawName) => {
  if (!rawName) return { scope: null, key: '' };
  const trimmed = String(rawName).trim();
  const parts = trimmed.split('.');
  if (parts.length > 1) {
    const scope = parts[0].toLowerCase();
    if (SCOPE_KEYS.includes(scope)) {
      return { scope, key: parts.slice(1).join('.') };
    }
  }
  return { scope: null, key: trimmed };
};

const resolveFromMap = (key, placeholderMap) => {
  if (!key || !placeholderMap) return null;
  const variants = getKeyVariants(key);
  for (const variant of variants) {
    if (variant in placeholderMap) {
      const value = placeholderMap[variant];
      if (value != null && value !== '') {
        return String(value);
      }
    }
  }
  return null;
};

const normalizeMetadataScopes = (metadata) => {
  // Simplified: only use document metadata, no scopes
  if (!metadata) return {};
  if (Array.isArray(metadata)) return metadata;
  if (typeof metadata !== 'object') return {};
  return metadata;
};

const buildPlaceholderMaps = (documentMetadata) => {
  // Simplified: only flatten document metadata
  const unscopedMap = flattenMetadata(documentMetadata, {});

  return {
    unscoped: unscopedMap,
    scoped: {}, // Empty for backward compatibility
  };
};

const resolveDisplayValue = ({ scope, key }, placeholderMaps, fallbackToken) => {
  if (!key) return fallbackToken;

  if (placeholderMaps?.unscoped) {
    const value = resolveFromMap(key, placeholderMaps.unscoped);
    return value != null ? value : fallbackToken;
  }

  const fallbackValue = resolveFromMap(key, placeholderMaps || {});
  return fallbackValue != null ? fallbackValue : fallbackToken;
};

const replaceTokensWithSpans = (text, placeholderMaps) => {
  if (!text) return '';
  return text.replace(COMBINED_PLACEHOLDER_REGEX, (match, doubleToken, singleToken) => {
    const rawName = doubleToken || singleToken;
    const { scope, key } = parsePlaceholderToken(rawName);
    const fallbackToken = doubleToken ? `[[${rawName}]]` : `[${rawName}]`;
    const displayValue = resolveDisplayValue({ scope, key }, placeholderMaps, fallbackToken);
    return buildPlaceholderSpan({
      key,
      rawToken: doubleToken ? `[[${rawName}]]` : `[${rawName}]`,
      displayValue,
      scope,
    });
  });
};

const updateExistingPlaceholders = (html, placeholderMaps) => {
  if (!html || !html.includes('data-placeholder')) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const nodes = doc.querySelectorAll('[data-placeholder]');
  if (!nodes.length) return null;
  nodes.forEach((node) => {
    const rawToken = node.getAttribute('data-placeholder-raw') || '';
    const rawName = rawToken.startsWith('[[')
      ? rawToken.replace(/^\[\[|\]\]$/g, '')
      : rawToken.replace(/^\[|\]$/g, '');
    const { scope, key } = parsePlaceholderToken(rawName || node.getAttribute('data-placeholder'));
    const placeholderKey = scope ? `${scope}.${key}` : key;
    const fallbackToken = rawToken || `[${placeholderKey}]`;
    const displayValue = resolveDisplayValue({ scope, key }, placeholderMaps, fallbackToken);
    node.textContent = displayValue;
    node.setAttribute('data-placeholder', placeholderKey);
    node.setAttribute('data-placeholder-raw', fallbackToken);
    node.setAttribute('contenteditable', 'false');
    node.classList.add('paragraph-placeholder');
  });
  return doc.body.innerHTML;
};

export const applyPlaceholdersToHtml = (html, documentMetadata = {}) => {
  if (html == null) return '';

  // Extract image URL map from metadata (set by image-slots/map-image endpoints)
  const imageUrlMap = documentMetadata?._image_url_map || {};

  // 1. Replace [[image:...]] patterns FIRST (before generic placeholder handling)
  let processed = replaceImagePlaceholders(html, imageUrlMap);

  // 2. Apply generic placeholder replacement on the result
  const placeholderMaps = buildPlaceholderMaps(documentMetadata);
  const updatedExisting = updateExistingPlaceholders(processed, placeholderMaps);
  if (updatedExisting != null) return updatedExisting;
  return replaceTokensWithSpans(processed, placeholderMaps);
};

export const serializePlaceholderHtml = (html) => {
  if (!html) return '';
  const hasPlaceholders = html.includes('data-placeholder');
  const hasImages = html.includes('data-image-uuid') || html.includes('data-image-slot') || html.includes('image-placeholder-chip');
  if (!hasPlaceholders && !hasImages) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Serialize rendered images back to [[image:UUID]]
  doc.querySelectorAll('[data-image-uuid]').forEach((node) => {
    const uuid = node.getAttribute('data-image-uuid');
    if (uuid) {
      node.replaceWith(doc.createTextNode(`[[image:${uuid}]]`));
    }
  });

  // Serialize named image placeholder chips back to [[image:name]]
  doc.querySelectorAll('[data-image-slot]').forEach((node) => {
    const name = node.getAttribute('data-image-slot');
    if (name) {
      node.replaceWith(doc.createTextNode(`[[image:${name}]]`));
    }
  });

  // Also handle chips without data attributes (loading state)
  doc.querySelectorAll('.image-placeholder-chip').forEach((node) => {
    // Already handled above if they had data attributes; skip if already replaced
    if (!node.parentNode) return;
    const text = node.textContent || '';
    // Try to extract the name from the chip text (🖼️ name)
    const name = text.replace(/^🖼️\s*/, '').trim();
    if (name && name !== 'Loading image…') {
      node.replaceWith(doc.createTextNode(`[[image:${name}]]`));
    }
  });

  // Serialize generic placeholders
  const nodes = doc.querySelectorAll('[data-placeholder]');
  nodes.forEach((node) => {
    const rawToken = node.getAttribute('data-placeholder-raw');
    const fallback = `[${normalizePlaceholderKey(node.getAttribute('data-placeholder'))}]`;
    const replacement = doc.createTextNode(rawToken || fallback);
    node.replaceWith(replacement);
  });
  return doc.body.innerHTML;
};

const wrapRangeInTextNode = (node, startOffset, endOffset, className) => {
  if (startOffset === 0 && endOffset === node.textContent.length) {
    const wrapper = document.createElement('span');
    wrapper.className = className;
    node.parentNode.replaceChild(wrapper, node);
    wrapper.appendChild(node);
    return wrapper;
  }

  const text = node.textContent;
  const before = text.slice(0, startOffset);
  const middle = text.slice(startOffset, endOffset);
  const after = text.slice(endOffset);

  const parent = node.parentNode;
  if (!parent) return;
  if (before) parent.insertBefore(document.createTextNode(before), node);
  const wrapper = document.createElement('span');
  wrapper.className = className;
  wrapper.textContent = middle;
  parent.insertBefore(wrapper, node);
  if (after) parent.insertBefore(document.createTextNode(after), node);
  parent.removeChild(node);
  return wrapper;
};

const stripSuggestionHighlights = (doc) => {
  if (!doc) return;
  const nodes = doc.querySelectorAll('[data-suggestion-id]');
  nodes.forEach((node) => {
    const parent = node.parentNode;
    if (!parent) return;
    parent.replaceChild(doc.createTextNode(node.textContent || ''), node);
  });
  const emptyWrappers = doc.querySelectorAll('.paragraph-suggestion-highlight');
  emptyWrappers.forEach((node) => {
    if (!node.textContent) node.remove();
  });
};

export const highlightHtmlRange = (html, range, className = 'paragraph-suggestion-highlight', suggestionId) => {
  if (!html || !range || range.start == null || range.end == null) return html || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  stripSuggestionHighlights(doc);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  let currentOffset = 0;
  const start = Math.max(0, range.start);
  const end = Math.max(start, range.end);

  const nodesToProcess = [];
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent.length;
    const nodeStart = currentOffset;
    const nodeEnd = currentOffset + length;
    if (end <= nodeStart) break;
    if (start < nodeEnd && end > nodeStart) {
      nodesToProcess.push({ node, nodeStart, nodeEnd });
    }
    currentOffset += length;
    node = walker.nextNode();
  }

  nodesToProcess.forEach(({ node: textNode, nodeStart, nodeEnd }) => {
    const from = Math.max(0, start - nodeStart);
    const to = Math.min(textNode.textContent.length, end - nodeStart);
    if (from >= to) return;
    const wrapperClass = className || 'paragraph-suggestion-highlight';
    const wrapper = wrapRangeInTextNode(textNode, from, to, wrapperClass);
    if (suggestionId && wrapper) {
      wrapper.setAttribute('data-suggestion-id', suggestionId);
    }
  });

  return doc.body.innerHTML;
};

export const applySuggestionToText = (rawText, suggestion) => {
  if (!rawText || !suggestion?.range) return rawText || '';
  const start = Math.max(0, suggestion.range.start ?? 0);
  const end = Math.max(start, suggestion.range.end ?? start);
  if (start > rawText.length) return rawText;
  const replacement = suggestion.replacement ?? '';
  return `${rawText.slice(0, start)}${replacement}${rawText.slice(end)}`;
};

export const applySuggestionHighlight = (html, suggestion, className) => {
  if (!suggestion?.range) return html || '';
  return highlightHtmlRange(html, suggestion.range, className, suggestion.id);
};

const getAdjacentPlaceholder = (container, offset, direction) => {
  if (!container) return null;
  if (container.nodeType === Node.TEXT_NODE) {
    if (direction === 'backward' && offset === 0) {
      return container.previousSibling?.matches?.('[data-placeholder]')
        ? container.previousSibling
        : null;
    }
    if (direction === 'forward' && offset === container.textContent?.length) {
      return container.nextSibling?.matches?.('[data-placeholder]')
        ? container.nextSibling
        : null;
    }
    return null;
  }

  if (container.nodeType === Node.ELEMENT_NODE) {
    const children = container.childNodes;
    if (direction === 'backward' && offset > 0) {
      const target = children[offset - 1];
      return target?.matches?.('[data-placeholder]') ? target : null;
    }
    if (direction === 'forward') {
      const target = children[offset];
      return target?.matches?.('[data-placeholder]') ? target : null;
    }
  }

  return null;
};

const getPlaceholdersInRange = (range, root) => {
  if (!range || !root) return [];
  const nodes = Array.from(root.querySelectorAll('[data-placeholder]'));
  return nodes.filter((node) => range.intersectsNode(node));
};

export const handlePlaceholderKeyDown = (event, editorEl) => {
  if (!editorEl || !['Backspace', 'Delete'].includes(event.key)) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editorEl.contains(range.startContainer)) return;

  const placeholders = getPlaceholdersInRange(range, editorEl);
  if (placeholders.length > 0) {
    placeholders.forEach((node) => node.remove());
    event.preventDefault();
    return;
  }

  if (!selection.isCollapsed) return;
  const direction = event.key === 'Backspace' ? 'backward' : 'forward';
  const placeholderNode = getAdjacentPlaceholder(range.startContainer, range.startOffset, direction);
  if (placeholderNode) {
    placeholderNode.remove();
    event.preventDefault();
  }
};

export { normalizePlaceholderKey, PLACEHOLDER_REGEX, DOUBLE_PLACEHOLDER_REGEX, COMBINED_PLACEHOLDER_REGEX };
