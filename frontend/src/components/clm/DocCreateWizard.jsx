import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Search, Save, Zap } from 'lucide-react';
import { workflowApi } from '@services/clm/clmApi';

/**
 * DocCreateWizard — 4-step modal dialog for configuring doc_create nodes.
 *
 *   Step 1 → Pick creation mode (template / duplicate / quick_latex / structured)
 *   Step 2 → Select source (template card or document search)
 *   Step 3 → Map CLM fields → document targets (custom_metadata required)
 *   Step 4 → Review summary → Save
 */
const MODES = [
  { value: 'template',   icon: '📄', label: 'From Template',     desc: 'Use a pre-built legal template with placeholders you fill in', color: 'indigo' },
  { value: 'duplicate',  icon: '📋', label: 'Duplicate Document', desc: 'Clone an existing document from your repository with metadata overrides', color: 'sky' },
  { value: 'quick_latex', icon: '📐', label: 'Quick LaTeX',       desc: 'Clone or create a LaTeX document for precision formatting', color: 'violet' },
  { value: 'structured', icon: '📝', label: 'Structured',         desc: 'Build a document from custom section definitions you provide', color: 'emerald' },
];

const STEP_LABELS = ['Mode', 'Source', 'Mapping', 'Save'];

const DIRECT_FIELDS = [
  'title', 'document_type', 'category', 'governing_law', 'jurisdiction',
  'contract_value', 'currency', 'author', 'term_length', 'reference_number',
  'project_name', 'effective_date', 'expiration_date', 'execution_date',
  'auto_renewal', 'renewal_terms',
];

const DOC_META_COMMON = [
  'financial.contract_value', 'financial.currency', 'financial.payment_terms',
  'legal.governing_law', 'legal.jurisdiction', 'legal.reference_number',
  'terms.term_length', 'terms.auto_renewal', 'terms.notice_period',
  'confidentiality.period', 'confidentiality.nda_type',
  'dispute_resolution.method', 'dispute_resolution.location',
];

