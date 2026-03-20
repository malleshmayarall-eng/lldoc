import { useFeatureFlags } from '../contexts/FeatureFlagContext';

/**
 * useDomainConfig
 *
 * Convenience hook that extracts domain configuration from the
 * FeatureFlagContext. Returns the parsed sub-objects so components
 * don't have to do null-checks everywhere.
 *
 * Usage:
 *   const { categories, quickActions, workflowPresets, uiHints } = useDomainConfig();
 */
const useDomainConfig = () => {
  const { domain, domainConfig, loading, error } = useFeatureFlags();

  return {
    domain,
    loading,
    error,
    config: domainConfig,
    categories: domainConfig?.categories || [],
    quickActions: domainConfig?.quick_actions || [],
    workflowPresets: domainConfig?.workflow_presets || [],
    uiHints: domainConfig?.ui_hints || {},
    theme: domainConfig?.ui_hints?.theme || {},
    emptyStates: domainConfig?.ui_hints?.empty_states || {},
  };
};

export default useDomainConfig;
