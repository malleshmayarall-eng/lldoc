import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { workflowApi } from '@services/clm/clmApi';
import { ConfirmModal, Spinner, EmptyState } from '@components/clm/ui/SharedUI';
import notify from '@utils/clm/clmNotify';
import { Plus, Copy, Trash2, Edit3, Clock, FileText, GitBranch, Sparkles, Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { useFeatureFlags } from '../../contexts/FeatureFlagContext';
import { getDomainWorkflowTemplates } from '../../domains';

export default function WorkflowList() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleteWf, setDeleteWf] = useState(null);
  const [showAiGen, setShowAiGen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState([]);   // [{question, answer}]
  const [originalPrompt, setOriginalPrompt] = useState('');         // keep the original prompt across rounds
  const navigate = useNavigate();
  const { domain } = useFeatureFlags();

  // Domain-aware AI prompt helpers
  const isProcurement = domain === 'procurement';
  const aiPlaceholder = isProcurement
    ? 'Example: Create a purchase order approval pipeline that routes POs over $10,000 to the finance director, uses AI to extract vendor_name and total_value, validates against budget, and sends email to the procurement team on approval.'
    : 'Example: Create a pipeline that takes uploaded contracts, uses AI to extract contract_type, party_names, and total_value, then filters for NDAs with value over $50,000, requires legal team approval, and sends an email notification with the approved documents.';
  const aiHints = isProcurement
    ? [
        'PO approval with budget check',
        'Vendor onboarding pipeline',
        'RFP bid evaluation workflow',
        'Contract renewal reminders',
      ]
    : [
        'Filter PDFs by contract type',
        'AI analysis + email results',
        'Multi-step approval pipeline',
        'Extract metadata and route by value',
      ];
  const createPlaceholder = isProcurement
    ? 'e.g., PO Approval Pipeline'
    : 'e.g., Contract Review Pipeline';

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const { data } = await workflowApi.list();
      setWorkflows(Array.isArray(data) ? data : data.results || []);
    } catch (e) {
      notify.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWorkflows(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const { data } = await workflowApi.create({ name, description });
      notify.success('Workflow created');
      navigate(`/clm/workflows/${data.id}`);
    } catch (e) {
      notify.error('Failed to create workflow');
    }
  };

  const handleDelete = async () => {
    if (!deleteWf) return;
    try {
      await workflowApi.delete(deleteWf.id);
      notify.success('Workflow deleted');
      setDeleteWf(null);
      fetchWorkflows();
    } catch {
      notify.error('Failed to delete workflow');
    }
  };

  const handleDuplicate = async (id) => {
    try {
      await workflowApi.duplicate(id);
      notify.success('Workflow duplicated');
      fetchWorkflows();
    } catch {
      notify.error('Failed to duplicate');
    }
  };

  const handleAiGenerate = async (e) => {
    e.preventDefault();
    const prompt = originalPrompt || aiPrompt.trim();
    if (!prompt) return;
    setAiGenerating(true);

    // Build answers payload if we're in follow-up mode
    const answers = followUpQuestions.length > 0
      ? followUpQuestions.filter((q) => q.answer?.trim())
      : null;

    try {
      const { data } = await workflowApi.generateFromText(prompt, answers);

      // AI wants to ask follow-up questions
      if (data.follow_up_questions && Array.isArray(data.follow_up_questions)) {
        if (!originalPrompt) setOriginalPrompt(aiPrompt.trim());
        setFollowUpQuestions(
          data.follow_up_questions.map((q) => ({ question: q, answer: '' }))
        );
        return;
      }

      // Workflow created successfully
      notify.success(`Workflow "${data.name}" created with ${data.nodes?.length || 0} nodes`);
      setShowAiGen(false);
      setAiPrompt('');
      setOriginalPrompt('');
      setFollowUpQuestions([]);
      navigate(`/clm/workflows/${data.id}`);
    } catch (err) {
      notify.error(err.response?.data?.error || 'Failed to generate workflow');
    } finally {
      setAiGenerating(false);
    }
  };

  const updateFollowUpAnswer = (idx, answer) => {
    setFollowUpQuestions((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, answer } : q))
    );
  };

  const resetAiGen = () => {
    setShowAiGen(false);
    setAiPrompt('');
    setOriginalPrompt('');
    setFollowUpQuestions([]);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
          <p className="text-sm text-gray-400 mt-0.5">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAiGen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all text-sm font-medium shadow-sm"
          >
            <Sparkles size={16} /> AI Generate
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} /> New Workflow
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 p-5 bg-white rounded-xl border shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Create New Workflow</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={createPlaceholder}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 font-medium">
              Create
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 font-medium text-gray-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      {showAiGen && (
        <form onSubmit={handleAiGenerate} className="mb-6 bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 px-5 py-3 border-b flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600" />
            <h3 className="font-semibold text-gray-900">AI Workflow Generator</h3>
            <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium ml-1">Powered by Gemini</span>
          </div>
          <div className="p-5">
            {/* --- Follow-up questions mode --- */}
            {followUpQuestions.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <MessageCircleQuestion size={18} className="text-purple-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-purple-900">AI needs a bit more detail</p>
                    <p className="text-xs text-purple-600 mt-0.5">Answer the questions below so the AI can build the perfect workflow for you.</p>
                  </div>
                </div>
                {followUpQuestions.map((fq, idx) => (
                  <div key={idx}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {idx + 1}. {fq.question}
                    </label>
                    <input
                      value={fq.answer}
                      onChange={(e) => updateFollowUpAnswer(idx, e.target.value)}
                      placeholder="Your answer..."
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
                      disabled={aiGenerating}
                    />
                  </div>
                ))}
              </div>
            ) : (
              /* --- Normal prompt mode --- */
              <>
                <label className="block text-xs text-gray-500 mb-1.5">Describe your workflow in natural language</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder={aiPlaceholder}
                  className="w-full px-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none resize-y min-h-[120px]"
                  rows={4}
                  required
                  autoFocus
                  disabled={aiGenerating}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {aiHints.map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      onClick={() => setAiPrompt(hint)}
                      className="text-[11px] px-2.5 py-1 bg-gray-50 text-gray-500 rounded-full border hover:bg-purple-50 hover:text-purple-600 hover:border-purple-200 transition-colors"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="px-5 py-3 bg-gray-50 border-t flex items-center justify-between">
            <p className="text-[11px] text-gray-400">
              {followUpQuestions.length > 0
                ? 'Answer the questions and click Generate to create your workflow'
                : 'AI will create nodes, connections, and configurations automatically'}
            </p>
            <div className="flex gap-2">
              {followUpQuestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setFollowUpQuestions([]); setOriginalPrompt(''); }}
                  className="px-3 py-2 text-xs bg-white border rounded-lg hover:bg-gray-50 font-medium text-gray-500"
                  disabled={aiGenerating}
                >
                  Start Over
                </button>
              )}
              <button
                type="button"
                onClick={resetAiGen}
                className="px-4 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50 font-medium text-gray-600"
                disabled={aiGenerating}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={aiGenerating || (followUpQuestions.length === 0 && !aiPrompt.trim()) || (followUpQuestions.length > 0 && followUpQuestions.every((q) => !q.answer?.trim()))}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-sm hover:from-purple-700 hover:to-indigo-700 font-medium disabled:opacity-50 flex items-center gap-2 transition-all"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Generating...
                  </>
                ) : followUpQuestions.length > 0 ? (
                  <>
                    <Send size={14} /> Generate Workflow
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> Generate Workflow
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" className="text-indigo-500" />
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon="📑"
          title="No workflows yet"
          description="Create your first workflow pipeline to start processing documents with AI"
          action={
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              <Plus size={16} /> Create Workflow
            </button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {workflows.map((wf) => (
            <div key={wf.id} className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow group">
              <div className="p-4 flex items-center justify-between">
                <Link to={`/clm/workflows/${wf.id}`} className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">{wf.name}</h3>
                  <p className="text-sm text-gray-500 truncate mt-0.5">{wf.description || 'No description'}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><GitBranch size={12} /> {wf.node_count ?? 0} nodes</span>
                    <span className="flex items-center gap-1"><FileText size={12} /> {wf.document_count ?? 0} docs</span>
                    {wf.last_executed_at && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> Last run: {new Date(wf.last_executed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </Link>
                <div className="flex gap-2 ml-4 shrink-0">
                  <Link
                    to={`/clm/workflows/${wf.id}`}
                    className="p-2 text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                    title="Edit"
                  >
                    <Edit3 size={14} />
                  </Link>
                  <button
                    onClick={() => handleDuplicate(wf.id)}
                    className="p-2 text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Duplicate"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteWf(wf)}
                    className="p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!deleteWf}
        title="Delete Workflow"
        message={`Are you sure you want to delete "${deleteWf?.name}"? All nodes, connections, documents, and extracted data will be permanently removed.`}
        confirmText="Delete Workflow"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteWf(null)}
      />
    </div>
  );
}
