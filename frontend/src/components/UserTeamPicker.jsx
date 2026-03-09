/**
 * UserTeamPicker Component — Modern Minimal UI
 *
 * Fuzzy search autocomplete for selecting users or teams.
 * Supports internal users, teams, and external email/phone invitations.
 * Lucide-react icons, responsive Tailwind, keyboard-navigable.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  User,
  Users,
  Mail,
  Phone,
  Search,
  Loader2,
  AlertCircle,
  Link2,
} from 'lucide-react';
import { useSearch } from '../hooks/useSharing';
import sharingService from '../services/sharingService';
import {
  SHARE_TYPES,
  VALIDATION,
  UI_CONFIG,
} from '../constants/sharingConstants';

const TAB_CONFIG = [
  { type: SHARE_TYPES.USER, label: 'Users', Icon: User },
  { type: SHARE_TYPES.TEAM, label: 'Teams', Icon: Users },
];

const UserTeamPicker = ({
  onSelect,
  shareType = SHARE_TYPES.USER,
  onShareTypeChange,
  placeholder,
  className = '',
  autoFocus = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const searchFunction =
    shareType === SHARE_TYPES.TEAM
      ? sharingService.searchTeams
      : sharingService.searchOrganizationUsers;

  const { results, loading, error, search, clearSearch } = useSearch(searchFunction);

  /* ── Input change ── */
  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
    setShowDropdown(true);
    setSelectedIndex(0);
    if (value.length >= UI_CONFIG.MIN_SEARCH_LENGTH) search(value);
  };

  /* ── Selection ── */
  const handleSelect = (item) => {
    onSelect(
      shareType === SHARE_TYPES.EMAIL || shareType === SHARE_TYPES.PHONE
        ? { type: shareType, value: inputValue, ...item }
        : { type: shareType, ...item }
    );
    setInputValue('');
    setShowDropdown(false);
    clearSearch();
  };

  /* ── External invite ── */
  const handleExternalInvitation = () => {
    const value = inputValue.trim();
    if (shareType === SHARE_TYPES.EMAIL && VALIDATION.EMAIL.test(value)) {
      onSelect({ type: SHARE_TYPES.EMAIL, invitation_email: value, display: value });
    } else if (shareType === SHARE_TYPES.PHONE && VALIDATION.PHONE.test(value)) {
      onSelect({ type: SHARE_TYPES.PHONE, invitation_phone: value, display: value });
    } else {
      return;
    }
    setInputValue('');
    setShowDropdown(false);
  };

  /* ── Keyboard ── */
  const handleKeyDown = (e) => {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => Math.min(p + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => Math.max(p - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) handleSelect(results[selectedIndex]);
      else if ((shareType === SHARE_TYPES.EMAIL || shareType === SHARE_TYPES.PHONE) && inputValue.trim()) handleExternalInvitation();
    }
    else if (e.key === 'Escape') setShowDropdown(false);
  };

  /* ── Click-outside ── */
  useEffect(() => {
    const close = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) && inputRef.current && !inputRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  /* ── Auto-focus ── */
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const showExternalOption =
    (shareType === SHARE_TYPES.EMAIL || shareType === SHARE_TYPES.PHONE) &&
    inputValue.trim() &&
    (shareType === SHARE_TYPES.EMAIL ? VALIDATION.EMAIL.test(inputValue) : VALIDATION.PHONE.test(inputValue));

  return (
    <div className={`relative ${className}`}>
      {/* Share type tabs */}
      {onShareTypeChange && (
        <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg w-fit mb-3">
          {TAB_CONFIG.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => { onShareTypeChange(type); setInputValue(''); clearSearch(); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                shareType === type ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Search input (hidden for link type) */}
      {shareType !== SHARE_TYPES.LINK && (
        <div className="relative">
          <Search
            size={15}
            className={`absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 ${loading ? 'animate-pulse' : ''}`}
          />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            placeholder={
              placeholder ||
              `Search ${shareType === SHARE_TYPES.USER ? 'users' : shareType === SHARE_TYPES.TEAM ? 'teams' : shareType === SHARE_TYPES.EMAIL ? 'email addresses' : 'phone numbers'}…`
            }
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition"
          />
          {loading && (
            <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
          )}
        </div>
      )}

      {/* Dropdown */}
      {showDropdown &&
        (inputValue.length >= UI_CONFIG.MIN_SEARCH_LENGTH || showExternalOption) && (
          <div
            ref={dropdownRef}
            className="absolute z-50 mt-1 w-full bg-white rounded-lg border border-gray-200 shadow-lg max-h-60 overflow-auto"
          >
            {/* External invite option */}
            {showExternalOption && (
              <button
                onClick={handleExternalInvitation}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-blue-50 transition border-b border-gray-100"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                  {shareType === SHARE_TYPES.EMAIL ? <Mail size={14} /> : <Phone size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">Invite {inputValue.trim()}</p>
                  <p className="text-[11px] text-gray-500">Send external invitation</p>
                </div>
              </button>
            )}

            {/* Results */}
            {results.length > 0
              ? results.map((item, idx) => {
                  const isUser = shareType === SHARE_TYPES.USER;
                  return (
                    <button
                      key={item.id || idx}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition border-b border-gray-100 last:border-0 ${
                        idx === selectedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs ${
                          isUser ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                        }`}
                      >
                        {item.avatar_url ? (
                          <img src={item.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : isUser ? (
                          <User size={14} />
                        ) : (
                          <Users size={14} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {isUser ? item.full_name || item.username : item.name}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {isUser ? item.email : `${item.member_count || 0} members`}
                        </p>
                      </div>
                      {item.is_team_admin && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                          Admin
                        </span>
                      )}
                    </button>
                  );
                })
              : !loading &&
                inputValue.length >= UI_CONFIG.MIN_SEARCH_LENGTH &&
                !showExternalOption && (
                  <div className="px-4 py-8 text-center">
                    <Search size={24} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">
                      No {shareType === SHARE_TYPES.TEAM ? 'teams' : 'users'} found
                    </p>
                  </div>
                )}

            {error && (
              <div className="px-3 py-2.5 flex items-center gap-2 text-sm text-red-600">
                <AlertCircle size={14} />
                {error}
              </div>
            )}
          </div>
        )}
    </div>
  );
};

export default UserTeamPicker;
