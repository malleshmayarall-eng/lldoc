/**
 * Custom Hooks for Sharing System
 * 
 * React hooks for managing shares, access logs, and permissions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import sharingService from '../services/sharingService';
import { 
  ERROR_MESSAGES, 
  SUCCESS_MESSAGES,
  UI_CONFIG 
} from '../constants/sharingConstants';

/**
 * Hook for managing shares for a specific content item
 * @param {string} contentType - Content type (e.g., 'document')
 * @param {string} objectId - Object ID
 * @param {Object} options - Hook options
 * @returns {Object} Shares data and management functions
 */
export const useSharing = (contentType, objectId, options = {}) => {
  const { autoLoad = true, onError, onSuccess } = options;
  
  // Stable refs for callbacks so they never destabilize memoised functions
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  // Load shares for content
  const loadShares = useCallback(async () => {
    if (!contentType || !objectId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await sharingService.getSharesForContent(contentType, objectId);
      setShares(data);
    } catch (err) {
      const errorMsg = ERROR_MESSAGES.LOAD_SHARES_FAILED;
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
    } finally {
      setLoading(false);
    }
  }, [contentType, objectId]);

  // Auto-load on mount / when contentType or objectId changes
  useEffect(() => {
    if (autoLoad) {
      loadShares();
    }
  }, [autoLoad, loadShares]);

  // Create a new share
  const createShare = useCallback(async (shareData) => {
    setCreating(true);
    setError(null);
    
    try {
      const newShare = await sharingService.createShare({
        content_type: contentType,
        object_id: objectId,
        ...shareData
      });
      
      setShares(prev => [newShare, ...prev]);
      onSuccessRef.current?.(SUCCESS_MESSAGES.SHARE_CREATED, newShare);
      return newShare;
    } catch (err) {
      const errorMsg = ERROR_MESSAGES.CREATE_SHARE_FAILED;
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
      throw err;
    } finally {
      setCreating(false);
    }
  }, [contentType, objectId]);

  // Update an existing share
  const updateShare = useCallback(async (shareId, updates) => {
    setError(null);
    
    try {
      const updated = await sharingService.updateShare(shareId, updates);
      
      setShares(prev => prev.map(s => s.id === shareId ? updated : s));
      onSuccessRef.current?.(SUCCESS_MESSAGES.SHARE_UPDATED, updated);
      return updated;
    } catch (err) {
      const errorMsg = ERROR_MESSAGES.UPDATE_SHARE_FAILED;
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
      throw err;
    }
  }, []);

  // Revoke a share
  const revokeShare = useCallback(async (shareId) => {
    setError(null);
    
    try {
      await sharingService.revokeShare(shareId);
      
      setShares(prev => prev.filter(s => s.id !== shareId));
      onSuccessRef.current?.(SUCCESS_MESSAGES.SHARE_REVOKED);
    } catch (err) {
      const errorMsg = ERROR_MESSAGES.REVOKE_SHARE_FAILED;
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
      throw err;
    }
  }, []);

  // Resend invitation
  const resendInvitation = useCallback(async (shareId) => {
    setError(null);
    
    try {
      await sharingService.resendInvitation(shareId);
      onSuccessRef.current?.(SUCCESS_MESSAGES.INVITATION_RESENT);
    } catch (err) {
      const errorMsg = ERROR_MESSAGES.RESEND_INVITATION_FAILED;
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
      throw err;
    }
  }, []);

  // Copy share link
  const copyShareLink = useCallback(async (shareId, token) => {
    try {
      const success = await sharingService.copyShareLink(shareId, token);
      if (success) {
        onSuccessRef.current?.(SUCCESS_MESSAGES.LINK_COPIED);
      } else {
        throw new Error('Copy failed');
      }
    } catch (err) {
      const errorMsg = ERROR_MESSAGES.COPY_LINK_FAILED;
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
    }
  }, []);

  return {
    shares,
    loading,
    creating,
    error,
    loadShares,
    createShare,
    updateShare,
    revokeShare,
    resendInvitation,
    copyShareLink
  };
};

/**
 * Hook for managing access logs
 * @param {string} contentType - Content type
 * @param {string} objectId - Object ID
 * @param {Object} options - Hook options
 * @returns {Object} Access logs data and functions
 */
export const useAccessLogs = (contentType, objectId, options = {}) => {
  const { autoLoad = true, days = 30, accessType, onError } = options;
  
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadLogs = useCallback(async () => {
    if (!contentType || !objectId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = { days };
      if (accessType) params.access_type = accessType;
      
      const data = await sharingService.getAccessLogs(contentType, objectId, params);
      setLogs(data);
    } catch (err) {
      const errorMsg = 'Failed to load access logs.';
      setError(errorMsg);
      onErrorRef.current?.(err, errorMsg);
    } finally {
      setLoading(false);
    }
  }, [contentType, objectId, days, accessType]);

  useEffect(() => {
    if (autoLoad) {
      loadLogs();
    }
  }, [autoLoad, loadLogs]);

  // Log new access
  const logAccess = useCallback(async (logData) => {
    try {
      await sharingService.logAccess({
        content_type: contentType,
        object_id: objectId,
        ...logData
      });
    } catch (err) {
      console.error('Failed to log access:', err);
      // Don't throw - logging failures shouldn't break functionality
    }
  }, [contentType, objectId]);

  return {
    logs,
    loading,
    error,
    loadLogs,
    logAccess
  };
};

