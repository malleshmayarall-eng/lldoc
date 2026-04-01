/**
 * QuickLatexPage
 *
 * Full-page view for managing Quick LaTeX documents — search, list,
 * create, AI-generate, duplicate, bulk-duplicate.
 *
 * Two modes:
 *  1. List view  — card grid with search/filters
 *  2. Editor view — full QuickLatexEditor for the selected document
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  Code,
  Copy,
  FileText,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
  Eye,
  Layers,
  ArrowLeft,
  ChevronRight,
  SlidersHorizontal,
  Calendar,
  DollarSign,
  Building2,
  Users,
  Filter,
  ChevronDown,
  ChevronLeft,
  LayoutGrid,
  LayoutList,
  Database,
} from 'lucide-react';
import useQuickLatex from '../hooks/useQuickLatex';
import quickLatexService from '../services/quickLatexService';
import exportSettingsService from '../services/exportSettingsService';
import { documentService } from '../services/documentService';
import { QuickLatexEditor } from '../components/quicklatex';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import { getDomainFilterCategories, getDomainDocumentTypes, getDomainCategories, getCreateDialogConfig } from '../domains';

/* ------------------------------------------------------------------ */
/*  Constants (fallback for default domain)                            */
/* ------------------------------------------------------------------ */

const DEFAULT_DOC_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'contract', label: 'Contract' },
  { value: 'policy', label: 'Policy' },
  { value: 'nda', label: 'NDA' },
  { value: 'legal_brief', label: 'Legal Brief' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'license', label: 'License' },
  { value: 'other', label: 'Other' },
];

/* ── Procurement-specific extra fields for create dialog ── */
const PROCUREMENT_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'archived', label: 'Archived' },
];

const PROCUREMENT_DEPARTMENTS = [
  { value: '', label: 'Select Department' },
  { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'it', label: 'IT' },
  { value: 'legal', label: 'Legal' },
  { value: 'hr', label: 'Human Resources' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'other', label: 'Other' },
];

const PROCUREMENT_CATEGORIES_EXTENDED = [
  { value: '', label: 'Select Category' },
  { value: 'raw_materials', label: 'Raw Materials' },
  { value: 'services', label: 'Services' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'technology', label: 'Technology' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'other', label: 'Other' },
];

const AMOUNT_RANGES = [
  { value: '', label: 'Any Amount' },
  { value: 'under_10k', label: '< $10,000' },
  { value: '10k_100k', label: '$10,000 – $100,000' },
  { value: 'over_100k', label: '> $100,000' },
];

const PAGE_SIZE = 12;

