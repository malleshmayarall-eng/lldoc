/**
 * DocumentViewerPage — Unified external document viewer.
 *
 * Handles BOTH:
 *   - New ViewerToken tokens (viewer app)
 *   - Legacy Share model invitation_token (sharing app)
 *
 * Flow:
 *   1. Resolve token via /api/viewer/resolve/<token>/
 *   2. If public → show PDF immediately
 *   3. If password-protected → password gate → then PDF
 *   4. If email_otp → OTP gate → then PDF
 *   5. If invite_only → accept gate → then PDF
 *
 * No sidebar, no menus — just the document PDF + optional AI chat.
 * Minimal, clean, Tailwind-only.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  FileText,
  Lock,
  Mail,
  Send,
  MessageSquare,
  X,
  Eye,
  Download,
  ChevronDown,
  Bot,
  User,
} from 'lucide-react';
import {
  resolveViewerToken,
  getPublicPdfUrl,
  getLegacyPdfUrl,
  getAuthenticatedPdfUrl,
  sendOTP,
  verifyOTP,
  verifyPassword,
  acceptInvitation,
  sendViewerAIChat,
  setViewerSession,
  getViewerSession,
  clearViewerSession,
  isViewerAuthenticated,
} from '../services/viewerService';
import CommentatorViewerPage from './CommentatorViewerPage';

// ═══════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════

const DocumentViewerPage = () => {
  const { token } = useParams();

  // State machine: 'loading' | 'error' | 'auth_gate' | 'viewing'
  const [stage, setStage] = useState('loading');
  const [tokenInfo, setTokenInfo] = useState(null);
  const [error, setError] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [showChat, setShowChat] = useState(false);

  // ── Resolve token on mount ──
  useEffect(() => {
    if (!token) {
      setError('No token provided.');
      setStage('error');
      return;
    }

    let cancelled = false;

    const resolve = async () => {
      try {
        const info = await resolveViewerToken(token);

        if (cancelled) return;

        if (!info.valid) {
          setError(info.error || 'Invalid link.');
          setStage('error');
          return;
        }

        setTokenInfo(info);

        // Commentators always go through auth → commentator page
        const isCommentator = ['commentator', 'commenter'].includes(info.role) || (info.allowed_actions && info.allowed_actions.includes('comment'));

        // Determine if we can show PDF directly
        if (info.token_type === 'legacy_share') {
          // Legacy share links are always public
          if (info.access_mode === 'public') {
            if (isCommentator) {
              setStage('commentator');
            } else {
              setPdfUrl(getLegacyPdfUrl(token));
              setStage('viewing');
            }
          } else if (info.requires_invitation_accept) {
            setStage('auth_gate');
          } else {
            if (isCommentator) {
              setStage('commentator');
            } else {
              setPdfUrl(getLegacyPdfUrl(token));
              setStage('viewing');
            }
          }
        } else {
          // New ViewerToken
          if (info.access_mode === 'public' && !info.requires_password) {
            if (isCommentator) {
              setStage('commentator');
            } else {
              setPdfUrl(getPublicPdfUrl(token));
              setStage('viewing');
            }
          } else if (isViewerAuthenticated()) {
            if (isCommentator) {
              setStage('commentator');
            } else {
              setPdfUrl(getAuthenticatedPdfUrl());
              setStage('viewing');
            }
          } else {
            setStage('auth_gate');
          }
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err.response?.data?.error ||
          err.response?.data?.detail ||
          'Failed to load shared content.';
        setError(msg);
        setStage('error');
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [token]);

  // ── After auth, switch to viewing ──
  const handleAuthSuccess = useCallback(() => {
    // Commentators go to the commentator page (structure + comments)
    if (['commentator', 'commenter'].includes(tokenInfo?.role) || tokenInfo?.allowed_actions?.includes('comment')) {
      setStage('commentator');
      return;
    }
    if (tokenInfo?.token_type === 'legacy_share') {
      setPdfUrl(getLegacyPdfUrl(token));
    } else {
      setPdfUrl(getAuthenticatedPdfUrl());
    }
    setStage('viewing');
  }, [token, tokenInfo]);

  // ── Render ──
  if (stage === 'loading') return <LoadingScreen />;
  if (stage === 'error') return <ErrorScreen message={error} />;

  if (stage === 'auth_gate') {
    return (
      <AuthGate
        token={token}
        tokenInfo={tokenInfo}
        onSuccess={handleAuthSuccess}
        onError={(msg) => { setError(msg); setStage('error'); }}
      />
    );
  }

  // Commentator role → full structure + comments page
  if (stage === 'commentator') {
    return <CommentatorViewerPage />;
  }

  // stage === 'viewing'
  return (
    <ViewerShell
      tokenInfo={tokenInfo}
      pdfUrl={pdfUrl}
      token={token}
      showChat={showChat}
      onToggleChat={() => setShowChat((v) => !v)}
    />
  );
};


// ═══════════════════════════════════════════════════════════════════════
// LOADING SCREEN
// ═══════════════════════════════════════════════════════════════════════

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
      <Loader2 size={40} className="mx-auto text-blue-500 animate-spin mb-4" />
      <p className="text-gray-500 text-sm">Loading document…</p>
    </div>
  </div>
);


// ═══════════════════════════════════════════════════════════════════════
// ERROR SCREEN
// ═══════════════════════════════════════════════════════════════════════

const ErrorScreen = ({ message }) => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
      <AlertCircle size={48} className="mx-auto text-red-400 mb-4" />
      <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to Access</h2>
      <p className="text-gray-600 mb-6">{message}</p>
    </div>
  </div>
);


// ═══════════════════════════════════════════════════════════════════════
// AUTH GATE — password / OTP / invitation accept
// ═══════════════════════════════════════════════════════════════════════

const AuthGate = ({ token, tokenInfo, onSuccess, onError }) => {
  const { requires_password, requires_otp, requires_invitation_accept, access_mode } = tokenInfo;

  // Password-protected public token
  if (requires_password && !requires_otp && !requires_invitation_accept) {
    return (
      <GateWrapper tokenInfo={tokenInfo}>
        <PasswordGate token={token} onSuccess={onSuccess} onError={onError} />
      </GateWrapper>
    );
  }

  // Email OTP
  if (requires_otp || access_mode === 'email_otp') {
    return (
      <GateWrapper tokenInfo={tokenInfo}>
        <OTPGate
          token={token}
          tokenInfo={tokenInfo}
          onSuccess={onSuccess}
          onError={onError}
        />
      </GateWrapper>
    );
  }

  // Invitation accept
  if (requires_invitation_accept || access_mode === 'invite_only') {
    return (
      <GateWrapper tokenInfo={tokenInfo}>
        <InvitationGate
          token={token}
          tokenInfo={tokenInfo}
          onSuccess={onSuccess}
          onError={onError}
        />
      </GateWrapper>
    );
  }

  // Fallback: password
  return (
    <GateWrapper tokenInfo={tokenInfo}>
      <PasswordGate token={token} onSuccess={onSuccess} onError={onError} />
    </GateWrapper>
  );
};

const GateWrapper = ({ tokenInfo, children }) => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div className="max-w-md w-full">
      {/* Document info card */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <FileText size={24} />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">
                {tokenInfo.document_title || 'Shared Document'}
              </h1>
              {tokenInfo.shared_by && (
                <p className="text-blue-100 text-sm mt-0.5">
                  Shared by {tokenInfo.shared_by}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  </div>
);


// ── Password Gate ──

const PasswordGate = ({ token, onSuccess, onError }) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await verifyPassword(token, password);
      onSuccess();
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Invalid password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 text-gray-600 mb-4">
        <Lock size={16} />
        <span className="text-sm font-medium">Password required</span>
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter password"
        autoFocus
        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
      />
      {err && <p className="text-red-500 text-xs mt-2">{err}</p>}
      <button
        type="submit"
        disabled={loading || !password.trim()}
        className="mt-4 w-full py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
        {loading ? 'Verifying…' : 'Unlock Document'}
      </button>
    </form>
  );
};


