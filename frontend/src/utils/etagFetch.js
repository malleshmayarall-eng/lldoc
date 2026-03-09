/**
 * ETag-aware API wrapper
 * Automatically handles ETag headers and caching
 */

import { etagManager } from './etagManager';

/**
 * Custom error for stale data conflicts
 */
export class StaleDataError extends Error {
  constructor(message = 'Document has been modified by another user') {
    super(message);
    this.name = 'StaleDataError';
    this.status = 412;
  }
}

/**
 * ETag-aware fetch wrapper
 * @param {string} url - Request URL
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>} Response
 */
export async function etagFetch(url, options = {}) {
  // Add ETag headers automatically
  const optionsWithETag = etagManager.addETagHeaders(url, options);
  
  // Make request
  const response = await fetch(url, optionsWithETag);
  
  // Handle 304 Not Modified (cached response)
  if (response.status === 304) {
    const documentId = etagManager.extractDocumentId(url);
    const cachedData = etagManager.handle304(documentId);
    
    if (cachedData) {
      // Return a synthetic response with cached data
      return new Response(JSON.stringify(cachedData), {
        status: 200,
        statusText: 'OK (Cached)',
        headers: {
          'Content-Type': 'application/json',
          'X-From-Cache': 'true',
        },
      });
    }
  }
  
  // Handle 412 Precondition Failed (stale data)
  if (etagManager.isStaleResponse(response)) {
    const documentId = etagManager.extractDocumentId(url);
    // Clear stale ETag
    etagManager.clearETag(documentId);
    
    throw new StaleDataError('Document has been modified. Please refresh and try again.');
  }
  
  // Process response and extract ETag
  etagManager.processResponse(response, url);
  
  return response;
}

/**
 * ETag-aware JSON fetch
 * @param {string} url - Request URL
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function etagFetchJSON(url, options = {}) {
  const response = await etagFetch(url, options);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Cache successful GET responses
  if ((options.method || 'GET').toUpperCase() === 'GET') {
    const documentId = etagManager.extractDocumentId(url);
    if (documentId) {
      etagManager.setCache(documentId, data);
    }
  }
  
  return data;
}

/**
 * Retry a request with fresh ETag
 * Useful for handling 412 errors by re-fetching and retrying
 * 
 * @param {Function} operation - Async operation to retry
 * @param {string} documentId - Document UUID
 * @param {Function} refreshFn - Function to refresh document data
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<any>} Operation result
 */
export async function retryWithFreshETag(operation, documentId, refreshFn, maxRetries = 1) {
  let attempts = 0;
  
  while (attempts <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StaleDataError && attempts < maxRetries) {
        console.warn(`🔄 Stale data detected, refreshing and retrying (attempt ${attempts + 1}/${maxRetries})`);
        
        // Refresh to get latest ETag
        await refreshFn(documentId);
        
        attempts++;
        continue;
      }
      
      throw error;
    }
  }
}

export default { etagFetch, etagFetchJSON, retryWithFreshETag, StaleDataError };