/* ── Highlight matching text spans ── */
const HighlightText = ({ text, query }) => {
  if (!query || !text) return <>{text}</>;
  const str = String(text);
  const q = query.toLowerCase();
  const idx = str.toLowerCase().indexOf(q);
  if (idx === -1) return <>{str}</>;
  return (
    <>
      {str.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{str.slice(idx, idx + query.length)}</mark>
      {str.slice(idx + query.length)}
    </>
  );
};

/* ─── Operator options for metadata filters ─── */
const METADATA_OPERATORS = [
  { value: 'contains', label: '≈ contains', symbol: '≈' },
  { value: 'eq', label: '= equals', symbol: '=' },
  { value: 'neq', label: '≠ not equal', symbol: '≠' },
  { value: 'lt', label: '< less than', symbol: '<' },
  { value: 'gt', label: '> greater than', symbol: '>' },
];

/* ─── Combobox-like input with autocomplete suggestions ─── */
const SuggestInput = ({ value, onChange, suggestions = [], placeholder, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const wrapRef = useRef(null);

  useEffect(() => { setSearch(value || ''); }, [value]);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes((search || '').toLowerCase())
  ).slice(0, 15);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-transparent bg-white"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setSearch(s); setOpen(false); }}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Metadata filter row with operator dropdown ─── */
const MetadataFilterRow = ({ filter, index, metadataKeys, onUpdate, onRemove }) => {
  const selectedKeyObj = metadataKeys.find((mk) => mk.key === filter.key);
  const keySuggestions = metadataKeys.map((mk) => mk.key);
  const valueSuggestions = selectedKeyObj?.sample_values || [];

  return (
    <div className="flex items-center gap-2">
      <SuggestInput
        value={filter.key}
        onChange={(v) => onUpdate(index, { ...filter, key: v })}
        suggestions={keySuggestions}
        placeholder="Key…"
        className="w-44"
      />
      <select
        value={filter.operator || 'contains'}
        onChange={(e) => onUpdate(index, { ...filter, operator: e.target.value })}
        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-400 focus:border-transparent text-gray-700 font-medium min-w-[120px]"
      >
        {METADATA_OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>
      <SuggestInput
        value={filter.value}
        onChange={(v) => onUpdate(index, { ...filter, value: v })}
        suggestions={valueSuggestions}
        placeholder="Value…"
        className="flex-1 min-w-[140px]"
      />
      <button
        onClick={() => onRemove(index)}
        className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Badge                                                              */
/* ------------------------------------------------------------------ */

const Badge = ({ children, color = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  QuickLatexCard                                                     */
/* ------------------------------------------------------------------ */

const QuickLatexCard = ({ doc, onSelect, onDuplicate, onDelete, searchQuery = '' }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const placeholderCount = doc.placeholders?.length || 0;
  const preview = (doc.latex_block?.latex_code || '').slice(0, 120);
  const meta = doc.document_metadata || doc.custom_metadata || {};

  // Collect which metadata keys matched the search
  const q = searchQuery.toLowerCase();
  const matchedMetaKeys = useMemo(() => {
    if (!q) return [];
    const hits = [];
    Object.entries(meta).forEach(([key, val]) => {
      if (String(val).toLowerCase().includes(q)) hits.push(key);
    });
    return hits;
  }, [q, meta]);

  return (
    <div
      className="group bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
      onClick={() => onSelect(doc)}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-indigo-50 p-1.5 rounded flex-shrink-0">
              <Code size={14} className="text-indigo-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              <HighlightText text={doc.title} query={searchQuery} />
            </h3>
          </div>

          {/* Action menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-20">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDuplicate?.(doc); setMenuOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Copy size={13} /> Duplicate
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${doc.title}"?`)) onDelete?.(doc.id);
                      setMenuOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Meta badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge color="indigo">
            <HighlightText text={doc.document_type || 'contract'} query={searchQuery} />
          </Badge>
          <Badge color={doc.status === 'draft' ? 'gray' : doc.status === 'finalized' ? 'green' : 'blue'}>
            <HighlightText text={doc.status} query={searchQuery} />
          </Badge>
          {doc.category && (
            <Badge color="purple">
              <HighlightText text={doc.category} query={searchQuery} />
            </Badge>
          )}
          {placeholderCount > 0 && (
            <Badge color="purple">{placeholderCount} fields</Badge>
          )}
        </div>

        {/* Matched metadata fields */}
        {matchedMetaKeys.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {matchedMetaKeys.slice(0, 4).map((key) => (
              <span key={key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-yellow-50 border border-yellow-200 text-yellow-800">
                <span className="font-medium text-yellow-600">{key}:</span>
                <HighlightText text={String(meta[key]).slice(0, 40)} query={searchQuery} />
              </span>
            ))}
            {matchedMetaKeys.length > 4 && (
              <span className="text-[10px] text-yellow-600">+{matchedMetaKeys.length - 4} more</span>
            )}
          </div>
        )}

        {/* Code preview */}
        {preview && (
          <pre className="text-xs font-mono text-gray-500 bg-gray-50 rounded p-2 mb-2 overflow-hidden leading-relaxed" style={{ maxHeight: '3.6rem' }}>
            {preview}{preview.length >= 120 ? '…' : ''}
          </pre>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-100">
          <span><HighlightText text={doc.author || '—'} query={searchQuery} /></span>
          <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  CreateDialog                                                       */
/* ------------------------------------------------------------------ */

const CreateDialog = ({ onSubmit, onClose, isCreating = false, domainDocTypes = [], domainCategories = [], createDialogConfig = {}, isProcurement = false }) => {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState(createDialogConfig.defaultDocType || 'contract');
  const [category, setCategory] = useState(createDialogConfig.defaultCategory || 'contract');
  const [latexCode, setLatexCode] = useState('');
  const [mode, setMode] = useState('blank'); // 'blank' | 'ai' | 'code'
  const [aiPrompt, setAiPrompt] = useState('');

  // Procurement-specific metadata
  const [vendor, setVendor] = useState('');
  const [department, setDepartment] = useState('');
  const [procurementCategory, setProcurementCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [contractExpiry, setContractExpiry] = useState('');
  const [poNumber, setPoNumber] = useState('');

  // ── AI Preview state ──────────────────────────────────────────────
  const [previewCode, setPreviewCode] = useState('');
  const [previewCodeType, setPreviewCodeType] = useState('latex');
  const [previewPlaceholders, setPreviewPlaceholders] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewRef = useRef(null);

  const showingPreview = mode === 'ai' && !!previewCode;

  /** Request an AI preview (no document created yet) */
  const handleGeneratePreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await quickLatexService.aiPreview({
        prompt: aiPrompt.trim(),
        title: title.trim() || 'Untitled Document',
        document_type: docType,
        code_type: 'latex',
      });
      setPreviewCode(res.latex_code || '');
      setPreviewCodeType(res.code_type || 'latex');
      setPreviewPlaceholders(res.placeholders || []);
      // scroll to preview area
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } catch (err) {
      setPreviewError(err?.response?.data?.message || err.message || 'AI generation failed.');
    } finally {
      setPreviewLoading(false);
    }
  };

  /** User accepts the preview — create doc with the AI code baked in */
  const handleAccept = () => {
    // Build initial document_metadata with placeholder keys seeded as empty strings
    const seedMeta = {};
    previewPlaceholders.forEach((key) => { seedMeta[key] = ''; });

    // Add procurement metadata if applicable
    if (isProcurement) {
      if (vendor) seedMeta.vendor = vendor;
      if (department) seedMeta.department = department;
      if (procurementCategory) seedMeta.procurement_category = procurementCategory;
      if (amount) seedMeta.amount = amount;
      if (contractExpiry) seedMeta.contract_expiry = contractExpiry;
      if (poNumber) seedMeta.po_number = poNumber;
    }

    onSubmit({
      title: title.trim(),
      document_type: docType,
      category,
      latex_code: previewCode,
      document_metadata: seedMeta,
    });
  };

  /** Submit handler: for blank / code modes → direct create; for AI mode → preview first */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'ai') {
      // If already showing preview, this shouldn't fire (button is Accept instead)
      handleGeneratePreview();
      return;
    }

    // Build procurement metadata
    const meta = {};
    if (isProcurement) {
      if (vendor) meta.vendor = vendor;
      if (department) meta.department = department;
      if (procurementCategory) meta.procurement_category = procurementCategory;
      if (amount) meta.amount = amount;
      if (contractExpiry) meta.contract_expiry = contractExpiry;
      if (poNumber) meta.po_number = poNumber;
    }

    onSubmit({
      title: title.trim(),
      document_type: docType,
      category,
      latex_code: mode === 'code' ? (latexCode || undefined) : undefined,
      ...(Object.keys(meta).length > 0 ? { document_metadata: meta } : {}),
    });
  };

  const PROMPT_SUGGESTIONS = isProcurement
    ? [
        'Draft a Purchase Order for raw materials with standard procurement terms',
        'Create an RFP for IT infrastructure services with evaluation criteria',
        'Write a vendor agreement with payment terms, SLA, and termination clauses',
        'Draft an NDA for vendor onboarding with confidentiality obligations',
        'Create a Statement of Work for consulting services with deliverables and timelines',
      ]
    : [
        'Draft a Non-Disclosure Agreement between two parties with mutual obligations',
        'Create an employment contract with standard clauses for salary, benefits, and termination',
        'Write a software license agreement for SaaS distribution',
        'Draft a commercial lease agreement for office space',
        'Create a consulting services agreement with payment terms and IP ownership',
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className={`bg-white rounded-xl shadow-2xl mx-4 transition-all duration-300 ${showingPreview ? 'w-full max-w-3xl' : 'w-full max-w-xl'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2 font-semibold text-gray-800">
            {showingPreview ? <Eye size={18} className="text-violet-600" /> : <Plus size={18} />}
            {showingPreview ? 'AI Preview — Review Before Creating' : (createDialogConfig.title || 'New Document')}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400" disabled={previewLoading || isCreating}>
            <X size={18} />
          </button>
        </div>
        {!showingPreview && createDialogConfig.subtitle && (
          <p className="px-5 pt-3 text-xs text-gray-500">{createDialogConfig.subtitle}</p>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* ── Form fields (collapsed when showing preview) ── */}
          {!showingPreview && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. Standard NDA Template"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    {domainDocTypes.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  >
                    {domainCategories.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Procurement-specific fields ── */}
              {isProcurement && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name</label>
                      <input
                        value={vendor}
                        onChange={(e) => setVendor(e.target.value)}
                        placeholder="e.g. Acme Corp"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">PO / Contract Number</label>
                      <input
                        value={poNumber}
                        onChange={(e) => setPoNumber(e.target.value)}
                        placeholder="e.g. PO-2026-001"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                      <select
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      >
                        {PROCUREMENT_DEPARTMENTS.map((d) => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Procurement Category</label>
                      <select
                        value={procurementCategory}
                        onChange={(e) => setProcurementCategory(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      >
                        {PROCUREMENT_CATEGORIES_EXTENDED.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contract Expiry Date</label>
                      <input
                        type="date"
                        value={contractExpiry}
                        onChange={(e) => setContractExpiry(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ── Start mode selector ── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">How do you want to start?</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('blank')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      mode === 'blank'
                        ? 'border-blue-400 bg-blue-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <FileText size={18} className={mode === 'blank' ? 'text-blue-600' : 'text-gray-400'} />
                    <p className={`text-xs font-semibold mt-1.5 ${mode === 'blank' ? 'text-blue-700' : 'text-gray-700'}`}>Blank</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Empty document</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('ai'); setPreviewCode(''); setPreviewError(''); }}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      mode === 'ai'
                        ? 'border-violet-400 bg-violet-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <Sparkles size={18} className={mode === 'ai' ? 'text-violet-600' : 'text-gray-400'} />
                    <p className={`text-xs font-semibold mt-1.5 ${mode === 'ai' ? 'text-violet-700' : 'text-gray-700'}`}>AI Draft</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">AI writes it for you</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('code')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      mode === 'code'
                        ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <Code size={18} className={mode === 'code' ? 'text-emerald-600' : 'text-gray-400'} />
                    <p className={`text-xs font-semibold mt-1.5 ${mode === 'code' ? 'text-emerald-700' : 'text-gray-700'}`}>Paste Code</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Your own LaTeX</p>
                  </button>
                </div>
              </div>

              {/* ── AI prompt ── */}
              {mode === 'ai' && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Describe the document you want <span className="text-violet-500">*</span>
                  </label>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    required={mode === 'ai'}
                    placeholder="e.g. Draft a Non-Disclosure Agreement between two companies with mutual obligations, 2-year term, and New York governing law"
                    rows={3}
                    className="w-full px-3 py-2 border border-violet-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 focus:border-violet-400 resize-none bg-violet-50/30"
                  />
                  {/* Quick suggestions */}
                  <div className="flex flex-wrap gap-1.5">
                    {PROMPT_SUGGESTIONS.slice(0, 3).map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setAiPrompt(s); if (!title) setTitle(s.split(' ').slice(0, 5).join(' ')); }}
                        className="text-[10px] px-2 py-1 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors truncate max-w-[200px]"
                      >
                        {s.length > 50 ? s.slice(0, 50) + '…' : s}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Sparkles size={10} className="text-violet-400" />
                    AI will generate a preview first — you can review and accept before the document is created
                  </p>
                </div>
              )}

              {/* ── Manual code ── */}
              {mode === 'code' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Initial LaTeX Code</label>
                  <textarea
                    value={latexCode}
                    onChange={(e) => setLatexCode(e.target.value)}
                    placeholder={"\\documentclass{article}\n\\begin{document}\n\nHello [[client_name]]!\n\n\\end{document}"}
                    rows={5}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              )}
            </>
          )}

          {/* ── AI Preview panel ── */}
          {showingPreview && (
            <div ref={previewRef} className="space-y-3">
              {/* Compact summary of what's being created */}
              <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium text-gray-800 truncate">{title || 'Untitled'}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500">{docType}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-violet-600 truncate flex-1">{aiPrompt.length > 80 ? aiPrompt.slice(0, 80) + '…' : aiPrompt}</span>
              </div>

              {/* Extracted placeholders */}
              {previewPlaceholders.length > 0 && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] font-medium text-violet-700 mb-1.5">
                    <Tag size={11} className="inline mr-1" />
                    {previewPlaceholders.length} metadata field{previewPlaceholders.length !== 1 ? 's' : ''} detected
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewPlaceholders.map((key) => (
                      <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700">
                        [[{key}]]
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-violet-500 mt-1.5">
                    These will be auto-created as fillable metadata fields in your document.
                  </p>
                </div>
              )}

              {/* Code preview */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {previewCodeType === 'html' ? 'HTML' : 'LaTeX'} Preview
                  </span>
                  <span className="text-[10px] text-gray-400">{previewCode.split('\n').length} lines</span>
                </div>
                <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs font-mono overflow-auto whitespace-pre-wrap leading-relaxed" style={{ maxHeight: '40vh' }}>
                  {previewCode}
                </pre>
              </div>

              {/* Edit prompt inline */}
              <div className="flex items-center gap-2">
                <input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Refine your prompt and regenerate..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
                />
                <button
                  type="button"
                  onClick={handleGeneratePreview}
                  disabled={previewLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Regenerate
                </button>
              </div>
            </div>
          )}

          {/* ── Preview loading overlay ── */}
          {previewLoading && !showingPreview && (
            <div className="flex flex-col items-center gap-2 py-6 text-violet-600">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-sm font-medium">AI is generating a preview…</p>
              <p className="text-[10px] text-gray-400">This may take 10–30 seconds</p>
            </div>
          )}

          {/* ── Preview error ── */}
          {previewError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {previewError}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="flex justify-end gap-2 pt-2">
            {showingPreview ? (
              <>
                <button
                  type="button"
                  onClick={() => { setPreviewCode(''); setPreviewError(''); setPreviewPlaceholders([]); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
                >
                  <ArrowLeft size={14} className="inline mr-1" />
                  Back to Edit
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={isCreating}
                  className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  {isCreating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      Accept & Create Document
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || previewLoading || (mode === 'ai' && !aiPrompt.trim())}
                  className={`px-4 py-2 text-sm text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                    mode === 'ai'
                      ? 'bg-violet-600 hover:bg-violet-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {previewLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Generating Preview…
                    </>
                  ) : mode === 'ai' ? (
                    <>
                      <Eye size={14} />
                      Generate Preview
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Create
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  QuickLatexPage                                                     */
/* ------------------------------------------------------------------ */

const QuickLatexPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { domain } = useFeatureFlags();
  const filterCategories = useMemo(() => getDomainFilterCategories(domain), [domain]);
  const isProcurement = domain === 'procurement';

  // Domain-aware document types and categories for dropdowns
  const domainDocTypes = useMemo(() => getDomainDocumentTypes(domain) || DEFAULT_DOC_TYPES.filter((t) => t.value), [domain]);
  const domainCategories = useMemo(() => getDomainCategories(domain) || [{ value: 'other', label: 'Other' }], [domain]);
  const createDialogConfig = useMemo(() => getCreateDialogConfig(domain) || {}, [domain]);

  // Build filter doc types with "All Types" prepended
  const filterDocTypes = useMemo(() => [{ value: '', label: 'All Types' }, ...domainDocTypes], [domainDocTypes]);

  const {
    documents,
    selectedDocument,
    placeholders,
    imageSlots,
    renderedLatex,
    previewPages,
    previewPdfUrl,
    previewLoading,
    previewError,
    resolvedImages,
    loading,
    saving,
    generating,
    error,
    searchQuery,
    fetchDocuments,
    fetchDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    duplicateDocument,
    bulkDuplicate,
    aiGenerate,
    undoToMessage,
    deleteChatHistory,
    fetchPlaceholders,
    updateMetadata,
    fetchRenderedLatex,
    resolveImages,
    mapImage,
    renderPreview,
    switchCodeType,
    setSearch,
    selectDocument,
    clearSelection,
    getChatMessages,
  } = useQuickLatex();

  const [showCreate, setShowCreate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
  const [currentPage, setCurrentPage] = useState(1);

  // Procurement-specific filters
  const [vendorFilter, setVendorFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [procCatFilter, setProcCatFilter] = useState('');
  const [amountRangeFilter, setAmountRangeFilter] = useState('');

  // Metadata filters (key-operator-value, like Documents & DMS)
  const [metadataKeys, setMetadataKeys] = useState([]);
  const [metadataFilters, setMetadataFilters] = useState([]); // [{key, operator, value}]
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);

  // ── Export Studio state ────────────────────────────────────────────
  const [exportSettings, setExportSettings] = useState(null);
  const [exportSettingsDraft, setExportSettingsDraft] = useState(null);
  const [exportSettingsLoading, setExportSettingsLoading] = useState(false);
  const [exportSettingsError, setExportSettingsError] = useState(null);
  const [exportSettingsSaving, setExportSettingsSaving] = useState(false);
  const [exportSettingsDirty, setExportSettingsDirty] = useState(false);
  const [exportTemplates, setExportTemplates] = useState({ headers: [], footers: [] });
  const [exportImages, setExportImages] = useState({ logo: [], watermark: [], background: [] });
  const [exportPdfFiles, setExportPdfFiles] = useState([]);
  const [exportMetadataSnapshot, setExportMetadataSnapshot] = useState(null);

  const requestedDocumentId = useMemo(() => searchParams.get('document'), [searchParams]);

  // Load metadata keys once on mount
  useEffect(() => {
    (async () => {
      try {
        const keys = await documentService.getDocumentMetadataKeys();
        setMetadataKeys(keys || []);
      } catch { /* silent */ }
    })();
  }, []);

  // Initial load
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Track intentional back-navigation so the fetch effect doesn't re-select
  const isGoingBackRef = useRef(false);

  useEffect(() => {
    if (!requestedDocumentId || selectedDocument?.id === requestedDocumentId) {
      return;
    }
    // Skip re-fetching when the user just pressed Back
    if (isGoingBackRef.current) {
      return;
    }

    fetchDocument(requestedDocumentId);
  }, [requestedDocumentId, selectedDocument?.id, fetchDocument]);

  useEffect(() => {
    if (!selectedDocument?.id) {
      // Reset the back-navigation guard once the URL is clean
      if (!searchParams.get('document')) {
        isGoingBackRef.current = false;
        return;
      }

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('document');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    if (searchParams.get('document') === selectedDocument.id) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('document', selectedDocument.id);
    setSearchParams(nextParams, { replace: true });
  }, [selectedDocument?.id, searchParams, setSearchParams]);

  // Back handler: flag the intentional navigation, then clear selection
  const handleBack = useCallback(() => {
    isGoingBackRef.current = true;
    clearSelection();
  }, [clearSelection]);

  // ── Export Studio: fetch settings when a document is selected ──────
  useEffect(() => {
    if (!selectedDocument?.id) {
      setExportSettings(null);
      setExportSettingsDraft(null);
      setExportSettingsDirty(false);
      return;
    }
    let active = true;
    (async () => {
      setExportSettingsLoading(true);
      setExportSettingsError(null);
      try {
        const [settings, headerTpls, footerTpls, logoImgs, watermarkImgs, bgImgs, pdfFiles] = await Promise.all([
          exportSettingsService.getExportSettings(selectedDocument.id),
          exportSettingsService.getHeaderFooterTemplates('header').catch(() => []),
          exportSettingsService.getHeaderFooterTemplates('footer').catch(() => []),
          exportSettingsService.listImagesByType('logo').catch(() => []),
          exportSettingsService.listImagesByType('watermark').catch(() => []),
          exportSettingsService.listImagesByType('background').catch(() => []),
          exportSettingsService.listPdfFiles().catch(() => []),
        ]);
        if (!active) return;
        setExportSettings(settings);
        setExportSettingsDraft(JSON.parse(JSON.stringify(settings)));
        setExportTemplates({ headers: headerTpls, footers: footerTpls });
        setExportImages({ logo: logoImgs, watermark: watermarkImgs, background: bgImgs });
        setExportPdfFiles(pdfFiles);
        // Try loading metadata snapshot
        exportSettingsService.getMetadataSnapshot(selectedDocument.id)
          .then((snap) => { if (active) setExportMetadataSnapshot(snap); })
          .catch(() => {});
      } catch (err) {
        if (active) setExportSettingsError(err?.response?.data?.detail || err.message || 'Failed to load export settings');
      } finally {
        if (active) setExportSettingsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedDocument?.id]);

  const handleUpdateExportSetting = useCallback((path, value) => {
    setExportSettingsDraft((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      let target = next;
      const keys = Array.isArray(path) ? path : [path];
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]] || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
        target = target[keys[i]];
      }
      target[keys[keys.length - 1]] = value;
      return next;
    });
    setExportSettingsDirty(true);
  }, []);

  const handleSaveExportSettings = useCallback(async () => {
    if (!selectedDocument?.id || !exportSettingsDraft) return;
    setExportSettingsSaving(true);
    setExportSettingsError(null);
    try {
      const updated = await exportSettingsService.updateExportSettings(selectedDocument.id, exportSettingsDraft);
      setExportSettings(updated);
      setExportSettingsDraft(JSON.parse(JSON.stringify(updated)));
      setExportSettingsDirty(false);
      // Auto-refresh preview with the saved settings
      const code = selectedDocument.latex_block?.latex_code || selectedDocument.latex_code || '';
      const ct = selectedDocument.latex_block?.code_type || 'latex';
      if (code.trim()) {
        setTimeout(() => renderPreview(selectedDocument.id, code, {}, ct, updated?.processing_settings), 300);
      }
    } catch (err) {
      setExportSettingsError(err?.response?.data?.detail || err.message || 'Failed to save');
    } finally {
      setExportSettingsSaving(false);
    }
  }, [selectedDocument?.id, selectedDocument, exportSettingsDraft, renderPreview]);

  const handleResetExportSettings = useCallback(() => {
    if (exportSettings) {
      setExportSettingsDraft(JSON.parse(JSON.stringify(exportSettings)));
      setExportSettingsDirty(false);
    }
  }, [exportSettings]);

  const handleUploadExportImage = useCallback(async (file, imageType) => {
    try {
      const result = await exportSettingsService.uploadImage({ file, imageType, name: file.name, documentId: selectedDocument?.id });
      // Refresh images of this type
      const updatedList = await exportSettingsService.listImagesByType(imageType).catch(() => []);
      setExportImages((prev) => ({ ...prev, [imageType]: updatedList }));
      return result;
    } catch (err) {
      setExportSettingsError(err?.message || 'Upload failed');
      return null;
    }
  }, [selectedDocument?.id]);

  const handleUploadExportPdfFile = useCallback(async (file) => {
    try {
      const result = await exportSettingsService.uploadPdfFile({ file, name: file.name, documentId: selectedDocument?.id });
      const updatedFiles = await exportSettingsService.listPdfFiles().catch(() => []);
      setExportPdfFiles(updatedFiles);
      return result;
    } catch (err) {
      setExportSettingsError(err?.message || 'PDF upload failed');
      return null;
    }
  }, [selectedDocument?.id]);

  const handleSaveHeaderFooterPdf = useCallback(async (type, data) => {
    if (!selectedDocument?.id) return null;
    try {
      const hfPdf = await exportSettingsService.createHfPdf(data);
      if (hfPdf?.id) {
        await exportSettingsService.applyHfPdf(hfPdf.id, { documentId: selectedDocument.id });
        // Re-fetch export settings
        const updated = await exportSettingsService.getExportSettings(selectedDocument.id);
        setExportSettings(updated);
        setExportSettingsDraft(JSON.parse(JSON.stringify(updated)));
      }
      return hfPdf;
    } catch (err) {
      setExportSettingsError(err?.message || 'Failed to save header/footer PDF');
      return null;
    }
  }, [selectedDocument?.id]);

  const handleRemoveHeaderFooterPdf = useCallback(async (type) => {
    if (!selectedDocument?.id) return;
    try {
      const key = type === 'header' ? 'header_pdf' : 'footer_pdf';
      await exportSettingsService.updateExportSettings(selectedDocument.id, {
        processing_settings: { [key]: '__removed__' },
      });
      const updated = await exportSettingsService.getExportSettings(selectedDocument.id);
      setExportSettings(updated);
      setExportSettingsDraft(JSON.parse(JSON.stringify(updated)));
    } catch (err) {
      setExportSettingsError(err?.message || 'Failed to remove');
    }
  }, [selectedDocument?.id]);

  const handleRefreshExportPreview = useCallback(() => {
    // Re-render the document preview with latest export settings
    if (selectedDocument?.id) {
      const code = selectedDocument.latex_block?.latex_code || selectedDocument.latex_code || '';
      const ct = selectedDocument.latex_block?.code_type || 'latex';
      if (code.trim()) {
        renderPreview(selectedDocument.id, code, {}, ct, exportSettingsDraft?.processing_settings);
      }
    }
  }, [selectedDocument, renderPreview, exportSettingsDraft]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreate = useCallback(async (data) => {
    setIsCreating(true);
    try {
      // data already contains latex_code if user accepted an AI preview,
      // or is blank/code-mode data — no separate AI step needed.
      const doc = await createDocument(data);
      if (doc?.id) {
        await fetchDocument(doc.id);
      }
      setShowCreate(false);
    } catch (err) {
      console.error('Create failed:', err);
    } finally {
      setIsCreating(false);
    }
  }, [createDocument, fetchDocument]);

  const handleSelectCard = useCallback(async (doc) => {
    await fetchDocument(doc.id);
  }, [fetchDocument]);

  const handleDelete = useCallback(async (id) => {
    await deleteDocument(id);
  }, [deleteDocument]);

  const handleDuplicate = useCallback(async (doc) => {
    await duplicateDocument(doc.id, { title: `${doc.title} (Copy)` });
  }, [duplicateDocument]);

  // ── Filtering ─────────────────────────────────────────────────────────

  const filteredDocs = useMemo(() => {
    let result = [...documents];
    
    // Type filter
    if (typeFilter) {
      result = result.filter((d) => d.document_type === typeFilter);
    }
    
    // Status filter
    if (statusFilter) {
      result = result.filter((d) => d.status === statusFilter);
    }
    
    // Date range
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter((d) => new Date(d.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((d) => new Date(d.created_at) <= to);
    }

    // Procurement-specific filters
    if (vendorFilter) {
      const q = vendorFilter.toLowerCase();
      result = result.filter((d) =>
        d.document_metadata?.vendor?.toLowerCase().includes(q) ||
        d.custom_metadata?.vendor?.toLowerCase().includes(q)
      );
    }
    if (departmentFilter) {
      result = result.filter((d) =>
        d.document_metadata?.department === departmentFilter ||
        d.custom_metadata?.department === departmentFilter
      );
    }
    if (procCatFilter) {
      result = result.filter((d) =>
        d.document_metadata?.procurement_category === procCatFilter ||
        d.custom_metadata?.procurement_category === procCatFilter ||
        d.category === procCatFilter
      );
    }
    if (amountRangeFilter) {
      result = result.filter((d) => {
        const amt = parseFloat(d.document_metadata?.amount || d.custom_metadata?.amount || 0);
        if (amountRangeFilter === 'under_10k') return amt < 10000;
        if (amountRangeFilter === '10k_100k') return amt >= 10000 && amt <= 100000;
        if (amountRangeFilter === 'over_100k') return amt > 100000;
        return true;
      });
    }
    
    // Search — fuzzy across title, author, type, category, and ALL metadata values
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((d) => {
        // Core fields
        if (d.title?.toLowerCase().includes(q)) return true;
        if (d.author?.toLowerCase().includes(q)) return true;
        if (d.document_type?.toLowerCase().includes(q)) return true;
        if (d.category?.toLowerCase().includes(q)) return true;
        if (d.status?.toLowerCase().includes(q)) return true;
        // All document_metadata values
        const docMeta = d.document_metadata || {};
        for (const val of Object.values(docMeta)) {
          if (String(val).toLowerCase().includes(q)) return true;
        }
        // All custom_metadata values
        const custMeta = d.custom_metadata || {};
        for (const val of Object.values(custMeta)) {
          if (String(val).toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }

    // Metadata filters (key-operator-value)
    const activeMetaFilters = metadataFilters.filter((mf) => mf.key?.trim() && mf.value?.trim());
    if (activeMetaFilters.length > 0) {
      result = result.filter((d) => {
        const allMeta = { ...(d.custom_metadata || {}), ...(d.document_metadata || {}) };
        return activeMetaFilters.every((mf) => {
          const docVal = String(allMeta[mf.key] ?? '').toLowerCase();
          const filterVal = mf.value.trim().toLowerCase();
          const op = mf.operator || 'contains';
          if (op === 'contains') return docVal.includes(filterVal);
          if (op === 'eq') return docVal === filterVal;
          if (op === 'neq') return docVal !== filterVal;
          if (op === 'lt') return parseFloat(docVal) < parseFloat(filterVal);
          if (op === 'gt') return parseFloat(docVal) > parseFloat(filterVal);
          return true;
        });
      });
    }
    
    // Sort
    result.sort((a, b) => {
      let aVal, bVal;
      if (sortBy === 'title') {
        aVal = (a.title || '').toLowerCase();
        bVal = (b.title || '').toLowerCase();
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      aVal = new Date(a[sortBy] || 0);
      bVal = new Date(b[sortBy] || 0);
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    return result;
  }, [documents, typeFilter, statusFilter, dateFrom, dateTo, searchQuery, sortBy, sortOrder, vendorFilter, departmentFilter, procCatFilter, amountRangeFilter, metadataFilters]);

  // ── Pagination ────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / PAGE_SIZE));

  // Reset to page 1 when filters / search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, typeFilter, statusFilter, dateFrom, dateTo, sortBy, sortOrder, vendorFilter, departmentFilter, procCatFilter, amountRangeFilter, metadataFilters]);

  const paginatedDocs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredDocs.slice(start, start + PAGE_SIZE);
  }, [filteredDocs, currentPage]);

  // Build page number buttons (show max 7 with ellipsis)
  const pageNumbers = useMemo(() => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('…');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('…');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const activeMetaCount = metadataFilters.filter((mf) => mf.key && mf.value).length;
  const activeFilterCount = [typeFilter, statusFilter, dateFrom, dateTo, vendorFilter, departmentFilter, procCatFilter, amountRangeFilter].filter(Boolean).length + activeMetaCount;

  const clearAllFilters = () => {
    setTypeFilter('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setVendorFilter('');
    setDepartmentFilter('');
    setProcCatFilter('');
    setAmountRangeFilter('');
    setMetadataFilters([]);
    setShowMetadataPanel(false);
    setSearch('');
    setShowAdvancedFilters(false);
  };

  // Status options derived from documents
  const statusOptions = useMemo(() => {
    const statuses = new Set(documents.map((d) => d.status).filter(Boolean));
    return ['', ...Array.from(statuses)].map((s) => ({
      value: s,
      label: s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'All Statuses',
    }));
  }, [documents]);

  // ── Editor view ───────────────────────────────────────────────────────

  if (selectedDocument) {
    return (
      <div className="h-full">
        <QuickLatexEditor
          document={selectedDocument}
          placeholders={placeholders}
          imageSlots={imageSlots}
          renderedLatex={renderedLatex}
          previewPages={previewPages}
          previewPdfUrl={previewPdfUrl}
          previewLoading={previewLoading}
          previewError={previewError}
          saving={saving}
          generating={generating}
          chatMessages={getChatMessages(selectedDocument.id)}
          resolvedImages={resolvedImages}
          onUpdate={updateDocument}
          onDelete={(id) => { deleteDocument(id); handleBack(); }}
          onDuplicate={duplicateDocument}
          onBulkDuplicate={bulkDuplicate}
          onAIGenerate={aiGenerate}
          onFetchPlaceholders={fetchPlaceholders}
          onFetchRendered={fetchRenderedLatex}
          onRenderPreview={renderPreview}
          onSwitchCodeType={switchCodeType}
          onUpdateMetadata={updateMetadata}
          onUndoEdit={undoToMessage}
          onClearChat={deleteChatHistory}
          onResolveImages={resolveImages}
          onMapImage={mapImage}
          onBack={handleBack}
          // Export Studio
          exportDraft={exportSettingsDraft}
          exportLoading={exportSettingsLoading}
          exportSaving={exportSettingsSaving}
          exportError={exportSettingsError}
          exportDirty={exportSettingsDirty}
          exportTemplates={exportTemplates}
          exportImages={exportImages}
          exportPdfFiles={exportPdfFiles}
          exportMetadataSnapshot={exportMetadataSnapshot}
          onUpdateExportSetting={handleUpdateExportSetting}
          onSaveExportSettings={handleSaveExportSettings}
          onResetExportSettings={handleResetExportSettings}
          onUploadExportImage={handleUploadExportImage}
          onUploadExportPdfFile={handleUploadExportPdfFile}
          onSaveHeaderFooterPdf={handleSaveHeaderFooterPdf}
          onRemoveHeaderFooterPdf={handleRemoveHeaderFooterPdf}
          onRefreshExportPreview={handleRefreshExportPreview}
        />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-50 p-2 rounded-lg">
            <Code size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Documents</h1>
            <p className="text-sm text-gray-500">Create and manage documents with AI</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 ${viewMode === 'table' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="Table view"
            >
              <LayoutList size={16} />
            </button>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            New Document
          </button>
        </div>
      </div>

      {/* Search + Quick Filters */}
      <div className="px-6 py-3 bg-white border-b border-gray-100 space-y-3">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, author, type, metadata..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Document Type */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600"
          >
            {filterDocTypes.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600"
          >
            {statusOptions.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split(':');
              setSortBy(field);
              setSortOrder(order);
            }}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600"
          >
            <option value="updated_at:desc">Last Modified ↓</option>
            <option value="updated_at:asc">Last Modified ↑</option>
            <option value="created_at:desc">Created ↓</option>
            <option value="created_at:asc">Created ↑</option>
            <option value="title:asc">Title A–Z</option>
            <option value="title:desc">Title Z–A</option>
          </select>

          {/* Advanced filter toggle */}
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-md text-sm transition-colors ${
              showAdvancedFilters || activeFilterCount > 0
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Metadata filter toggle */}
          <button
            onClick={() => { setShowMetadataPanel((p) => !p); if (showAdvancedFilters) setShowAdvancedFilters(false); }}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-md text-sm transition-colors ${
              showMetadataPanel || activeMetaCount > 0
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Database size={14} />
            Metadata
            {activeMetaCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded-full">
                {activeMetaCount}
              </span>
            )}
          </button>

          <span className="text-xs text-gray-400">
            {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Advanced filters panel */}
        {showAdvancedFilters && (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Filter size={14} />
                Advanced Filters
              </h3>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  Clear all filters
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  <Calendar size={12} className="inline mr-1" />
                  Date From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  <Calendar size={12} className="inline mr-1" />
                  Date To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {isProcurement && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      <Building2 size={12} className="inline mr-1" />
                      Vendor
                    </label>
                    <input
                      type="text"
                      value={vendorFilter}
                      onChange={(e) => setVendorFilter(e.target.value)}
                      placeholder="Search vendor..."
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      <Users size={12} className="inline mr-1" />
                      Department
                    </label>
                    <select
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Departments</option>
                      {PROCUREMENT_DEPARTMENTS.filter((d) => d.value).map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
            {isProcurement && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    <Tag size={12} className="inline mr-1" />
                    Procurement Category
                  </label>
                  <select
                    value={procCatFilter}
                    onChange={(e) => setProcCatFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    {PROCUREMENT_CATEGORIES_EXTENDED.map((c) => (
                      <option key={c.value} value={c.value}>{c.label || 'All Categories'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    <DollarSign size={12} className="inline mr-1" />
                    Amount Range
                  </label>
                  <select
                    value={amountRangeFilter}
                    onChange={(e) => setAmountRangeFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500"
                  >
                    {AMOUNT_RANGES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Metadata filter builder panel */}
        {showMetadataPanel && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database size={14} className="text-emerald-600" />
                <span className="text-sm font-semibold text-gray-700">Metadata Filters</span>
                <span className="text-[10px] text-gray-400">Filter by document metadata key-value pairs</span>
              </div>
              <div className="flex items-center gap-2">
                {metadataFilters.length > 0 && (
                  <button
                    onClick={() => { setMetadataFilters([]); setShowMetadataPanel(false); }}
                    className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setShowMetadataPanel(false)}
                  className="text-gray-300 hover:text-gray-500"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Metadata filter rows */}
            <div className="space-y-2">
              {metadataFilters.map((mf, idx) => (
                <MetadataFilterRow
                  key={idx}
                  filter={mf}
                  index={idx}
                  metadataKeys={metadataKeys}
                  onUpdate={(i, updated) => {
                    const next = [...metadataFilters];
                    next[i] = updated;
                    setMetadataFilters(next);
                  }}
                  onRemove={(i) => {
                    setMetadataFilters(metadataFilters.filter((_, fi) => fi !== i));
                  }}
                />
              ))}
            </div>

            {/* Add filter button */}
            <button
              onClick={() => setMetadataFilters((prev) => [...prev, { key: '', operator: 'contains', value: '' }])}
              className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
            >
              <Plus size={13} />
              Add metadata filter
            </button>

            {/* Quick key pills when no filters yet */}
            {metadataFilters.length === 0 && metadataKeys.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[10px] text-gray-400">Quick add:</span>
                {metadataKeys.slice(0, 12).map((mk) => (
                  <button
                    key={mk.key}
                    onClick={() => setMetadataFilters([...metadataFilters, { key: mk.key, operator: 'contains', value: '' }])}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all"
                  >
                    {mk.key}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active metadata filter badges (when panel is closed) */}
        {!showMetadataPanel && activeMetaCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-gray-400">Metadata:</span>
            {metadataFilters.filter((mf) => mf.key && mf.value).map((mf, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-700">
                {mf.key} {(METADATA_OPERATORS.find((op) => op.value === mf.operator) || METADATA_OPERATORS[0]).symbol} {mf.value}
                <button
                  onClick={() => setMetadataFilters((prev) => prev.filter((_, fi) => fi !== metadataFilters.indexOf(mf)))}
                  className="hover:text-red-500 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Category filter chips */}
        {filterCategories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {filterCategories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setTypeFilter(typeFilter === cat.value ? '' : cat.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  typeFilter === cat.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-3 px-4 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">Loading documents...</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Code size={40} className="mb-3 opacity-50" />
            <p className="text-sm font-medium text-gray-500 mb-1">
              {searchQuery || typeFilter || statusFilter || dateFrom || dateTo || vendorFilter || departmentFilter ? 'No matching documents' : 'No documents yet'}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              {searchQuery || typeFilter || statusFilter || dateFrom || dateTo || vendorFilter || departmentFilter
                ? 'Try adjusting your filters'
                : 'Create your first document to get started'}
            </p>
            {!(searchQuery || typeFilter || statusFilter || vendorFilter || departmentFilter) && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
              >
                <Plus size={14} />
                Create Document
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          /* ── Table view ── */
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                  {isProcurement && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>}
                  {isProcurement && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  {isProcurement && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Dept</th>}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Author</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Modified</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedDocs.map((doc) => {
                  const meta = doc.document_metadata || doc.custom_metadata || {};
                  return (
                  <tr
                    key={doc.id}
                    onClick={() => handleSelectCard(doc)}
                    className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="bg-indigo-50 p-1 rounded flex-shrink-0">
                          <Code size={12} className="text-indigo-600" />
                        </div>
                        <span className="text-sm font-medium text-gray-900 truncate max-w-[280px]">
                          <HighlightText text={doc.title} query={searchQuery} />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        <HighlightText text={doc.document_type || 'contract'} query={searchQuery} />
                      </span>
                    </td>
                    {isProcurement && (
                      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-[140px]">
                        <HighlightText text={meta.vendor || '—'} query={searchQuery} />
                      </td>
                    )}
                    {isProcurement && (
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {meta.amount ? `$${Number(meta.amount).toLocaleString()}` : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        doc.status === 'draft' ? 'bg-gray-100 text-gray-700' :
                        doc.status === 'finalized' ? 'bg-green-100 text-green-700' :
                        doc.status === 'approved' ? 'bg-green-100 text-green-700' :
                        doc.status === 'pending_approval' ? 'bg-amber-100 text-amber-700' :
                        doc.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        doc.status === 'expired' ? 'bg-red-50 text-red-600' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        <HighlightText text={(doc.status || 'draft').replace(/_/g, ' ')} query={searchQuery} />
                      </span>
                    </td>
                    {isProcurement && (
                      <td className="px-4 py-3 text-sm text-gray-500 capitalize">
                        <HighlightText text={meta.department || '—'} query={searchQuery} />
                      </td>
                    )}
                    <td className="px-4 py-3 text-sm text-gray-500">
                      <HighlightText text={doc.author || '—'} query={searchQuery} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{new Date(doc.updated_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDuplicate(doc); }}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                          title="Duplicate"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${doc.title}"?`)) handleDelete(doc.id); }}
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* ── Grid view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {paginatedDocs.map((doc) => (
              <QuickLatexCard
                key={doc.id}
                doc={doc}
                onSelect={handleSelectCard}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}

        {/* ── Pagination controls ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-6 pb-2">
            <p className="text-xs text-gray-400">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredDocs.length)} of {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              {pageNumbers.map((pg, i) =>
                pg === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm select-none">…</span>
                ) : (
                  <button
                    key={pg}
                    onClick={() => setCurrentPage(pg)}
                    className={`min-w-[32px] h-8 rounded-md text-sm font-medium transition-colors ${
                      pg === currentPage
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {pg}
                  </button>
                )
              )}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <CreateDialog
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
          isCreating={isCreating}
          domainDocTypes={domainDocTypes}
          domainCategories={domainCategories}
          createDialogConfig={createDialogConfig}
          isProcurement={isProcurement}
        />
      )}
    </div>
  );
};

export default QuickLatexPage;
