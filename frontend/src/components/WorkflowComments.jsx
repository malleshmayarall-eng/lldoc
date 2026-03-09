import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { MessageSquare, Send, CheckCircle, User, Clock } from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';
import { useAuth } from '../contexts/AuthContext';

const WorkflowComments = ({ workflowId, compact = false }) => {
  const { user } = useAuth();
  const {
    comments,
    loading,
    fetchComments,
    createComment,
    resolveComment,
    deleteComment
  } = useWorkflowStore();

  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState('general');
  const [mentions, setMentions] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);

  useEffect(() => {
    if (workflowId) {
      fetchComments({ workflow: workflowId });
    }
  }, [workflowId, fetchComments]);

  const workflowComments = comments.filter(c => c.workflow === workflowId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      await createComment({
        workflow: workflowId,
        comment: newComment,
        comment_type: commentType,
        mentions: mentions.map(m => m.id),
      });
      setNewComment('');
      setMentions([]);
      setCommentType('general');
      if (compact) setShowCommentForm(false);
    } catch (err) {
      console.error('Error creating comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolve = async (commentId) => {
    try {
      await resolveComment(commentId);
    } catch (err) {
      console.error('Error resolving comment:', err);
    }
  };

  const handleDelete = async (commentId) => {
    if (confirm('Delete this comment?')) {
      try {
        await deleteComment(commentId);
      } catch (err) {
        console.error('Error deleting comment:', err);
      }
    }
  };

  const getCommentTypeColor = (type) => {
    const colors = {
      general: 'bg-gray-100 text-gray-800',
      question: 'bg-blue-100 text-blue-800',
      clarification: 'bg-purple-100 text-purple-800',
      update: 'bg-green-100 text-green-800',
      issue: 'bg-red-100 text-red-800',
    };
    return colors[type] || colors.general;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };
  
  // Compact mode for inline display in document editor
  if (compact) {
    if (workflowComments.length === 0 && !showCommentForm) {
      return (
        <button
          onClick={() => setShowCommentForm(true)}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <MessageSquare size={12} />
          Add comment
        </button>
      );
    }
    
    return (
      <div className="space-y-2">
        {/* Show last 2 comments */}
        {workflowComments.slice(-2).map((comment) => (
          <div key={comment.id} className="bg-gray-50/50 rounded px-2 py-1.5 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-gray-700">
                    {comment.user_name || 'Unknown'}
                  </span>
                  <span className="text-gray-400">{formatDate(comment.created_at)}</span>
                </div>
                <p className="text-gray-600 leading-relaxed">{comment.comment}</p>
              </div>
              {comment.is_resolved && (
                <CheckCircle size={12} className="text-green-600 flex-shrink-0" />
              )}
            </div>
          </div>
        ))}
        
        {/* Comment form */}
        {showCommentForm ? (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-300"
              autoFocus
            />
            <button
              type="submit"
              disabled={!newComment.trim() || isSubmitting}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded disabled:opacity-50"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCommentForm(false);
                setNewComment('');
              }}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </form>
        ) : workflowComments.length > 0 && (
          <button
            onClick={() => setShowCommentForm(true)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Reply...
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border">
      {/* Header */}
      <div className="px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-gray-600" />
          <h2 className="text-xl font-semibold text-gray-900">
            Comments ({workflowComments.length})
          </h2>
        </div>
      </div>

      {/* Comments List */}
      <div className="px-6 py-4 space-y-4 max-h-96 overflow-y-auto">
        {loading.comments ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : workflowComments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No comments yet. Be the first to comment!</p>
          </div>
        ) : (
          workflowComments.map((comment) => (
            <div
              key={comment.id}
              className={`p-4 rounded-lg ${
                comment.is_resolved ? 'bg-gray-50 opacity-75' : 'bg-white border'
              }`}
            >
              {/* Comment Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <User className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {comment.user_info?.username || 'Unknown User'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock className="w-3 h-3" />
                      {formatDate(comment.created_at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getCommentTypeColor(comment.comment_type)}`}>
                    {comment.comment_type}
                  </span>
                  {comment.is_resolved && (
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Resolved
                    </span>
                  )}
                </div>
              </div>

              {/* Comment Content */}
              <p className="text-gray-700 whitespace-pre-wrap mb-3">{comment.comment}</p>

              {/* Mentions */}
              {comment.mentions && comment.mentions.length > 0 && (
                <div className="flex items-center gap-2 mb-3 text-sm text-gray-600">
                  <User className="w-4 h-4" />
                  <span>Mentioned:</span>
                  {comment.mentions.map((mention, idx) => (
                    <span key={idx} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                      @{mention.username}
                    </span>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {!comment.is_resolved && comment.user === user?.id && (
                  <button
                    onClick={() => handleResolve(comment.id)}
                    className="text-sm text-green-600 hover:text-green-700 font-medium"
                  >
                    Mark as Resolved
                  </button>
                )}
                {comment.user === user?.id && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-sm text-red-600 hover:text-red-700 font-medium"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* New Comment Form */}
      <div className="px-6 py-4 border-t bg-gray-50">
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <select
              value={commentType}
              onChange={(e) => setCommentType(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="general">General</option>
              <option value="question">Question</option>
              <option value="clarification">Clarification</option>
              <option value="update">Update</option>
              <option value="issue">Issue</option>
            </select>
          </div>

          <div className="flex gap-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment... (use @username to mention)"
              rows={3}
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <button
              type="submit"
              disabled={isSubmitting || !newComment.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {isSubmitting ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

WorkflowComments.propTypes = {
  workflowId: PropTypes.string.isRequired,
  compact: PropTypes.bool,
};

export default WorkflowComments;
