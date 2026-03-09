/**
 * CommentatorViewerPage — Editor-like document review with inline chat-style comments.
 *
 * Renders the full document content (sections, paragraphs, tables, images)
 * in a read-only, editor-style layout. Commentators can:
 *   - Read the document exactly as it appears in the editor
 *   - Open an inline chatbox on ANY element to comment/discuss
 *   - Reply to existing comments / resolve threads
 *   - Approve, reject, or request changes on the document
 *
 * Comments appear as an expandable chat thread directly below each element,
 * NOT in a sidebar. This enables contextual, in-place discussion.
 *
 * Login required — uses ViewerSession authentication.
 */

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Loader2, AlertCircle, FileText, MessageSquare, Send, X, ChevronDown, ChevronRight,
  Trash2, CheckCircle, Circle, User, Eye, Table2, Image as ImageIcon,
  CornerDownRight, ThumbsUp, ThumbsDown, AlertTriangle, Shield,
  MessageCircle, Bell,
} from 'lucide-react';
import {
  resolveViewerToken,
  getDocumentStructure,
  getComments,
  createComment,
  deleteComment,
  resolveComment,
  approveDocument,
  getDocumentApprovals,
  isViewerAuthenticated,
  getViewerSession,
  getLegacyPdfUrl,
  getPublicPdfUrl,
  getAuthenticatedPdfUrl,
  sendOTP,
  verifyOTP,
  getAlerts,
  markAlertRead,
  markAllAlertsRead,
} from '../services/viewerService';


// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

const SECTION_DEPTH_STYLES = [
  'text-2xl font-bold',
  'text-xl font-semibold',
  'text-lg font-semibold',
  'text-base font-medium',
  'text-sm font-medium',
];

