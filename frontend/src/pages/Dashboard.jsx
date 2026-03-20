import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { documentService } from '../services/documentService';
import { openDocumentInEditor } from '../utils/documentRouting';
import useWorkflowStore from '../store/workflowStore';
import { FileText, AlertTriangle, CheckCircle, Clock, TrendingUp, ListTodo, Bell, Share2, Activity, Eye, MessageSquare, Edit3, Calendar, User as UserIcon, ArrowRight, AlertCircle as AlertCircleIcon, Sparkles, Zap, Target, ShieldCheck, History, FileCheck } from 'lucide-react';

import api from '../services/api';

const AI_DASHBOARD_SETTINGS_KEY = 'dashboard_ai_settings';

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { fetchMyTasks, fetchMyApprovals, fetchUnreadNotifications, myTasks, myApprovals, unreadCount } = useWorkflowStore();
  const [dashboardData, setDashboardData] = useState(null);
  const [sharedDocuments, setSharedDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState('week');
  const [username, setUsername] = useState('');
  const [aiAssistant, setAiAssistant] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);
  const openCreateDialog = () => {
    window.dispatchEvent(new CustomEvent('openCreateDocumentDialog'));
  };

  useEffect(() => {
    api.get('/documents/user-info/')
      .then(res => setUsername(res.data.username))
      .catch(() => setUsername(''));
    // Fetch AI dashboard assistant data
    let aiConfig = { enabled: true, provider: 'ollama', model: 'llama3.2' };
    try {
      const raw = localStorage.getItem(AI_DASHBOARD_SETTINGS_KEY);
      if (raw) aiConfig = { ...aiConfig, ...JSON.parse(raw) };
    } catch {
      // ignore parse errors and use defaults
    }

    setAiLoading(true);
    if (!aiConfig.enabled) {
      setAiAssistant({
        status: 'disabled',
        ai_summary: '',
        recommendations: [],
        urgent_items: [],
        document_updates: [],
        ai_provider: 'disabled',
      });
      setAiLoading(false);
    } else {
      api.get('/ai/dashboard-assistant/', {
        params: {
          provider: aiConfig.provider,
          model: aiConfig.model,
        },
      })
        .then(res => setAiAssistant(res.data))
        .catch(() => setAiAssistant(null))
        .finally(() => setAiLoading(false));
    }
  }, []);
  useEffect(() => {
    loadDashboardData();
  }, [timeframe]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch complete dashboard overview from new API
      try {
        const response = await documentService.getDashboardOverview({
          timeframe,
          include_stats: true,
          include_recent: true,
          limit: 5
        });
        setDashboardData(response);
      } catch (error) {
        console.error('Error loading dashboard overview:', error);
        // Set empty state on error
        setDashboardData({
          my_documents: { total: 0, recent: [] },
          statistics: {
            by_status: {},
            by_workflow: {},
            shares: { total: 0, shared_by_me: 0, shared_with_me: 0 }
          },
          recent_activity: []
        });
      }
      
      // Fetch shared documents with access levels
      try {
        const sharedResponse = await documentService.getSharedWithMe();
        // Handle both array and object with results property
        const sharedDocs = Array.isArray(sharedResponse) 
          ? sharedResponse 
          : sharedResponse?.results || [];
        console.log('Shared documents sample:', sharedDocs[0]); // Debug: log first document structure
        setSharedDocuments(sharedDocs.slice(0, 5));
      } catch (error) {
        console.error('Error loading shared documents:', error);
        setSharedDocuments([]);
      }
      
      // Also load workflow data for backwards compatibility (optional, may not exist)
      try {
        await Promise.all([
          fetchMyTasks().catch(err => console.warn('Tasks API not available:', err)),
          fetchMyApprovals().catch(err => console.warn('Approvals API not available:', err)),
          fetchUnreadNotifications().catch(err => console.warn('Notifications API not available:', err))
        ]);
      } catch (error) {
        console.warn('Some workflow endpoints not available:', error);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'My Documents',
      value: dashboardData?.my_documents?.total || 0,
      icon: FileText,
      color: 'blue',
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600',
      onClick: () => navigate('/documents'),
    },
    {
      title: 'Pending Workflows',
      value: dashboardData?.my_workflows?.pending || 0,
      icon: ListTodo,
      color: 'purple',
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-600',
      onClick: () => navigate('/tasks'),
    },
    {
      title: 'Pending Approvals',
      value: dashboardData?.pending_approvals?.total || 0,
      icon: CheckCircle,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
      onClick: () => navigate('/approvals'),
    },
    {
      title: 'Shared Documents',
      value: dashboardData?.shared_documents?.total || 0,
      icon: Share2,
      color: 'orange',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600',
      onClick: () => navigate('/shared'),
    },
  ];

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

  const getAccessLevelBadge = (accessLevel) => {
    const badges = {
      viewer: { 
        color: 'bg-gray-100 text-gray-700', 
        icon: Eye, 
        label: 'Viewer' 
      },
      commentor: { 
        color: 'bg-blue-100 text-blue-700', 
        icon: MessageSquare, 
        label: 'Commentor' 
      },
      editor: { 
        color: 'bg-green-100 text-green-700', 
        icon: Edit3, 
        label: 'Editor' 
      },
    };
    return badges[accessLevel] || badges.viewer;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome back, <span className="text-red-500 inline underline">{username ? username : user?.first_name || 'User'}</span>!
            </h1>
          </div>
          {/* Timeframe Selector */}
          <div className="flex gap-2">
            {['today', 'week', 'month', 'all'].map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {tf.charAt(0).toUpperCase() + tf.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat) => (
          <div
            key={stat.title}
            onClick={stat.onClick}
            className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow ${stat.onClick ? 'cursor-pointer' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">{stat.title}</p>
                <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
              </div>
              <div className={`${stat.bgColor} p-3 rounded-lg`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Assistant Panel */}
      <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-blue-50 rounded-xl border border-indigo-200 mb-8 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-2.5 rounded-lg">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI Document Briefing</h2>
              <p className="text-xs text-gray-500">
                {(() => {
                  const p = aiAssistant?.ai_provider || '';
                  if (p.startsWith('ollama:')) return `Powered by Ollama · ${p.split(':')[1]}`;
                  if (p === 'gemini') return 'Powered by Gemini';
                  if (p === 'fallback') return 'Rule-based summary';
                  if (p === 'disabled') return 'AI assistant disabled';
                  return 'Powered by AI';
                })()}
              </p>
            </div>
          </div>

          {aiLoading ? (
            <div className="flex items-center gap-3 py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
              <span className="text-sm text-gray-500">Preparing your document briefing...</span>
            </div>
          ) : aiAssistant ? (
            <div className="space-y-4">
              {/* AI Summary */}
              {aiAssistant.ai_summary && (
                <div className="bg-white/70 rounded-lg p-4 border border-indigo-100">
                  <p className="text-sm text-gray-800 leading-relaxed">{aiAssistant.ai_summary}</p>
                </div>
              )}

              {/* Urgent Items */}
              {aiAssistant.urgent_items?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    Needs Attention
                  </h3>
                  {aiAssistant.urgent_items.map((item, idx) => (
                    <div key={idx} className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
                      <Zap className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
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
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <History className="h-4 w-4" />
                    Recent Document Updates
                  </h3>
                  <div className="bg-white/70 rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {aiAssistant.document_updates.slice(0, 5).map((update, idx) => (
                      <div key={idx} className="p-3 flex items-start gap-3 hover:bg-white/90 transition-colors">
                        <div className="mt-0.5 flex-shrink-0">
                          <FileCheck className="h-4 w-4 text-indigo-500" />
                        </div>
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
                          {update.updated_at && (
                            <p className="text-[10px] text-gray-400 mt-1">
                              {new Date(update.updated_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {aiAssistant.recommendations?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <Target className="h-4 w-4" />
                    Recommendations
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {aiAssistant.recommendations.map((rec, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if (rec.action_type === 'navigate_approvals') navigate('/approvals');
                          else if (rec.action_type === 'navigate_tasks') navigate('/tasks');
                          else if (rec.action_type === 'navigate_notifications') navigate('/notifications');
                          else if (rec.action_type === 'create_document') openCreateDialog();
                          else navigate('/documents');
                        }}
                        className="bg-white/80 hover:bg-white border border-gray-200 hover:border-indigo-300 rounded-lg p-3 text-left transition-all group"
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
                          <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-indigo-500 mt-0.5 flex-shrink-0" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : aiAssistant?.status === 'disabled' ? (
            <div className="bg-white/70 rounded-lg p-4 border border-indigo-100 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-500">
                Dashboard AI Assistant is turned off. Enable it in Settings to get AI-powered insights.
              </p>
              <button
                onClick={() => navigate('/settings')}
                className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
              >
                Open Settings
              </button>
            </div>
          ) : (
            <div className="bg-white/70 rounded-lg p-4 border border-indigo-100 flex items-center justify-between gap-4">
              <p className="text-sm text-gray-500">
                AI assistant is not available right now. Make sure Ollama is running (<code className="bg-gray-100 px-1 rounded">ollama serve</code>) or configure a provider in Settings.
              </p>
              <button
                onClick={() => navigate('/settings')}
                className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline"
              >
                Settings
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Approvals & Tasks — Unified Side-by-Side Panel */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
          {/* Left: Approvals */}
          <div className="flex flex-col">
            <div className="p-5 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <ShieldCheck className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Approvals</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(dashboardData?.pending_approvals?.total > 0 || (myApprovals && myApprovals.length > 0))
                        ? `${dashboardData?.pending_approvals?.total || myApprovals?.length || 0} pending`
                        : 'All caught up'
                      }
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/approvals')}
                  className="text-xs font-medium text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-100/50 transition-colors"
                >
                  View all
                </button>
              </div>
            </div>
            {dashboardData?.pending_approvals?.items?.length > 0 || (myApprovals && myApprovals.length > 0) ? (
              <div className="flex-1 divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {(dashboardData?.pending_approvals?.items || myApprovals || []).slice(0, 4).map((approval) => (
                  <div
                    key={approval.id}
                    onClick={() => navigate(approval.workflow?.document ? `/drafter/${approval.workflow.document}` : '/approvals')}
                    className="p-3.5 hover:bg-green-50/50 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-green-700">
                          {approval.document_title || approval.workflow?.document_title || 'Untitled'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {(approval.workflow_name || approval.workflow?.name) && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-100 text-blue-700 truncate max-w-[120px]">
                              {approval.workflow_name || approval.workflow?.name}
                            </span>
                          )}
                          {approval.role && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700 truncate">
                              {approval.role}
                            </span>
                          )}
                          {approval.is_required && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 text-red-700">
                              Required
                            </span>
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
                  <CheckCircle className="h-8 w-8 text-green-200 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">No pending approvals</p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Tasks */}
          <div className="flex flex-col">
            <div className="p-5 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-violet-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <ListTodo className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Tasks</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {myTasks && myTasks.length > 0
                        ? `${myTasks.length} assigned`
                        : 'No tasks'
                      }
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/tasks')}
                  className="text-xs font-medium text-purple-600 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-100/50 transition-colors"
                >
                  View all
                </button>
              </div>
            </div>
            {myTasks && myTasks.length > 0 ? (
              <div className="flex-1 divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {myTasks.slice(0, 4).map((task) => {
                  const isOverdue = task.due_date && new Date(task.due_date) < new Date();
                  const priorityColors = {
                    urgent: 'bg-red-100 text-red-700',
                    high: 'bg-orange-100 text-orange-700',
                    medium: 'bg-yellow-100 text-yellow-700',
                    low: 'bg-blue-100 text-blue-700',
                  };
                  const statusColors = {
                    draft: 'bg-gray-100 text-gray-700',
                    review: 'bg-blue-100 text-blue-700',
                    approved: 'bg-green-100 text-green-700',
                    revision_required: 'bg-yellow-100 text-yellow-700',
                    executed: 'bg-purple-100 text-purple-700',
                  };
                  const status = task.current_status || task.status;
                  return (
                    <div
                      key={task.id}
                      onClick={() => navigate(`/drafter/${task.document}`)}
                      className={`p-3.5 hover:bg-purple-50/50 cursor-pointer transition-colors group ${
                        isOverdue ? 'border-l-2 border-l-red-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate group-hover:text-purple-700">
                            {task.document_title || 'Untitled'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${priorityColors[task.priority] || priorityColors.medium}`}>
                              {task.priority}
                            </span>
                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusColors[status] || statusColors.draft}`}>
                              {status?.replace(/_/g, ' ')}
                            </span>
                            {task.due_date && (
                              <span className={`text-[9px] ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                                {isOverdue ? '⚠ ' : ''}
                                {new Date(task.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
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
                  <ListTodo className="h-8 w-8 text-purple-200 mx-auto mb-2" />
                  <p className="text-xs text-gray-500">No assigned tasks</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Statistics Breakdown */}
      {dashboardData?.statistics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Workflow Status */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Workflow Status</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total</span>
                <span className="text-sm font-semibold text-gray-900">
                  {dashboardData.statistics?.by_workflow?.total || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pending</span>
                <span className="text-sm font-semibold text-yellow-600">
                  {dashboardData.statistics?.by_workflow?.pending || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Completed</span>
                <span className="text-sm font-semibold text-green-600">
                  {dashboardData.statistics?.by_workflow?.completed || 0}
                </span>
              </div>
              {(dashboardData.statistics?.by_workflow?.overdue || 0) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Overdue</span>
                  <span className="text-sm font-semibold text-red-600">
                    {dashboardData.statistics?.by_workflow?.overdue || 0}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Sharing Stats */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Sharing Activity</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Shares</span>
                <span className="text-sm font-semibold text-gray-900">
                  {dashboardData.statistics?.shares?.total || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Shared by Me</span>
                <span className="text-sm font-semibold text-blue-600">
                  {dashboardData.statistics?.shares?.shared_by_me || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Shared with Me</span>
                <span className="text-sm font-semibold text-purple-600">
                  {dashboardData.statistics?.shares?.shared_with_me || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Recent Documents */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Recent Documents</h2>
            <button
              onClick={() => navigate('/documents')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View all
            </button>
          </div>
        </div>

        {(!dashboardData?.my_documents?.recent || dashboardData.my_documents.recent.length === 0) && 
         (!sharedDocuments || sharedDocuments.length === 0) ? (
          <div className="p-12 text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">No documents yet</p>
            <button
                onClick={openCreateDialog}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Create your first document
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {/* My Documents */}
            {dashboardData?.my_documents?.recent?.map((doc) => (
              <div
                key={`my-${doc.id}`}
                onClick={() => openDocumentInEditor(navigate, doc)}
                className="p-4 hover:bg-gray-50 cursor-pointer transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="bg-blue-50 p-2 rounded">
                      <FileText className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {doc.title}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {new Date(doc.created_at).toLocaleDateString()} • {doc.created_by}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {doc.status && (
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                          doc.status
                        )}`}
                      >
                        {doc.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Shared with Me Documents */}
            {sharedDocuments?.slice(0, 3).map((doc) => {
              const accessBadge = getAccessLevelBadge(doc.access_level);
              const AccessIcon = accessBadge.icon;
              
              return (
                <div
                  key={`shared-${doc.id}`}
                  onClick={() => openDocumentInEditor(navigate, doc)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="bg-orange-50 p-2 rounded">
                        <Share2 className="h-5 w-5 text-orange-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-900 truncate">
                          {doc.title}
                        </h3>
                        <p className="text-xs text-gray-500">
                          {doc.shared_by && `Shared by ${doc.shared_by}`}
                          {!doc.shared_by && doc.created_by && `By ${doc.created_by}`}
                          {(doc.shared_at || doc.created_at) && (
                            <>
                              {' • '}
                              {new Date(doc.shared_at || doc.created_at).toLocaleDateString()}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full flex items-center gap-1 ${accessBadge.color}`}>
                        <AccessIcon className="h-3 w-3" />
                        {accessBadge.label}
                      </span>
                      {doc.status && (
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(doc.status)}`}>
                          {doc.status.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {dashboardData?.recent_activity && dashboardData.recent_activity.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Recent Activity
            </h2>
          </div>
          <div className="divide-y divide-gray-200">
            {dashboardData.recent_activity.map((activity, index) => (
              <div key={index} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${
                    activity.type === 'document' ? 'bg-blue-50' :
                    activity.type === 'workflow' ? 'bg-purple-50' :
                    'bg-orange-50'
                  }`}>
                    {activity.type === 'document' && <FileText className="h-4 w-4 text-blue-600" />}
                    {activity.type === 'workflow' && <ListTodo className="h-4 w-4 text-purple-600" />}
                    {activity.type === 'share' && <Share2 className="h-4 w-4 text-orange-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium capitalize">{activity.type}</span>
                      {' '}<span className="text-gray-600">{activity.action}</span>
                      {activity.data.title && (
                        <>: <span className="font-medium">{activity.data.title}</span></>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(activity.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <button
          onClick={openCreateDialog}
          className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-600 hover:bg-blue-50 transition-all group"
        >
          <div className="text-center">
            <FileText className="h-8 w-8 text-gray-400 group-hover:text-blue-600 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-gray-900 mb-1">New Document</h3>
            <p className="text-xs text-gray-500">Create a new legal document</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/documents')}
          className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-600 hover:bg-blue-50 transition-all group"
        >
          <div className="text-center">
            <TrendingUp className="h-8 w-8 text-gray-400 group-hover:text-blue-600 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-gray-900 mb-1">View Analytics</h3>
            <p className="text-xs text-gray-500">Track document progress</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/settings')}
          className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-600 hover:bg-blue-50 transition-all group"
        >
          <div className="text-center">
            <CheckCircle className="h-8 w-8 text-gray-400 group-hover:text-blue-600 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-gray-900 mb-1">Settings</h3>
            <p className="text-xs text-gray-500">Manage preferences</p>
          </div>
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