// ── OTP Gate ──

const OTPGate = ({ token, tokenInfo, onSuccess, onError }) => {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState(tokenInfo.recipient_name ? '' : '');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleSendOTP = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await sendOTP(token, email);
      setStep('code');
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await verifyOTP(token, email, otp);
      onSuccess();
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Invalid code.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'email') {
    return (
      <form onSubmit={handleSendOTP}>
        <div className="flex items-center gap-2 text-gray-600 mb-4">
          <Mail size={16} />
          <span className="text-sm font-medium">Email verification required</span>
        </div>
        <p className="text-gray-500 text-xs mb-4">
          Enter your email to receive a one-time verification code.
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          autoFocus
          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
        />
        {err && <p className="text-red-500 text-xs mt-2">{err}</p>}
        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="mt-4 w-full py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {loading ? 'Sending…' : 'Send Verification Code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerifyOTP}>
      <div className="flex items-center gap-2 text-gray-600 mb-4">
        <Mail size={16} />
        <span className="text-sm font-medium">Enter verification code</span>
      </div>
      <p className="text-gray-500 text-xs mb-4">
        Code sent to <strong>{email}</strong>. Check your inbox.
      </p>
      <input
        type="text"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        maxLength={6}
        autoFocus
        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm text-center tracking-[0.5em] font-mono text-lg"
      />
      {err && <p className="text-red-500 text-xs mt-2">{err}</p>}
      <button
        type="submit"
        disabled={loading || otp.length !== 6}
        className="mt-4 w-full py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
        {loading ? 'Verifying…' : 'Verify & View Document'}
      </button>
      <button
        type="button"
        onClick={() => { setStep('email'); setOtp(''); setErr(''); }}
        className="mt-2 w-full text-center text-xs text-gray-500 hover:text-gray-700"
      >
        Use a different email
      </button>
    </form>
  );
};