/**
 * Hook for checking user permissions
 * @param {string} contentType - Content type
 * @param {string} objectId - Object ID
 * @param {string} token - Optional external token
 * @returns {Object} Permission data and functions
 */
export const useSharePermissions = (contentType, objectId, token = null) => {
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasAccess, setHasAccess] = useState(false);

  const checkAccess = useCallback(async () => {
    if (!contentType || !objectId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await sharingService.checkAccess(contentType, objectId, token);
      console.log('🔐 Permission check result:', {
        contentType,
        objectId,
        data,
        hasRole: !!data?.role,
        role: data?.role
      });
      setPermissions(data);
      setHasAccess(data.has_access);
    } catch (err) {
      console.error('❌ Permission check failed:', err);
      setError(ERROR_MESSAGES.NO_PERMISSION);
      setHasAccess(false);
    } finally {
      setLoading(false);
    }
  }, [contentType, objectId, token]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  // Permission calculation based on role
  // - owner: Full access to everything
  // - editor: Can edit, comment, view (but not manage sharing)
  // - commenter: Can comment and view
  // - viewer: Can only view
  // - no role/null: Assume owner (fallback for backward compatibility)
  const canEdit = !permissions?.role || ['owner', 'editor'].includes(permissions.role);
  const canComment = !permissions?.role || ['owner', 'editor', 'commenter'].includes(permissions.role);
  const canView = !permissions?.role || ['owner', 'editor', 'commenter', 'viewer'].includes(permissions.role);
  const canShare = !permissions?.role || permissions.role === 'owner'; // Only owners can share

  // console.log('🔓 Calculated permissions:', {
  //   role: permissions?.role,
  //   canEdit,
  //   canComment,
  //   canView,
  //   canShare
  // });

  return {
    permissions,
    loading,
    error,
    hasAccess,
    canEdit,
    canComment,
    canView,
    canShare,
    role: permissions?.role || null,
    checkAccess
  };
};

/**
 * Hook for fuzzy search (users/teams)
 * @param {Function} searchFunction - Search service function
 * @param {Object} options - Hook options
 * @returns {Object} Search state and functions
 */
export const useSearch = (searchFunction, options = {}) => {
  const { minLength = UI_CONFIG.MIN_SEARCH_LENGTH, debounceMs = UI_CONFIG.SEARCH_DEBOUNCE_MS } = options;
  
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const debounceTimer = useRef(null);

  const search = useCallback(async (searchQuery) => {
    if (searchQuery.length < minLength) {
      setResults([]);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await searchFunction(searchQuery);
      setResults(data);
    } catch (err) {
      setError(ERROR_MESSAGES.SEARCH_FAILED);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [searchFunction, minLength]);

  const debouncedSearch = useCallback((searchQuery) => {
    setQuery(searchQuery);
    
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    debounceTimer.current = setTimeout(() => {
      search(searchQuery);
    }, debounceMs);
  }, [search, debounceMs]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return {
    query,
    results,
    loading,
    error,
    search: debouncedSearch,
    clearSearch
  };
};

/**
 * Hook for analytics data
 * @param {Object} options - Hook options
 * @returns {Object} Analytics data and functions
 */
export const useShareAnalytics = (options = {}) => {
  const { days = 30, contentType, autoLoad = true } = options;
  
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = { days };
      if (contentType) params.content_type = contentType;
      
      const data = await sharingService.getAnalytics(params);
      setAnalytics(data);
    } catch (err) {
      setError('Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [days, contentType]);

  useEffect(() => {
    if (autoLoad) {
      loadAnalytics();
    }
  }, [autoLoad, loadAnalytics]);

  return {
    analytics,
    loading,
    error,
    loadAnalytics
  };
};

/**
 * Hook for accepting external invitations
 * @returns {Object} Invitation acceptance state and functions
 */
export const useInvitationAcceptance = () => {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);
  const [shareData, setShareData] = useState(null);

  const acceptInvitation = useCallback(async (token) => {
    setAccepting(true);
    setError(null);
    
    try {
      const data = await sharingService.acceptInvitation(token);
      setShareData(data);
      return data;
    } catch (err) {
      setError(ERROR_MESSAGES.ACCEPT_INVITATION_FAILED);
      throw err;
    } finally {
      setAccepting(false);
    }
  }, []);

  return {
    accepting,
    error,
    shareData,
    acceptInvitation
  };
};

export default {
  useSharing,
  useAccessLogs,
  useSharePermissions,
  useSearch,
  useShareAnalytics,
  useInvitationAcceptance
};
