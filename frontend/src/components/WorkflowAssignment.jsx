import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  X, Plus, Search, Check, ChevronDown, ArrowRight,
  Users, User, Mail, Trash2, GripVertical,
} from 'lucide-react';
import useWorkflowStore from '../store/workflowStore';
import api from '../services/api';

/* ──────────────────────────────────────────────────────────────────────────── *
 *  WorkflowAssignment — simplified "todo-style" workflow builder
 *  • What  → title + short message
 *  • Who   → chain of steps, each assigned to a user / team / email
 *  • Flow  → visual vertical flow with connectors
 * ──────────────────────────────────────────────────────────────────────────── */

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const WorkflowAssignment = ({ documentId, documentTitle, onClose, onSuccess }) => {
  const { createWorkflow, createApproval } = useWorkflowStore();

  // ── form state ──
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueDate, setDueDate] = useState('');

  // ── flow steps ──
  const [steps, setSteps] = useState([]);       // { id, type:'user'|'team'|'email', label, userId, teamName, email }
  const [addMode, setAddMode] = useState(null);  // null | 'user' | 'team' | 'email'

  // ── search ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [teams, setTeams] = useState([]);
  const [emailInput, setEmailInput] = useState('');

  const searchRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── load teams once ──
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/documents/workflows/get_teams/');
        setTeams(res.data.teams || []);
      } catch { /* silent */ }
    })();
  }, []);

  // ── debounced member search ──
  useEffect(() => {
    if (addMode !== 'user' || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.get('/documents/workflows/search_team_members/', {
          params: { q: searchQuery, exclude_self: true, limit: 10 },
        });
        setSearchResults(res.data.members || []);
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, addMode]);

  // ── helpers ──
  const uid = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const addUserStep = (member) => {
    setSteps(prev => [...prev, {
      id: uid(),
      type: 'user',
      label: member.full_name,
      subtitle: member.profile?.job_title || member.email,
      userId: member.id,
    }]);
    resetAddMode();
  };

  const addTeamStep = (team) => {
    setSteps(prev => [...prev, {
      id: uid(),
      type: 'team',
      label: team.name,
      subtitle: `${team.members_count || '?'} members`,
      teamName: team.name,
    }]);
    resetAddMode();
  };

  const addEmailStep = () => {
    if (!emailInput || !/\S+@\S+\.\S+/.test(emailInput)) return;
    setSteps(prev => [...prev, {
      id: uid(),
      type: 'email',
      label: emailInput,
      subtitle: 'External email',
      email: emailInput,
    }]);
    setEmailInput('');
    resetAddMode();
  };

  const removeStep = (stepId) => setSteps(prev => prev.filter(s => s.id !== stepId));

  const resetAddMode = () => { setAddMode(null); setSearchQuery(''); setSearchResults([]); setEmailInput(''); };

  // ── submit ──
  const handleSubmit = async () => {
    if (!title.trim()) { setError('Give the workflow a title'); return; }
    if (steps.length === 0) { setError('Add at least one step'); return; }

    setLoading(true);
    setError(null);
    try {
      // First step assignee = workflow.assigned_to (pick first user step, else leave blank)
      const firstUser = steps.find(s => s.type === 'user');
      const workflow = await createWorkflow({
        document: documentId,
        assigned_to: firstUser?.userId || '',
        priority,
        due_date: dueDate || undefined,
        current_status: 'review',
        message: `${title}${message ? '\n' + message : ''}`,
      });

      // Create an approval step for each flow step
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await createApproval({
          workflow: workflow.id,
          approver: step.userId || undefined,
          role: step.label,
          order: i + 1,
          is_required: true,
          metadata: {
            target_type: step.type,
            team_name: step.teamName || undefined,
            email: step.email || undefined,
          },
        });
      }

      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create workflow');
    } finally {
      setLoading(false);
    }
  };

  // ── render ──
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">New Workflow</h2>
            <p className="text-xs text-gray-500 truncate">{documentTitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {error && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* ── What ── */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              What needs to happen?
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Review NDA before signing"
              className="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Additional context (optional)"
              rows={2}
              className="w-full mt-2 px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />

            {/* priority + due date row */}
            <div className="flex gap-2 mt-2">
              <div className="relative flex-1">
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  className={`w-full text-xs font-medium px-3 py-1.5 rounded-lg appearance-none cursor-pointer border-0 ${PRIORITY_COLORS[priority]}`}
                >
                  <option value="low">🟢 Low</option>
                  <option value="medium">🔵 Medium</option>
                  <option value="high">🟠 High</option>
                  <option value="urgent">🔴 Urgent</option>
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
              </div>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="flex-1 text-xs px-3 py-1.5 border rounded-lg text-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Due date"
              />
            </div>
          </div>

          {/* ── Flow Steps ── */}
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Workflow flow ({steps.length} step{steps.length !== 1 ? 's' : ''})
            </label>

            {/* Steps List */}
            {steps.length > 0 && (
              <div className="relative pl-5 mb-3">
                {/* Vertical connector line */}
                {steps.length > 1 && (
                  <div className="absolute left-[9px] top-5 bottom-5 w-0.5 bg-blue-200" />
                )}

                <div className="space-y-0">
                  {steps.map((step, idx) => (
                    <div key={step.id} className="relative flex items-center gap-3 group">
                      {/* Dot */}
                      <div className={`absolute -left-5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center text-[9px] font-bold
                        ${idx === 0 ? 'border-blue-500 bg-blue-500 text-white' : 'border-blue-300 bg-white text-blue-500'}`}>
                        {idx + 1}
                      </div>

                      {/* Card */}
                      <div className="flex-1 flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 my-1 border border-gray-100 group-hover:border-blue-200 transition-colors">
                        <div className="w-7 h-7 rounded-lg bg-white border flex items-center justify-center shrink-0">
                          {step.type === 'user' && <User size={14} className="text-blue-600" />}
                          {step.type === 'team' && <Users size={14} className="text-purple-600" />}
                          {step.type === 'email' && <Mail size={14} className="text-green-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{step.label}</p>
                          <p className="text-[11px] text-gray-500 truncate">{step.subtitle}</p>
                        </div>
                        <button
                          onClick={() => removeStep(step.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                      </div>

                      {/* Arrow between steps */}
                      {idx < steps.length - 1 && (
                        <ArrowRight size={12} className="absolute -left-[13px] -bottom-[5px] text-blue-300 hidden" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add Step */}
            {addMode === null ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddMode('user')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
                >
                  <User size={14} /> Person
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('team')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs font-medium text-gray-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50/50 transition-all"
                >
                  <Users size={14} /> Team
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('email')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs font-medium text-gray-500 hover:border-green-300 hover:text-green-600 hover:bg-green-50/50 transition-all"
                >
                  <Mail size={14} /> Email
                </button>
              </div>
            ) : (
              <div className="border rounded-xl p-3 bg-gray-50 space-y-2">
                {/* User Search */}
                {addMode === 'user' && (
                  <>
                    <div className="relative" ref={searchRef}>
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search people..."
                        autoFocus
                        className="w-full pl-8 pr-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {searchLoading && (
                        <div className="text-center py-3">
                          <div className="animate-spin mx-auto w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                        </div>
                      )}
                      {!searchLoading && searchResults.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => addUserStep(m)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-blue-50 text-left transition-colors"
                        >
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
                            {m.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{m.full_name}</p>
                            <p className="text-[11px] text-gray-500 truncate">{m.profile?.job_title || m.email}</p>
                          </div>
                        </button>
                      ))}
                      {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-2">No people found</p>
                      )}
                    </div>
                  </>
                )}

                {/* Team Picker */}
                {addMode === 'team' && (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {teams.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3">No teams found</p>
                    ) : teams.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => addTeamStep(t)}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-purple-50 text-left transition-colors"
                      >
                        <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                          <Users size={14} className="text-purple-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{t.name}</p>
                          <p className="text-[11px] text-gray-500">{t.members_count || '?'} members</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Email Input */}
                {addMode === 'email' && (
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={e => setEmailInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEmailStep())}
                      placeholder="name@company.com"
                      autoFocus
                      className="flex-1 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={addEmailStep}
                      className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={resetAddMode}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="border-t px-5 py-3 flex items-center justify-between bg-gray-50/60">
          <p className="text-[11px] text-gray-400">
            {steps.length === 0 ? 'Add steps to build the flow' : `${steps.length} step${steps.length !== 1 ? 's' : ''} in workflow`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !title.trim() || steps.length === 0}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating…' : 'Create Workflow'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

WorkflowAssignment.propTypes = {
  documentId: PropTypes.string.isRequired,
  documentTitle: PropTypes.string,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};

export default WorkflowAssignment;