// ── Invitation Gate ──

const InvitationGate = ({ token, tokenInfo, onSuccess, onError }) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErr('');
    try {
      await acceptInvitation(token, email);
      onSuccess();
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Failed to accept invitation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleAccept}>
      <div className="flex items-center gap-2 text-gray-600 mb-4">
        <Mail size={16} />
        <span className="text-sm font-medium">Accept invitation</span>
      </div>
      <p className="text-gray-500 text-xs mb-4">
        Enter your email to accept this invitation and view the document.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        autoFocus
        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
      />
      {err && <p className="text-red-500 text-xs mt-2">{err}</p>}
      <button
        type="submit"
        disabled={loading || !email.trim()}
        className="mt-4 w-full py-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
        {loading ? 'Accepting…' : 'Accept & View Document'}
      </button>
    </form>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// VIEWER SHELL — PDF embed + header + AI chat FAB
// ═══════════════════════════════════════════════════════════════════════

const ViewerShell = ({ tokenInfo, pdfUrl, token, showChat, onToggleChat }) => {
  const hasAIChat = tokenInfo?.allowed_actions?.includes('ai_chat');

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* Minimal header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <FileText size={20} className="text-blue-600 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">
              {tokenInfo?.document_title || 'Document'}
            </h1>
            {tokenInfo?.shared_by && (
              <p className="text-xs text-gray-500 truncate">
                Shared by {tokenInfo.shared_by}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Role badge */}
          <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            <Eye size={12} />
            {tokenInfo?.role || 'viewer'}
          </span>

          {/* Download button */}
          <a
            href={pdfUrl + (pdfUrl.includes('?') ? '&' : '?') + 'download=1'}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
            title="Download PDF"
          >
            <Download size={18} />
          </a>

          {/* AI Chat toggle */}
          {hasAIChat && (
            <button
              onClick={onToggleChat}
              className={`p-2 rounded-lg transition ${
                showChat
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
              title="AI Chat"
            >
              <MessageSquare size={18} />
            </button>
          )}
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF embed */}
        <div className={`flex-1 transition-all duration-300 ${showChat ? 'mr-0' : ''}`}>
          <iframe
            src={pdfUrl}
            title="Document PDF"
            className="w-full h-full border-0"
            style={{ minHeight: 'calc(100vh - 57px)' }}
          />
        </div>

        {/* AI Chat panel */}
        {showChat && hasAIChat && (
          <AIChatPanel
            token={token}
            tokenInfo={tokenInfo}
            onClose={onToggleChat}
          />
        )}
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════
// AI CHAT PANEL
// ═══════════════════════════════════════════════════════════════════════

const AIChatPanel = ({ token, tokenInfo, onClose }) => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hi! I can help you understand this document. Ask me anything about "${tokenInfo?.document_title || 'the document'}".`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const sessionToken = localStorage.getItem('viewer_session_token');
      const result = await sendViewerAIChat({
        viewerToken: tokenInfo?.token_type === 'viewer_token' ? token : undefined,
        sessionToken: sessionToken || undefined,
        message: userMessage,
        conversationHistory: messages.filter((m) => m.role !== 'assistant' || messages.indexOf(m) > 0).map((m) => ({
          role: m.role,
          parts: [{ text: m.content }],
        })),
      });

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.response || result.message || 'No response.' },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I couldn\'t process your request. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-80 lg:w-96 border-l border-gray-200 bg-white flex flex-col flex-shrink-0">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">AI Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={14} className="text-blue-600" />
              </div>
            )}
            <div
              className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User size={14} className="text-gray-600" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 items-start">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Bot size={14} className="text-blue-600" />
            </div>
            <div className="bg-gray-100 rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="px-3 py-3 border-t border-gray-200">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the document…"
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
};

export default DocumentViewerPage;
