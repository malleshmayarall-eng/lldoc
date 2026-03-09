/**
 * PublicUpload — Shareable public upload page
 * ============================================
 * Anyone with the link can upload documents to a workflow.
 * URL: /upload/:token
 * No authentication required (but may require OTP verification).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Upload, FileText, CheckCircle, AlertCircle, Loader2,
  X, Lock, CloudUpload, File, Trash2, Info,
  Mail, Phone, ShieldCheck, ArrowRight,
} from 'lucide-react';
import { publicUploadApi } from '@services/clm/clmApi';

// ── Helpers ──────────────────────────────────────────────────────────────

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['zip', 'rar', '7z'].includes(ext)) return '📦';
  return '📎';
}

// ── OTP Verification Screen ─────────────────────────────────────────────

function OTPVerification({ token, requireLogin, onVerified }) {
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('input'); // input | code
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const codeInputRef = useRef(null);

  const isEmail = requireLogin === 'email_otp';

  const handleSendOtp = async () => {
    if (!identifier.trim()) return;
    setSending(true);
    setError('');
    try {
      const { data } = await publicUploadApi.sendOtp(token, identifier.trim());
      setMessage(data.message);
      setStep('code');
      setTimeout(() => codeInputRef.current?.focus(), 100);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send verification code.');
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!code.trim()) return;
    setVerifying(true);
    setError('');
    try {
      const { data } = await publicUploadApi.verifyOtp(token, identifier.trim(), code.trim());
      onVerified(data.session_token, data.identifier);
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setSending(true);
    setError('');
    setCode('');
    try {
      const { data } = await publicUploadApi.sendOtp(token, identifier.trim());
      setMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
              {isEmail ? <Mail className="w-5 h-5 text-blue-600" /> : <Phone className="w-5 h-5 text-purple-600" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-800">Verify Your Identity</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isEmail
                  ? 'Enter your email to receive a verification code'
                  : 'Enter your phone number to receive a verification code'
                }
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {step === 'input' ? (
            <>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {isEmail ? 'Email address' : 'Phone number'}
              </label>
              <div className="flex gap-2">
                <input
                  type={isEmail ? 'email' : 'tel'}
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder={isEmail ? 'you@example.com' : '+1 (555) 000-0000'}
                  onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  onClick={handleSendOtp}
                  disabled={sending || !identifier.trim()}
                  className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {sending ? 'Sending…' : 'Send Code'}
                </button>
              </div>
            </>
          ) : (
            <>
              {message && (
                <div className="mb-4 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-emerald-700">{message}</p>
                </div>
              )}

              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Enter the 6-digit code
              </label>
              <div className="flex gap-2">
                <input
                  ref={codeInputRef}
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                  maxLength={6}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-center font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={verifying || code.length < 6}
                  className="px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {verifying ? 'Verifying…' : 'Verify'}
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs">
                <button
                  onClick={() => { setStep('input'); setCode(''); setError(''); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ← Change {isEmail ? 'email' : 'number'}
                </button>
                <button
                  onClick={handleResend}
                  disabled={sending}
                  className="text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export default function PublicUpload() {
  const { token } = useParams();
  const fileInputRef = useRef(null);

  // State
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const [password, setPassword] = useState('');
  const [uploaderName, setUploaderName] = useState('');
  const [uploaderEmail, setUploaderEmail] = useState('');
  const [uploaderPhone, setUploaderPhone] = useState('');

  const [dragOver, setDragOver] = useState(false);

  // OTP state
  const [sessionToken, setSessionToken] = useState(null);
  const [verifiedAs, setVerifiedAs] = useState('');

  // Fetch link info
  useEffect(() => {
    setLoading(true);
    setError(null);
    publicUploadApi.getInfo(token)
      .then(res => setInfo(res.data))
      .catch(err => {
        const msg = err.response?.data?.error || 'This upload link is not available.';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) {
      setFiles(prev => [...prev, ...dropped]);
      setUploadResult(null);
      setUploadError(null);
    }
  }, []);

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    if (selected.length) {
      setFiles(prev => [...prev, ...selected]);
      setUploadResult(null);
      setUploadError(null);
    }
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // OTP verified callback
  const handleOtpVerified = (sToken, identifier) => {
    setSessionToken(sToken);
    setVerifiedAs(identifier);
  };

  // Upload
  const handleUpload = async () => {
    if (!files.length) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadResult(null);
    setUploadError(null);

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    if (password) formData.append('password', password);
    if (uploaderName) formData.append('uploader_name', uploaderName);
    if (uploaderEmail) formData.append('uploader_email', uploaderEmail);
    if (uploaderPhone) formData.append('uploader_phone', uploaderPhone);
    if (sessionToken) formData.append('session_token', sessionToken);

    try {
      const res = await publicUploadApi.upload(token, formData, (e) => {
        if (e.total) setUploadProgress(Math.round((e.loaded * 100) / e.total));
      });
      setUploadResult(res.data);
      setFiles([]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Upload failed. Please try again.';
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  // ── Render: Loading ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading upload page…</p>
        </div>
      </div>
    );
  }

  // ── Render: Error ──────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-red-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Link Unavailable</h2>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // ── Render: Upload Page ────────────────────────────────────────────────
  // Check if OTP verification is required but not yet done
  const needsVerification = info.require_login && info.require_login !== 'none' && !sessionToken;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <CloudUpload className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {info.workflow_name}
              </h1>
              {info.label && (
                <p className="text-sm text-indigo-600 font-medium">{info.label}</p>
              )}
            </div>
          </div>
          {info.workflow_description && (
            <p className="mt-3 text-sm text-gray-500 leading-relaxed">
              {info.workflow_description}
            </p>
          )}
          {info.input_node_label && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <Info className="w-3.5 h-3.5" />
              <span>Uploading to: <strong className="text-gray-600">{info.input_node_label}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* OTP Verification gate */}
        {needsVerification ? (
          <OTPVerification
            token={token}
            requireLogin={info.require_login}
            onVerified={handleOtpVerified}
          />
        ) : (
          <>
            {/* Verified badge */}
            {verifiedAs && (
              <div className="mb-5 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <p className="text-xs text-emerald-700">
                  Verified as <strong>{verifiedAs}</strong>
                </p>
              </div>
            )}

            {/* Success state */}
            {uploadResult && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-emerald-800 text-sm">Upload Successful!</h3>
                <p className="text-emerald-700 text-sm mt-1">{uploadResult.message}</p>
                {uploadResult.count > 0 && (
                  <p className="text-emerald-600 text-xs mt-2">
                    {uploadResult.count} document{uploadResult.count !== 1 ? 's' : ''} uploaded
                    {uploadResult.duplicates_skipped?.length > 0 &&
                      `, ${uploadResult.duplicates_skipped.length} duplicate(s) skipped`
                    }
                  </p>
                )}
                <button
                  onClick={() => setUploadResult(null)}
                  className="mt-3 text-xs text-emerald-600 hover:text-emerald-800 font-medium underline"
                >
                  Upload more files
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {uploadError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-800 text-sm">Upload Failed</h3>
                <p className="text-red-600 text-sm mt-1">{uploadError}</p>
              </div>
              <button onClick={() => setUploadError(null)} className="ml-auto text-red-300 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Password field (if required) */}
        {info.requires_password && (
          <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Lock className="w-4 h-4 text-gray-400" />
              Password Required
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter the upload password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Drop zone */}
        {!uploadResult && (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative cursor-pointer border-2 border-dashed rounded-2xl p-10 text-center
              transition-all duration-200
              ${dragOver
                ? 'border-indigo-400 bg-indigo-50 scale-[1.01]'
                : 'border-gray-300 bg-white hover:border-indigo-300 hover:bg-gray-50'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? 'text-indigo-500' : 'text-gray-300'}`} />
            <p className="text-sm font-medium text-gray-700">
              {dragOver ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              or click to browse · PDF, DOCX, images, spreadsheets, ZIP archives
            </p>
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <span className="text-lg">{getFileIcon(f.name)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                  <p className="text-xs text-gray-400">{formatFileSize(f.size)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="p-1 text-gray-300 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Uploader info (optional — only if not OTP verified) */}
        {!uploadResult && files.length > 0 && !verifiedAs && (
          <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">
              Your info (optional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={uploaderName}
                onChange={e => setUploaderName(e.target.value)}
                placeholder="Your name"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <input
                type="email"
                value={uploaderEmail}
                onChange={e => setUploaderEmail(e.target.value)}
                placeholder="Email address"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
        )}

        {/* Upload button */}
        {!uploadResult && files.length > 0 && (
          <div className="mt-5">
            <button
              onClick={handleUpload}
              disabled={uploading || (info.requires_password && !password)}
              className={`
                w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl
                text-sm font-semibold transition-all duration-200
                ${uploading
                  ? 'bg-indigo-400 text-white cursor-wait'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-lg shadow-indigo-200'
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading… {uploadProgress}%
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload {files.length} file{files.length !== 1 ? 's' : ''}
                </>
              )}
            </button>
            {uploading && (
              <div className="mt-3 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </div>
        )}

          </>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-gray-400">
          <p>Powered by CLM Workflows</p>
        </div>
      </div>
    </div>
  );
}
