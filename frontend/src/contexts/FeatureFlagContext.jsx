import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { userService } from '../services/userService';

const FeatureFlagContext = createContext(null);

/**
 * FeatureFlagProvider
 *
 * Loads the resolved feature flags for the current user's organization
 * and exposes helpers to check which features are enabled.
 *
 * Flags shape (from API):
 *   { domain, flags: { apps: {...}, editor: {...}, dashboard: {...} } }
 */
export const FeatureFlagProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [domain, setDomain] = useState('default');
  const [flags, setFlags] = useState(null);
  const [domainConfig, setDomainConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Fetch flags from backend ──────────────────────────────────────

  const loadFlags = useCallback(async () => {
    if (!isAuthenticated) {
      setFlags(null);
      setDomain('default');
      setDomainConfig(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [flagsRes, configRes] = await Promise.all([
        userService.getFeatureFlags().catch(() => null),
        userService.getDomainConfig().catch(() => null),
      ]);

      if (flagsRes) {
        setDomain(flagsRes.domain || 'default');
        setFlags(flagsRes.flags || {});
      }

      if (configRes) {
        setDomainConfig(configRes);
      }
    } catch (err) {
      console.error('Failed to load feature flags:', err);
      setError(err);
      // Fallback: everything enabled
      setFlags(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Check if a specific feature is enabled.
   * @param {string} category  - 'apps' | 'editor' | 'dashboard'
   * @param {string} feature   - e.g. 'clm', 'quick_latex', 'ai_assist'
   * @returns {boolean} — defaults to true if flags haven't loaded yet
   */
  const isEnabled = useCallback(
    (category, feature) => {
      if (!flags) return true; // permissive fallback while loading
      return flags[category]?.[feature] !== false;
    },
    [flags],
  );

  /**
   * Check if an app-level feature is enabled.
   * Shorthand for isEnabled('apps', feature).
   */
  const isAppEnabled = useCallback(
    (feature) => isEnabled('apps', feature),
    [isEnabled],
  );

  /**
   * Check if an editor feature is enabled.
   * Shorthand for isEnabled('editor', feature).
   */
  const isEditorEnabled = useCallback(
    (feature) => isEnabled('editor', feature),
    [isEnabled],
  );

  /**
   * Check if a dashboard feature is enabled.
   * Shorthand for isEnabled('dashboard', feature).
   */
  const isDashboardEnabled = useCallback(
    (feature) => isEnabled('dashboard', feature),
    [isEnabled],
  );

  // ── Memoised value ────────────────────────────────────────────────

  const value = useMemo(
    () => ({
      domain,
      flags,
      domainConfig,
      loading,
      error,
      isEnabled,
      isAppEnabled,
      isEditorEnabled,
      isDashboardEnabled,
      refresh: loadFlags,
    }),
    [domain, flags, domainConfig, loading, error, isEnabled, isAppEnabled, isEditorEnabled, isDashboardEnabled, loadFlags],
  );

  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

/**
 * Hook to access the feature flag context.
 */
export const useFeatureFlags = () => {
  const context = useContext(FeatureFlagContext);
  if (!context) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagProvider');
  }
  return context;
};

export default FeatureFlagContext;
