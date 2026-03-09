/**
 * Document Permissions Utilities
 * 
 * Helper functions to check user permissions on documents
 * based on share_info from the API
 */

/**
 * Check if user can edit the document
 * @param {Object} document - Document object with share_info
 * @returns {boolean}
 */
export const canEditDocument = (document) => {
  // No share_info means user owns the document
  if (!document?.share_info) {
    return true;
  }
  
  // Check can_edit flag from share_info
  return document.share_info.can_edit === true;
};

/**
 * Check if user can comment on the document
 * @param {Object} document - Document object with share_info
 * @returns {boolean}
 */
export const canCommentDocument = (document) => {
  // Owner can always comment
  if (!document?.share_info) {
    return true;
  }
  
  // Check can_comment flag from share_info
  return document.share_info.can_comment === true;
};

/**
 * Check if user can view the document
 * @param {Object} document - Document object with share_info
 * @returns {boolean}
 */
export const canViewDocument = (document) => {
  // If we have the document, we can view it
  // Backend already handles access control
  return true;
};

/**
 * Check if user can delete the document
 * @param {Object} document - Document object with share_info
 * @returns {boolean}
 */
export const canDeleteDocument = (document) => {
  // Only owner can delete (no share_info means owner)
  return !document?.share_info;
};

/**
 * Get user's role for the document
 * @param {Object} document - Document object with share_info
 * @returns {string} 'owner', 'editor', 'commenter', or 'viewer'
 */
export const getDocumentRole = (document) => {
  if (!document?.share_info) {
    return 'owner';
  }
  
  return document.share_info.role || 'viewer';
};

/**
 * Get display name for who shared the document
 * @param {Object} document - Document object with share_info
 * @returns {string|null}
 */
export const getSharedBy = (document) => {
  if (!document?.share_info) return null;
  
  // Priority: shared_by_name > shared_by > author > 'Unknown'
  return document.share_info.shared_by_name || 
         document.share_info.shared_by || 
         document.author || 
         'Unknown';
};

/**
 * Check if document is shared with user
 * @param {Object} document - Document object with share_info
 * @returns {boolean}
 */
export const isSharedDocument = (document) => {
  return !!document?.share_info;
};

/**
 * Get permission summary text
 * @param {Object} document - Document object with share_info
 * @returns {string}
 */
export const getPermissionSummary = (document) => {
  const role = getDocumentRole(document);
  
  const summaries = {
    owner: 'You own this document',
    editor: 'You can edit this document',
    commenter: 'You can comment on this document',
    viewer: 'You can view this document'
  };
  
  return summaries[role] || 'Unknown permissions';
};

/**
 * Get badge color class for role
 * @param {string} role - User's role
 * @returns {string}
 */
export const getRoleBadgeColor = (role) => {
  const colors = {
    owner: 'bg-purple-100 text-purple-700 border-purple-200',
    editor: 'bg-green-100 text-green-700 border-green-200',
    commenter: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    viewer: 'bg-gray-100 text-gray-700 border-gray-200'
  };
  
  return colors[role] || colors.viewer;
};

export default {
  canEditDocument,
  canCommentDocument,
  canViewDocument,
  canDeleteDocument,
  getDocumentRole,
  getSharedBy,
  isSharedDocument,
  getPermissionSummary,
  getRoleBadgeColor
};
