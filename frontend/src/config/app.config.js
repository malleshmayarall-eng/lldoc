/**
 * Application Configuration
 */

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export const API_CONFIG = {
  BASE_URL: IS_DEV ? '/api' : 'http://localhost:8000/api',
  BACKEND_URL: 'http://127.0.0.1:8000',
  TIMEOUT: 30000,
};

export const APP_CONFIG = {
  NAME: 'LL-Doc',
  VERSION: '1.0.0',
};

export default {
  API_CONFIG,
  APP_CONFIG,
};
