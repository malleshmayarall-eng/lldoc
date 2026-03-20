/**
 * ProcurementDashboard
 *
 * Domain-aware dashboard for the **procurement** vertical.
 * Renders AI briefing, approvals/tasks panels, quick-action cards,
 * a template gallery with category tabs, workflow stats, and recent docs.
 *
 * Reads config from FeatureFlagContext.domainConfig (populated by
 * GET /api/organizations/current/domain-config/).
 */

import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import { documentService } from '../services/documentService';
import quickLatexService from '../services/quickLatexService';
import useWorkflowStore from '../store/workflowStore';
import api from '../services/api';
import {
  ShoppingCart,
  FileSearch,
  ClipboardList,
  ShieldCheck,
  FileText,
  GitBranch,
  UserPlus,
  Layers,
  RefreshCw,
  Plus,
  ArrowRight,
  Code,
  Clock,
  BarChart3,
  Loader2,
  Sparkles,
  Package,
  AlertTriangle,
  Zap,
  Target,
  History,
  FileCheck,
  ListTodo,
  CheckCircle,
} from 'lucide-react';

const AI_DASHBOARD_SETTINGS_KEY = 'dashboard_ai_settings';

/* ------------------------------------------------------------------ */
/*  Icon resolver                                                      */
/* ------------------------------------------------------------------ */

const ICON_MAP = {
  ShoppingCart,
  FileSearch,
  ClipboardList,
  ShieldCheck,
  FileText,
  GitBranch,
  UserPlus,
  Layers,
  RefreshCw,
  BarChart3,
  Package,
  Code,
};

const resolveIcon = (name, fallback = FileText) => ICON_MAP[name] || fallback;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const StatCard = ({ label, value, icon: Icon, color, onClick }) => (
  <button
    onClick={onClick}
    className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all text-left w-full"
  >
    <div className="flex items-center justify-between mb-3">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
    <p className="text-2xl font-bold text-gray-900">{value}</p>
    <p className="text-sm text-gray-500 mt-0.5">{label}</p>
  </button>
);

