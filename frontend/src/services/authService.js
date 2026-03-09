import api from './api';

export const authService = {
  // Login — may return { requires_otp: true } if 2FA is enabled
  login: async (email, password) => {
    const response = await api.post('/auth/login/', { email, password });
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Send (or resend) login OTP
  sendLoginOtp: async (email) => {
    const response = await api.post('/auth/send-login-otp/', { email });
    return response.data;
  },

  // Verify login OTP and complete authentication
  verifyLoginOtp: async (email, otp) => {
    const response = await api.post('/auth/verify-login-otp/', { email, otp });
    if (response.data.user) {
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  // Toggle two-factor authentication
  toggleTwoFactor: async (enabled) => {
    const response = await api.post('/auth/two-factor/toggle/', { enabled });
    return response.data;
  },

  // Request passwordless email login OTP (no password needed)
  requestEmailLoginOtp: async (email) => {
    const response = await api.post('/auth/request-email-login-otp/', { email });
    return response.data;
  },

  // Register
  register: async (userData) => {
    const response = await api.post('/users/users/', userData);
    return response.data;
  },

  // Logout
  logout: () => {
    localStorage.removeItem('user');
  },

  // Get current user
  getCurrentUser: () => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Deprecated alias: getStoredUser (for backward compatibility)
  getStoredUser: () => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return !!localStorage.getItem('user');
  },
};

export default authService;
