/**
 * Sharing System Constants
 * 
 * Constants for roles, share types, access types, and UI configurations
 * Mirrors the backend Django sharing app enums
 */

/**
 * Share roles - determines permission level
 */
export const SHARE_ROLES = {
  VIEWER: 'viewer',
  COMMENTER: 'commenter',
  EDITOR: 'editor'
};

/**
 * Role display information
 */
export const ROLE_INFO = {
  [SHARE_ROLES.VIEWER]: {
    label: 'Viewer',
    description: 'Can view content',
    icon: 'eye',
    color: 'blue',
    permissions: ['read']
  },
  [SHARE_ROLES.COMMENTER]: {
    label: 'Commenter',
    description: 'Can view and add comments',
    icon: 'comment',
    color: 'green',
    permissions: ['read', 'comment']
  },
  [SHARE_ROLES.EDITOR]: {
    label: 'Editor',
    description: 'Can view, comment, and edit',
    icon: 'edit',
    color: 'purple',
    permissions: ['read', 'comment', 'write']
  }
};

/**
 * Share types - how content is shared
 */
export const SHARE_TYPES = {
  USER: 'user',      // Direct share with registered user
  TEAM: 'team',      // Share with entire team
  EMAIL: 'email',    // External invitation via email
  PHONE: 'phone',    // External invitation via SMS/phone
  LINK: 'link'       // Public link (anyone with the link)
};

/**
 * Share type display information
 */
export const SHARE_TYPE_INFO = {
  [SHARE_TYPES.USER]: {
    label: 'User',
    description: 'Share with a registered user',
    icon: 'user',
    color: 'blue'
  },
  [SHARE_TYPES.TEAM]: {
    label: 'Team',
    description: 'Share with an entire team',
    icon: 'users',
    color: 'green'
  },
  [SHARE_TYPES.EMAIL]: {
    label: 'Email',
    description: 'Send invitation via email',
    icon: 'envelope',
    color: 'orange'
  },
  [SHARE_TYPES.PHONE]: {
    label: 'Phone',
    description: 'Send invitation via SMS',
    icon: 'phone',
    color: 'purple'
  },
  [SHARE_TYPES.LINK]: {
    label: 'Public Link',
    description: 'Anyone with the link can access',
    icon: 'link',
    color: 'indigo'
  }
};

/**
 * Access types for logging
 */
export const ACCESS_TYPES = {
  VIEW: 'view',
  EDIT: 'edit',
  COMMENT: 'comment',
  SHARE: 'share',
  DOWNLOAD: 'download',
  PRINT: 'print',
  EXPORT: 'export',
  DELETE: 'delete',
  RESTORE: 'restore'
};

/**
 * Access type display information
 */
export const ACCESS_TYPE_INFO = {
  [ACCESS_TYPES.VIEW]: {
    label: 'Viewed',
    icon: 'eye',
    color: 'blue'
  },
  [ACCESS_TYPES.EDIT]: {
    label: 'Edited',
    icon: 'edit',
    color: 'green'
  },
  [ACCESS_TYPES.COMMENT]: {
    label: 'Commented',
    icon: 'comment',
    color: 'purple'
  },
  [ACCESS_TYPES.SHARE]: {
    label: 'Shared',
    icon: 'share-alt',
    color: 'orange'
  },
  [ACCESS_TYPES.DOWNLOAD]: {
    label: 'Downloaded',
    icon: 'download',
    color: 'teal'
  },
  [ACCESS_TYPES.PRINT]: {
    label: 'Printed',
    icon: 'print',
    color: 'gray'
  },
  [ACCESS_TYPES.EXPORT]: {
    label: 'Exported',
    icon: 'file-export',
    color: 'indigo'
  },
  [ACCESS_TYPES.DELETE]: {
    label: 'Deleted',
    icon: 'trash',
    color: 'red'
  },
  [ACCESS_TYPES.RESTORE]: {
    label: 'Restored',
    icon: 'undo',
    color: 'green'
  }
};

/**
 * Content types that can be shared
 */
export const CONTENT_TYPES = {
  DOCUMENT: 'document',
  FILE: 'file',
  FOLDER: 'folder',
  PROJECT: 'project',
  SECTION: 'section',
  IMAGE: 'image'
};

/**
 * Content type display information
 */
