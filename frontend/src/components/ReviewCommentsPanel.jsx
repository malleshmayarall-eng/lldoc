/**
 * ReviewCommentsPanel — Shows viewer/commentator comments in the document editor sidebar.
 *
 * The document owner (or org editors) can:
 *   - See all comments grouped by target element
 *   - Reply to any comment
 *   - Resolve / unresolve comment threads
 *   - Delete comments
 *   - Filter by resolved/unresolved
 *   - Filter by focused element (when clicking a comment badge on an element)
 *
 * Props:
 *   documentId           — UUID of the document
 *   focusedElementId     — (optional) element UUID to filter to
 *   focusedElementType   — (optional) element type string
 *   onClearFocus         — callback to clear the focused element filter
 *   onCommentCountsLoaded — callback({ elementId: { total, unresolved, target_type } })
 *
 * Uses Django session auth (not ViewerSession).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Send, CheckCircle, Circle, Trash2, RefreshCw,
  ChevronDown, ChevronRight, User, CornerDownRight,
  MessageCircle, AlertCircle, Loader2, X, Plus,
} from 'lucide-react';
import api from '../services/api';

// ── Helpers ──────────────────────────────────────────────────────────

const formatTimeAgo = (dateStr) => {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const TARGET_LABELS = {
  document: 'Document',
  section: 'Section',
  paragraph: 'Paragraph',
  table: 'Table',
  image: 'Image',
};

const TARGET_COLORS = {
  document: 'bg-blue-100 text-blue-700',
  section: 'bg-purple-100 text-purple-700',
  paragraph: 'bg-green-100 text-green-700',
  table: 'bg-amber-100 text-amber-700',
  image: 'bg-pink-100 text-pink-700',
};


// ── Main Panel ───────────────────────────────────────────────────────

const ReviewCommentsPanel = ({
  documentId,
  focusedElementId = null,
  focusedElementType = null,
  onClearFocus,
  onCommentCountsLoaded,
}) => {
  const [comments, setComments] = useState([]);
  const [stats, setStats] = useState({ total: 0, unresolved: 0, resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'unresolved' | 'resolved'
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [replyingTo, setReplyingTo] = useState(null); // comment id
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showNewComment, setShowNewComment] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentTargetType, setNewCommentTargetType] = useState('document');
  const [newCommentObjectId, setNewCommentObjectId] = useState('');

  // ── Load comments ──────────────────────────────────────────────

  const loadComments = useCallback(async () => {
    if (!documentId) return;
    try {
      setLoading(true);
      const { data } = await api.get(`/viewer/review-comments/${documentId}/`);
      setComments(data.comments || []);
      setStats({
        total: data.total || 0,
        unresolved: data.unresolved || 0,
        resolved: data.resolved || 0,
      });
      // Notify parent of per-element counts so badges can render
      if (onCommentCountsLoaded && data.counts_by_element) {
        onCommentCountsLoaded(data.counts_by_element);
      }
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load review comments.');
    } finally {
      setLoading(false);
    }
  }, [documentId, onCommentCountsLoaded]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!documentId) return;
    const interval = setInterval(loadComments, 30000);
    return () => clearInterval(interval);
  }, [documentId, loadComments]);

  // Auto-expand comments matching focusedElementId when it changes
  useEffect(() => {
    if (focusedElementId && comments.length > 0) {
      const matchingIds = new Set(
        comments
          .filter((c) => c.object_id === focusedElementId)
          .map((c) => c.id)
      );
      if (matchingIds.size > 0) {
        setExpandedIds(matchingIds);
      }
    }
  }, [focusedElementId, comments]);

  // Auto-populate new comment target when focused element changes
  useEffect(() => {
    if (focusedElementId && focusedElementType) {
      setNewCommentTargetType(focusedElementType);
      setNewCommentObjectId(focusedElementId);
    }
  }, [focusedElementId, focusedElementType]);

  // ── Handlers ───────────────────────────────────────────────────

  const handleCreateComment = async () => {
    if (!newCommentText.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/viewer/review-comments/${documentId}/create/`, {
        text: newCommentText.trim(),
        target_type: newCommentTargetType || 'document',
        object_id: newCommentObjectId || documentId,
      });
      setNewCommentText('');
      setShowNewComment(false);
      await loadComments();
    } catch (err) {
      console.error('Create comment failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/viewer/review-comments/${commentId}/reply/`, { text: replyText.trim() });
      setReplyText('');
      setReplyingTo(null);
      await loadComments();
    } catch (err) {
      console.error('Reply failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (commentId) => {
    try {
      await api.patch(`/viewer/review-comments/${commentId}/resolve/`);
      await loadComments();
    } catch (err) {
      console.error('Resolve failed:', err);
    }
  };

  const handleDelete = async (commentId) => {
    if (!confirm('Delete this comment and all its replies?')) return;
    try {
      await api.delete(`/viewer/review-comments/${commentId}/delete/`);
      await loadComments();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Filter comments ────────────────────────────────────────────

  const filteredComments = comments.filter((c) => {
    // Element focus filter
    if (focusedElementId && c.object_id !== focusedElementId) return false;
    // Status filter
    if (filter === 'unresolved') return !c.is_resolved;
    if (filter === 'resolved') return c.is_resolved;
    return true;
  });

  // Stats for the focused-element scope (used in the focus banner)
  const focusedStats = focusedElementId
    ? comments.reduce(
        (acc, c) => {
          if (c.object_id === focusedElementId) {
            acc.total += 1;
            if (c.is_resolved) acc.resolved += 1;
            else acc.unresolved += 1;
          }
          return acc;
        },
        { total: 0, resolved: 0, unresolved: 0 },
      )
    : null;

  // ── Render ─────────────────────────────────────────────────────

  if (loading && comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mb-2" />
        <span className="text-sm">Loading review comments…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-red-500">
        <AlertCircle className="w-6 h-6 mb-2" />
        <span className="text-sm">{error}</span>
        <button onClick={loadComments} className="mt-2 text-xs text-blue-600 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Stats bar ── */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <MessageSquare size={14} />
          <span className="font-semibold">{stats.total}</span>
          <span className="text-xs text-gray-400">total</span>
        </div>
        <div className="flex items-center gap-1 text-sm text-orange-600">
          <Circle size={12} fill="currentColor" />
          <span className="font-semibold">{stats.unresolved}</span>
          <span className="text-xs text-gray-400">open</span>
        </div>
        <div className="flex items-center gap-1 text-sm text-green-600">
          <CheckCircle size={12} />
          <span className="font-semibold">{stats.resolved}</span>
          <span className="text-xs text-gray-400">resolved</span>
        </div>
        <button
          onClick={loadComments}
          className="ml-auto p-1 rounded hover:bg-gray-100 text-gray-400"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── Focused-element banner ── */}
      {focusedElementId && (
        <div className="flex items-center gap-2 mb-3 px-2.5 py-2 rounded-lg bg-indigo-50 border border-indigo-200">
          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${
            TARGET_COLORS[focusedElementType] || 'bg-gray-100 text-gray-600'
          }`}>
            {TARGET_LABELS[focusedElementType] || focusedElementType || 'Element'}
          </span>
          <span className="text-xs text-indigo-700 font-medium">
            {focusedStats?.total || 0} comment{focusedStats?.total !== 1 ? 's' : ''}
            {focusedStats?.unresolved ? ` · ${focusedStats.unresolved} open` : ''}
          </span>
          {onClearFocus && (
            <button
              onClick={onClearFocus}
              className="ml-auto p-0.5 rounded hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600"
              title="Show all comments"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* ── Filter tabs ── */}
      <div className="flex gap-1 mb-3 p-0.5 bg-gray-100 rounded-lg">
        {[
          { key: 'all', label: 'All' },
          { key: 'unresolved', label: 'Open' },
          { key: 'resolved', label: 'Resolved' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
              filter === f.key
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── New comment form ── */}
      {showNewComment ? (
        <div className="mb-3 p-3 rounded-lg border border-blue-200 bg-blue-50/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-gray-600">Comment on:</span>
            <select
              value={newCommentTargetType}
              onChange={(e) => {
                setNewCommentTargetType(e.target.value);
                if (e.target.value === 'document') setNewCommentObjectId(documentId);
              }}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="document">Document</option>
              <option value="section">Section</option>
              <option value="paragraph">Paragraph</option>
              <option value="table">Table</option>
              <option value="image">Image</option>
            </select>
            {focusedElementId && newCommentTargetType !== 'document' && (
              <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${
                TARGET_COLORS[newCommentTargetType] || 'bg-gray-100 text-gray-600'
              }`}>
                {TARGET_LABELS[newCommentTargetType] || newCommentTargetType}
              </span>
            )}
          </div>
          <textarea
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder="Write your comment…"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCreateComment();
              }
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-gray-400">⌘+Enter to submit</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => { setShowNewComment(false); setNewCommentText(''); }}
                className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateComment}
                disabled={!newCommentText.trim() || submitting}
                className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={12} />
                {submitting ? 'Posting…' : 'Post Comment'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setShowNewComment(true);
            if (focusedElementId && focusedElementType) {
              setNewCommentTargetType(focusedElementType);
              setNewCommentObjectId(focusedElementId);
            } else {
              setNewCommentTargetType('document');
              setNewCommentObjectId(documentId);
            }
          }}
          className="flex items-center gap-1.5 w-full mb-3 px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 border-dashed rounded-lg transition-colors"
        >
          <Plus size={14} />
          Add Comment{focusedElementId ? ` on ${TARGET_LABELS[focusedElementType] || 'Element'}` : ''}
        </button>
      )}

      {/* ── Comment list ── */}
      <div className="flex-1 overflow-y-auto space-y-2 -mx-4 px-4">
        {filteredComments.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            {filter === 'all' ? 'No review comments yet.' : `No ${filter} comments.`}
          </div>
        ) : (
          filteredComments.map((comment) => {
            const isExpanded = expandedIds.has(comment.id);
            const replies = comment.replies || [];
            const hasReplies = replies.length > 0;

            return (
              <div
                key={comment.id}
                className={`rounded-lg border transition-colors ${
                  comment.is_resolved
                    ? 'border-green-200 bg-green-50/30'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {/* Comment header */}
                <div
                  className="flex items-start gap-2 px-3 py-2 cursor-pointer"
                  onClick={() => toggleExpand(comment.id)}
                >
                  <button className="mt-0.5 text-gray-400 flex-shrink-0">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        TARGET_COLORS[comment.target_type] || 'bg-gray-100 text-gray-600'
                      }`}>
                        {TARGET_LABELS[comment.target_type] || comment.target_type}
                      </span>
                      {comment.is_resolved && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 font-medium">
                          <CheckCircle size={10} /> Resolved
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 leading-snug line-clamp-2">
                      {comment.text}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <User size={10} />
                        {comment.author_name || comment.author_email?.split('@')[0] || 'Anonymous'}
                      </span>
                      <span>·</span>
                      <span>{formatTimeAgo(comment.created_at)}</span>
                      {hasReplies && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-0.5">
                            <CornerDownRight size={10} />
                            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-3 py-2">
                    {/* Full comment text */}
                    <div className="text-sm text-gray-700 mb-2 whitespace-pre-wrap">
                      {comment.text}
                    </div>

                    {/* Target info */}
                    {comment.target_title && (
                      <p className="text-xs text-gray-400 mb-2 italic">
                        On: {comment.target_title}
                      </p>
                    )}

                    {/* Replies */}
                    {hasReplies && (
                      <div className="space-y-2 mb-2 pl-3 border-l-2 border-gray-200">
                        {replies.map((reply) => (
                          <div key={reply.id} className="text-sm">
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-0.5">
                              <User size={10} />
                              <span className="font-medium">
                                {reply.author_name || reply.author_email?.split('@')[0] || 'Anonymous'}
                              </span>
                              {reply.metadata?.source === 'editor' && (
                                <span className="px-1 py-0 text-[9px] rounded bg-blue-100 text-blue-700 font-medium">
                                  Editor
                                </span>
                              )}
                              <span className="text-gray-300">·</span>
                              <span>{formatTimeAgo(reply.created_at)}</span>
                            </div>
                            <p className="text-gray-700 whitespace-pre-wrap">{reply.text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reply input */}
                    {replyingTo === comment.id ? (
                      <div className="flex items-end gap-2 mt-2">
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write a reply…"
                          className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                          rows={2}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleReply(comment.id);
                            }
                          }}
                        />
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleReply(comment.id)}
                            disabled={!replyText.trim() || submitting}
                            className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Send size={14} />
                          </button>
                          <button
                            onClick={() => { setReplyingTo(null); setReplyText(''); }}
                            className="p-1.5 rounded border border-gray-200 text-gray-400 hover:bg-gray-50"
                          >
                            <span className="text-xs">✕</span>
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); setReplyingTo(comment.id); setReplyText(''); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      >
                        <MessageCircle size={12} />
                        Reply
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(comment.id); }}
                        className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                          comment.is_resolved
                            ? 'text-green-600 hover:text-orange-600 hover:bg-orange-50'
                            : 'text-gray-500 hover:text-green-600 hover:bg-green-50'
                        }`}
                      >
                        <CheckCircle size={12} />
                        {comment.is_resolved ? 'Unresolve' : 'Resolve'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(comment.id); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors ml-auto"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ReviewCommentsPanel;
