/**
 * AccessManager Component — Unified Sharing Panel
 *
 * Single sidebar that combines:
 *  1. Invite by Email  — external review sharing via ViewerTokens
 *  2. Team / Users     — internal sharing (ShareDialog + SharesList)
 *  3. Active viewer token list for the document
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  Users,
  Send,
  Plus,
  Trash2,
  Eye,
  MessageSquare,
  UserCheck,
  Loader2,
  CheckCircle,
  AlertCircle,
  Link2,
  Copy,
  Check,
  RefreshCw,
  Globe,
  X,
  Shield,
} from 'lucide-react';
import ShareDialog from './ShareDialog';
import SharesList from './SharesList';
import PublicLinkDialog from './PublicLinkDialog';
import { useSharePermissions } from '../hooks/useSharing';
import {
  shareForApproval,
  getViewerTokensByDocument,
  revokeViewerToken,
} from '../services/viewerService';

const AccessManager = ({
  contentType,
  objectId,
  contentTitle,
  showPermissionInfo = true,
  allowSharing = true,
}) => {
  // ── Tab state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('invite'); // 'invite' | 'internal'
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showPublicLinkDialog, setShowPublicLinkDialog] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { permissions, loading: permLoading, canEdit } = useSharePermissions(contentType, objectId);
  const canManageShares = canEdit || permissions?.is_owner;

  // ── Email invite state ─────────────────────────────────────────
  const [emails, setEmails] = useState(['']);
  const [role, setRole] = useState('commentator');
  const [accessMode, setAccessMode] = useState('email_otp');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState('');

  // ── Viewer tokens list ─────────────────────────────────────────
  const [viewerTokens, setViewerTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState(null);

  const loadTokens = useCallback(async () => {
    if (!objectId) return;
    setTokensLoading(true);
    try {
      const data = await getViewerTokensByDocument(objectId);
      setViewerTokens(Array.isArray(data) ? data : data.results || []);
    } catch {
      setViewerTokens([]);
    } finally {
      setTokensLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens, refreshKey]);

  // ── Invite handlers ────────────────────────────────────────────
  const addEmail = () => setEmails((prev) => [...prev, '']);
  const removeEmail = (i) => setEmails((prev) => prev.filter((_, idx) => idx !== i));
  const updateEmail = (i, v) => setEmails((prev) => prev.map((e, idx) => (idx === i ? v : e)));

  const handleSendInvite = async () => {
    const valid = emails.map((e) => e.trim().toLowerCase()).filter((e) => e && e.includes('@'));
    if (!valid.length) {
      setInviteError('Enter at least one valid email address.');
      return;
    }
    setInviteError('');
    setSending(true);
    setInviteResult(null);
    try {
      const data = await shareForApproval({
        document_id: objectId,
        emails: valid,
        role,
        access_mode: accessMode,
        message,
      });
      setInviteResult(data);
      loadTokens();
    } catch (err) {
      setInviteError(err.response?.data?.detail || 'Failed to send invitation.');
    } finally {
      setSending(false);
    }
  };

  const resetInviteForm = () => {
    setEmails(['']);
    setRole('commentator');
    setAccessMode('email_otp');
    setMessage('');
    setInviteResult(null);
    setInviteError('');
  };

  // ── Token helpers ──────────────────────────────────────────────
  const handleRevokeToken = async (tokenId) => {
    if (!window.confirm('Revoke this share? The recipient will lose access.')) return;
    try {
      await revokeViewerToken(tokenId);
      setViewerTokens((prev) => prev.filter((t) => t.id !== tokenId));
    } catch { /* ignore */ }
  };

  const handleCopyLink = (token) => {
    const role = token.role;
    const prefix = role === 'commentator' ? 'comment' : 'view';
    const url = `${window.location.origin}/${prefix}/${token.token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token.id);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRefresh = () => setRefreshKey((prev) => prev + 1);

  const getRoleBadge = (r) => {
    const map = {
      viewer:      { icon: Eye,            label: 'Viewer',      cls: 'text-blue-700 bg-blue-50 border-blue-200' },
      commentator: { icon: MessageSquare,   label: 'Reviewer',    cls: 'text-purple-700 bg-purple-50 border-purple-200' },
      approver:    { icon: UserCheck,       label: 'Reviewer',    cls: 'text-purple-700 bg-purple-50 border-purple-200' },
    };
    const info = map[r] || map.viewer;
    const Icon = info.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold border rounded-full ${info.cls}`}>
        <Icon className="h-3 w-3" />
        {info.label}
      </span>
    );
  };

  // ── Loading ────────────────────────────────────────────────────
  if (permLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-gray-900">Share & Access</h2>
        {showPermissionInfo && permissions && (
          <p className="text-xs text-gray-500 mt-0.5">
            Your role: <span className="font-medium capitalize">{permissions.role}</span>
          </p>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('invite')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors ${
            activeTab === 'invite'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Mail className="h-3.5 w-3.5" />
          Invite by Email
        </button>
        <button
          onClick={() => setActiveTab('internal')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors ${
            activeTab === 'internal'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Team / Users
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  TAB: Invite by Email                                  */}
      {/* ═══════════════════════════════════════════════════════ */}
      {activeTab === 'invite' && (
        <div className="space-y-4">
          {/* Success banner */}
          {inviteResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-green-700 text-sm font-medium mb-1">
                <CheckCircle className="h-4 w-4" />
                Sent to {inviteResult.count} recipient{inviteResult.count !== 1 ? 's' : ''}
              </div>
              <div className="space-y-0.5">
                {inviteResult.tokens?.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 text-xs text-green-600">
                    <Mail className="h-3 w-3" />
                    {t.email}
                    <span className="text-green-500">({t.is_new ? 'new' : 'updated'})</span>
                  </div>
                ))}
              </div>
              <button onClick={resetInviteForm} className="mt-2 text-xs text-green-700 font-medium hover:underline">
                Invite more
              </button>
            </div>
          )}

          {/* Invite form */}
          {!inviteResult && canManageShares && (
            <>
              {/* Email inputs */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email addresses</label>
                <div className="space-y-1.5">
                  {emails.map((email, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => updateEmail(i, e.target.value)}
                        placeholder="reviewer@example.com"
                        className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {emails.length > 1 && (
                        <button onClick={() => removeEmail(i)} className="p-1 text-gray-400 hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={addEmail} className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                  <Plus className="h-3.5 w-3.5" />
                  Add another
                </button>
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Access role</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: 'viewer', icon: Eye, label: 'Viewer', desc: 'Read-only access', activeBorder: 'border-blue-500', activeBg: 'bg-blue-50', activeText: 'text-blue-700' },
                    { value: 'commentator', icon: MessageSquare, label: 'Reviewer', desc: 'Comment & approve', activeBorder: 'border-purple-500', activeBg: 'bg-purple-50', activeText: 'text-purple-700' },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const isActive = role === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setRole(opt.value)}
                        className={`flex flex-col items-center gap-0.5 p-2.5 rounded-lg border-2 transition-all text-[11px] font-medium ${
                          isActive
                            ? `${opt.activeBorder} ${opt.activeBg} ${opt.activeText}`
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {opt.label}
                        <span className="text-[9px] font-normal opacity-70">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Auth mode */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Authentication</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setAccessMode('email_otp')}
                    className={`p-2 rounded-lg border-2 text-[11px] font-medium text-center transition-all ${
                      accessMode === 'email_otp'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    🔐 Email OTP
                  </button>
                  <button
                    onClick={() => setAccessMode('invite_only')}
                    className={`p-2 rounded-lg border-2 text-[11px] font-medium text-center transition-all ${
                      accessMode === 'invite_only'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    ✉️ Invitation
                  </button>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Note <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a message for the reviewer…"
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              {/* Error */}
              {inviteError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {inviteError}
                </div>
              )}

              {/* Send */}
              <button
                onClick={handleSendInvite}
                disabled={sending}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? 'Sending…' : 'Send Invitation'}
              </button>
            </>
          )}

          {/* ── Active email shares (Viewer Tokens) ───────────── */}
          <div className="pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide">Active Email Shares</h4>
              <button onClick={loadTokens} className="text-gray-400 hover:text-gray-600">
                <RefreshCw className={`h-3.5 w-3.5 ${tokensLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {tokensLoading && !viewerTokens.length ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : viewerTokens.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">No external shares yet. Invite someone above.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {viewerTokens.map((tk) => (
                  <div key={tk.id} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {tk.recipient_email || tk.recipient_name || 'Anonymous'}
                        </span>
                        {getRoleBadge(tk.role)}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                        {tk.access_mode === 'public' && <span className="flex items-center gap-0.5"><Globe className="h-3 w-3" /> Public</span>}
                        {tk.access_mode === 'email_otp' && <span className="flex items-center gap-0.5"><Shield className="h-3 w-3" /> OTP</span>}
                        {tk.access_mode === 'invite_only' && <span className="flex items-center gap-0.5"><Mail className="h-3 w-3" /> Invite</span>}
                        {tk.access_count > 0 && <span>{tk.access_count} view{tk.access_count !== 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleCopyLink(tk)} className="p-1 text-gray-400 hover:text-blue-600 rounded" title="Copy link">
                        {copiedToken === tk.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => handleRevokeToken(tk.id)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Revoke">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/*  TAB: Internal (Team / Users)                          */}
      {/* ═══════════════════════════════════════════════════════ */}
      {activeTab === 'internal' && (
        <div className="space-y-4">
          {canManageShares && allowSharing && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowShareDialog(true)}
                className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Users className="h-4 w-4 text-blue-500" />
                <span>Share with User</span>
              </button>
              <button
                onClick={() => setShowPublicLinkDialog(true)}
                className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Link2 className="h-4 w-4 text-indigo-500" />
                <span>Get Public Link</span>
              </button>
            </div>
          )}

          {/* Internal shares list */}
          <SharesList
            key={refreshKey}
            contentType={contentType}
            objectId={objectId}
            showHeader={true}
            onShareUpdated={handleRefresh}
            onShareRevoked={handleRefresh}
          />
        </div>
      )}

      {/* ── Dialogs (rendered always, visibility controlled by isOpen) */}
      <ShareDialog
        isOpen={showShareDialog}
        onClose={() => setShowShareDialog(false)}
        contentType={contentType}
        objectId={objectId}
        contentTitle={contentTitle}
        onShareCreated={handleRefresh}
      />
      <PublicLinkDialog
        isOpen={showPublicLinkDialog}
        onClose={() => setShowPublicLinkDialog(false)}
        contentType={contentType}
        objectId={objectId}
        contentTitle={contentTitle}
      />
    </div>
  );
};

export default AccessManager;
