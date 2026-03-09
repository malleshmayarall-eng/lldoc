/**
 * ShareDialog Component — Modern Minimal UI
 *
 * Full-featured share modal:
 *  • People tab – search org users / teams, pick role per-recipient
 *  • Link tab  – create a public link with role + optional expiry, one-click copy
 *  • Active shares list inline with role editing + revoke
 *  • Responsive, keyboard-navigable, Escape to close
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Link2,
  Copy,
  Check,
  Users,
  User,
  Mail,
  ChevronDown,
  Search,
  Loader2,
  Globe,
  Shield,
  Eye,
  MessageSquare,
  Pencil,
  Trash2,
  Send,
  AlertCircle,
  Clock,
  UserPlus,
} from 'lucide-react';
import { useSharing } from '../hooks/useSharing';
import sharingService from '../services/sharingService';
import {
  SHARE_ROLES,
  SHARE_TYPES,
  EXPIRATION_PERIODS,
  UI_CONFIG,
  VALIDATION,
} from '../constants/sharingConstants';

/* ─── Role Options ────────────────────────────────────────────────────────── */
const ROLE_OPTIONS = [
  { value: 'viewer',    label: 'Viewer',    desc: 'Can view only',       icon: Eye,            color: 'text-gray-600' },
  { value: 'commenter', label: 'Commenter', desc: 'Can view & comment',  icon: MessageSquare,  color: 'text-amber-600' },
  { value: 'editor',    label: 'Editor',    desc: 'Can edit',            icon: Pencil,         color: 'text-blue-600' },
];

