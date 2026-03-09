import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { FileText, AlertCircle, ShieldCheck, ArrowLeft, Mail } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Login mode: 'password' | 'emailOtp' | 'otpVerify'
  const [mode, setMode] = useState('password');
  const [otpEmail, setOtpEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Track whether we arrived at OTP verify via 2FA (password login) or passwordless flow
  const [otpSource, setOtpSource] = useState(null); // '2fa' | 'emailOtp'
  const otpRefs = useRef([]);

  const navigate = useNavigate();
  const { login, verifyLoginOtp, resendLoginOtp, requestEmailLoginOtp } = useAuth();

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Focus first OTP input when entering verify mode
  useEffect(() => {
    if (mode === 'otpVerify' && otpRefs.current[0]) {
      otpRefs.current[0].focus();
    }
  }, [mode]);

  // ── Password login ──────────────────────────────────────────────────
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(email, password);
    if (result.success) {
      navigate('/dashboard');
    } else if (result.requires_otp) {
      // 2FA enabled — need OTP verification
      setOtpEmail(email);
      setOtpSource('2fa');
      setMode('otpVerify');
      setResendCooldown(60);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── Passwordless email OTP request ──────────────────────────────────
  const handleEmailOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await requestEmailLoginOtp(email);
    if (result.success) {
      setOtpEmail(email);
      setOtpSource('emailOtp');
      setMode('otpVerify');
      setResendCooldown(60);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── OTP digit handling ──────────────────────────────────────────────
  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = [...otp];
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || '';
    }
    setOtp(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  // ── OTP verification (works for both 2FA and passwordless) ──────────
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code');
      return;
    }
    setError('');
    setLoading(true);

    const result = await verifyLoginOtp(otpEmail, code);
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    }
    setLoading(false);
  };

  // ── Resend OTP (picks correct endpoint based on source) ─────────────
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError('');

    const result =
      otpSource === '2fa'
        ? await resendLoginOtp(otpEmail)
        : await requestEmailLoginOtp(otpEmail);

    if (result.success) {
      setResendCooldown(60);
    } else {
      setError(result.error);
    }
  };

  // ── Navigation helpers ──────────────────────────────────────────────
  const handleBackFromOtp = () => {
    const returnTo = otpSource === 'emailOtp' ? 'emailOtp' : 'password';
    setMode(returnTo);
    setOtp(['', '', '', '', '', '']);
    setOtpSource(null);
    setError('');
  };

  const switchToEmailOtp = () => {
    setMode('emailOtp');
    setError('');
    setPassword('');
  };

  const switchToPassword = () => {
    setMode('password');
    setError('');
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-blue-600 p-3 rounded-lg">
              <FileText className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Drafter</h1>
          <p className="text-gray-600">AI-Assisted Legal Document Editor</p>
        </div>

        <div className="bg-white rounded-lg shadow-xl p-8">

          {/* ─────────── OTP Verification Step ─────────── */}
          {mode === 'otpVerify' && (
            <>
              <button
                onClick={handleBackFromOtp}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 -mt-1"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <ShieldCheck className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Verify Your Identity</h2>
                  <p className="text-sm text-gray-500">
                    We sent a 6-digit code to{' '}
                    <span className="font-medium text-gray-700">{otpEmail}</span>
                  </p>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <form onSubmit={handleOtpSubmit} className="space-y-6">
                <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => (otpRefs.current[i] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-lg
                                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                                 transition-colors"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={loading || otp.join('').length !== 6}
                  className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-md hover:bg-blue-700
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                             transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Verifying…' : 'Verify & Sign In'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <p className="text-sm text-gray-500">
                  Didn't receive a code?{' '}
                  <button
                    onClick={handleResend}
                    disabled={resendCooldown > 0}
                    className="text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </p>
              </div>
            </>
          )}

          {/* ─────────── Passwordless Email OTP Step ─────────── */}
          {mode === 'emailOtp' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-indigo-100 p-2 rounded-lg">
                  <Mail className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Sign In with Email</h2>
                  <p className="text-sm text-gray-500">We'll send a one-time code to your email</p>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <form onSubmit={handleEmailOtpSubmit} className="space-y-5">
                <div>
                  <label htmlFor="otp-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    id="otp-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter your email"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Sending code…' : 'Send Verification Code'}
                </button>
              </form>

              <div className="mt-5 relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">or</span>
                </div>
              </div>

              <div className="mt-5 text-center">
                <button
                  onClick={switchToPassword}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Sign in with password
                </button>
              </div>
            </>
          )}

          {/* ─────────── Password Login Step (default) ─────────── */}
          {mode === 'password' && (
            <>
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">Sign In</h2>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter your email"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter your password"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm text-gray-600">Remember me</span>
                  </label>
                  <a href="#" className="text-sm text-blue-600 hover:text-blue-700">
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <div className="mt-5 relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">or</span>
                </div>
              </div>

              <div className="mt-5 text-center">
                <button
                  onClick={switchToEmailOtp}
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Mail className="h-4 w-4" />
                  Sign in with email code
                </button>
              </div>

              <div className="mt-4 text-center">
                <p className="text-sm text-gray-600">
                  Don't have an account?{' '}
                  <Link to="/register" className="text-blue-600 hover:text-blue-700 font-medium">
                    Sign up
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-gray-600">
          © 2026 Drafter. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default Login;
