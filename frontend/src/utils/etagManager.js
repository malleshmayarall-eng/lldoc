/**
 * ETag Manager
 * Centralized ETag storage and management for document versioning
 * 
 * Features:
 * - Store ETags per document
 * - Automatic If-Match/If-None-Match header injection
 * - Handle 304 Not Modified and 412 Precondition Failed responses
 */

class ETagManager {
  constructor() {
    // Store ETags by document ID
    this.etags = new Map();
    
    // Store cached data for 304 responses
    this.cache = new Map();
  }

  /**
   * Store ETag for a document
   * @param {string} documentId - Document UUID
   * @param {string} etag - ETag value from response header
   */
  setETag(documentId, etag) {
    if (!documentId || !etag) return;
    
    this.etags.set(documentId, {
      value: etag,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get ETag for a document
   * @param {string} documentId - Document UUID
   * @returns {string|null} ETag value or null
   */
  getETag(documentId) {
    if (!documentId) return null;
    return this.etags.get(documentId)?.value || null;
  }

  /**
   * Clear ETag for a document
   * @param {string} documentId - Document UUID
   */
  clearETag(documentId) {
    if (!documentId) return;
    this.etags.delete(documentId);
    this.cache.delete(documentId);
  }

  /**
   * Clear all ETags
   */
  clearAll() {
    this.etags.clear();
    this.cache.clear();
  }

  /**
   * Store cached response data for 304 handling
   * @param {string} documentId - Document UUID
   * @param {any} data - Response data
   */
  setCache(documentId, data) {
    if (!documentId) return;
    this.cache.set(documentId, {
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get cached data for a document
   * @param {string} documentId - Document UUID
   * @returns {any|null} Cached data or null
   */
  getCache(documentId) {
    if (!documentId) return null;
    return this.cache.get(documentId)?.data || null;
  }

  /**
   * Extract document ID from URL
   * @param {string} url - Request URL
   * @returns {string|null} Document ID or null
   */
  extractDocumentId(url) {
    // Match patterns like /documents/{uuid}/ or /documents/{uuid}/action/
    const match = url.match(/\/documents\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  /**
   * Add ETag headers to request options
   * @param {string} url - Request URL
   * @param {RequestInit} options - Fetch options
   * @returns {RequestInit} Modified options with ETag headers
   */
  addETagHeaders(url, options = {}) {
    const documentId = this.extractDocumentId(url);
    if (!documentId) return options;

    const method = (options.method || 'GET').toUpperCase();
    const etag = this.getETag(documentId);
    
    if (!etag) return options;

    const headers = new Headers(options.headers || {});

    // For read operations, use If-None-Match for caching
    if (method === 'GET' || method === 'HEAD') {
      headers.set('If-None-Match', etag);
    }
    // For write operations, use If-Match for conflict detection
    else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      headers.set('If-Match', etag);
    }

    return { ...options, headers };
  }

  /**
   * Process response and extract ETag
   * @param {Response} response - Fetch response
   * @param {string} url - Request URL
   * @returns {Response} Original response
   */
  processResponse(response, url) {
    const documentId = this.extractDocumentId(url);
    if (!documentId) return response;

    const etag = response.headers.get('ETag');
    if (etag) {
      this.setETag(documentId, etag);
    }

    return response;
  }

  /**
   * Handle 304 Not Modified response
   * @param {string} documentId - Document UUID
   * @returns {any|null} Cached data or null
   */
  handle304(documentId) {
    return this.getCache(documentId);
  }

  /**
   * Check if response is stale (412 Precondition Failed)
   * @param {Response} response - Fetch response
   * @returns {boolean} True if stale
   */
  isStaleResponse(response) {
    return response.status === 412;
  }

  /**
   * Get ETag info for debugging
   * @param {string} documentId - Document UUID
   * @returns {object} ETag info
   */
  getETagInfo(documentId) {
    const etag = this.etags.get(documentId);
    const cache = this.cache.get(documentId);
    
    return {
      documentId,
      hasETag: !!etag,
      etag: etag?.value,
      timestamp: etag?.timestamp,
      hasCachedData: !!cache,
      cacheTimestamp: cache?.timestamp,
    };
  }
}

// Export singleton instance
export const etagManager = new ETagManager();

// Export class for testing
export default ETagManager;