/* ─── Role Picker Dropdown ────────────────────────────────────────────────── */
const RolePicker = ({ value, onChange, compact = false, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = ROLE_OPTIONS.find((r) => r.value === value) || ROLE_OPTIONS[0];

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 ${compact ? 'text-[11px] px-2 py-1' : ''}`}
      >
        <current.icon size={compact ? 11 : 13} className={current.color} />
        {current.label}
        <ChevronDown size={12} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 transition ${opt.value === value ? 'bg-gray-50' : ''}`}
            >
              <opt.icon size={14} className={opt.color} />
              <div>
                <p className="font-medium text-gray-800 text-xs">{opt.label}</p>
                <p className="text-[10px] text-gray-500">{opt.desc}</p>
              </div>
              {opt.value === value && <Check size={14} className="ml-auto text-blue-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Recipient Chip ──────────────────────────────────────────────────────── */
const RecipientChip = ({ recipient, role, onRoleChange, onRemove }) => {
  const TypeIcon = recipient.type === 'team' ? Users : recipient.type === 'email' ? Mail : User;
  const bg = recipient.type === 'team' ? 'bg-emerald-50 text-emerald-700' : recipient.type === 'email' ? 'bg-orange-50 text-orange-700' : 'bg-blue-50 text-blue-700';

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
      <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs ${bg}`}>
        <TypeIcon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {recipient.full_name || recipient.name || recipient.username || recipient.invitation_email || recipient.display}
        </p>
        {recipient.email && <p className="text-[11px] text-gray-500 truncate">{recipient.email}</p>}
      </div>
      <RolePicker value={role} onChange={onRoleChange} compact />
      <button onClick={onRemove} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition">
        <X size={14} />
      </button>
    </div>
  );
};

/* ─── Share Row (active shares list) ──────────────────────────────────────── */
const ShareRow = ({ share, onRoleUpdate, onRevoke, onCopyLink, onResend }) => {
  const [busy, setBusy] = useState(false);
  const isLink = share.share_type === 'link';
  const isPending = (share.share_type === 'email' || share.share_type === 'phone') && !share.invitation_accepted;
  const isExpired = share.is_expired;

  const userInfo = share.shared_with_user_info || share.shared_with_user;
  const teamInfo = share.shared_with_team_info || share.shared_with_team;

  let name, subtitle, IconComp, iconBg;
  if (isLink) {
    name = 'Anyone with the link'; subtitle = share.expires_at ? `Expires ${new Date(share.expires_at).toLocaleDateString()}` : 'No expiration';
    IconComp = Globe; iconBg = 'bg-indigo-50 text-indigo-600';
  } else if (userInfo) {
    name = userInfo.full_name || userInfo.username || 'User'; subtitle = userInfo.email || '';
    IconComp = User; iconBg = 'bg-blue-50 text-blue-600';
  } else if (teamInfo) {
    name = teamInfo.name; subtitle = `${teamInfo.member_count || 0} members`;
    IconComp = Users; iconBg = 'bg-emerald-50 text-emerald-600';
  } else if (share.invitation_email) {
    name = share.invitation_email; subtitle = isPending ? 'Pending invitation' : 'Accepted';
    IconComp = Mail; iconBg = 'bg-orange-50 text-orange-600';
  } else {
    name = 'Unknown'; subtitle = ''; IconComp = User; iconBg = 'bg-gray-100 text-gray-600';
  }

  const handleRole = async (r) => { setBusy(true); try { await onRoleUpdate(share.id, r); } finally { setBusy(false); } };

  return (
    <div className={`flex items-center gap-2.5 py-2 ${isExpired ? 'opacity-50' : ''}`}>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${iconBg}`}>
        <IconComp size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
        <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1">
        {isPending && onResend && (
          <button onClick={() => onResend(share.id)} className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition" title="Resend"><Send size={13} /></button>
        )}
        {isLink && share.invitation_token && onCopyLink && (
          <button onClick={() => onCopyLink(share.id, share.invitation_token)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition" title="Copy link"><Copy size={13} /></button>
        )}
        {!isExpired && <RolePicker value={share.role} onChange={handleRole} compact disabled={busy} />}
        <button onClick={() => onRevoke(share.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition" title="Remove"><Trash2 size={13} /></button>
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════════
   Main ShareDialog
   ═════════════════════════════════════════════════════════════════════════════ */
const ShareDialog = ({ isOpen, onClose, contentType, objectId, contentTitle, onShareCreated }) => {
  const [tab, setTab] = useState('people');

  // People tab
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('user');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recipients, setRecipients] = useState([]);

  // Link tab
  const [linkRole, setLinkRole] = useState('viewer');
  const [linkExpiry, setLinkExpiry] = useState(null);
  const [createdLink, setCreatedLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // General
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const searchTimer = useRef(null);
  const inputRef = useRef(null);

  const { shares, createShare, updateShare, revokeShare, resendInvitation, copyShareLink } = useSharing(
    contentType, objectId, { onError: (_, msg) => setError(msg) }
  );

  // Focus + reset
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
    if (!isOpen) { setQuery(''); setSearchResults([]); setRecipients([]); setCreatedLink(null); setLinkCopied(false); setError(null); setTab('people'); }
  }, [isOpen]);

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [isOpen, onClose]);

  // Search
  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const fn = searchType === 'team' ? sharingService.searchTeams : sharingService.searchOrganizationUsers;
      setSearchResults((await fn(q)) || []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [searchType]);

  const onQueryChange = (e) => {
    setQuery(e.target.value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(e.target.value), 300);
  };

  // Recipients
  const addRecipient = (item) => {
    const type = item.type || searchType;
    if (recipients.some(r => (r.type === type && r.id === item.id) || (type === 'email' && r.invitation_email === item.invitation_email))) return;
    setRecipients(prev => [...prev, { ...item, type, role: 'viewer' }]);
    setQuery(''); setSearchResults([]); inputRef.current?.focus();
  };

  const emailInvite = () => {
    if (!VALIDATION.EMAIL.test(query.trim())) return;
    addRecipient({ type: 'email', invitation_email: query.trim(), display: query.trim() });
  };

  // Send
  const handleSend = async () => {
    if (!recipients.length) return;
    setSubmitting(true); setError(null);
    try {
      for (const r of recipients) {
        const d = { share_type: r.type, role: r.role };
        if (r.type === 'user') d.shared_with_user = r.id;
        else if (r.type === 'team') d.shared_with_team = r.id;
        else if (r.type === 'email') d.invitation_email = r.invitation_email;
        await createShare(d);
      }
      setRecipients([]); onShareCreated?.();
    } catch (e) { setError(e?.response?.data?.detail || e?.message || 'Failed to share'); }
    finally { setSubmitting(false); }
  };

  // Link
  const handleCreateLink = async () => {
    setSubmitting(true); setError(null);
    try {
      const result = await createShare({
        share_type: 'link', public_link: true, role: linkRole,
        expires_at: linkExpiry ? new Date(Date.now() + linkExpiry * 86400000).toISOString() : undefined,
      });
      setCreatedLink(result); onShareCreated?.(result);
    } catch (e) { setError(e?.response?.data?.detail || e?.message || 'Failed to create link'); }
    finally { setSubmitting(false); }
  };

  const doCopyLink = async () => {
    const url = createdLink.invitation_link || `${window.location.origin}/shared/${createdLink.invitation_token}`;
    try { await navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } catch {}
  };

  if (!isOpen) return null;
  const isEmailQ = VALIDATION.EMAIL.test(query.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Share</h2>
            {contentTitle && <p className="text-xs text-gray-500 truncate mt-0.5">&ldquo;{contentTitle}&rdquo;</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {[
            { id: 'people', label: 'People', Icon: UserPlus },
            { id: 'link',   label: 'Get Link', Icon: Link2 },
          ].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition ${tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)}><X size={14} className="text-red-400 hover:text-red-600" /></button>
            </div>
          )}

          {/* People Tab */}
          {tab === 'people' && (
            <>
              {/* Type toggle */}
              <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg w-fit">
                {[
                  { id: 'user',  label: 'Users', Icon: User },
                  { id: 'team',  label: 'Teams', Icon: Users },
                  { id: 'email', label: 'Email', Icon: Mail },
                ].map(({ id, label, Icon }) => (
                  <button key={id}
                    onClick={() => { setSearchType(id); setQuery(''); setSearchResults([]); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${searchType === id ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                  ><Icon size={12} />{label}</button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input ref={inputRef} value={query} onChange={onQueryChange}
                  onKeyDown={e => { if (e.key === 'Enter' && searchType === 'email' && isEmailQ) { e.preventDefault(); emailInvite(); } }}
                  placeholder={searchType === 'email' ? 'Enter email address…' : searchType === 'team' ? 'Search teams…' : 'Search people by name or email…'}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition"
                />
                {searching && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
              </div>

              {/* Results */}
              {searchResults.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                  {searchResults.map((item, idx) => {
                    const isUser = searchType === 'user' || item.type === 'user';
                    return (
                      <button key={item.id || idx} onClick={() => addRecipient(item)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-blue-50 transition border-b border-gray-100 last:border-0">
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${isUser ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                          {isUser ? <User size={13} /> : <Users size={13} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{item.full_name || item.name || item.username}</p>
                          <p className="text-[11px] text-gray-500 truncate">{isUser ? item.email : `${item.member_count || 0} members`}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Email invite */}
              {searchType === 'email' && isEmailQ && (
                <button onClick={emailInvite} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition">
                  <Mail size={15} className="text-orange-500" />
                  Invite <span className="font-medium text-gray-800">{query.trim()}</span> via email
                </button>
              )}

              {/* Recipients */}
              {recipients.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</p>
                  {recipients.map((r, i) => (
                    <RecipientChip key={`${r.type}-${r.id || r.invitation_email || i}`}
                      recipient={r} role={r.role}
                      onRoleChange={role => setRecipients(prev => prev.map((x, j) => j === i ? { ...x, role } : x))}
                      onRemove={() => setRecipients(prev => prev.filter((_, j) => j !== i))} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Link Tab */}
          {tab === 'link' && (
            <>
              {createdLink ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-700"><Check size={16} className="text-emerald-600" /><span className="font-medium">Link created!</span></div>
                  <div className="flex items-center gap-2">
                    <input readOnly value={createdLink.invitation_link || `${window.location.origin}/shared/${createdLink.invitation_token}`}
                      className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-gray-700" onClick={e => e.target.select()} />
                    <button onClick={doCopyLink} className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition ${linkCopied ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                      {linkCopied ? <Check size={13} /> : <Copy size={13} />}{linkCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Shield size={11} />{createdLink.role}</span>
                    {createdLink.expires_at && <span className="flex items-center gap-1"><Clock size={11} />Expires {new Date(createdLink.expires_at).toLocaleDateString()}</span>}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50/60 border border-blue-100">
                    <Globe size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">Public link</p>
                      <p className="text-xs text-blue-700 mt-0.5">Anyone with this link can access the {contentType}.</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-700">Permission</label>
                    <RolePicker value={linkRole} onChange={setLinkRole} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-700">Expiration</label>
                    <select value={linkExpiry || ''} onChange={e => setLinkExpiry(e.target.value ? parseInt(e.target.value) : null)}
                      className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                      {EXPIRATION_PERIODS.map(p => <option key={p.value || 'never'} value={p.value || ''}>{p.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Active shares */}
          {shares.length > 0 && (
            <div className="border-t border-gray-100 pt-3 mt-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">People with access ({shares.length})</p>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {shares.map(s => (
                  <ShareRow key={s.id} share={s}
                    onRoleUpdate={(id, r) => updateShare(id, { role: r })}
                    onRevoke={id => { if (window.confirm('Remove access?')) revokeShare(id); }}
                    onCopyLink={copyShareLink}
                    onResend={resendInvitation} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition">
            {createdLink ? 'Done' : 'Cancel'}
          </button>
          {tab === 'people' && !createdLink && (
            <button onClick={handleSend} disabled={!recipients.length || submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Share{recipients.length > 1 ? ` (${recipients.length})` : ''}
            </button>
          )}
          {tab === 'link' && !createdLink && (
            <button onClick={handleCreateLink} disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Create Link
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;
