/**
 * AIGenerateMasterDialog
 *
 * Modal for AI-generating a new master document via Gemini.
 * The user provides a prompt and optional raw text;
 * the backend calls Gemini and returns a fully-structured master + template document.
 */

import { useState, useCallback } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';

const CATEGORY_OPTIONS = [
  { value: 'contract', label: 'Contract' },
  { value: 'policy', label: 'Policy' },
  { value: 'nda', label: 'NDA' },
  { value: 'employment', label: 'Employment' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'memo', label: 'Memo' },
  { value: 'letter', label: 'Letter' },
  { value: 'custom', label: 'Custom' },
];

const AIGenerateMasterDialog = ({ onCreated, onClose }) => {
  const [form, setForm] = useState({
    name: '',
    prompt: '',
    raw_text: '',
    category: 'contract',
    document_type: 'Generated',
    tags: '',
    default_parties: '',
    style_preset: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState('form'); // 'form' | 'generating'

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault();
      if (!form.name.trim()) { setError('Name is required'); return; }
      if (!form.prompt.trim() && !form.raw_text.trim()) {
        setError('Provide a prompt or raw text for AI generation');
        return;
      }

      setLoading(true);
      setError(null);
      setStep('generating');

      try {
        const { default: masterService } = await import('../../services/masterService');

        const payload = {
          name: form.name.trim(),
          category: form.category,
          document_type: form.document_type.trim() || 'Generated',
        };

        if (form.prompt.trim()) payload.prompt = form.prompt.trim();
        if (form.raw_text.trim()) payload.raw_text = form.raw_text.trim();
        if (form.tags.trim()) {
          payload.tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
        }
        if (form.default_parties.trim()) {
          payload.default_parties = form.default_parties.split(',').map((p) => p.trim()).filter(Boolean);
        }
        if (form.style_preset.trim()) payload.style_preset = form.style_preset.trim();

        const result = await masterService.aiGenerateMaster(payload);
        onCreated?.(result);
        onClose?.();
      } catch (err) {
        setStep('form');
        setError(err.response?.data?.error || err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    },
    [form, onCreated, onClose],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={loading ? undefined : onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-bold text-gray-900">AI Generate Master</h3>
          </div>
          {!loading && (
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
              <X className="h-4 w-4 text-gray-500" />
            </button>
          )}
        </div>

        {step === 'generating' ? (
          /* Loading state */
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-purple-500 mb-4" />
            <p className="text-lg font-semibold text-gray-900">Generating with AI…</p>
            <p className="text-sm text-gray-500 mt-1">This may take 10–30 seconds depending on complexity.</p>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Master Name *</label>
                <input
                  value={form.name}
                  onChange={set('name')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="e.g. SaaS Service Agreement Template"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Category */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={set('category')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {/* Document type */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Document Type</label>
                  <input
                    value={form.document_type}
                    onChange={set('document_type')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Generated"
                  />
                </div>
              </div>

              {/* AI Prompt */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">AI Prompt *</label>
                <textarea
                  value={form.prompt}
                  onChange={set('prompt')}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Describe the document you want the AI to generate…&#10;e.g. Create a comprehensive SaaS service agreement covering data processing, SLA, and termination clauses."
                />
              </div>

              {/* Raw Text */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                  Raw Text <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={form.raw_text}
                  onChange={set('raw_text')}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Paste raw text for the AI to structure into a document…"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tags</label>
                <input
                  value={form.tags}
                  onChange={set('tags')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="saas, template, agreement (comma-separated)"
                />
              </div>

              {/* Parties */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Default Parties</label>
                <input
                  value={form.default_parties}
                  onChange={set('default_parties')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Provider, Client (comma-separated)"
                />
              </div>

              {/* Style Preset */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Style Preset</label>
                <input
                  value={form.style_preset}
                  onChange={set('style_preset')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="formal, modern-clean, legal-traditional"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>
              )}
            </form>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.name.trim() || (!form.prompt.trim() && !form.raw_text.trim())}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Generate with AI
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AIGenerateMasterDialog;
