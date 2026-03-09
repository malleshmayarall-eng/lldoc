/**
 * WorkflowPanel — Unified workflow sidebar panel
 *
 * Single panel replaces the old separate Workflows, Decision Workflow,
 * and Activity Feed panels.  Tabs:
 *   • Workflows  – list existing workflows, create new ones (inline)
 *   • Decisions  – decision steps with approve/reject
 *   • Activity   – unified feed (comments, approvals, alerts, decisions)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitBranch,
  Plus,
  Trash2,
  User,
  Users,
  Mail,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  Send,
  AlertCircle,
  Bell,
  MessageSquare,
  FileCheck,
  Reply,
  Share2,
  RefreshCw,
  X,
  Search,
} from 'lucide-react';
import api from '../services/api';
import { workflowService } from '../services/workflowService';
import { getDocumentActivityFeed } from '../services/viewerService';
import WorkflowComments from './WorkflowComments';

// ─── Activity feed icon mappings ───────────────────────────────
const FEED_ICONS = {
  comment:  { icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-50' },
  approval: { icon: FileCheck,     color: 'text-green-600', bg: 'bg-green-50' },
  alert:    { icon: Bell,          color: 'text-amber-600', bg: 'bg-amber-50' },
  decision: { icon: GitBranch,     color: 'text-purple-600', bg: 'bg-purple-50' },
};
const ALERT_SUB_ICONS = {
  new_comment: MessageSquare, comment_reply: Reply, comment_resolved: CheckCircle,
  comment_deleted: Trash2, approval_submitted: FileCheck, document_shared: Share2,
};

// ─── Status helpers ─────────────────────────────────────────────
const statusIcon = (s) => {
  if (s === 'approved' || s === 'completed') return <CheckCircle className="h-4 w-4 text-green-600" />;
  if (s === 'rejected') return <XCircle className="h-4 w-4 text-red-600" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
};

const statusBadge = (s) => {
  const base = 'px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border';
  if (s === 'approved' || s === 'completed') return `${base} bg-green-50 text-green-700 border-green-200`;
  if (s === 'rejected') return `${base} bg-red-50 text-red-700 border-red-200`;
  return `${base} bg-amber-50 text-amber-700 border-amber-200`;
};

const priorityBadge = (p) => {
  const map = {
    urgent: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-blue-50 text-blue-700 border-blue-200',
    low: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return map[p] || map.medium;
};

const timeAgo = (ts) => {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

const TABS = [
  { key: 'workflows', label: 'Workflows' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'activity',  label: 'Activity' },
];

const WorkflowPanel = ({
  documentId,
  canModifyContent = false,
  onCreateWorkflow,          // opens the WorkflowAssignment modal
  documentWorkflows = [],    // from store, already filtered for this doc
  workflowsLoading = false,
  onClose,
}) => {
  const [tab, setTab] = useState('workflows');

  // ─── Decision state ────────────────────────────────────────────
  const [decisionView, setDecisionView] = useState('list');
  const [decisionWorkflows, setDecisionWorkflows] = useState([]);
  const [decisionLoading, setDecisionLoading] = useState(true);
  const [expandedWf, setExpandedWf] = useState(null);
  const [wfSteps, setWfSteps] = useState({});
  const [pendingSteps, setPendingSteps] = useState([]);
  const [decidingStep, setDecidingStep] = useState(null);
  const [decisionComment, setDecisionComment] = useState('');

  // Create decision form
  const [dcPriority, setDcPriority] = useState('medium');
  const [dcMessage, setDcMessage] = useState('');
  const [dcSteps, setDcSteps] = useState([
    { order: 1, target_type: 'user', target_user: '', target_team: '', target_email: '', title: '', description: '', on_reject_action: 'revision_required', _userLabel: '', _teamLabel: '' },
  ]);
  const [dcCreating, setDcCreating] = useState(false);
  const [dcError, setDcError] = useState('');

  // Decision form: member search & team picker (per-step)
  const [dcMemberQuery, setDcMemberQuery] = useState({});      // { [stepIdx]: 'search text' }
  const [dcMemberResults, setDcMemberResults] = useState({});   // { [stepIdx]: [member, …] }
  const [dcMemberLoading, setDcMemberLoading] = useState({});   // { [stepIdx]: bool }
  const [dcTeams, setDcTeams] = useState([]);
  const [dcTeamsLoading, setDcTeamsLoading] = useState(false);
  const [dcTeamDropdownOpen, setDcTeamDropdownOpen] = useState({}); // { [stepIdx]: bool }

  // ─── Activity state ────────────────────────────────────────────
  const [feed, setFeed] = useState([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [feedPage, setFeedPage] = useState(1);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedFilter, setFeedFilter] = useState('all');

  // ─── Expanded workflow comments ────────────────────────────────
  const [expandedComments, setExpandedComments] = useState(null);

  // ═══════════════════════════════════════════════════════════════
  // DATA LOADING
  // ═══════════════════════════════════════════════════════════════

  // Decisions
  const loadDecisionWorkflows = useCallback(async () => {
    if (!documentId) return;
    setDecisionLoading(true);
    try {
      const data = await workflowService.getWorkflows({ document: documentId });
      const list = data.results || data.workflows || data || [];
      setDecisionWorkflows(Array.isArray(list) ? list : []);
    } catch { setDecisionWorkflows([]); }
    finally { setDecisionLoading(false); }
  }, [documentId]);

  const loadPendingSteps = useCallback(async () => {
    try {
      const data = await workflowService.getMyPendingDecisions();
      setPendingSteps(data.steps || []);
    } catch { setPendingSteps([]); }
  }, []);

  // Activity
  const loadFeed = useCallback(async (pageNum = 1, append = false) => {
    if (!documentId) return;
    if (pageNum === 1) setFeedLoading(true);
    else setFeedLoadingMore(true);
    try {
      const data = await getDocumentActivityFeed(documentId, { page: pageNum, page_size: 30 });
      setFeedTotal(data.total || 0);
      if (append) setFeed((prev) => [...prev, ...(data.feed || [])]);
      else setFeed(data.feed || []);
      setFeedPage(pageNum);
    } catch { if (!append) setFeed([]); }
    finally { setFeedLoading(false); setFeedLoadingMore(false); }
  }, [documentId]);

  // Load on mount / tab switch
  useEffect(() => {
    if (tab === 'decisions') { loadDecisionWorkflows(); loadPendingSteps(); }
    if (tab === 'activity') loadFeed(1);
  }, [tab, loadDecisionWorkflows, loadPendingSteps, loadFeed]);

  // Load teams for decision form
  useEffect(() => {
    if (tab === 'decisions' && decisionView === 'create' && dcTeams.length === 0) {
      (async () => {
        setDcTeamsLoading(true);
        try {
          const res = await api.get('/documents/workflows/get_teams/');
          setDcTeams(res.data.teams || []);
        } catch { /* silent */ }
        finally { setDcTeamsLoading(false); }
      })();
    }
  }, [tab, decisionView]);

  // Debounced member search per step
  useEffect(() => {
    const timers = {};
    Object.entries(dcMemberQuery).forEach(([idx, query]) => {
      if (!query || query.length < 2) {
        setDcMemberResults((prev) => ({ ...prev, [idx]: [] }));
        return;
      }
      timers[idx] = setTimeout(async () => {
        setDcMemberLoading((prev) => ({ ...prev, [idx]: true }));
        try {
          const res = await api.get('/documents/workflows/search_team_members/', {
            params: { q: query, exclude_self: true, limit: 10 },
          });
          setDcMemberResults((prev) => ({ ...prev, [idx]: res.data.members || [] }));
        } catch {
          setDcMemberResults((prev) => ({ ...prev, [idx]: [] }));
        }
        setDcMemberLoading((prev) => ({ ...prev, [idx]: false }));
      }, 300);
    });
    return () => Object.values(timers).forEach(clearTimeout);
  }, [dcMemberQuery]);

  // ═══════════════════════════════════════════════════════════════
  // DECISION HANDLERS
  // ═══════════════════════════════════════════════════════════════

  const toggleWf = async (wfId) => {
    if (expandedWf === wfId) { setExpandedWf(null); return; }
    setExpandedWf(wfId);
    if (!wfSteps[wfId]) {
      try {
        const data = await workflowService.getDecisionStepsByWorkflow(wfId);
        setWfSteps((prev) => ({ ...prev, [wfId]: data.decision_steps || [] }));
      } catch { setWfSteps((prev) => ({ ...prev, [wfId]: [] })); }
    }
  };

  const handleDecision = async (stepId, decision) => {
    setDecidingStep(stepId);
    try {
      await workflowService.submitDecision(stepId, decision, decisionComment);
      setDecisionComment(''); setDecidingStep(null);
      loadDecisionWorkflows(); loadPendingSteps();
    } catch { setDecidingStep(null); }
  };

  // Create decision workflow
  const addDcStep = () => setDcSteps((prev) => [...prev, { order: prev.length + 1, target_type: 'user', target_user: '', target_team: '', target_email: '', title: '', description: '', on_reject_action: 'revision_required', _userLabel: '', _teamLabel: '' }]);
  const removeDcStep = (idx) => setDcSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  const updateDcStep = (idx, field, value) => setDcSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));

  const handleCreateDecision = async () => {
    setDcError('');
    const validSteps = dcSteps.filter((s) => {
      if (s.target_type === 'user' && !s.target_user) return false;
      if (s.target_type === 'team' && !s.target_team) return false;
      if (s.target_type === 'email' && !s.target_email) return false;
      return true;
    });
    if (!validSteps.length) { setDcError('At least one valid step is required.'); return; }
    setDcCreating(true);
    try {
      await workflowService.createWorkflowWithSteps({
        document: documentId, priority: dcPriority, message: dcMessage,
        steps: validSteps.map((s) => ({
          order: s.order, target_type: s.target_type,
          ...(s.target_type === 'user' && { target_user: parseInt(s.target_user) }),
          ...(s.target_type === 'team' && { target_team: s.target_team }),
          ...(s.target_type === 'email' && { target_email: s.target_email }),
          title: s.title, description: s.description, on_reject_action: s.on_reject_action,
        })),
      });
      setDecisionView('list');
      setDcSteps([{ order: 1, target_type: 'user', target_user: '', target_team: '', target_email: '', title: '', description: '', on_reject_action: 'revision_required', _userLabel: '', _teamLabel: '' }]);
      setDcMessage('');
      setDcMemberQuery({});
      setDcMemberResults({});
      setDcTeamDropdownOpen({});
      loadDecisionWorkflows();
    } catch (err) { setDcError(err.response?.data?.error || 'Failed to create workflow.'); }
    finally { setDcCreating(false); }
  };

  // ─── Filtered feed ──────────────────────────────────────────
  const filteredFeed = feedFilter === 'all' ? feed : feed.filter((item) => item.type === feedFilter);
  const feedHasMore = feed.length < feedTotal;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <GitBranch className="h-4 w-4 text-blue-600" />
          Workflow
        </h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 mb-3">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 pb-2 text-xs font-medium text-center border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ═══ TAB: Workflows ═══════════════════════════════════ */}
        {tab === 'workflows' && (
          <div className="space-y-3">
            {/* Create button */}
            {canModifyContent && (
              <button
                onClick={onCreateWorkflow}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New Workflow
              </button>
            )}

            {workflowsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : documentWorkflows.length === 0 ? (
              <div className="text-center py-10">
                <GitBranch className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No workflows yet</p>
                <p className="text-xs text-gray-400 mt-1">Create one to assign tasks and track progress</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documentWorkflows.map((wf) => {
                  const st = wf.current_status || wf.status;
                  const name = wf.assigned_to_info
                    ? `${wf.assigned_to_info.first_name} ${wf.assigned_to_info.last_name}`.trim() || wf.assigned_to_info.email
                    : wf.assigned_user_name || 'Unassigned';

                  return (
                    <div key={wf.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      {/* Summary row */}
                      <div className="p-3 flex items-start gap-2.5">
                        <div className="mt-0.5">{statusIcon(st)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={statusBadge(st)}>
                              {st?.replace(/_/g, ' ')}
                            </span>
                            {wf.priority && wf.priority !== 'medium' && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${priorityBadge(wf.priority)}`}>
                                {wf.priority}
                              </span>
                            )}
                          </div>
                          {wf.message && (
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2">{wf.message}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" /> {name}
                            </span>
                            {wf.due_date && (
                              <span>Due {new Date(wf.due_date).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Comments toggle */}
                      <div className="border-t border-gray-100">
                        <button
                          onClick={() => setExpandedComments(expandedComments === wf.id ? null : wf.id)}
                          className="w-full px-3 py-1.5 flex items-center gap-1.5 text-[11px] text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                          <MessageSquare className="h-3 w-3" />
                          {wf.comments_count > 0 ? `${wf.comments_count} comment${wf.comments_count !== 1 ? 's' : ''}` : 'Comments'}
                          <ChevronDown className={`h-3 w-3 ml-auto transition-transform ${expandedComments === wf.id ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedComments === wf.id && (
                          <div className="px-3 pb-3 border-t border-gray-100">
                            <WorkflowComments workflowId={wf.id} compact={true} />
                          </div>
                        )}
                      </div>

                      {/* Approval status */}
                      {wf.approval_status && (
                        <div className="px-3 py-1.5 border-t border-gray-100 flex items-center gap-1.5 text-[11px]">
                          <span className="text-gray-400">Approval:</span>
                          {statusIcon(wf.approval_status)}
                          <span className="capitalize text-gray-600">{wf.approval_status}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: Decisions ═══════════════════════════════════ */}
        {tab === 'decisions' && (
          <div className="space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between">
              {decisionView === 'list' ? (
                <button
                  onClick={() => setDecisionView('create')}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> New
                </button>
              ) : (
                <button onClick={() => setDecisionView('list')} className="text-xs text-gray-500 hover:text-gray-700 font-medium">← Back</button>
              )}
            </div>

            {/* Pending decisions */}
            {pendingSteps.length > 0 && decisionView === 'list' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <h4 className="text-xs font-bold text-amber-800 mb-2 uppercase tracking-wide">
                  ⚡ Your Pending Decisions ({pendingSteps.length})
                </h4>
                <div className="space-y-2">
                  {pendingSteps.map((step) => (
                    <div key={step.id} className="bg-white rounded-lg border border-amber-100 p-2.5">
                      <p className="text-sm font-medium text-gray-800">{step.title || `Step ${step.order}`}</p>
                      {step.description && <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>}
                      <div className="flex items-center gap-1.5 mt-2">
                        <input
                          type="text"
                          value={decidingStep === step.id ? decisionComment : ''}
                          onChange={(e) => { setDecidingStep(step.id); setDecisionComment(e.target.value); }}
                          placeholder="Comment (optional)"
                          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => handleDecision(step.id, 'approved')}
                          className="px-2.5 py-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100"
                        >✓ Yes</button>
                        <button
                          onClick={() => handleDecision(step.id, 'rejected')}
                          className="px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100"
                        >✗ No</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Decision list */}
            {decisionView === 'list' && (
              <div className="space-y-2">
                {decisionLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                ) : decisionWorkflows.length === 0 ? (
                  <div className="text-center py-8">
                    <GitBranch className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">No decision workflows</p>
                    <p className="text-xs text-gray-400 mt-1">Create one to route decisions</p>
                  </div>
                ) : (
                  decisionWorkflows.map((wf) => (
                    <div key={wf.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <button onClick={() => toggleWf(wf.id)} className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-2">
                          {statusIcon(wf.current_status)}
                          <div className="text-left">
                            <p className="text-sm font-medium text-gray-800">{wf.message?.slice(0, 50) || wf.current_status?.replace(/_/g, ' ')}</p>
                            <p className="text-[11px] text-gray-400">{wf.priority} · {new Date(wf.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <span className={statusBadge(wf.current_status)}>{wf.current_status?.replace(/_/g, ' ')}</span>
                      </button>

                      {expandedWf === wf.id && (
                        <div className="border-t border-gray-100 bg-gray-50 p-3 space-y-2">
                          {(wfSteps[wf.id] || []).length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-2">No decision steps</p>
                          ) : (
                            (wfSteps[wf.id] || []).map((step, idx) => (
                              <div key={step.id} className="flex items-start gap-2">
                                <div className="flex flex-col items-center mt-0.5">
                                  {statusIcon(step.decision_status)}
                                  {idx < (wfSteps[wf.id] || []).length - 1 && <div className="w-px h-6 bg-gray-300 my-0.5" />}
                                </div>
                                <div className="flex-1 bg-white rounded border border-gray-200 p-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold text-gray-700">{step.title || `Step ${step.order}`}</p>
                                    <span className={statusBadge(step.decision_status)}>{step.decision_status}</span>
                                  </div>
                                  <p className="text-[11px] text-gray-500 mt-0.5">
                                    {step.target_type === 'user' && step.target_user_info && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {step.target_user_info.first_name} {step.target_user_info.last_name}</span>}
                                    {step.target_type === 'team' && step.target_team_info && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {step.target_team_info.name}</span>}
                                    {step.target_type === 'email' && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {step.target_email}</span>}
                                  </p>
                                  {step.decision_comment && <p className="text-[11px] text-gray-500 mt-1 italic">"{step.decision_comment}"</p>}
                                  {step.decided_at && <p className="text-[10px] text-gray-400 mt-0.5">{new Date(step.decided_at).toLocaleString()}</p>}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Create decision form */}
            {decisionView === 'create' && (
              <div className="space-y-3">
                {/* Priority */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Priority</label>
                  <div className="grid grid-cols-4 gap-1">
                    {['low', 'medium', 'high', 'urgent'].map((p) => (
                      <button
                        key={p}
                        onClick={() => setDcPriority(p)}
                        className={`py-1.5 text-[11px] font-medium rounded border transition-all capitalize ${
                          dcPriority === p ? `${priorityBadge(p)}` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >{p}</button>
                    ))}
                  </div>
                </div>

                {/* Message */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Instructions</label>
                  <textarea value={dcMessage} onChange={(e) => setDcMessage(e.target.value)} placeholder="What should reviewers check…" rows={2} className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>

                {/* Steps */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-700">Decision Steps</label>
                    <button onClick={addDcStep} className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700 font-medium"><Plus className="h-3 w-3" /> Add</button>
                  </div>
                  <div className="space-y-2">
                    {dcSteps.map((step, idx) => (
                      <div key={idx} className="bg-gray-50 rounded-lg border border-gray-200 p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-600">Step {idx + 1}</span>
                          {dcSteps.length > 1 && <button onClick={() => removeDcStep(idx)} className="text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
                        </div>
                        <input type="text" value={step.title} onChange={(e) => updateDcStep(idx, 'title', e.target.value)} placeholder="Step title" className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500" />
                        <div className="grid grid-cols-3 gap-1">
                          {[{ value: 'user', icon: User, label: 'User' }, { value: 'team', icon: Users, label: 'Team' }, { value: 'email', icon: Mail, label: 'Email' }].map((opt) => {
                            const Icon = opt.icon;
                            return (
                              <button key={opt.value} onClick={() => updateDcStep(idx, 'target_type', opt.value)} className={`flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium rounded border transition-all ${step.target_type === opt.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                <Icon className="h-3 w-3" />{opt.label}
                              </button>
                            );
                          })}
                        </div>
                        {/* User search picker */}
                        {step.target_type === 'user' && (
                          <div className="relative">
                            {step.target_user && step._userLabel ? (
                              <div className="flex items-center justify-between px-2 py-1.5 text-xs border border-green-300 bg-green-50 rounded">
                                <span className="flex items-center gap-1.5">
                                  <User className="h-3 w-3 text-green-600" />
                                  <span className="font-medium text-green-800">{step._userLabel}</span>
                                </span>
                                <button onClick={() => { updateDcStep(idx, 'target_user', ''); updateDcStep(idx, '_userLabel', ''); }} className="text-gray-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                              </div>
                            ) : (
                              <>
                                <div className="relative">
                                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                                  <input
                                    type="text"
                                    value={dcMemberQuery[idx] || ''}
                                    onChange={(e) => setDcMemberQuery((prev) => ({ ...prev, [idx]: e.target.value }))}
                                    placeholder="Search by name or email…"
                                    className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                                  />
                                  {dcMemberLoading[idx] && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-gray-400" />}
                                </div>
                                {(dcMemberResults[idx] || []).length > 0 && (
                                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                    {dcMemberResults[idx].map((member) => (
                                      <button
                                        key={member.id}
                                        onClick={() => {
                                          updateDcStep(idx, 'target_user', member.id);
                                          updateDcStep(idx, '_userLabel', member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email);
                                          setDcMemberQuery((prev) => ({ ...prev, [idx]: '' }));
                                          setDcMemberResults((prev) => ({ ...prev, [idx]: [] }));
                                        }}
                                        className="w-full text-left px-2.5 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-gray-100 last:border-0"
                                      >
                                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                          <User className="h-3 w-3 text-blue-600" />
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-xs font-medium text-gray-800 truncate">{member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim()}</p>
                                          <p className="text-[10px] text-gray-500 truncate">{member.email}</p>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Team dropdown picker */}
                        {step.target_type === 'team' && (
                          <div className="relative">
                            {step.target_team && step._teamLabel ? (
                              <div className="flex items-center justify-between px-2 py-1.5 text-xs border border-green-300 bg-green-50 rounded">
                                <span className="flex items-center gap-1.5">
                                  <Users className="h-3 w-3 text-green-600" />
                                  <span className="font-medium text-green-800">{step._teamLabel}</span>
                                </span>
                                <button onClick={() => { updateDcStep(idx, 'target_team', ''); updateDcStep(idx, '_teamLabel', ''); }} className="text-gray-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => setDcTeamDropdownOpen((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs border border-gray-300 rounded hover:border-gray-400 focus:ring-1 focus:ring-blue-500 bg-white"
                                >
                                  <span className="text-gray-500">Select a team…</span>
                                  <ChevronDown className="h-3 w-3 text-gray-400" />
                                </button>
                                {dcTeamDropdownOpen[idx] && (
                                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                    {dcTeamsLoading ? (
                                      <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
                                    ) : dcTeams.length === 0 ? (
                                      <p className="text-xs text-gray-500 text-center py-3">No teams found</p>
                                    ) : (
                                      dcTeams.map((team) => (
                                        <button
                                          key={team.id}
                                          onClick={() => {
                                            updateDcStep(idx, 'target_team', team.id);
                                            updateDcStep(idx, '_teamLabel', team.name);
                                            setDcTeamDropdownOpen((prev) => ({ ...prev, [idx]: false }));
                                          }}
                                          className="w-full text-left px-2.5 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-gray-100 last:border-0"
                                        >
                                          <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                                            <Users className="h-3 w-3 text-purple-600" />
                                          </div>
                                          <div className="min-w-0">
                                            <p className="text-xs font-medium text-gray-800 truncate">{team.name}</p>
                                            <p className="text-[10px] text-gray-500 truncate">{team.members_count || '?'} members{team.team_lead ? ` · Lead: ${team.team_lead}` : ''}</p>
                                          </div>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Email input (unchanged) */}
                        {step.target_type === 'email' && <input type="email" value={step.target_email} onChange={(e) => updateDcStep(idx, 'target_email', e.target.value)} placeholder="reviewer@example.com" className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500" />}
                        <select value={step.on_reject_action} onChange={(e) => updateDcStep(idx, 'on_reject_action', e.target.value)} className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded bg-white focus:ring-1 focus:ring-blue-500">
                          <option value="revision_required">On Reject: Request Revision</option>
                          <option value="stop">On Reject: Stop Workflow</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {dcError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{dcError}
                  </div>
                )}

                <button onClick={handleCreateDecision} disabled={dcCreating} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
                  {dcCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {dcCreating ? 'Creating…' : 'Create Decision Workflow'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══ TAB: Activity ════════════════════════════════════ */}
        {tab === 'activity' && (
          <div className="space-y-3">
            {/* Filters */}
            <div className="flex gap-1 flex-wrap">
              {[
                { key: 'all', label: 'All' },
                { key: 'comment', label: 'Comments' },
                { key: 'approval', label: 'Approvals' },
                { key: 'decision', label: 'Decisions' },
                { key: 'alert', label: 'Alerts' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFeedFilter(key)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-full transition-all ${
                    feedFilter === key
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-500 border border-transparent hover:bg-gray-200'
                  }`}
                >{label}</button>
              ))}
              <button onClick={() => loadFeed(1)} className="ml-auto text-gray-400 hover:text-gray-600" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${feedLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <p className="text-[11px] text-gray-400">{feedTotal} activit{feedTotal !== 1 ? 'ies' : 'y'}</p>

            {feedLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : filteredFeed.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No activity yet</p>
              </div>
            ) : (
              <div className="space-y-0">
                {filteredFeed.map((item, idx) => {
                  const meta = FEED_ICONS[item.type] || FEED_ICONS.alert;
                  const Icon = item.type === 'alert' && item.alert_type ? (ALERT_SUB_ICONS[item.alert_type] || Bell) : meta.icon;
                  return (
                    <div key={`${item.type}-${item.id}-${idx}`} className="flex gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${meta.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs text-gray-800 leading-snug">
                            <span className="font-semibold">{item.author || 'Unknown'}</span>{' '}
                            <span className="text-gray-600">{item.message}</span>
                          </p>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">{timeAgo(item.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {item.type === 'comment' && item.is_reply && <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">Reply</span>}
                          {item.type === 'comment' && item.is_resolved && <span className="text-[9px] px-1.5 py-0.5 bg-green-50 text-green-600 border border-green-200 rounded-full font-medium">Resolved</span>}
                          {item.type === 'approval' && item.status && <span className={statusBadge(item.status)}>{item.status?.replace(/_/g, ' ')}</span>}
                          {item.type === 'decision' && item.decision_status && <span className={statusBadge(item.decision_status)}>{item.decision_status === 'approved' ? 'Yes' : item.decision_status === 'rejected' ? 'No' : 'Pending'}</span>}
                          {item.type === 'alert' && !item.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Unread" />}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {feedHasMore && (
                  <button onClick={() => loadFeed(feedPage + 1, true)} disabled={feedLoadingMore} className="w-full py-2 text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1">
                    {feedLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {feedLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkflowPanel;