const QuickActionCard = ({ action, onClick }) => {
  const Icon = resolveIcon(action.icon, ShoppingCart);
  return (
    <button
      onClick={() => onClick(action)}
      className="group flex flex-col items-start gap-3 rounded-xl border-2 border-dashed border-gray-200 p-5 hover:border-blue-400 hover:bg-blue-50/30 transition-all text-left"
    >
      <div className="p-2.5 rounded-lg" style={{ backgroundColor: `${action.color}15` }}>
        <Icon className="h-5 w-5" style={{ color: action.color }} />
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{action.label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{action.description}</p>
      </div>
    </button>
  );
};

const WorkflowPresetCard = ({ preset, onClick }) => {
  const Icon = resolveIcon(preset.icon, GitBranch);
  return (
    <button
      onClick={() => onClick(preset)}
      className="flex items-center gap-4 bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm hover:border-gray-300 transition-all text-left w-full"
    >
      <div className="p-2.5 rounded-lg flex-shrink-0" style={{ backgroundColor: `${preset.color}15` }}>
        <Icon className="h-5 w-5" style={{ color: preset.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{preset.name}</p>
        <p className="text-xs text-gray-500 truncate">{preset.description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
    </button>
  );
};

const TemplateCard = ({ template, onClick }) => (
  <button
    onClick={() => onClick(template)}
    className="group bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all text-left w-full"
  >
    <div className="flex items-center gap-3 mb-2">
      <div className="bg-indigo-50 p-1.5 rounded flex-shrink-0">
        <Code size={14} className="text-indigo-600" />
      </div>
      <h4 className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors truncate">
        {template.title}
      </h4>
    </div>
    <p className="text-xs text-gray-500 line-clamp-2">{template.description || 'Quick LaTeX template'}</p>
    {template.document_type && (
      <span className="inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
        {template.document_type}
      </span>
    )}
  </button>
);

const RecentDocRow = ({ doc, onClick }) => (
  <button
    onClick={() => onClick(doc)}
    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left"
  >
    <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-gray-900 truncate">{doc.title}</p>
      <p className="text-xs text-gray-500">{doc.document_type || 'document'}</p>
    </div>
    <span className="text-xs text-gray-400 flex-shrink-0">
      {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : ''}
    </span>
  </button>
);

const CategoryTabs = ({ categories, active, onChange }) => (
  <div className="flex gap-1 overflow-x-auto pb-1">
    <button
      onClick={() => onChange('')}
      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
        active === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      All
    </button>
    {categories.map((cat) => (
      <button
        key={cat.value}
        onClick={() => onChange(cat.value)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
          active === cat.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        {cat.label}
      </button>
    ))}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const getStatusBadge = (status) => {
  const badges = {
    draft: 'bg-gray-100 text-gray-700',
    under_review: 'bg-yellow-100 text-yellow-700',
    analyzed: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    finalized: 'bg-purple-100 text-purple-700',
  };
  return badges[status] || 'bg-gray-100 text-gray-700';
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const ProcurementDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { domainConfig, isAppEnabled } = useFeatureFlags();
  const { fetchMyTasks, fetchMyApprovals, fetchUnreadNotifications, myTasks, myApprovals } = useWorkflowStore();

  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [recentDocs, setRecentDocs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, workflows: 0 });
  const [activeCat, setActiveCat] = useState('');

  // AI State
  const [aiAssistant, setAiAssistant] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);

  // Extract from domainConfig
  const categories = domainConfig?.categories || [];
  const quickActions = domainConfig?.quick_actions || [];
  const workflowPresets = domainConfig?.workflow_presets || [];
  const uiHints = domainConfig?.ui_hints || {};

  // ── Load AI briefing on mount ─────────────────────────────────────
  useEffect(() => {
    let aiConfig = { enabled: true, provider: 'ollama', model: 'llama3.2' };
    try {
      const raw = localStorage.getItem(AI_DASHBOARD_SETTINGS_KEY);
      if (raw) aiConfig = { ...aiConfig, ...JSON.parse(raw) };
    } catch { /* use defaults */ }

    setAiLoading(true);
    if (!aiConfig.enabled) {
      setAiAssistant({ status: 'disabled', ai_summary: '', recommendations: [], urgent_items: [], document_updates: [], ai_provider: 'disabled' });
      setAiLoading(false);
    } else {
      api.get('/ai/dashboard-assistant/', { params: { provider: aiConfig.provider, model: aiConfig.model } })
        .then(res => setAiAssistant(res.data))
        .catch(() => setAiAssistant(null))
        .finally(() => setAiLoading(false));
    }
  }, []);

  // ── Load dashboard data ───────────────────────────────────────────
  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [overviewRes, qlDocs] = await Promise.all([
        documentService.getDashboardOverview({ timeframe: 'week', include_stats: true, include_recent: true, limit: 8 }).catch(() => null),
        quickLatexService.list({ limit: 50 }).catch(() => ({ results: [] })),
      ]);

      setDashboardData(overviewRes);

      // Recent documents
      const recent = overviewRes?.my_documents?.recent || [];
      setRecentDocs(recent.slice(0, 8));

      // Templates
      const qlList = qlDocs?.results || qlDocs || [];
      setTemplates(qlList);

      // Stats
      setStats({
        total: overviewRes?.my_documents?.total || 0,
        pending: overviewRes?.statistics?.by_status?.under_review || overviewRes?.statistics?.by_status?.draft || 0,
        approved: overviewRes?.statistics?.by_status?.approved || 0,
        workflows: overviewRes?.my_workflows?.pending || 0,
      });

      // Fetch workflow store data
      await Promise.all([
        fetchMyTasks().catch(() => {}),
        fetchMyApprovals().catch(() => {}),
        fetchUnreadNotifications().catch(() => {}),
      ]);
    } catch (err) {
      console.error('Procurement dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Filtered templates ────────────────────────────────────────────
  const filteredTemplates = useMemo(() => {
    if (!activeCat) return templates;
    return templates.filter((t) => t.document_type === activeCat);
  }, [templates, activeCat]);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleQuickAction = (action) => navigate(`/quick-latex?template=${action.template || ''}`);
  const handleOpenDoc = (doc) => navigate(doc.document_mode === 'quick_latex' ? `/quick-latex?id=${doc.id}` : `/drafter/${doc.id}`);
  const handleOpenTemplate = (template) => navigate(`/quick-latex?id=${template.id}`);
  const handleWorkflowPreset = () => navigate('/clm');
  const handleNewDocument = () => window.dispatchEvent(new CustomEvent('openCreateDocumentDialog'));

  // ── Loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="p-6 lg:p-8 min-h-screen" style={{ backgroundColor: uiHints?.theme?.surface_alt || '#F8FAFC' }}>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Procurement Hub</h1>
            <p className="text-sm text-gray-500 mt-1">
              Welcome back, {user?.first_name || 'User'} — manage orders, agreements, and workflows.
            </p>
          </div>
          <button
            onClick={handleNewDocument}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Document
          </button>
        </div>

        {/* ── Stat Cards ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Documents" value={stats.total} icon={FileText} color="bg-blue-50 text-blue-600" onClick={() => navigate('/documents')} />
          <StatCard label="Pending Review" value={stats.pending} icon={Clock} color="bg-amber-50 text-amber-600" onClick={() => navigate('/documents')} />
          <StatCard label="Approved" value={stats.approved} icon={ShieldCheck} color="bg-green-50 text-green-600" onClick={() => navigate('/documents')} />
          {isAppEnabled('clm') && (
            <StatCard label="Active Workflows" value={stats.workflows} icon={GitBranch} color="bg-purple-50 text-purple-600" onClick={() => navigate('/clm')} />
          )}
        </div>

        {/* ── AI Briefing Panel ───────────────────────────────────── */}
        <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-blue-50 rounded-xl border border-indigo-200 overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2 rounded-lg">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">AI Procurement Briefing</h2>
                <p className="text-[11px] text-gray-500">
                  {(() => {
                    const p = aiAssistant?.ai_provider || '';
                    if (p.startsWith('ollama:')) return `Powered by Ollama · ${p.split(':')[1]}`;
                    if (p === 'gemini') return 'Powered by Gemini Flash';
                    if (p === 'fallback') return 'Rule-based summary';
                    if (p === 'disabled') return 'AI assistant disabled';
                    return 'Powered by AI';
                  })()}
                </p>
              </div>
            </div>

            {aiLoading ? (
              <div className="flex items-center gap-3 py-3">
                <Loader2 className="h-4 w-4 text-indigo-600 animate-spin" />
                <span className="text-sm text-gray-500">Preparing your procurement briefing...</span>
              </div>
            ) : aiAssistant && aiAssistant.status !== 'disabled' ? (
              <div className="space-y-3">
                {/* AI Summary */}
                {aiAssistant.ai_summary && (
                  <div className="bg-white/70 rounded-lg p-3.5 border border-indigo-100">
                    <p className="text-sm text-gray-800 leading-relaxed">{aiAssistant.ai_summary}</p>
                  </div>
                )}

                {/* Urgent Items */}
                {aiAssistant.urgent_items?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Needs Attention
                    </h3>
                    {aiAssistant.urgent_items.map((item, idx) => (
                      <div key={idx} className="bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-start gap-2.5">
                        <Zap className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-red-900">{item.title}</p>
                          <p className="text-xs text-red-700 mt-0.5">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Document Updates Timeline */}
                {aiAssistant.document_updates?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      Recent Updates
                    </h3>
                    <div className="bg-white/70 rounded-lg border border-gray-200 divide-y divide-gray-100">
                      {aiAssistant.document_updates.slice(0, 4).map((update, idx) => (
                        <div key={idx} className="p-2.5 flex items-start gap-2.5 hover:bg-white/90 transition-colors">
                          <FileCheck className="h-3.5 w-3.5 text-indigo-500 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-medium text-gray-900 truncate">{update.title}</p>
                              {update.status && (
                                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${getStatusBadge(update.status)}`}>
                                  {update.status.replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600">{update.change_summary}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {aiAssistant.recommendations?.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5" />
                      Recommendations
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {aiAssistant.recommendations.map((rec, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            if (rec.action_type === 'navigate_approvals') navigate('/approvals');
                            else if (rec.action_type === 'navigate_tasks') navigate('/tasks');
                            else if (rec.action_type === 'create_document') handleNewDocument();
                            else navigate('/documents');
                          }}
                          className="bg-white/80 hover:bg-white border border-gray-200 hover:border-indigo-300 rounded-lg p-2.5 text-left transition-all group"
                        >
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${
                              rec.priority === 'high' ? 'bg-red-100 text-red-700' :
                              rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-green-100 text-green-700'
                            }`}>{rec.priority}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700">{rec.title}</p>
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{rec.description}</p>
                            </div>
                            <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-indigo-500 mt-0.5 flex-shrink-0" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : aiAssistant?.status === 'disabled' ? (
              <div className="bg-white/70 rounded-lg p-3.5 border border-indigo-100 flex items-center justify-between gap-4">
                <p className="text-sm text-gray-500">AI Assistant is turned off. Enable it in Settings.</p>
                <button onClick={() => navigate('/settings')} className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline">Settings</button>
              </div>
            ) : (
              <div className="bg-white/70 rounded-lg p-3.5 border border-indigo-100 flex items-center justify-between gap-4">
                <p className="text-sm text-gray-500">AI assistant unavailable. Make sure Ollama is running or configure a provider in Settings.</p>
                <button onClick={() => navigate('/settings')} className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline">Settings</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Approvals & Tasks ───────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
            {/* Approvals */}
            <div className="flex flex-col">
              <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-green-100 rounded-lg">
                      <ShieldCheck className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Approvals</h3>
                      <p className="text-[11px] text-gray-500">
                        {(dashboardData?.pending_approvals?.total > 0 || myApprovals?.length > 0)
                          ? `${dashboardData?.pending_approvals?.total || myApprovals?.length || 0} pending`
                          : 'All caught up'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => navigate('/approvals')} className="text-xs font-medium text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-100/50 transition-colors">View all</button>
                </div>
              </div>
              {(dashboardData?.pending_approvals?.items?.length > 0 || myApprovals?.length > 0) ? (
                <div className="flex-1 divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {(dashboardData?.pending_approvals?.items || myApprovals || []).slice(0, 4).map((approval) => (
                    <div
                      key={approval.id}
                      onClick={() => navigate(approval.workflow?.document ? `/drafter/${approval.workflow.document}` : '/approvals')}
                      className="p-3 hover:bg-green-50/50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate group-hover:text-green-700">
                            {approval.document_title || approval.workflow?.document_title || 'Untitled'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            {approval.role && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700 truncate">{approval.role}</span>
                            )}
                            {approval.is_required && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 text-red-700">Required</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center">
                    <CheckCircle className="h-7 w-7 text-green-200 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-500">No pending approvals</p>
                  </div>
                </div>
              )}
            </div>

            {/* Tasks */}
            <div className="flex flex-col">
              <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-violet-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-purple-100 rounded-lg">
                      <ListTodo className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Tasks</h3>
                      <p className="text-[11px] text-gray-500">
                        {myTasks?.length > 0 ? `${myTasks.length} assigned` : 'No tasks'}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => navigate('/tasks')} className="text-xs font-medium text-purple-600 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-100/50 transition-colors">View all</button>
                </div>
              </div>
              {myTasks?.length > 0 ? (
                <div className="flex-1 divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {myTasks.slice(0, 4).map((task) => {
                    const isOverdue = task.due_date && new Date(task.due_date) < new Date();
                    const priorityColors = { urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-blue-100 text-blue-700' };
                    const statusColors = { draft: 'bg-gray-100 text-gray-700', review: 'bg-blue-100 text-blue-700', approved: 'bg-green-100 text-green-700', revision_required: 'bg-yellow-100 text-yellow-700', executed: 'bg-purple-100 text-purple-700' };
                    const status = task.current_status || task.status;
                    return (
                      <div
                        key={task.id}
                        onClick={() => navigate(`/drafter/${task.document}`)}
                        className={`p-3 hover:bg-purple-50/50 cursor-pointer transition-colors group ${isOverdue ? 'border-l-2 border-l-red-500' : ''}`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate group-hover:text-purple-700">{task.document_title || 'Untitled'}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${priorityColors[task.priority] || priorityColors.medium}`}>{task.priority}</span>
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusColors[status] || statusColors.draft}`}>{status?.replace(/_/g, ' ')}</span>
                              {task.due_date && (
                                <span className={`text-[9px] ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                                  {isOverdue ? '⚠ ' : ''}{new Date(task.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center">
                    <ListTodo className="h-7 w-7 text-purple-200 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-500">No assigned tasks</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Quick Actions ───────────────────────────────────────── */}
        {quickActions.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">Quick Actions</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {quickActions.map((a) => (
                <QuickActionCard key={a.key} action={a} onClick={handleQuickAction} />
              ))}
            </div>
          </section>
        )}

        {/* ── Main three-column layout ────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Template Gallery (2/3) */}
          <section className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Document Templates</h2>
              <button onClick={() => navigate('/quick-latex')} className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <CategoryTabs categories={categories} active={activeCat} onChange={setActiveCat} />

            {filteredTemplates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredTemplates.slice(0, 8).map((t) => (
                  <TemplateCard key={t.id} template={t} onClick={handleOpenTemplate} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center">
                <Code className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">
                  {activeCat ? 'No templates for this category yet.' : (uiHints?.empty_states?.documents?.description || 'No procurement templates found.')}
                </p>
                <button onClick={() => navigate('/quick-latex')} className="mt-3 text-sm text-blue-600 font-medium hover:text-blue-700">
                  {uiHints?.empty_states?.documents?.cta_label || 'Create Template'}
                </button>
              </div>
            )}
          </section>

          {/* Right sidebar (1/3) */}
          <aside className="space-y-5">
            {/* Workflow Stats */}
            {isAppEnabled('clm') && dashboardData?.statistics?.by_workflow && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-gray-400" />
                  Workflow Status
                </h3>
                <div className="space-y-2.5">
                  {[
                    { label: 'Total', value: dashboardData.statistics.by_workflow.total || 0, color: 'text-gray-900' },
                    { label: 'Pending', value: dashboardData.statistics.by_workflow.pending || 0, color: 'text-yellow-600' },
                    { label: 'Completed', value: dashboardData.statistics.by_workflow.completed || 0, color: 'text-green-600' },
                    ...(dashboardData.statistics.by_workflow.overdue > 0 ? [{ label: 'Overdue', value: dashboardData.statistics.by_workflow.overdue, color: 'text-red-600' }] : []),
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{label}</span>
                      <span className={`text-sm font-semibold ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Documents */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Documents</h3>
              {recentDocs.length > 0 ? (
                <div className="space-y-0.5">
                  {recentDocs.slice(0, 6).map((doc) => (
                    <RecentDocRow key={doc.id} doc={doc} onClick={handleOpenDoc} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic py-4 text-center">No recent documents</p>
              )}
            </div>

            {/* Workflow Presets */}
            {isAppEnabled('clm') && workflowPresets.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Workflow Presets</h3>
                  <button onClick={() => navigate('/clm')} className="text-xs text-blue-600 hover:text-blue-700 font-medium">View all</button>
                </div>
                <div className="space-y-2">
                  {workflowPresets.map((preset) => (
                    <WorkflowPresetCard key={preset.key} preset={preset} onClick={handleWorkflowPreset} />
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ProcurementDashboard;
