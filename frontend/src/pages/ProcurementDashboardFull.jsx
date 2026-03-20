/**
 * ProcurementDashboardFull
 *
 * Full procurement dashboard optimized for monitoring, document retrieval,
 * and exception detection. Layout: header controls → KPI strip →
 * intelligence panels → document workspace + sidebar filters + activity feed.
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import api from '../services/api';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  DollarSign,
  Download,
  Eye,
  FileCheck,
  FileText,
  Filter,
  GitBranch,
  Loader2,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const KPICard = ({ label, value, icon: Icon, color, accent, onClick }) => (
  <button
    onClick={onClick}
    className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all text-left w-full group"
  >
    <div className="flex items-center justify-between mb-3">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      {accent && (
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${accent}`}>
          action
        </span>
      )}
    </div>
    <p className="text-2xl font-bold text-gray-900 group-hover:text-blue-700 transition-colors">{value}</p>
    <p className="text-sm text-gray-500 mt-0.5">{label}</p>
  </button>
);

const FunnelStage = ({ label, count, total, color }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm font-medium text-gray-700 text-right">{label}</div>
      <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-800">
          {count}
        </span>
      </div>
    </div>
  );
};

const AlertRow = ({ alert, onClick }) => (
  <button
    onClick={() => onClick?.(alert)}
    className="w-full flex items-start gap-2.5 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left group"
  >
    <div className={`mt-0.5 flex-shrink-0 ${alert.severity === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
      {alert.severity === 'red' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm text-gray-800 group-hover:text-blue-700 transition-colors">{alert.message}</p>
      <span className={`inline-block mt-1 px-1.5 py-0.5 text-[10px] font-semibold rounded uppercase ${
        alert.severity === 'red' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
      }`}>
        {alert.type?.replace(/_/g, ' ')}
      </span>
    </div>
    <ChevronRight size={14} className="text-gray-300 mt-0.5 flex-shrink-0 group-hover:text-blue-400" />
  </button>
);

const ActivityItem = ({ item }) => {
  const iconMap = {
    document: FileText,
    workflow: GitBranch,
    share: Users,
  };
  const Icon = iconMap[item.type] || FileText;
  const colorMap = {
    document: 'text-blue-500 bg-blue-50',
    workflow: 'text-purple-500 bg-purple-50',
    share: 'text-green-500 bg-green-50',
  };
  const cls = colorMap[item.type] || 'text-gray-500 bg-gray-50';

  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <div className={`p-1.5 rounded-lg flex-shrink-0 ${cls}`}>
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">
          {item.data?.title || item.data?.document_title || 'Activity'}
        </p>
        <p className="text-xs text-gray-400">
          {item.action} · {item.timestamp ? new Date(item.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
        </p>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const colors = {
    draft: 'bg-gray-100 text-gray-700',
    under_review: 'bg-yellow-100 text-yellow-700',
    review: 'bg-yellow-100 text-yellow-700',
    analyzed: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    finalized: 'bg-purple-100 text-purple-700',
    executed: 'bg-indigo-100 text-indigo-700',
    rejected: 'bg-red-100 text-red-700',
    expired: 'bg-red-100 text-red-700',
    archived: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.draft}`}>
      {(status || 'draft').replace(/_/g, ' ')}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const ProcurementDashboardFull = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { domain } = useFeatureFlags();

  // Data
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterDocType, setFilterDocType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterAmountMin, setFilterAmountMin] = useState('');
  const [filterAmountMax, setFilterAmountMax] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [page, setPage] = useState(1);

  // ── Load dashboard data ───────────────────────────────────────────
  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = {
        page,
        page_size: 20,
        limit: 20,
      };
      if (filterDocType) params.document_type = filterDocType;
      if (filterStatus) params.status = filterStatus;
      if (filterVendor) params.vendor = filterVendor;
      if (filterDept) params.department = filterDept;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      if (filterAmountMin) params.amount_min = filterAmountMin;
      if (filterAmountMax) params.amount_max = filterAmountMax;

      const res = await api.get('/documents/dashboard/procurement/', { params });
      setData(res.data);
    } catch (err) {
      console.error('Procurement dashboard error:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [page, filterDocType, filterStatus, filterVendor, filterDept, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Derived data
  const kpis = data?.kpis || {};
  const funnel = data?.funnel || {};
  const alerts = data?.alerts || [];
  const workspace = data?.workspace || {};
  const activity = data?.activity || [];
  const filterOptions = data?.filter_options || {};
  const funnelTotal = Object.values(funnel).reduce((s, v) => s + v, 0);

  // Filter workspace docs by search locally
  const workspaceDocs = useMemo(() => {
    if (!search) return workspace.documents || [];
    const q = search.toLowerCase();
    return (workspace.documents || []).filter((d) =>
      d.title?.toLowerCase().includes(q) ||
      d.document_type?.toLowerCase().includes(q) ||
      d.author?.toLowerCase().includes(q) ||
      d.created_by?.toLowerCase().includes(q)
    );
  }, [workspace.documents, search]);

  const clearAllFilters = () => {
    setSearch('');
    setFilterDocType('');
    setFilterStatus('');
    setFilterVendor('');
    setFilterDept('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterAmountMin('');
    setFilterAmountMax('');
    setPage(1);
  };

  const activeFilterCount = [filterDocType, filterStatus, filterVendor, filterDept, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax].filter(Boolean).length;

  const openDocument = (doc) => {
    if (doc.document_mode === 'quick_latex') {
      navigate(`/quick-latex?document=${doc.id}`);
    } else {
      navigate(`/drafter/${doc.id}`);
    }
  };

  const handleAlertClick = (alert) => {
    if (alert.document_id) {
      navigate(`/drafter/${alert.document_id}`);
    }
  };

  const handleKPIClick = (filterKey, filterValue) => {
    if (filterKey === 'status') setFilterStatus(filterValue);
    else if (filterKey === 'type') setFilterDocType(filterValue);
    setPage(1);
  };

  // ── Loading ───────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-10 w-10 text-blue-600 animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading procurement dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC]">
      {/* ═══════════════════════════════════════════════════════════════
          1. GLOBAL HEADER (Persistent Control Layer)
         ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-lg">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, vendor, PO number, contract ID..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Quick filters */}
          <select
            value={filterDocType}
            onChange={(e) => { setFilterDocType(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600"
          >
            <option value="">All Types</option>
            <option value="purchase_order">Purchase Order</option>
            <option value="vendor_agreement">Contract</option>
            <option value="invoice">Invoice</option>
            <option value="rfq">RFQ</option>
            <option value="rfp">RFP</option>
            <option value="goods_receipt">Delivery Note</option>
            <option value="nda">NDA</option>
            <option value="sow">SOW</option>
            <option value="other">Other</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="under_review">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="finalized">Finalized</option>
            <option value="executed">Executed</option>
          </select>

          {/* Actions */}
          <button
            onClick={() => navigate('/quick-latex')}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} />
            Create Document
          </button>

          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`p-2 border rounded-lg transition-colors ${showSidebar ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
            title="Toggle filters sidebar"
          >
            <SlidersHorizontal size={16} />
          </button>

          <button onClick={loadDashboard} className="p-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50" title="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          2. KPI STRIP (Procurement Health Summary)
         ═══════════════════════════════════════════════════════════════ */}
      <div className="px-6 pt-5 pb-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard
            label="Total Documents"
            value={kpis.total_documents ?? 0}
            icon={FileText}
            color="bg-blue-50 text-blue-600"
            onClick={() => clearAllFilters()}
          />
          <KPICard
            label="Pending Approval"
            value={kpis.pending_approval ?? 0}
            icon={Clock}
            color="bg-amber-50 text-amber-600"
            accent={kpis.pending_approval > 0 ? 'bg-amber-100 text-amber-700' : undefined}
            onClick={() => navigate('/approvals')}
          />
          <KPICard
            label={`Expiring (${kpis.expiry_days || 30}d)`}
            value={kpis.contracts_expiring ?? 0}
            icon={Calendar}
            color="bg-orange-50 text-orange-600"
            accent={kpis.contracts_expiring > 0 ? 'bg-orange-100 text-orange-700' : undefined}
            onClick={() => handleKPIClick('type', 'vendor_agreement')}
          />
          <KPICard
            label="Invoices Awaiting"
            value={kpis.invoices_awaiting ?? 0}
            icon={DollarSign}
            color="bg-emerald-50 text-emerald-600"
            onClick={() => handleKPIClick('type', 'invoice')}
          />
          <KPICard
            label="Conflicts"
            value={kpis.conflicts ?? 0}
            icon={AlertTriangle}
            color="bg-red-50 text-red-600"
            accent={kpis.conflicts > 0 ? 'bg-red-100 text-red-700' : undefined}
            onClick={() => {}}
          />
          <KPICard
            label="Compliance Missing"
            value={kpis.compliance_missing ?? 0}
            icon={ShieldCheck}
            color="bg-violet-50 text-violet-600"
            onClick={() => {}}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          3. INTELLIGENCE PANELS (Workflow Funnel + Alerts)
         ═══════════════════════════════════════════════════════════════ */}
      <div className="px-6 pb-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* A. Workflow Funnel */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Procurement Workflow Funnel</h2>
            </div>
            <div className="space-y-3">
              <FunnelStage label="Draft" count={funnel.draft || 0} total={funnelTotal} color="bg-gray-400" />
              <FunnelStage label="Submitted" count={funnel.submitted || 0} total={funnelTotal} color="bg-yellow-400" />
              <FunnelStage label="Under Review" count={funnel.under_review || 0} total={funnelTotal} color="bg-blue-400" />
              <FunnelStage label="Approved" count={funnel.approved || 0} total={funnelTotal} color="bg-green-400" />
              <FunnelStage label="Completed" count={funnel.completed || 0} total={funnelTotal} color="bg-purple-400" />
            </div>
          </div>

          {/* B. Alerts & Exceptions */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                <h2 className="text-sm font-semibold text-gray-900">Alerts & Exceptions</h2>
                {alerts.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded-full">
                    {alerts.length}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {alerts.length > 0 ? (
                alerts.map((alert, idx) => (
                  <AlertRow key={idx} alert={alert} onClick={handleAlertClick} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <CheckCircle size={28} className="mb-2 text-green-300" />
                  <p className="text-sm">No active alerts</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          4. DOCUMENT WORKSPACE + SIDEBAR + ACTIVITY FEED
         ═══════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden px-6 pb-6 gap-4">
        {/* ── Smart Filters Sidebar (collapsible) ── */}
        {showSidebar && (
          <aside className="w-56 flex-shrink-0 bg-white rounded-xl border border-gray-200 overflow-y-auto">
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <Filter size={14} />
                  Filters
                </h3>
                {activeFilterCount > 0 && (
                  <button onClick={clearAllFilters} className="text-[10px] text-red-600 hover:text-red-700 font-medium">
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Vendor */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Vendor</label>
                <select
                  value={filterVendor}
                  onChange={(e) => { setFilterVendor(e.target.value); setPage(1); }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg"
                >
                  <option value="">All Vendors</option>
                  {(filterOptions.vendors || []).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Department</label>
                <select
                  value={filterDept}
                  onChange={(e) => { setFilterDept(e.target.value); setPage(1); }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg"
                >
                  <option value="">All Departments</option>
                  {(filterOptions.departments || []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Amount Range */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Amount Range</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    value={filterAmountMin}
                    onChange={(e) => { setFilterAmountMin(e.target.value); setPage(1); }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={filterAmountMax}
                    onChange={(e) => { setFilterAmountMax(e.target.value); setPage(1); }}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
              </div>

              {/* Date Range */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date Range</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg mb-1.5"
                />
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg"
                />
              </div>

              {/* Document Type breakdown */}
              {filterOptions.document_types && Object.keys(filterOptions.document_types).length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">By Type</label>
                  <div className="space-y-1">
                    {Object.entries(filterOptions.document_types).map(([type, count]) => (
                      <button
                        key={type}
                        onClick={() => { setFilterDocType(filterDocType === type ? '' : type); setPage(1); }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                          filterDocType === type ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <span className="truncate">{(type || 'other').replace(/_/g, ' ')}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* ── Primary: Document Table ── */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">Document Workspace</h2>
            <span className="text-xs text-gray-400">{workspace.total || 0} total · Page {workspace.page || 1} of {workspace.total_pages || 1}</span>
          </div>

          <div className="flex-1 overflow-auto">
            {error ? (
              <div className="p-6 text-center">
                <AlertTriangle size={28} className="text-red-300 mx-auto mb-2" />
                <p className="text-sm text-red-600">{error}</p>
                <button onClick={loadDashboard} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium">Retry</button>
              </div>
            ) : workspaceDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <FileText size={36} className="mb-2 opacity-40" />
                <p className="text-sm">No documents match your filters</p>
                {activeFilterCount > 0 && (
                  <button onClick={clearAllFilters} className="mt-2 text-sm text-blue-600 font-medium">Clear all filters</button>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Document</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Owner</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Modified</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {workspaceDocs.map((doc) => (
                    <tr
                      key={doc.id}
                      onClick={() => openDocument(doc)}
                      className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={14} className="text-gray-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-900 truncate max-w-[280px]">{doc.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          {(doc.document_type || 'other').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{doc.created_by || doc.author || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openDocument(doc); }}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                            title="Preview"
                          >
                            <Eye size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {(workspace.total_pages || 1) > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-white"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500">Page {page} of {workspace.total_pages}</span>
              <button
                onClick={() => setPage(Math.min(workspace.total_pages, page + 1))}
                disabled={page >= workspace.total_pages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-white"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* ── Activity Feed (Right sidebar) ── */}
        <aside className="w-64 flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Activity Feed</h3>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-gray-100">
            {activity.length > 0 ? (
              activity.map((item, idx) => <ActivityItem key={idx} item={item} />)
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Clock size={24} className="mb-2 opacity-40" />
                <p className="text-xs">No recent activity</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ProcurementDashboardFull;