const APPROVAL_STATUS_MAP = {
  approved: { label: 'Approved', icon: ThumbsUp, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  rejected: { label: 'Rejected', icon: ThumbsDown, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  changes_requested: { label: 'Changes Requested', icon: AlertTriangle, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
};


// ═══════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════

const CommentatorViewerPage = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  // ── Core state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tokenInfo, setTokenInfo] = useState(null);
  const [structure, setStructure] = useState(null);

  // ── Auth gate (mandatory email OTP for commentators) ──
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authOtp, setAuthOtp] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // ── Comments (all loaded, filtered per-element in components) ──
  const [allComments, setAllComments] = useState([]);
  // Which element's chatbox is open: "section:uuid" | "paragraph:uuid" | null
  const [openChatId, setOpenChatId] = useState(null);

  // ── Approval ──
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState('');
  const [approvalComment, setApprovalComment] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [latestApproval, setLatestApproval] = useState(null);

  // ── PDF Preview ──
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');

  // ── Alerts / Notifications ──
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const alertsPanelRef = useRef(null);


  // ════════════════════════════════════════════════════════════════════
  // LOAD DATA
  // ════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!token) { setError('No token provided.'); setLoading(false); return; }
    resolveAndGate();
  }, [token]);

  const resolveAndGate = async () => {
    setLoading(true);
    try {
      const info = await resolveViewerToken(token);
      if (!info.valid) {
        setError(info.error || 'Invalid or expired link.');
        setLoading(false);
        return;
      }
      setTokenInfo(info);

      // ── Commentator pages ALWAYS require login via email OTP ──
      // Skip only if user already has a valid viewer session.
      const alreadyAuthed = isViewerAuthenticated();
      if (alreadyAuthed) {
        await loadDocumentData(info);
      } else {
        // Force OTP login — pre-fill email if the token has a recipient
        setAuthEmail(info.recipient_email || '');
        setNeedsAuth(true);
        setLoading(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resolve token.');
      setLoading(false);
    }
  };

  const loadDocumentData = async (info) => {
    setLoading(true);
    try {
      const struct = await getDocumentStructure(token);
      setStructure(struct);
      setTokenInfo((prev) => ({ ...prev, ...info }));

      if (info?.token_type === 'legacy_share') {
        setPdfUrl(getLegacyPdfUrl(token));
      } else if (info?.access_mode === 'public') {
        setPdfUrl(getPublicPdfUrl(token));
      } else {
        setPdfUrl(getAuthenticatedPdfUrl());
      }

      if (struct.approval_status) {
        setLatestApproval(struct.approval_status);
      }

      await loadAllComments();
      setNeedsAuth(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load document.');
    } finally {
      setLoading(false);
    }
  };

  const loadAllComments = async () => {
    try {
      const data = await getComments(token, { page_size: 200, sort: 'oldest' });
      setAllComments(data.comments || []);
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  };

  const loadAlerts = async () => {
    try {
      const data = await getAlerts(token);
      setAlerts(data.alerts || []);
      setUnreadCount(data.unread_count || 0);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  };

  // Close alerts panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (alertsPanelRef.current && !alertsPanelRef.current.contains(e.target)) {
        setShowAlerts(false);
      }
    };
    if (showAlerts) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAlerts]);

  // Poll alerts every 30s when authenticated
  useEffect(() => {
    if (!needsAuth && structure) {
      loadAlerts();
      const interval = setInterval(loadAlerts, 30000);
      return () => clearInterval(interval);
    }
  }, [needsAuth, structure]);

  const handleMarkAlertRead = async (alertId) => {
    try {
      await markAlertRead(alertId);
      setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, is_read: true } : a));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark alert as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllAlertsRead(token);
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all alerts as read:', err);
    }
  };

  const handleAuthSubmit = async () => {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      if (!otpSent) {
        // Step 1: Send OTP to the email
        await sendOTP(token, authEmail);
        setOtpSent(true);
        setAuthSubmitting(false);
        return;
      }
      // Step 2: Verify OTP → creates session → load document
      await verifyOTP(token, authEmail, authOtp);
      await loadDocumentData(tokenInfo);
    } catch (err) {
      setAuthError(err.response?.data?.error || err.response?.data?.otp?.[0] || 'Authentication failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };


  // ════════════════════════════════════════════════════════════════════
  // COMMENT ACTIONS (used by inline chatboxes)
  // ════════════════════════════════════════════════════════════════════

  const getCommentsForTarget = useCallback((targetType, targetId) => {
    return allComments.filter(
      (c) => c.target_type === targetType && c.object_id === targetId
    );
  }, [allComments]);

  const handleSubmitComment = async (targetType, targetId, text) => {
    if (!text.trim()) return;
    try {
      await createComment({
        viewer_token: token,
        target_type: targetType,
        target_id: targetId,
        text: text.trim(),
      });
      await loadAllComments();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit comment.');
    }
  };

  const handleSubmitReply = async (targetType, targetId, parentId, text) => {
    if (!text.trim()) return;
    try {
      await createComment({
        viewer_token: token,
        target_type: targetType,
        target_id: targetId,
        text: text.trim(),
        parent_id: parentId,
      });
      await loadAllComments();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit reply.');
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!confirm('Delete this comment?')) return;
    try {
      await deleteComment(commentId);
      await loadAllComments();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete comment.');
    }
  };

  const handleResolveComment = async (commentId, resolved) => {
    try {
      await resolveComment(commentId, resolved);
      await loadAllComments();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update comment.');
    }
  };

  // Toggle chatbox for an element
  const toggleChat = useCallback((targetType, targetId) => {
    const key = `${targetType}:${targetId}`;
    setOpenChatId((prev) => (prev === key ? null : key));
  }, []);


  // ════════════════════════════════════════════════════════════════════
  // APPROVAL
  // ════════════════════════════════════════════════════════════════════

  const handleSubmitApproval = async () => {
    if (!approvalStatus) return;
    setSubmittingApproval(true);
    try {
      const result = await approveDocument({
        viewer_token: token,
        status: approvalStatus,
        comment: approvalComment.trim(),
      });
      setLatestApproval(result);
      setShowApprovalModal(false);
      setApprovalComment('');
      setApprovalStatus('');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit decision.');
    } finally {
      setSubmittingApproval(false);
    }
  };


  // ════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
          <p className="mt-3 text-sm text-gray-500">Loading document…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
          <h2 className="mt-3 text-lg font-semibold text-gray-900">Unable to load document</h2>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  // ── Auth Gate — Email OTP Login ──
  if (needsAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50/30">
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">Sign in to Review</h2>
            <p className="text-sm text-gray-500 mt-1">
              {tokenInfo?.document_title
                ? <>Verify your email to review <strong>{tokenInfo.document_title}</strong></>
                : 'Verify your email to access this document'}
            </p>
            {tokenInfo?.shared_by && (
              <p className="text-xs text-gray-400 mt-1">Shared by {tokenInfo.shared_by}</p>
            )}
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {authError}
            </div>
          )}

          <div className="space-y-4">
            {/* Email input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !otpSent && handleAuthSubmit()}
                placeholder="Enter your email"
                disabled={otpSent}
                autoFocus={!otpSent}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>

            {/* OTP input — shown after code is sent */}
            {otpSent && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Verification Code</label>
                <input
                  type="text"
                  value={authOtp}
                  onChange={(e) => setAuthOtp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuthSubmit()}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  autoFocus
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent text-sm text-center tracking-widest text-lg"
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  We sent a verification code to <strong>{authEmail}</strong>. Check your inbox.
                </p>
                <button
                  onClick={() => { setOtpSent(false); setAuthOtp(''); setAuthError(''); }}
                  className="text-xs text-blue-600 hover:text-blue-700 mt-1"
                >
                  Use a different email
                </button>
              </div>
            )}

            {/* Submit button */}
            <button
              onClick={handleAuthSubmit}
              disabled={(!authEmail && !otpSent) || (otpSent && !authOtp) || authSubmitting}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm flex items-center justify-center gap-2"
            >
              {authSubmitting && <Loader2 size={16} className="animate-spin" />}
              {authSubmitting
                ? (otpSent ? 'Verifying…' : 'Sending code…')
                : (otpSent ? 'Verify & Continue' : 'Send Verification Code')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const session = getViewerSession();
  const currentEmail = session?.email || '';

  // Shared comment props for all blocks
  const commentProps = {
    allComments,
    getCommentsForTarget,
    openChatId,
    toggleChat,
    onSubmitComment: handleSubmitComment,
    onSubmitReply: handleSubmitReply,
    onDeleteComment: handleDeleteComment,
    onResolveComment: handleResolveComment,
    currentEmail,
    token,
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* ── Header Bar ── */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {structure?.document_title || 'Document Review'}
              </h1>
              {structure?.document_type && (
                <span className="text-xs text-gray-500">{structure.document_type}</span>
              )}
            </div>
            <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
              Reviewer
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Total comments badge */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600">
              <MessageSquare size={15} className="text-gray-400" />
              <span className="font-medium">{structure?.total_comments || 0}</span>
              <span className="text-xs text-gray-400">comments</span>
            </div>

            {/* Notification Bell */}
            <div className="relative" ref={alertsPanelRef}>
              <button
                onClick={() => setShowAlerts((prev) => !prev)}
                className="relative flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                title="Notifications"
              >
                <Bell size={16} className={unreadCount > 0 ? 'text-blue-600' : 'text-gray-400'} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Alerts dropdown panel */}
              {showAlerts && (
                <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                  <div className="sticky top-0 bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {alerts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-gray-400">
                      No notifications yet
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {alerts.map((alert) => (
                        <button
                          key={alert.id}
                          onClick={() => {
                            if (!alert.is_read) handleMarkAlertRead(alert.id);
                            // If alert references a comment, scroll to that element
                            if (alert.metadata?.target_type && alert.metadata?.object_id) {
                              setOpenChatId(`${alert.metadata.target_type}:${alert.metadata.object_id}`);
                            }
                            setShowAlerts(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors ${
                            !alert.is_read ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                              !alert.is_read ? 'bg-blue-500' : 'bg-transparent'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 leading-snug">{alert.message}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{formatTimeAgo(alert.created_at)}</p>
                            </div>
                            {alert.alert_type === 'approval_submitted' && (
                              <Shield size={14} className="text-purple-400 flex-shrink-0 mt-0.5" />
                            )}
                            {(alert.alert_type === 'new_comment' || alert.alert_type === 'comment_reply') && (
                              <MessageCircle size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PDF Preview */}
            {pdfUrl && (
              <button
                onClick={() => setShowPdf(!showPdf)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  showPdf ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <Eye size={15} />
                PDF
              </button>
            )}

            {/* Approve / Reject */}
            <button
              onClick={() => setShowApprovalModal(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Shield size={15} />
              Review Decision
            </button>
          </div>
        </div>

        {/* Latest approval banner */}
        {latestApproval && <ApprovalBanner approval={latestApproval} />}
      </header>

      {/* ── PDF Preview Overlay ── */}
      {showPdf && pdfUrl && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-5xl h-[90vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-semibold text-gray-700">Document PDF Preview</span>
              <button onClick={() => setShowPdf(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>
            <iframe title="PDF Preview" src={pdfUrl} className="flex-1 w-full border-0" />
          </div>
        </div>
      )}

      {/* ── Approval Modal ── */}
      {showApprovalModal && (
        <ApprovalModal
          approvalStatus={approvalStatus}
          setApprovalStatus={setApprovalStatus}
          approvalComment={approvalComment}
          setApprovalComment={setApprovalComment}
          submitting={submittingApproval}
          onSubmit={handleSubmitApproval}
          onClose={() => { setShowApprovalModal(false); setApprovalStatus(''); setApprovalComment(''); }}
        />
      )}

      {/* ── Document Content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto py-8 px-4 md:px-6">

          {/* Document-level inline chatbox */}
          <DocumentCommentBlock
            documentId={structure?.document_id}
            commentCount={structure?.document_comment_count || 0}
            {...commentProps}
          />

          {/* Render sections */}
          {(structure?.sections || []).map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              depth={0}
              {...commentProps}
            />
          ))}

          {(!structure?.sections || structure.sections.length === 0) && (
            <div className="text-center py-16 text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">This document has no content yet.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// DOCUMENT-LEVEL COMMENT BLOCK
// ═══════════════════════════════════════════════════════════════════════

const DocumentCommentBlock = ({
  documentId, commentCount,
  openChatId, toggleChat, getCommentsForTarget,
  onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
}) => {
  const chatKey = `document:${documentId}`;
  const isOpen = openChatId === chatKey;
  const comments = getCommentsForTarget('document', documentId);

  return (
    <div className="mb-6">
      <button
        onClick={() => toggleChat('document', documentId)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
          isOpen
            ? 'bg-blue-50 border-blue-300 text-blue-700'
            : comments.length > 0
              ? 'bg-blue-50/60 border-blue-200 text-blue-600 hover:bg-blue-50'
              : 'border-gray-200 text-gray-500 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600'
        }`}
      >
        <MessageCircle size={13} />
        Comment on document
        {comments.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">
            {comments.length}
          </span>
        )}
      </button>

      {isOpen && (
        <InlineChatbox
          targetType="document"
          targetId={documentId}
          comments={comments}
          onSubmitComment={onSubmitComment}
          onSubmitReply={onSubmitReply}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          currentEmail={currentEmail}
        />
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// SECTION BLOCK
// ═══════════════════════════════════════════════════════════════════════

const SectionBlock = ({
  section, depth,
  openChatId, toggleChat, getCommentsForTarget,
  onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
  ...commentProps
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const depthStyle = SECTION_DEPTH_STYLES[Math.min(depth, SECTION_DEPTH_STYLES.length - 1)];

  const chatKey = `section:${section.id}`;
  const isOpen = openChatId === chatKey;
  const sectionComments = getCommentsForTarget('section', section.id);

  // Merge child elements and sort by order
  const childElements = useMemo(() => {
    const items = [];
    (section.paragraphs || []).forEach((p) => items.push({ ...p, _kind: 'paragraph' }));
    (section.tables || []).forEach((t) => items.push({ ...t, _kind: 'table' }));
    (section.images || []).forEach((i) => items.push({ ...i, _kind: 'image' }));
    items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return items;
  }, [section]);

  // Only show section.content if there are NO paragraphs
  // (prevents duplicate text when section text == paragraph text)
  const hasParagraphs = (section.paragraphs || []).length > 0;

  const sharedProps = {
    openChatId, toggleChat, getCommentsForTarget,
    onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
    ...commentProps,
  };

  return (
    <div className={`mb-6 ${depth > 0 ? 'ml-5 pl-4 border-l-2 border-gray-200' : ''}`}>
      {/* Section Header */}
      <div className="group flex items-start gap-2 mb-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="mt-1 p-0.5 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
        >
          {collapsed
            ? <ChevronRight size={16} className="text-gray-400" />
            : <ChevronDown size={16} className="text-gray-400" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className={`${depthStyle} text-gray-900 leading-tight`}>
              {section.title || 'Untitled Section'}
            </h2>
            {section.section_type && section.section_type !== 'section' && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded uppercase">
                {section.section_type}
              </span>
            )}
          </div>
        </div>

        {/* Comment toggle */}
        <button
          onClick={() => toggleChat('section', section.id)}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-all flex-shrink-0 ${
            isOpen
              ? 'bg-blue-100 border-blue-300 text-blue-700'
              : sectionComments.length > 0
                ? 'opacity-100 bg-blue-50 border-blue-200 text-blue-700'
                : 'opacity-0 group-hover:opacity-100 border-gray-200 hover:bg-blue-50 hover:border-blue-200 text-gray-500 hover:text-blue-600'
          }`}
        >
          <MessageCircle size={12} />
          {sectionComments.length > 0 && (
            <span className="text-[10px] font-bold">{sectionComments.length}</span>
          )}
        </button>
      </div>

      {/* Inline chatbox for section */}
      {isOpen && (
        <div className="ml-6 mb-3">
          <InlineChatbox
            targetType="section"
            targetId={section.id}
            comments={sectionComments}
            onSubmitComment={onSubmitComment}
            onSubmitReply={onSubmitReply}
            onDeleteComment={onDeleteComment}
            onResolveComment={onResolveComment}
            currentEmail={currentEmail}
          />
        </div>
      )}

      {/* Section content */}
      {!collapsed && (
        <div className="space-y-3 pl-6">
          {/* Section-level text content — ONLY if no paragraphs exist */}
          {!hasParagraphs && section.content && section.content.trim() && (
            <div className="text-sm text-gray-700 leading-relaxed">
              <ContentRenderer html={section.content} />
            </div>
          )}

          {/* Child elements (paragraphs, tables, images) in order */}
          {childElements.map((item) => {
            if (item._kind === 'paragraph') {
              return (
                <ParagraphBlock
                  key={item.id}
                  paragraph={item}
                  {...sharedProps}
                />
              );
            }
            if (item._kind === 'table') {
              return (
                <TableBlock
                  key={item.id}
                  table={item}
                  {...sharedProps}
                />
              );
            }
            if (item._kind === 'image') {
              return (
                <ImageBlock
                  key={item.id}
                  image={item}
                  {...sharedProps}
                />
              );
            }
            return null;
          })}

          {/* Nested subsections */}
          {(section.children || []).map((child) => (
            <SectionBlock
              key={child.id}
              section={child}
              depth={depth + 1}
              {...sharedProps}
            />
          ))}
        </div>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// PARAGRAPH BLOCK
// ═══════════════════════════════════════════════════════════════════════

const ParagraphBlock = ({
  paragraph,
  openChatId, toggleChat, getCommentsForTarget,
  onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
}) => {
  const content = paragraph.content || paragraph.content_preview || '';
  if (!content.trim()) return null;

  const chatKey = `paragraph:${paragraph.id}`;
  const isOpen = openChatId === chatKey;
  const comments = getCommentsForTarget('paragraph', paragraph.id);

  return (
    <div className="group relative">
      <div className="flex items-start gap-1">
        <div className="flex-1 text-sm text-gray-800 leading-relaxed">
          <ContentRenderer html={content} />
        </div>

        {/* Comment toggle */}
        <button
          onClick={() => toggleChat('paragraph', paragraph.id)}
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-all flex-shrink-0 mt-0.5 ${
            isOpen
              ? 'bg-blue-100 border-blue-300 text-blue-700'
              : comments.length > 0
                ? 'opacity-100 bg-blue-50 border-blue-200 text-blue-700'
                : 'opacity-0 group-hover:opacity-100 border-gray-200 hover:bg-blue-50 hover:border-blue-200 text-gray-400 hover:text-blue-600'
          }`}
        >
          <MessageCircle size={10} />
          {comments.length > 0 && <span className="font-bold">{comments.length}</span>}
        </button>
      </div>

      {/* Inline chatbox */}
      {isOpen && (
        <InlineChatbox
          targetType="paragraph"
          targetId={paragraph.id}
          comments={comments}
          onSubmitComment={onSubmitComment}
          onSubmitReply={onSubmitReply}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          currentEmail={currentEmail}
        />
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// TABLE BLOCK
// ═══════════════════════════════════════════════════════════════════════

const TableBlock = ({
  table,
  openChatId, toggleChat, getCommentsForTarget,
  onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
}) => {
  const headers = table.column_headers || [];
  const rows = table.table_data || [];
  const config = table.table_config || {};

  const chatKey = `table:${table.id}`;
  const isOpen = openChatId === chatKey;
  const comments = getCommentsForTarget('table', table.id);

  return (
    <div className="group relative my-4">
      {/* Table title */}
      {table.title && (
        <div className="flex items-center gap-2 mb-2">
          <Table2 size={14} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-700">{table.title}</span>
          {/* Comment toggle in header */}
          <button
            onClick={() => toggleChat('table', table.id)}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-all ${
              isOpen
                ? 'bg-blue-100 border-blue-300 text-blue-700'
                : comments.length > 0
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'opacity-0 group-hover:opacity-100 border-gray-200 hover:bg-blue-50 hover:border-blue-200 text-gray-400 hover:text-blue-600'
            }`}
          >
            <MessageCircle size={10} />
            {comments.length > 0 && <span className="font-bold">{comments.length}</span>}
          </button>
        </div>
      )}
      {table.description && (
        <p className="text-xs text-gray-500 mb-2">{table.description}</p>
      )}

      {/* Actual table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          {headers.length > 0 && (
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {headers.map((col, i) => (
                  <th key={col.id || i}
                    className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
                    style={{ width: col.width || 'auto', textAlign: col.align || 'left' }}>
                    {col.label || col.id || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-gray-100">
            {rows.length > 0 ? rows.map((row, rowIdx) => (
              <tr key={row.row_id || rowIdx} className={rowIdx % 2 === 1 && config.striped_rows ? 'bg-gray-50/50' : ''}>
                {headers.map((col, colIdx) => (
                  <td key={col.id || colIdx} className="px-3 py-2 text-gray-700"
                    style={{ textAlign: col.align || 'left' }}>
                    {row.cells?.[col.id] ?? row.cells?.[colIdx] ?? ''}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={headers.length || 1} className="px-3 py-4 text-center text-gray-400 text-xs">
                  Empty table
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Comment toggle if no title (fallback) */}
      {!table.title && (
        <div className="mt-1">
          <button
            onClick={() => toggleChat('table', table.id)}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-all ${
              isOpen
                ? 'bg-blue-100 border-blue-300 text-blue-700'
                : comments.length > 0
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'opacity-0 group-hover:opacity-100 border-gray-200 hover:bg-blue-50 text-gray-400 hover:text-blue-600'
            }`}
          >
            <MessageCircle size={10} />
            {comments.length > 0 && <span className="font-bold">{comments.length}</span>}
          </button>
        </div>
      )}

      {/* Inline chatbox */}
      {isOpen && (
        <InlineChatbox
          targetType="table"
          targetId={table.id}
          comments={comments}
          onSubmitComment={onSubmitComment}
          onSubmitReply={onSubmitReply}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          currentEmail={currentEmail}
        />
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// IMAGE BLOCK
// ═══════════════════════════════════════════════════════════════════════

const ImageBlock = ({
  image,
  openChatId, toggleChat, getCommentsForTarget,
  onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
}) => {
  const sizeMap = {
    small: 'max-w-[25%]', medium: 'max-w-[50%]', large: 'max-w-[75%]',
    full: 'max-w-full', original: 'max-w-full', custom: 'max-w-[60%]',
  };
  const alignMap = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto', justify: 'mx-auto' };

  const sizeClass = sizeMap[image.size_mode] || 'max-w-[50%]';
  const alignClass = alignMap[image.alignment] || 'mx-auto';

  const chatKey = `image:${image.id}`;
  const isOpen = openChatId === chatKey;
  const comments = getCommentsForTarget('image', image.id);

  return (
    <div className="group relative my-4">
      <figure className={`${sizeClass} ${alignClass}`}>
        {image.figure_number && (
          <div className="text-xs text-gray-500 font-medium mb-1">{image.figure_number}</div>
        )}
        {image.image_url ? (
          <img
            src={image.image_url}
            alt={image.alt_text || image.caption || 'Document image'}
            className="w-full rounded-lg border border-gray-200 shadow-sm"
          />
        ) : (
          <div className="w-full h-32 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
            <ImageIcon size={24} className="text-gray-300" />
          </div>
        )}
        {(image.caption || image.title) && (
          <figcaption className="mt-1.5 text-xs text-gray-500 text-center italic">
            {image.caption || image.title}
          </figcaption>
        )}
      </figure>

      {/* Comment toggle */}
      <div className="flex justify-end mt-1">
        <button
          onClick={() => toggleChat('image', image.id)}
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-all ${
            isOpen
              ? 'bg-blue-100 border-blue-300 text-blue-700'
              : comments.length > 0
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'opacity-0 group-hover:opacity-100 border-gray-200 hover:bg-blue-50 text-gray-400 hover:text-blue-600'
          }`}
        >
          <MessageCircle size={10} />
          {comments.length > 0 && <span className="font-bold">{comments.length}</span>}
        </button>
      </div>

      {/* Inline chatbox */}
      {isOpen && (
        <InlineChatbox
          targetType="image"
          targetId={image.id}
          comments={comments}
          onSubmitComment={onSubmitComment}
          onSubmitReply={onSubmitReply}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          currentEmail={currentEmail}
        />
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// INLINE CHATBOX — Interactive chat-style comment thread under elements
// ═══════════════════════════════════════════════════════════════════════

const InlineChatbox = ({
  targetType, targetId, comments,
  onSubmitComment, onSubmitReply, onDeleteComment, onResolveComment, currentEmail,
}) => {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const chatEndRef = useRef(null);

  // Auto-focus on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to bottom when new comments arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await onSubmitComment(targetType, targetId, text);
      setText('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Chat header */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <MessageCircle size={13} className="text-blue-500" />
        <span className="text-xs font-semibold text-gray-700">
          Discussion
        </span>
        <span className="text-[10px] text-gray-400">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {/* Messages area */}
      <div className="max-h-64 overflow-y-auto px-3 py-2 space-y-2">
        {comments.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">
            No comments yet — start the discussion.
          </p>
        )}

        {comments.map((comment) => (
          <ChatMessage
            key={comment.id}
            comment={comment}
            currentEmail={currentEmail}
            targetType={targetType}
            targetId={targetId}
            onDelete={onDeleteComment}
            onResolve={onResolveComment}
            onReply={onSubmitReply}
          />
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Type a message…"
          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || submitting}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// CHAT MESSAGE — single comment within an inline chatbox
// ═══════════════════════════════════════════════════════════════════════

const ChatMessage = ({
  comment, currentEmail, targetType, targetId,
  onDelete, onResolve, onReply,
}) => {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  const isOwn = currentEmail && comment.author_email?.toLowerCase() === currentEmail.toLowerCase();
  const timeAgo = formatTimeAgo(comment.created_at);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSubmittingReply(true);
    try {
      await onReply(targetType, targetId, comment.id, replyText);
      setReplyText('');
      setShowReply(false);
    } catch { /* handled upstream */ }
    setSubmittingReply(false);
  };

  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${
      comment.is_resolved ? 'bg-green-50/70 border border-green-200' : isOwn ? 'bg-blue-50/60' : 'bg-gray-50'
    }`}>
      {/* Author line */}
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-5 h-5 rounded-full bg-blue-200 flex items-center justify-center flex-shrink-0">
          <User size={10} className="text-blue-700" />
        </div>
        <span className="text-xs font-semibold text-gray-800">
          {comment.author_name || comment.author_email?.split('@')[0] || 'Anonymous'}
        </span>
        <span className="text-[10px] text-gray-400">{timeAgo}</span>
        {comment.is_resolved && (
          <span className="text-[10px] text-green-600 font-medium flex items-center gap-0.5 ml-auto">
            <CheckCircle size={10} /> Resolved
          </span>
        )}
      </div>

      {/* Text */}
      <p className="text-gray-700 leading-relaxed text-[13px]">{comment.text}</p>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-1.5 text-[11px]">
        <button onClick={() => setShowReply(!showReply)}
          className="text-gray-500 hover:text-blue-600 flex items-center gap-0.5 transition-colors">
          <CornerDownRight size={10} /> Reply
        </button>
        <button onClick={() => onResolve(comment.id, !comment.is_resolved)}
          className="text-gray-500 hover:text-green-600 flex items-center gap-0.5 transition-colors">
          {comment.is_resolved
            ? <><Circle size={10} /> Unresolve</>
            : <><CheckCircle size={10} /> Resolve</>}
        </button>
        {isOwn && (
          <button onClick={() => onDelete(comment.id)}
            className="text-gray-400 hover:text-red-500 flex items-center gap-0.5 transition-colors">
            <Trash2 size={10} /> Delete
          </button>
        )}
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2 ml-5 pl-3 border-l-2 border-gray-200 space-y-1.5">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="text-xs">
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center">
                  <User size={8} className="text-gray-500" />
                </div>
                <span className="font-medium text-gray-700">
                  {reply.author_name || reply.author_email?.split('@')[0]}
                </span>
                <span className="text-gray-400">{formatTimeAgo(reply.created_at)}</span>
              </div>
              <p className="text-gray-600 ml-[22px]">{reply.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReply && (
        <div className="mt-2 ml-5 flex gap-1.5">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleReply(); } }}
            placeholder="Write a reply…"
            className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            autoFocus
          />
          <button onClick={handleReply} disabled={!replyText.trim() || submittingReply}
            className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            <Send size={12} />
          </button>
        </div>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// CONTENT RENDERER — safely renders HTML or plain text
// ═══════════════════════════════════════════════════════════════════════

const ContentRenderer = ({ html }) => {
  if (!html) return null;
  if (/<[a-z][\s\S]*>/i.test(html)) {
    return <div dangerouslySetInnerHTML={{ __html: html }} className="prose prose-sm max-w-none" />;
  }
  return <span className="whitespace-pre-wrap">{html}</span>;
};


// ═══════════════════════════════════════════════════════════════════════
// APPROVAL BANNER
// ═══════════════════════════════════════════════════════════════════════

const ApprovalBanner = ({ approval }) => {
  const cfg = APPROVAL_STATUS_MAP[approval.status];
  if (!cfg) return null;
  const Icon = cfg.icon;

  return (
    <div className={`px-4 py-2 border-t ${cfg.bg} flex items-center gap-2 text-sm`}>
      <Icon size={16} className={cfg.color} />
      <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
      <span className="text-gray-500">by {approval.reviewer_name || approval.reviewer_email}</span>
      {approval.comment && (
        <span className="text-gray-500 ml-2">— &ldquo;{approval.comment}&rdquo;</span>
      )}
      <span className="ml-auto text-xs text-gray-400">
        {new Date(approval.created_at).toLocaleString()}
      </span>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// APPROVAL MODAL
// ═══════════════════════════════════════════════════════════════════════

const ApprovalModal = ({
  approvalStatus, setApprovalStatus,
  approvalComment, setApprovalComment,
  submitting, onSubmit, onClose,
}) => {
  const options = [
    { value: 'approved', label: 'Approve', icon: ThumbsUp, color: 'border-green-300 bg-green-50 text-green-800', active: 'ring-2 ring-green-500' },
    { value: 'changes_requested', label: 'Request Changes', icon: AlertTriangle, color: 'border-amber-300 bg-amber-50 text-amber-800', active: 'ring-2 ring-amber-500' },
    { value: 'rejected', label: 'Reject', icon: ThumbsDown, color: 'border-red-300 bg-red-50 text-red-800', active: 'ring-2 ring-red-500' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-gray-900">Submit Review Decision</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="space-y-2 mb-5">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <button key={opt.value} onClick={() => setApprovalStatus(opt.value)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${opt.color} ${
                  approvalStatus === opt.value ? opt.active : 'opacity-70 hover:opacity-100'
                }`}>
                <Icon size={18} />
                <span className="font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>

        <textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)}
          placeholder="Add a comment (optional)…" rows={3}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent" />

        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={onSubmit} disabled={!approvalStatus || submitting}
            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {submitting ? 'Submitting…' : 'Submit Decision'}
          </button>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}


export default CommentatorViewerPage;