export const CONTENT_TYPE_INFO = {
  [CONTENT_TYPES.DOCUMENT]: {
    label: 'Document',
    icon: 'file-alt',
    color: 'blue'
  },
  [CONTENT_TYPES.FILE]: {
    label: 'File',
    icon: 'file',
    color: 'gray'
  },
  [CONTENT_TYPES.FOLDER]: {
    label: 'Folder',
    icon: 'folder',
    color: 'yellow'
  },
  [CONTENT_TYPES.PROJECT]: {
    label: 'Project',
    icon: 'project-diagram',
    color: 'purple'
  },
  [CONTENT_TYPES.SECTION]: {
    label: 'Section',
    icon: 'align-left',
    color: 'teal'
  },
  [CONTENT_TYPES.IMAGE]: {
    label: 'Image',
    icon: 'image',
    color: 'pink'
  }
};

/**
 * Default expiration periods (in days)
 */
export const EXPIRATION_PERIODS = [
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '1 week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '1 month' },
  { value: 90, label: '3 months' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
  { value: null, label: 'Never' }
];

/**
 * Share status
 */
export const SHARE_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  PENDING: 'pending'
};

/**
 * Share status display information
 */
export const SHARE_STATUS_INFO = {
  [SHARE_STATUS.ACTIVE]: {
    label: 'Active',
    color: 'green',
    icon: 'check-circle'
  },
  [SHARE_STATUS.EXPIRED]: {
    label: 'Expired',
    color: 'orange',
    icon: 'clock'
  },
  [SHARE_STATUS.REVOKED]: {
    label: 'Revoked',
    color: 'red',
    icon: 'times-circle'
  },
  [SHARE_STATUS.PENDING]: {
    label: 'Pending',
    color: 'yellow',
    icon: 'hourglass-half'
  }
};

/**
 * Analytics time periods
 */
export const ANALYTICS_PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last year' }
];

/**
 * Validation patterns
 */
export const VALIDATION = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[1-9]\d{1,14}$/  // E.164 format
};

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  // Maximum number of shares to display before pagination
  MAX_SHARES_DISPLAY: 50,
  
  // Maximum number of access logs to display
  MAX_LOGS_DISPLAY: 100,
  
  // Debounce delay for search (ms)
  SEARCH_DEBOUNCE_MS: 300,
  
  // Default items per page for pagination
  ITEMS_PER_PAGE: 10,
  
  // Toast notification duration (ms)
  TOAST_DURATION: 3000,
  
  // Minimum search query length
  MIN_SEARCH_LENGTH: 2,
  
  // Maximum invitation message length
  MAX_MESSAGE_LENGTH: 500
};

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  CREATE_SHARE_FAILED: 'Failed to create share. Please try again.',
  UPDATE_SHARE_FAILED: 'Failed to update share. Please try again.',
  REVOKE_SHARE_FAILED: 'Failed to revoke share. Please try again.',
  LOAD_SHARES_FAILED: 'Failed to load shares. Please refresh the page.',
  RESEND_INVITATION_FAILED: 'Failed to resend invitation. Please try again.',
  ACCEPT_INVITATION_FAILED: 'Failed to accept invitation. The link may be invalid or expired.',
  INVALID_EMAIL: 'Please enter a valid email address.',
  INVALID_PHONE: 'Please enter a valid phone number.',
  COPY_LINK_FAILED: 'Failed to copy link to clipboard.',
  SEARCH_FAILED: 'Failed to search. Please try again.',
  NO_PERMISSION: 'You do not have permission to perform this action.'
};

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  SHARE_CREATED: 'Share created successfully!',
  SHARE_UPDATED: 'Share updated successfully!',
  SHARE_REVOKED: 'Share revoked successfully.',
  INVITATION_RESENT: 'Invitation resent successfully!',
  INVITATION_ACCEPTED: 'Invitation accepted! You now have access.',
  LINK_COPIED: 'Share link copied to clipboard!'
};

/**
 * Permission helpers
 */
export const hasPermission = (role, permission) => {
  const rolePerms = ROLE_INFO[role]?.permissions || [];
  return rolePerms.includes(permission);
};

export const canEdit = (role) => hasPermission(role, 'write');
export const canComment = (role) => hasPermission(role, 'comment');
export const canRead = (role) => hasPermission(role, 'read');

/**
 * Role hierarchy (for comparison)
 */
export const ROLE_HIERARCHY = {
  [SHARE_ROLES.VIEWER]: 1,
  [SHARE_ROLES.COMMENTER]: 2,
  [SHARE_ROLES.EDITOR]: 3
};

export const isRoleHigherOrEqual = (role1, role2) => {
  return ROLE_HIERARCHY[role1] >= ROLE_HIERARCHY[role2];
};
