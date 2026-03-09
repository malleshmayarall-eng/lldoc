import { useState } from 'react';
import {
  X,
  Send,
  Mail,
  Plus,
  Trash2,
  Share2,
  UserCheck,
  MessageSquare,
  Eye,
  Loader2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { shareForApproval } from '../services/viewerService';

/**
 * ShareForApprovalDialog — Modal for sharing a document with external
 * reviewers/approvers via email. Creates ViewerTokens and sends invitations.
 *
 * Props:
 *   isOpen       — boolean, controls visibility
 *   onClose      — () => void
 *   documentId   — UUID string of the document to share
 *   documentTitle — string, for display purposes
 */
const ShareForApprovalDialog = ({ isOpen, onClose, documentId, documentTitle }) => {
  const [emails, setEmails] = useState(['']);
  const [role, setRole] = useState('commentator');
  const [accessMode, setAccessMode] = useState('email_otp');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const addEmail = () => {
    setEmails(prev => [...prev, '']);
  };

  const removeEmail = (index) => {
    setEmails(prev => prev.filter((_, i) => i !== index));
  };

  const updateEmail = (index, value) => {
    setEmails(prev => prev.map((e, i) => (i === index ? value : e)));
  };

  const handleSend = async () => {
    const validEmails = emails
      .map(e => e.trim().toLowerCase())
      .filter(e => e && e.includes('@'));

    if (validEmails.length === 0) {
      setError('Please enter at least one valid email address.');
      return;
    }

    setError('');
    setSending(true);
    setResult(null);

    try {
      const data = await shareForApproval({
        document_id: documentId,
        emails: validEmails,
        role,
        access_mode: accessMode,
        message,
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to share document. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setEmails(['']);
    setRole('commentator');
    setAccessMode('email_otp');
    setMessage('');
    setResult(null);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50" onClick={handleClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-purple-600 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Share2 className="h-5 w-5" />
                <div>
                  <h2 className="text-lg font-semibold">Share for Review</h2>
                  <p className="text-sm text-blue-100 truncate max-w-[300px]">
                    {documentTitle || 'Untitled Document'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Success Result */}
            {result && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                  <CheckCircle className="h-5 w-5" />
                  Shared with {result.count} recipient{result.count !== 1 ? 's' : ''}!
                </div>
                <div className="space-y-1">
                  {result.tokens?.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-sm text-green-600">
                      <Mail className="h-3.5 w-3.5" />
                      <span>{t.email}</span>
                      <span className="text-green-500 text-xs">
                        ({t.is_new ? 'new invitation' : 'updated'})
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleClose}
                  className="mt-3 text-sm text-green-700 hover:text-green-800 font-medium"
                >
                  Done
                </button>
              </div>
            )}

            {/* Email Inputs */}
            {!result && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    <Mail className="inline h-4 w-4 mr-1" />
                    Email Addresses
                  </label>
                  <div className="space-y-2">
                    {emails.map((email, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => updateEmail(i, e.target.value)}
                          placeholder="reviewer@example.com"
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        {emails.length > 1 && (
                          <button
                            onClick={() => removeEmail(i)}
                            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addEmail}
                    className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Plus className="h-4 w-4" />
                    Add another email
                  </button>
                </div>

                {/* Role Selection */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Access Role
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setRole('viewer')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium ${
                        role === 'viewer'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Eye className="h-5 w-5" />
                      Viewer
                    </button>
                    <button
                      onClick={() => setRole('commentator')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium ${
                        role === 'commentator'
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <MessageSquare className="h-5 w-5" />
                      Commentator
                    </button>
                    <button
                      onClick={() => setRole('approver')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium ${
                        role === 'approver'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <UserCheck className="h-5 w-5" />
                      Approver
                    </button>
                  </div>
                </div>

                {/* Access Mode */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Authentication
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setAccessMode('email_otp')}
                      className={`p-3 rounded-lg border-2 transition-all text-xs font-medium text-center ${
                        accessMode === 'email_otp'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      🔐 Email OTP
                      <span className="block text-[10px] text-gray-500 mt-0.5">Verify via one-time code</span>
                    </button>
                    <button
                      onClick={() => setAccessMode('invite_only')}
                      className={`p-3 rounded-lg border-2 transition-all text-xs font-medium text-center ${
                        accessMode === 'invite_only'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      ✉️ Invitation
                      <span className="block text-[10px] text-gray-500 mt-0.5">Accept invite to access</span>
                    </button>
                  </div>
                </div>

                {/* Personal Message */}
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    Personal Message <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Add a note for the reviewer..."
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!result && (
            <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sending ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ShareForApprovalDialog;
