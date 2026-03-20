import { Navigate } from 'react-router-dom';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';

/**
 * FeatureRoute
 *
 * Wraps a route element and only renders it if the given feature flag
 * is enabled.  While flags are still loading the component renders a
 * lightweight spinner (same style as ProtectedRoute).  When the flag
 * resolves to disabled, the user is redirected to `/dashboard`.
 *
 * Usage:
 *   <Route path="clm/*" element={
 *     <FeatureRoute category="apps" feature="clm">
 *       <ClmApp />
 *     </FeatureRoute>
 *   } />
 */
const FeatureRoute = ({ category, feature, children, fallback = '/dashboard' }) => {
  const { isEnabled, loading } = useFeatureFlags();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!isEnabled(category, feature)) {
    return <Navigate to={fallback} replace />;
  }

  return children;
};

export default FeatureRoute;
