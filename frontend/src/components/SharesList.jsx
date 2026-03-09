/**
 * SharesList Component — Modern Minimal UI
 *
 * Standalone active-shares list with inline role editing, revoke, resend,
 * copy-link, and expandable details. Lucide-react icons, responsive Tailwind.
 */

import React, { useState } from 'react';
import {
  User,
  Users,
  Mail,
  Phone,
  Globe,
  Eye,
  MessageSquare,
  Pencil,
  Trash2,
  Send,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Share2,
  Loader2,
  AlertCircle,
  Clock,
  Shield,
  Link2,
  MoreVertical,
} from 'lucide-react';
import { useSharing } from '../hooks/useSharing';
import {
  ROLE_INFO,
  SHARE_TYPES,
  SHARE_ROLES,
  SHARE_STATUS,
} from '../constants/sharingConstants';

/* ─── Role Picker (compact inline) ───────────────────────────────────────── */
const ROLE_OPTS = [
  { value: 'viewer',    label: 'Viewer',    icon: Eye,           color: 'text-gray-600' },
  { value: 'commenter', label: 'Commenter', icon: MessageSquare, color: 'text-amber-600' },
  { value: 'editor',    label: 'Editor',    icon: Pencil,        color: 'text-blue-600' },
];

const InlineRolePicker = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const current = ROLE_OPTS.find(r => r.value === value) || ROLE_OPTS[0];
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
      >
        <current.icon size={11} className={current.color} />
        {current.label}
        <ChevronDown size={10} className="text-gray-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {ROLE_OPTS.map(opt => (
              <button key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition ${opt.value === value ? 'bg-gray-50' : ''}`}>
                <opt.icon size={12} className={opt.color} />
                <span className="font-medium text-gray-800">{opt.label}</span>
                {opt.value === value && <Check size={12} className="ml-auto text-blue-600" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const fmtDate = (s) => {
  if (!s) return 'Never';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const getStatus = (share) => {
  if (!share.is_active) return 'revoked';
  if (share.expires_at && new Date(share.expires_at) < new Date()) return 'expired';
  if ((share.share_type === 'email' || share.share_type === 'phone') && !share.invitation_accepted) return 'pending';
  return 'active';
};

const getRecipient = (share) => {
  const userInfo = share.shared_with_user_info || share.shared_with_user;
  const teamInfo = share.shared_with_team_info || share.shared_with_team;

  if (share.share_type === 'link' || (!userInfo && !teamInfo && !share.invitation_email && !share.invitation_phone && share.invitation_token)) {
    return { name: 'Anyone with the link', subtitle: 'Public link access', Icon: Globe, bg: 'bg-indigo-50 text-indigo-600' };
  }
  if (userInfo) {
    return { name: userInfo.full_name || userInfo.username || 'User', subtitle: userInfo.email || '', Icon: User, bg: 'bg-blue-50 text-blue-600' };
  }
  if (teamInfo) {
    return { name: teamInfo.name, subtitle: `${teamInfo.member_count || 0} members`, Icon: Users, bg: 'bg-emerald-50 text-emerald-600' };
  }
  if (share.invitation_email) {
    return { name: share.invitation_email, subtitle: share.invitation_accepted ? 'Accepted' : 'Pending invitation', Icon: Mail, bg: 'bg-orange-50 text-orange-600' };
  }
  if (share.invitation_phone) {
    return { name: share.invitation_phone, subtitle: share.invitation_accepted ? 'Accepted' : 'Pending SMS', Icon: Phone, bg: 'bg-violet-50 text-violet-600' };
  }
  return { name: 'Unknown', subtitle: '', Icon: User, bg: 'bg-gray-100 text-gray-500' };
};

/* ─── Share Card ──────────────────────────────────────────────────────────── */
const ShareCard = ({ share, onRoleUpdate, onRevoke, onResend, onCopyLink, compact }) => {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = getStatus(share);
  const { name, subtitle, Icon, bg } = getRecipient(share);
  const isExpired = status === 'expired' || status === 'revoked';

  const handleRole = async (r) => {
    setBusy(true);
    try { await onRoleUpdate(share.id, r); } finally { setBusy(false); }
  };

  const handleCopy = async () => {
    await onCopyLink(share.id, share.invitation_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`rounded-xl border transition-all ${isExpired ? 'border-gray-200 bg-gray-50/50 opacity-60' : 'border-gray-200 bg-white hover:border-gray-300'} ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${bg}`}>
          <Icon size={15} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
            {status === 'pending' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                <Clock size={9} /> Pending
              </span>
            )}
            {status === 'expired' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-600 border border-red-200">
                Expired
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {status === 'pending' && onResend && (
            <button onClick={() => onResend(share.id)} className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition" title="Resend invitation">
              <Send size={13} />
            </button>
          )}
          {share.invitation_token && onCopyLink && (
            <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition" title="Copy link">
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            </button>
          )}
          {!isExpired && (
            <InlineRolePicker value={share.role} onChange={handleRole} disabled={busy} />
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
          >
            {expanded ? <ChevronUp size={13} /> : <MoreVertical size={13} />}
          </button>
        </div>
      </div>

      {/* Link URL */}
      {share.share_type === 'link' && share.invitation_token && (
        <div className="mt-2.5 flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={share.invitation_link || `${window.location.origin}/shared/${share.invitation_token}`}
            className="flex-1 text-[11px] font-mono bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600"
            onClick={e => e.target.select()}
          />
        </div>
      )}

      {/* Expanded Detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <div><span className="font-medium text-gray-600">Shared:</span> {fmtDate(share.shared_at)}</div>
            <div><span className="font-medium text-gray-600">Expires:</span> {fmtDate(share.expires_at)}</div>
            {share.last_accessed_at && (
              <>
                <div><span className="font-medium text-gray-600">Last accessed:</span> {fmtDate(share.last_accessed_at)}</div>
                <div><span className="font-medium text-gray-600">Access count:</span> {share.access_count || 0}</div>
              </>
            )}
          </div>
          {share.invitation_message && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-[11px] text-gray-600">
              <span className="font-medium">Message:</span> {share.invitation_message}
            </div>
          )}
          <div className="flex gap-2">
            {status === 'active' && (
              <button
                onClick={() => { if (window.confirm('Remove access?')) onRevoke(share.id); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition"
              >
                <Trash2 size={12} /> Revoke
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════════
   SharesList
   ═════════════════════════════════════════════════════════════════════════════ */
const SharesList = ({
  contentType,
  objectId,
  onShareUpdated,
  onShareRevoked,
  showHeader = true,
  compact = false,
}) => {
  const {
    shares,
    loading,
    error,
    updateShare,
    revokeShare,
    resendInvitation,
    copyShareLink,
    loadShares,
  } = useSharing(contentType, objectId);

  const handleRoleUpdate = async (id, role) => {
    await updateShare(id, { role });
    onShareUpdated?.();
  };

  const handleRevoke = async (id) => {
    await revokeShare(id);
    onShareRevoked?.();
  };

  /* ── Loading ── */
  if (loading && shares.length === 0) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 size={24} className="text-gray-400 animate-spin" />
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-100 p-4">
        <div className="flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">Error loading shares</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
            <button onClick={loadShares} className="text-xs text-red-600 hover:text-red-800 underline mt-1">Try again</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Empty ── */
  if (shares.length === 0) {
    return (
      <div className="text-center py-12">
        <Share2 size={32} className="mx-auto text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">No shares yet</p>
        <p className="text-xs text-gray-400 mt-1">Click &ldquo;Share&rdquo; to give others access</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">
            Shared with ({shares.length})
          </h3>
          <button
            onClick={loadShares}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      <div className="space-y-2">
        {shares.map(share => (
          <ShareCard
            key={share.id}
            share={share}
            compact={compact}
            onRoleUpdate={handleRoleUpdate}
            onRevoke={handleRevoke}
            onResend={resendInvitation}
            onCopyLink={copyShareLink}
          />
        ))}
      </div>
    </div>
  );
};

export default SharesList;
