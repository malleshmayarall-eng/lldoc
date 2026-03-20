/**
 * DomainDashboard
 *
 * Thin routing component that renders the correct dashboard based on
 * the active organization domain.  Falls back to the general Dashboard
 * for unknown or "general" domains.
 */

import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import Dashboard from './Dashboard';
import ProcurementDashboard from './ProcurementDashboard';

const DOMAIN_DASHBOARDS = {
  procurement: ProcurementDashboard,
  // Add more domains here as they are implemented:
  // legal: LegalDashboard,
  // compliance: ComplianceDashboard,
};

const DomainDashboard = () => {
  const { domain, loading } = useFeatureFlags();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  const DashboardComponent = DOMAIN_DASHBOARDS[domain] || Dashboard;
  return <DashboardComponent />;
};

export default DomainDashboard;