export default function DocCreateWizard({ open, onClose, node, onSave, fieldOptions }) {
  const [step, setStep] = useState(0);
  const initialConfig = node?.config || {};

  // Local draft config (saved only on final "Save")
  const [draft, setDraft] = useState({ ...initialConfig });
  const patch = useCallback((p) => setDraft(d => ({ ...d, ...p })), []);

  // Data
  const [templates, setTemplates] = useState([]);
  const [docs, setDocs] = useState([]);
  const [docTotal, setDocTotal] = useState(0);
  const [docSearch, setDocSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [docFilters, setDocFilters] = useState({ mode: '', type: '' });
  const [filterOpts, setFilterOpts] = useState({ document_types: [], categories: [], modes: [] });
  const [loading, setLoading] = useState(false);
  const [targetDocFields, setTargetDocFields] = useState(null); // from editor-document-fields
  const [customKeyInput, setCustomKeyInput] = useState('');

  // Reset on open
  useEffect(() => {
    if (open) {
      setDraft({ ...node?.config || {} });
      setStep(0);
      setDocSearch('');
      setDebouncedSearch('');
    }
  }, [open, node?.id]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(docSearch), 300);
    return () => clearTimeout(t);
  }, [docSearch]);

  // Fetch templates
  useEffect(() => {
    if (!open) return;
    workflowApi.editorTemplates()
      .then(({ data }) => setTemplates(data.templates || []))
      .catch(() => {});
  }, [open]);

  // Fetch documents for duplicate / quick_latex
  useEffect(() => {
    if (!open) return;
    const mode = draft.creation_mode;
    if (mode !== 'duplicate' && mode !== 'quick_latex') return;
    setLoading(true);
    const params = { limit: 40, sort: debouncedSearch ? 'relevance' : 'recent' };
    if (debouncedSearch) params.search = debouncedSearch;
    if (docFilters.mode) params.mode = docFilters.mode;
    if (docFilters.type) params.type = docFilters.type;
    if (mode === 'quick_latex') params.mode = 'quick_latex';
    workflowApi.editorDocuments(params)
      .then(({ data }) => {
        setDocs(data.documents || []);
        setDocTotal(data.total || 0);
        if (data.filters) setFilterOpts(data.filters);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, draft.creation_mode, debouncedSearch, docFilters.mode, docFilters.type]);

  // Fetch target document fields when a source document is selected (for step 3)
  useEffect(() => {
    if (!open) return;
    const docId = draft.source_document_id;
    if (!docId) { setTargetDocFields(null); return; }
    workflowApi.editorDocumentFields(docId)
      .then(({ data }) => setTargetDocFields(data))
      .catch(() => setTargetDocFields(null));
  }, [open, draft.source_document_id]);

  // Source fields from CLM extraction
  const sourceFields = useMemo(() => {
    if (!fieldOptions) return [];
    const names = fieldOptions.field_names || [];
    return Array.isArray(names) ? names : [];
  }, [fieldOptions]);

  // Selected template
  const selectedTemplate = templates.find(t => t.key === draft.template_name);
  const templatePlaceholders = selectedTemplate?.placeholders || [];

  // All target fields for mapping step
  const allTargets = useMemo(() => {
    const groups = [];

    // Direct fields
    groups.push({ label: '📋 Document Fields', fields: DIRECT_FIELDS.map(f => ({ key: f, display: f })) });

    // Template placeholders
    if (templatePlaceholders.length > 0) {
      groups.push({ label: '📝 Template Placeholders', fields: templatePlaceholders.map(p => ({ key: p, display: `[[${p}]]` })) });
    }

    // Custom metadata from target document
    if (targetDocFields?.custom_metadata_keys?.length > 0) {
      groups.push({
        label: '🟣 Custom Metadata (from document)',
        fields: targetDocFields.custom_metadata_keys
          .filter(k => k !== 'processing_settings') // hide internal keys
          .map(k => ({ key: `custom_metadata.${k}`, display: k, value: targetDocFields.custom_metadata?.[k] })),
      });
    }

    // Document metadata
    const dmKeys = targetDocFields?.document_metadata_keys || DOC_META_COMMON;
    if (dmKeys.length > 0) {
      groups.push({ label: '📊 Document Metadata', fields: dmKeys.map(k => ({ key: `document_metadata.${k}`, display: k })) });
    }

    return groups;
  }, [templatePlaceholders, targetDocFields]);

  // Flat target list for auto-map
  const allTargetsFlat = useMemo(() => allTargets.flatMap(g => g.fields.map(f => f.key)), [allTargets]);

  // Mapping helpers
  const mappings = draft.field_mappings || [];
  const setMappings = (m) => patch({ field_mappings: m });
  const addMapping = () => setMappings([...mappings, { source_field: '', target_field: '' }]);
  const updateMapping = (i, key, val) => {
    const u = [...mappings]; u[i] = { ...u[i], [key]: val }; setMappings(u);
  };
  const removeMapping = (i) => setMappings(mappings.filter((_, j) => j !== i));

  const autoMap = () => {
    if (!sourceFields.length) return;
    const targetSet = new Set(allTargetsFlat.map(f => f.toLowerCase()));
    const news = [];
    for (const src of sourceFields) {
      const lower = src.toLowerCase().replace(/[-\s]/g, '_');
      if (targetSet.has(lower)) { news.push({ source_field: src, target_field: lower }); continue; }
      // partial
      for (const tgt of allTargetsFlat) {
        if (lower.includes(tgt.toLowerCase()) || tgt.toLowerCase().includes(lower)) {
          news.push({ source_field: src, target_field: tgt }); break;
        }
      }
    }
    if (news.length) setMappings([...mappings, ...news]);
  };

  const addCustomKey = () => {
    const key = customKeyInput.trim();
    if (!key) return;
    addMapping();
    const idx = mappings.length;
    const m = [...mappings, { source_field: '', target_field: `custom_metadata.${key}` }];
    setMappings(m);
    setCustomKeyInput('');
  };

  // Validation
  const canProceed = () => {
    if (step === 0) return !!draft.creation_mode;
    if (step === 1) {
      if (draft.creation_mode === 'template') return !!draft.template_name;
      if (draft.creation_mode === 'duplicate' || draft.creation_mode === 'quick_latex') return !!draft.source_document_id;
      if (draft.creation_mode === 'structured') return true; // sections are optional at this step
    }
    if (step === 2) return true; // mappings are optional
    return true;
  };

  // Unmapped custom_metadata keys warning
  const unmappedCustomKeys = useMemo(() => {
    if (!targetDocFields?.custom_metadata_keys) return [];
    const mappedTargets = new Set(mappings.map(m => m.target_field));
    return targetDocFields.custom_metadata_keys
      .filter(k => k !== 'processing_settings')
      .filter(k => !mappedTargets.has(`custom_metadata.${k}`));
  }, [targetDocFields, mappings]);

  if (!open) return null;

  const creationMode = draft.creation_mode || 'template';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[680px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Configure Document Creator</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {STEP_LABELS[step]} — Step {step + 1} of {STEP_LABELS.length}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* ── Step indicator ── */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {STEP_LABELS.map((label, i) => (
              <React.Fragment key={i}>
                {i > 0 && <div className={`flex-1 h-px ${i <= step ? 'bg-indigo-300' : 'bg-gray-200'}`} />}
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                    i === step ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' :
                    i < step ? 'bg-emerald-50 text-emerald-600 cursor-pointer hover:bg-emerald-100' :
                    'bg-gray-50 text-gray-400'
                  }`}
                >
                  {i < step ? <Check size={10} /> : <span className="w-4 h-4 rounded-full bg-current/10 flex items-center justify-center text-[9px]">{i + 1}</span>}
                  {label}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">

          {/* ══════ STEP 0: Mode ══════ */}
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">How should this node create editor documents?</p>
              <div className="grid grid-cols-2 gap-3">
                {MODES.map(m => (
                  <button
                    key={m.value}
                    onClick={() => patch({ creation_mode: m.value })}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      creationMode === m.value
                        ? 'border-indigo-400 bg-indigo-50/60 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                    <span className="text-2xl">{m.icon}</span>
                    <p className={`text-sm font-semibold mt-2 ${creationMode === m.value ? 'text-indigo-700' : 'text-gray-700'}`}>{m.label}</p>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ══════ STEP 1: Source ══════ */}
          {step === 1 && creationMode === 'template' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Select a template to use as the document base</p>
              <div className="space-y-2">
                {templates.map(t => {
                  const sel = draft.template_name === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => patch({ template_name: t.key })}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                        sel ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl mt-0.5">{t.type === 'nda' ? '🔒' : t.type === 'license' ? '📜' : '📑'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${sel ? 'text-indigo-700' : 'text-gray-700'}`}>{t.title}</span>
                            {sel && <Check size={14} className="text-indigo-500" />}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                            <span className="px-1.5 py-0.5 rounded bg-gray-100">{t.type}</span>
                            <span>{t.sections_count} sections</span>
                            {t.placeholders?.length > 0 && <span>· {t.placeholders.length} placeholders</span>}
                          </div>
                          {sel && t.sections && (
                            <div className="mt-3 space-y-1 border-t border-gray-100 pt-2">
                              {t.sections.slice(0, 4).map((s, i) => (
                                <div key={i} className="text-[10px] text-gray-500 flex gap-2">
                                  <span className="text-gray-300 w-3 text-right">{i + 1}.</span>
                                  <span className="font-medium">{s.title}</span>
                                </div>
                              ))}
                              {t.sections.length > 4 && <p className="text-[10px] text-gray-400 pl-5">+{t.sections.length - 4} more…</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (creationMode === 'duplicate' || creationMode === 'quick_latex') && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                {creationMode === 'quick_latex' ? 'Select a LaTeX document to clone' : 'Search and select a document to duplicate'}
              </p>

              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  value={docSearch}
                  onChange={e => setDocSearch(e.target.value)}
                  placeholder="Search by title, type, content, author…"
                  className="w-full pl-9 pr-9 py-2.5 border rounded-xl text-xs focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  autoFocus
                />
                {docSearch && (
                  <button onClick={() => setDocSearch('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Filters */}
              {creationMode === 'duplicate' && (
                <div className="flex gap-2 items-center">
                  <select value={docFilters.mode} onChange={e => setDocFilters(f => ({ ...f, mode: e.target.value }))}
                    className="px-2.5 py-1.5 border rounded-lg text-[11px] bg-white focus:ring-1 focus:ring-indigo-200 outline-none">
                    <option value="">All modes</option>
                    {filterOpts.modes.map(m => <option key={m} value={m}>{m === 'quick_latex' ? '📐 LaTeX' : '📄 Standard'}</option>)}
                  </select>
                  <select value={docFilters.type} onChange={e => setDocFilters(f => ({ ...f, type: e.target.value }))}
                    className="px-2.5 py-1.5 border rounded-lg text-[11px] bg-white focus:ring-1 focus:ring-indigo-200 outline-none">
                    <option value="">All types</option>
                    {filterOpts.document_types.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {(docFilters.mode || docFilters.type) && (
                    <button onClick={() => setDocFilters({ mode: '', type: '' })} className="text-[10px] text-indigo-600 hover:text-indigo-800">Clear</button>
                  )}
                  <span className="ml-auto text-[10px] text-gray-400">{docTotal} found</span>
                </div>
              )}

              {/* Document list */}
              {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-400 text-xs gap-2">
                  <span className="animate-spin text-lg">⟳</span> Searching…
                </div>
              ) : docs.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="text-xs">{debouncedSearch ? `No matches for "${debouncedSearch}"` : 'No documents in your repository'}</p>
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto space-y-1.5 pr-1 -mr-1">
                  {docs.map(doc => {
                    const sel = draft.source_document_id === doc.id;
                    return (
                      <button
                        key={doc.id}
                        onClick={() => patch({ source_document_id: doc.id })}
                        className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                          sel ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="text-lg mt-0.5">{doc.document_mode === 'quick_latex' ? '📐' : '📄'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-xs font-medium truncate ${sel ? 'text-indigo-700' : 'text-gray-700'}`}>{doc.title}</p>
                              {sel && <Check size={12} className="text-indigo-500 shrink-0" />}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{doc.document_type}</span>
                              {doc.section_count > 0 && <span className="text-[9px] text-gray-400">{doc.section_count} sections</span>}
                              {doc.governing_law && <span className="text-[9px] text-gray-400">· {doc.governing_law}</span>}
                              {doc.status && (
                                <span className={`text-[9px] px-1 py-0.5 rounded ${
                                  doc.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                                  doc.status === 'draft' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'
                                }`}>{doc.status}</span>
                              )}
                            </div>
                            {doc.content_preview && (
                              <p className="text-[10px] text-gray-400 mt-1.5 leading-snug line-clamp-2">
                                {doc.matching_section && <span className="text-gray-500 font-medium">{doc.matching_section}: </span>}
                                {doc.content_preview}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0 text-[9px] text-gray-400">
                            {doc.created_by && <p>{doc.created_by}</p>}
                            {doc.updated_at && <p>{new Date(doc.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Clone options for duplicate */}
              {creationMode === 'duplicate' && draft.source_document_id && (
                <div className="flex gap-4 pt-2 border-t border-gray-100 text-[11px] text-gray-600">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={draft.include_structure !== false} onChange={e => patch({ include_structure: e.target.checked })}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-200 w-3.5 h-3.5" />
                    Include structure
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={draft.include_images === true} onChange={e => patch({ include_images: e.target.checked })}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-200 w-3.5 h-3.5" />
                    Include images
                  </label>
                </div>
              )}
            </div>
          )}

          {step === 1 && creationMode === 'structured' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Define the document structure with sections. Use <code className="bg-gray-100 px-1 rounded text-[10px]">[[placeholder]]</code> for dynamic values.</p>
              <textarea
                value={draft.sections ? JSON.stringify(draft.sections, null, 2) : '[\n  {\n    "title": "Parties",\n    "content": "Agreement between [[party_a]] and [[party_b]]."\n  }\n]'}
                onChange={e => { try { const p = JSON.parse(e.target.value); if (Array.isArray(p)) patch({ sections: p }); } catch {} }}
                rows={14}
                className="w-full px-4 py-3 border rounded-xl text-[11px] font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none resize-y bg-gray-50"
                spellCheck={false}
              />
            </div>
          )}

          {/* ══════ STEP 2: Field Mapping ══════ */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600 font-medium">Map CLM fields → document targets</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Custom metadata fields hold the actual document content — map them to ensure data flows correctly.
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {sourceFields.length > 0 && (
                    <button onClick={autoMap} className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 font-medium px-2 py-1 rounded-lg hover:bg-violet-50 transition-colors">
                      <Zap size={10} /> Auto-map
                    </button>
                  )}
                  <button onClick={addMapping} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors">
                    + Add row
                  </button>
                </div>
              </div>

              {/* Mapping rows */}
              {mappings.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                  <p className="text-gray-400 text-xs">No mappings configured yet</p>
                  <p className="text-[10px] text-gray-400 mt-1">Unmapped CLM data will be stored in document_metadata</p>
                  <div className="flex justify-center gap-2 mt-3">
                    <button onClick={addMapping} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-colors">
                      + Add mapping
                    </button>
                    {sourceFields.length > 0 && (
                      <button onClick={autoMap} className="text-[10px] text-violet-600 hover:text-violet-800 font-medium px-3 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 transition-colors flex items-center gap-1">
                        <Zap size={10} /> Auto-detect
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Column headers */}
                  <div className="flex items-center gap-1 px-1 text-[9px] text-gray-400 uppercase font-semibold tracking-wider">
                    <span className="flex-1">CLM Source</span>
                    <span className="w-5" />
                    <span className="flex-1">Document Target</span>
                    <span className="w-6" />
                  </div>

                  {mappings.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-1 group">
                      {/* Source */}
                      {sourceFields.length > 0 ? (
                        <select value={m.source_field} onChange={e => updateMapping(idx, 'source_field', e.target.value)}
                          className="flex-1 px-2.5 py-2 border rounded-lg text-[11px] focus:ring-1 focus:ring-indigo-200 outline-none bg-white">
                          <option value="">Select source…</option>
                          {sourceFields.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      ) : (
                        <input value={m.source_field} onChange={e => updateMapping(idx, 'source_field', e.target.value)}
                          placeholder="source_field" className="flex-1 px-2.5 py-2 border rounded-lg text-[11px] focus:ring-1 focus:ring-indigo-200 outline-none font-mono" />
                      )}

                      <span className="text-gray-300 text-xs px-0.5">→</span>

                      {/* Target with grouped optgroups */}
                      <select value={m.target_field} onChange={e => updateMapping(idx, 'target_field', e.target.value)}
                        className={`flex-1 px-2.5 py-2 border rounded-lg text-[11px] focus:ring-1 focus:ring-indigo-200 outline-none bg-white ${
                          m.target_field?.startsWith('custom_metadata.') ? 'border-purple-300 bg-purple-50/30' :
                          m.target_field?.startsWith('document_metadata.') ? 'border-sky-300 bg-sky-50/30' : ''
                        }`}>
                        <option value="">Select target…</option>
                        {allTargets.map(group => (
                          <optgroup key={group.label} label={group.label}>
                            {group.fields.map(f => <option key={f.key} value={f.key}>{f.display}</option>)}
                          </optgroup>
                        ))}
                      </select>

                      <button onClick={() => removeMapping(idx)}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-all">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add custom key */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <span className="text-[10px] text-purple-600 font-medium shrink-0">+ Custom key:</span>
                <input
                  value={customKeyInput}
                  onChange={e => setCustomKeyInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomKey()}
                  placeholder="my_custom_field"
                  className="flex-1 px-2.5 py-1.5 border rounded-lg text-[10px] font-mono focus:ring-1 focus:ring-purple-200 outline-none"
                />
                <button onClick={addCustomKey} disabled={!customKeyInput.trim()}
                  className="text-[10px] text-purple-600 hover:text-purple-800 font-medium px-2 py-1 rounded-lg hover:bg-purple-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Add
                </button>
              </div>

              {/* Unmapped custom_metadata warning */}
              {unmappedCustomKeys.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[10px] font-semibold text-amber-700">⚠ Unmapped custom metadata keys</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">These fields exist on the source document but aren't mapped:</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {unmappedCustomKeys.map(k => (
                      <button key={k} onClick={() => {
                        setMappings([...mappings, { source_field: '', target_field: `custom_metadata.${k}` }]);
                      }} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[9px] font-mono hover:bg-amber-200 transition-colors cursor-pointer">
                        {k} +
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Static replacements */}
              {(creationMode === 'template' || creationMode === 'structured') && (
                <div className="pt-2 border-t border-gray-100 space-y-1.5">
                  <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Static Replacements <span className="normal-case font-normal text-gray-400">(optional)</span></p>
                  <textarea
                    value={draft.template_replacements ? JSON.stringify(draft.template_replacements, null, 2) : ''}
                    onChange={e => { try { const p = e.target.value.trim() ? JSON.parse(e.target.value) : {}; patch({ template_replacements: p }); } catch {} }}
                    placeholder='{"governing_law": "New York"}'
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg text-[10px] font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none resize-none bg-gray-50"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>
          )}

          {/* ══════ STEP 3: Review & Save ══════ */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Review your configuration before saving</p>

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3">
                <SummaryCard label="Mode" value={MODES.find(m => m.value === creationMode)?.label || creationMode}
                  icon={MODES.find(m => m.value === creationMode)?.icon || '📄'} />
                <SummaryCard label="Source"
                  value={creationMode === 'template' ? (selectedTemplate?.title || draft.template_name) :
                         (docs.find(d => d.id === draft.source_document_id)?.title || draft.source_document_id?.slice(0, 8) || 'None')}
                  icon={creationMode === 'template' ? '📑' : '📄'} />
                <SummaryCard label="Field Mappings" value={`${mappings.length} mapping${mappings.length !== 1 ? 's' : ''}`} icon="🔗" />
                <SummaryCard label="Custom Metadata"
                  value={`${mappings.filter(m => m.target_field?.startsWith('custom_metadata.')).length} mapped`}
                  icon="🟣"
                  warn={unmappedCustomKeys.length > 0 ? `${unmappedCustomKeys.length} unmapped` : null} />
              </div>

              {/* Mappings preview */}
              {mappings.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-[10px] uppercase text-gray-400 font-semibold">Mappings</p>
                  <div className="space-y-1">
                    {mappings.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className="font-mono text-gray-600 truncate flex-1">{m.source_field || '—'}</span>
                        <span className="text-gray-300">→</span>
                        <span className={`font-mono truncate flex-1 ${
                          m.target_field?.startsWith('custom_metadata.') ? 'text-purple-600' :
                          m.target_field?.startsWith('document_metadata.') ? 'text-sky-600' :
                          'text-gray-600'
                        }`}>{m.target_field || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmapped warning */}
              {unmappedCustomKeys.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[10px]">
                  <p className="font-semibold text-amber-700">⚠ {unmappedCustomKeys.length} custom metadata key{unmappedCustomKeys.length > 1 ? 's' : ''} not mapped</p>
                  <p className="text-amber-600 mt-0.5">{unmappedCustomKeys.join(', ')}</p>
                  <button onClick={() => setStep(2)} className="mt-1.5 text-amber-700 underline hover:text-amber-900">Go back to fix</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={14} />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={() => { onSave(draft); onClose(); }}
              className="flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
            >
              <Save size={14} /> Save Configuration
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, warn }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] text-gray-400 uppercase font-semibold">{label}</p>
          <p className="text-xs font-medium text-gray-700 truncate">{value}</p>
          {warn && <p className="text-[9px] text-amber-600 mt-0.5">⚠ {warn}</p>}
        </div>
      </div>
    </div>
  );
}
