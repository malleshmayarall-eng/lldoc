/**
 * SharedContentPage — Modern Minimal UI
 *
 * Token-based shared content page. Accepts invitation on mount,
 * displays content with role badge, edit button for editors.
 * Lucide-react icons, responsive Tailwind.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  Home,
  CheckCircle2,
  Eye,
  MessageSquare,
  Pencil,
  ArrowRight,
} from 'lucide-react';
import { useInvitationAcceptance, useSharePermissions, useAccessLogs } from '../hooks/useSharing';
import { SUCCESS_MESSAGES } from '../constants/sharingConstants';
import { openDocumentInEditor } from '../utils/documentRouting';

const ROLE_ICON = { editor: Pencil, commenter: MessageSquare, viewer: Eye };

const SharedContentPage = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [contentData, setContentData] = useState(null);

  const { accepting, error: acceptError, shareData, acceptInvitation } = useInvitationAcceptance();
  const { permissions, loading: permissionsLoading } = useSharePermissions(
    shareData?.content_type, shareData?.object_id, token,
  );
  const { logAccess } = useAccessLogs(shareData?.content_type, shareData?.object_id);

  useEffect(() => {
    if (token) {
      acceptInvitation(token)
        .then((data) => {
          setContentData(data.content);
          logAccess({ access_type: 'view', share_id: data.share.id });
        })
        .catch((err) => console.error('Failed to accept invitation:', err));
    }
  }, [token, acceptInvitation, logAccess]);

  /* ── Loading ── */
  if (accepting || permissionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 size={36} className="mx-auto text-blue-500 animate-spin mb-4" />
          <p className="text-gray-600">Loading shared content…</p>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (acceptError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <AlertCircle size={48} className="mx-auto text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to Access</h2>
          <p className="text-gray-600 mb-6">{acceptError}</p>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
          >
            <Home size={15} /> Go to Home
          </button>
        </div>
      </div>
    );
  }

  /* ── Content ── */
  if (shareData && contentData) {
    const RoleIcon = ROLE_ICON[permissions?.role] || Eye;
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">
                {contentData.title || 'Shared Content'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Shared by {shareData.share.shared_by?.full_name || 'Someone'}
                {shareData.share.shared_at && <> on {new Date(shareData.share.shared_at).toLocaleDateString()}</>}
              </p>
            </div>
            {permissions && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                <RoleIcon size={13} />
                {permissions.role}
              </span>
            )}
          </div>
        </header>

        {/* Main */}
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            {/* Success banner */}
            <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-3 mb-6">
              <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
              <p className="text-sm text-emerald-800">{SUCCESS_MESSAGES.INVITATION_ACCEPTED}</p>
            </div>

            {/* Content */}
            <div className="prose prose-gray max-w-none">
              <h2>{contentData.title}</h2>
              {contentData.description && <p>{contentData.description}</p>}
              {contentData.content && (
                <div dangerouslySetInnerHTML={{ __html: contentData.content }} />
              )}
            </div>

            {/* Edit action */}
            {permissions?.canEdit && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                <button
                  onClick={() => openDocumentInEditor(navigate, {
                    object_id: shareData.object_id,
                    document_mode: contentData?.document_mode,
                    mode: contentData?.mode,
                  })}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
                >
                  <Pencil size={14} /> Edit Document <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  return null;
};

export default SharedContentPage;
