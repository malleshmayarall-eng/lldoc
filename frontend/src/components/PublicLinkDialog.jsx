/**
 * PublicLinkDialog Component
 * 
 * Create and manage public share links (anyone with the link)
 * Shows existing public links and allows creating new ones
 */

import React, { useState, useEffect } from 'react';
import sharingService from '../services/sharingService';
import {
  SHARE_ROLES,
  ROLE_INFO,
  EXPIRATION_PERIODS
} from '../constants/sharingConstants';

const PublicLinkDialog = ({
  isOpen,
  onClose,
  contentType,
  objectId,
  contentTitle
}) => {
  const [role, setRole] = useState(SHARE_ROLES.VIEWER);
  const [expirationDays, setExpirationDays] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publicLinks, setPublicLinks] = useState([]);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Load existing public links
  useEffect(() => {
    if (isOpen) {
      loadPublicLinks();
    }
  }, [isOpen, contentType, objectId]);

  const loadPublicLinks = async () => {
    setLoading(true);
    setError(null);
    try {
      const links = await sharingService.getPublicLinks(contentType, objectId);
      setPublicLinks(links);
    } catch (err) {
      console.error('Error loading public links:', err);
      setError('Failed to load existing links');
    } finally {
      setLoading(false);
    }
  };

  // Create new public link
  const handleCreateLink = async () => {
    setCreating(true);
    setError(null);

    try {
      const expiresAt = expirationDays
        ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const newLink = await sharingService.createPublicLink({
        content_type: contentType,
        object_id: objectId,
        role,
        expires_at: expiresAt
      });

      // Add to list
      setPublicLinks([newLink, ...publicLinks]);

      // Auto-copy the new link
      handleCopyLink(newLink);

    } catch (err) {
      console.error('Error creating public link:', err);
      setError('Failed to create public link. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  // Copy link to clipboard
  const handleCopyLink = async (link) => {
    try {
      const url = sharingService.getShareLink(link.id, link.invitation_token);
      await navigator.clipboard.writeText(url);
      
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Error copying link:', err);
    }
  };

  // Revoke link
  const handleRevokeLink = async (linkId) => {
    if (!window.confirm('Are you sure you want to revoke this link? Anyone with this link will lose access.')) {
      return;
    }

    try {
      await sharingService.revokePublicLink(linkId);
      setPublicLinks(publicLinks.filter(link => link.id !== linkId));
    } catch (err) {
      console.error('Error revoking link:', err);
      setError('Failed to revoke link');
    }
  };

  // Update link role
  const handleUpdateRole = async (linkId, newRole) => {
    try {
      await sharingService.updatePublicLink(linkId, { role: newRole });
      setPublicLinks(publicLinks.map(link =>
        link.id === linkId ? { ...link, role: newRole } : link
      ));
    } catch (err) {
      console.error('Error updating link:', err);
      setError('Failed to update link');
    }
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      ></div>

      {/* Dialog */}
      <div className="flex items-center justify-center min-h-screen p-4">
        <div 
          className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <i className="fas fa-link text-indigo-600 mr-3"></i>
                  Public Link Sharing
                </h3>
                {contentTitle && (
                  <p className="text-sm text-gray-500 mt-1">
                    "{contentTitle}"
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 focus:outline-none"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-4 space-y-6">
            {/* Error Alert */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex">
                  <i className="fas fa-exclamation-circle text-red-400 mr-3"></i>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex">
                <i className="fas fa-info-circle text-blue-400 mr-3 mt-0.5"></i>
                <div className="text-sm text-blue-800">
                  <p className="font-medium">Anyone with the link can access this {contentType}</p>
                  <p className="mt-1 text-blue-700">
                    Links work even for users who aren't logged in. Set an expiration date for added security.
                  </p>
                </div>
              </div>
            </div>

            {/* Create New Link Section */}
            <div className="border border-gray-200 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-gray-900">Create New Link</h4>

              {/* Role Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Permission level
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {Object.values(SHARE_ROLES).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                        role === r
                          ? `border-${ROLE_INFO[r].color}-500 bg-${ROLE_INFO[r].color}-50`
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start">
                        <i className={`fas fa-${ROLE_INFO[r].icon} text-${ROLE_INFO[r].color}-600 mr-2`}></i>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 text-xs">
                            {ROLE_INFO[r].label}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {ROLE_INFO[r].description}
                          </div>
                        </div>
                        {role === r && (
                          <i className={`fas fa-check-circle text-${ROLE_INFO[r].color}-600`}></i>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Expiration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Link expires
                </label>
                <select
                  value={expirationDays || ''}
                  onChange={(e) => setExpirationDays(e.target.value ? parseInt(e.target.value) : null)}
                  className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-lg"
                >
                  {EXPIRATION_PERIODS.map(period => (
                    <option key={period.value || 'never'} value={period.value || ''}>
                      {period.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Create Button */}
              <button
                onClick={handleCreateLink}
                disabled={creating}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Creating Link...
                  </>
                ) : (
                  <>
                    <i className="fas fa-plus mr-2"></i>
                    Create Public Link
                  </>
                )}
              </button>
            </div>

            {/* Existing Links */}
            {loading ? (
              <div className="flex justify-center py-8">
                <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
              </div>
            ) : publicLinks.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  Active Links ({publicLinks.length})
                </h4>
                <div className="space-y-3">
                  {publicLinks.map(link => (
                    <div
                      key={link.id}
                      className="border border-gray-200 rounded-lg p-4 space-y-3"
                    >
                      {/* Link Info */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-${ROLE_INFO[link.role].color}-100 text-${ROLE_INFO[link.role].color}-800`}>
                              {ROLE_INFO[link.role].label}
                            </span>
                            {link.expires_at && (
                              <span className="text-xs text-gray-500">
                                Expires: {formatDate(link.expires_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            Created: {formatDate(link.created_at || link.shared_at)}
                          </p>
                        </div>
                      </div>

                      {/* Link URL */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          readOnly
                          value={sharingService.getShareLink(link.id, link.invitation_token)}
                          className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 bg-gray-50 text-gray-600"
                        />
                        <button
                          onClick={() => handleCopyLink(link)}
                          className="px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100"
                        >
                          {copiedId === link.id ? (
                            <>
                              <i className="fas fa-check mr-1"></i>
                              Copied!
                            </>
                          ) : (
                            <>
                              <i className="fas fa-copy mr-1"></i>
                              Copy
                            </>
                          )}
                        </button>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                        <select
                          value={link.role}
                          onChange={(e) => handleUpdateRole(link.id, e.target.value)}
                          className="text-sm border-gray-300 rounded focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          {Object.values(SHARE_ROLES).map(r => (
                            <option key={r} value={r}>
                              {ROLE_INFO[r].label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRevokeLink(link.id)}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          <i className="fas fa-ban mr-1"></i>
                          Revoke
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <i className="fas fa-link text-4xl text-gray-300 mb-3"></i>
                <p className="text-sm text-gray-500">No public links yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Create a link above to share this {contentType}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 px-6 py-4 rounded-b-lg border-t border-gray-200">
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicLinkDialog;
