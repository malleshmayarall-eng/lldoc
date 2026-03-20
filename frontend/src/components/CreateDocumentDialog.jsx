import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookTemplate,
  Building2,
  Calendar,
  CheckCircle2,
  Code,
  FileText,
  GitBranch,
  Loader2,
  Scale,
  Search,
  Sparkles,
  Tag,
  UploadCloud,
  User,
  Users,
  X,
} from 'lucide-react';
import aiService from '../services/aiService';
import { documentService } from '../services/documentService';
import masterService from '../services/masterService';
import { openDocumentInEditor } from '../utils/documentRouting';
import { extractPlaceholderFields } from '../utils/metadataFieldUsageTracker';
import { useFeatureFlags } from '../contexts/FeatureFlagContext';
import { getDomainDocumentTypes, getDomainCategories, getCreateDialogConfig } from '../domains';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

// DOCUMENT_TYPES, CATEGORIES, and EMPTY_META are now domain-aware.
// They are computed inside the component via getDomainDocumentTypes() / getDomainCategories()
// based on the active domain from FeatureFlagContext.

/* ------------------------------------------------------------------ */
/*  Tiny reusable components                                           */
/* ------------------------------------------------------------------ */

const Field = ({ label, icon: Icon, children }) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </label>
    {children}
  </div>
);

const Input = (props) => (
  <input
    {...props}
    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800
      placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
      transition-colors ${props.className || ''}`}
  />
);

const Select = ({ options, ...props }) => (
  <select
    {...props}
    className={`w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800
      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors
      ${props.className || ''}`}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

/* ------------------------------------------------------------------ */
/*  Party chip editor                                                  */
/* ------------------------------------------------------------------ */

const PartyEditor = ({ parties = [], onChange }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onChange([...parties, { name: trimmed, role: role.trim() || undefined }]);
    setName('');
    setRole('');
  };

  const remove = (idx) => onChange(parties.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {parties.map((p, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-medium text-blue-700"
          >
            {p.name}
            {p.role && <span className="text-blue-400">({p.role})</span>}
            <button type="button" onClick={() => remove(i)} className="ml-1 hover:text-red-500">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Party name"
          className="flex-1"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <Input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role (optional)"
          className="w-32"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button
          type="button"
          onClick={add}
          disabled={!name.trim()}
          className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-100 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Add custom field row (for template step)                           */
/* ------------------------------------------------------------------ */

const AddCustomFieldRow = ({ onAdd }) => {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const handleAdd = () => {
    const trimmedKey = key.trim().replace(/\s+/g, '_');
    if (!trimmedKey) return;
    onAdd(trimmedKey, value.trim());
    setKey('');
    setValue('');
  };

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <label className="text-xs text-gray-400">Field name</label>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. company_address"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
        />
      </div>
      <div className="flex-1 space-y-1">
        <label className="text-xs text-gray-400">Value</label>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
        />
      </div>
      <button
        type="button"
        onClick={handleAdd}
        disabled={!key.trim()}
        className="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 disabled:opacity-40"
      >
        + Add
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main dialog                                                        */
/* ------------------------------------------------------------------ */

const CreateDocumentDialog = () => {
  const navigate = useNavigate();
  const textAreaRef = useRef(null);
  const { domain } = useFeatureFlags();

  /* --- domain-aware constants --------------------------------------- */
  const DOCUMENT_TYPES = useMemo(() => getDomainDocumentTypes(domain), [domain]);
  const CATEGORIES = useMemo(() => getDomainCategories(domain), [domain]);
  const dialogConfig = useMemo(() => getCreateDialogConfig(domain), [domain]);
  const EMPTY_META = useMemo(() => ({
    title: '',
    author: '',
    document_type: dialogConfig.defaultDocType,
    category: dialogConfig.defaultCategory,
    jurisdiction: '',
    governing_law: '',
    reference_number: '',
    project_name: '',
    effective_date: '',
    expiration_date: '',
    parties: [],
    custom_metadata: {},
  }), [dialogConfig]);

  /* --- state -------------------------------------------------------- */
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1); // 1 = text input  |  2 = metadata review  |  3 = template browser  |  4 = branch form
  const [text, setText] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [meta, setMeta] = useState({ ...EMPTY_META });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  // Template / branch flow state
  const [templates, setTemplates] = useState([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templatePlaceholders, setTemplatePlaceholders] = useState([]); // extracted [[field]] names
  const [loadingPlaceholders, setLoadingPlaceholders] = useState(false);
  const [branchForm, setBranchForm] = useState({
    title: '',
    branch_name: '',
    parties: [],
    customFields: {},     // key-value for [[placeholder]] overrides → custom_metadata_overrides
    include_content: true,
  });

  const busy = isAnalyzing || isCreating;

  /* --- helpers ------------------------------------------------------ */
  const resetState = useCallback(() => {
    setStep(1);
    setText('');
    setUploadedFileName('');
    setMeta({ ...EMPTY_META });
    setIsAnalyzing(false);
    setIsCreating(false);
    setError(null);
    setTemplates([]);
    setTemplateSearch('');
    setTemplateCategory('');
    setLoadingTemplates(false);
    setSelectedTemplate(null);
    setTemplatePlaceholders([]);
    setLoadingPlaceholders(false);
    setBranchForm({ title: '', branch_name: '', parties: [], customFields: {}, include_content: true });
  }, []);

  const openDialog = useCallback(() => {
    resetState();
    setIsOpen(true);
  }, [resetState]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setIsOpen(false);
    resetState();
  }, [busy, resetState]);

  const updateMeta = useCallback((key, value) => {
    setMeta((prev) => ({ ...prev, [key]: value }));
  }, []);

  /* --- global listeners --------------------------------------------- */
  useEffect(() => {
    const handleOpen = () => openDialog();
    window.addEventListener('openCreateDocumentDialog', handleOpen);
    return () => window.removeEventListener('openCreateDocumentDialog', handleOpen);
  }, [openDialog]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, closeDialog]);

  useEffect(() => {
    if (isOpen && step === 1) requestAnimationFrame(() => textAreaRef.current?.focus());
  }, [isOpen, step]);

  /* --- file upload -------------------------------------------------- */
  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      setUploadedFileName(file.name || 'Uploaded file');
      setError(null);
    } catch {
      setError('Failed to read file. Please try a plain text file.');
    }
  }, []);

  const handleFileChange = useCallback(
    async (e) => handleFileUpload(e.target.files?.[0]),
    [handleFileUpload],
  );

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      handleFileUpload(e.dataTransfer.files?.[0]);
    },
    [handleFileUpload],
  );

  /* --- create blank ------------------------------------------------- */
  const handleCreateBlank = useCallback(async () => {
    if (busy) return;
    setIsCreating(true);
    setError(null);
    try {
      const created = await documentService.createDocument({
        title: 'Untitled Document',
        document_type: dialogConfig.defaultDocType,
      });
      const documentId = created?.id || created?.document_id;
      if (!documentId) throw new Error('Document ID not returned from server');
      closeDialog();
  openDocumentInEditor(navigate, created);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  }, [busy, closeDialog, navigate, dialogConfig]);

  /* --- analyse with AI -> go to step 2 ------------------------------ */
  const handleAnalyze = useCallback(async () => {
    if (!text.trim()) {
      setError('Please enter or upload document text.');
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await aiService.analyzeText({ text: text.trim() });
      const extracted = res?.metadata || {};
      setMeta({
        title: extracted.title || '',
        author: extracted.author || '',
        document_type: extracted.document_type || dialogConfig.defaultDocType,
        category: extracted.category || dialogConfig.defaultCategory,
        jurisdiction: extracted.jurisdiction || '',
        governing_law: extracted.governing_law || '',
        reference_number: extracted.reference_number || '',
        project_name: extracted.project_name || '',
        effective_date: extracted.effective_date || '',
        expiration_date: extracted.expiration_date || '',
        parties: Array.isArray(extracted.parties) ? extracted.parties : [],
        custom_metadata: extracted.custom_metadata || {},
      });
      setStep(2);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'AI analysis failed. You can still use Quick create below.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [text]);

  /* --- create with AI (ingest text + metadata) ---------------------- */
  const handleCreateWithAI = useCallback(async () => {
    if (busy) return;
    setIsCreating(true);
    setError(null);
    try {
      // Step 1: ingest text -> creates the document with AI-generated structure
      const response = await aiService.ingestText({ text: text.trim() });
      const document = response?.document || response?.data?.document || response?.result?.document;
      const documentId = document?.id || document?.document_id;
      if (!documentId) throw new Error('Document ID not returned from server');

      // Step 2: patch the document with user-reviewed metadata
      const patch = {};
      if (meta.title) patch.title = meta.title;
      if (meta.author) patch.author = meta.author;
      if (meta.document_type) patch.document_type = meta.document_type;
      if (meta.category) patch.category = meta.category;
      if (meta.jurisdiction) patch.jurisdiction = meta.jurisdiction;
      if (meta.governing_law) patch.governing_law = meta.governing_law;
      if (meta.reference_number) patch.reference_number = meta.reference_number;
      if (meta.project_name) patch.project_name = meta.project_name;
      if (meta.effective_date) patch.effective_date = meta.effective_date;
      if (meta.expiration_date) patch.expiration_date = meta.expiration_date;
      if (meta.parties?.length) patch.parties = meta.parties;
      if (Object.keys(meta.custom_metadata || {}).length) patch.custom_metadata = meta.custom_metadata;

      if (Object.keys(patch).length > 0) {
        await documentService.updateDocument(documentId, patch, 'Document created with AI metadata');
      }

      closeDialog();
  openDocumentInEditor(navigate, document || { id: documentId });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.response?.data?.message || err?.message || 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  }, [busy, text, meta, closeDialog, navigate]);

  /* --- quick create (skip analysis, straight AI ingest) ------------- */
  const handleQuickCreateAI = useCallback(async () => {
    if (!text.trim()) {
      setError('Please enter or upload document text.');
      return;
    }
    if (busy) return;
    setIsCreating(true);
    setError(null);
    try {
      const response = await aiService.ingestText({ text: text.trim() });
      const document = response?.document || response?.data?.document || response?.result?.document;
      const documentId = document?.id || document?.document_id;
      if (!documentId) throw new Error('Document ID not returned from server');
      closeDialog();
  openDocumentInEditor(navigate, document || { id: documentId });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  }, [busy, text, closeDialog, navigate]);

  /* --- template browser ---------------------------------------------- */
  const fetchTemplates = useCallback(async (search = '', category = '') => {
    setLoadingTemplates(true);
    try {
      const params = {};
      if (search) params.q = search;
      if (category) params.category = category;
      const res = await masterService.searchMasters(params);
      setTemplates(Array.isArray(res) ? res : res.results || []);
    } catch {
      setTemplates([]);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const handleOpenTemplates = useCallback(() => {
    setStep(3);
    setError(null);
    fetchTemplates();
  }, [fetchTemplates]);

  // Debounced template search
  useEffect(() => {
    if (step !== 3) return;
    const timer = setTimeout(() => fetchTemplates(templateSearch, templateCategory), 300);
    return () => clearTimeout(timer);
  }, [templateSearch, templateCategory, step, fetchTemplates]);

  const handleSelectTemplate = useCallback(async (master) => {
    setSelectedTemplate(master);
    setStep(4);
    setError(null);

    // Pre-fill defaults from master's default_custom_metadata
    const defaults = master.default_custom_metadata || {};
    setBranchForm({
      title: master.template_document_title ? `${master.template_document_title} — Copy` : `${master.name} — New`,
      branch_name: '',
      parties: master.default_parties || [],
      customFields: { ...defaults },
      include_content: true,
    });

    // Fetch template document content to extract [[placeholder]] fields
    if (master.template_document) {
      setLoadingPlaceholders(true);
      try {
        const doc = await documentService.getCompleteDocument(master.template_document);
        const fieldSet = new Set();

        // Extract from all paragraph content
        (doc.sections || []).forEach((section) => {
          (section.paragraphs || []).forEach((para) => {
            extractPlaceholderFields(para.content || '').forEach((f) => fieldSet.add(f));
            extractPlaceholderFields(para.edited_text || '').forEach((f) => fieldSet.add(f));
          });
        });

        // Also include any keys from default_custom_metadata that aren't already found
        Object.keys(defaults).forEach((k) => {
          if (k !== 'processing_settings') fieldSet.add(k);
        });

        // Also include keys from the document's existing custom_metadata
        const docCustom = doc.custom_metadata || {};
        Object.keys(docCustom).forEach((k) => {
          if (k !== 'processing_settings') fieldSet.add(k);
        });

        const fields = Array.from(fieldSet).sort();
        setTemplatePlaceholders(fields);

        // Pre-fill customFields with existing values from doc + defaults
        setBranchForm((prev) => {
          const merged = { ...prev.customFields };
          fields.forEach((f) => {
            if (!(f in merged)) {
              merged[f] = docCustom[f] ?? defaults[f] ?? '';
            }
          });
          return { ...prev, customFields: merged };
        });
      } catch {
        // If fetch fails, still show what we have from defaults
        setTemplatePlaceholders(Object.keys(defaults).filter((k) => k !== 'processing_settings'));
      } finally {
        setLoadingPlaceholders(false);
      }
    } else {
      // No template doc — just show default_custom_metadata keys
      const fields = Object.keys(defaults).filter((k) => k !== 'processing_settings');
      setTemplatePlaceholders(fields);
    }
  }, []);

  const handleCreateFromTemplate = useCallback(async () => {
    if (!selectedTemplate || busy) return;
    if (!branchForm.title.trim()) {
      setError('Title is required');
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const payload = {
        branch_name: branchForm.branch_name.trim() || branchForm.title.trim(),
        title_override: branchForm.title.trim(),
        include_content: branchForm.include_content,
      };
      if (branchForm.parties?.length) payload.parties_override = branchForm.parties;

      // Build custom_metadata_overrides from the filled-in custom fields
      const customOverrides = {};
      Object.entries(branchForm.customFields || {}).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) {
          customOverrides[key] = value;
        }
      });
      if (Object.keys(customOverrides).length) {
        payload.custom_metadata_overrides = customOverrides;
      }

      const result = await masterService.createBranch(selectedTemplate.id, payload);
      const docId = result?.document || result?.document_data?.id;
      if (!docId) throw new Error('Document ID not returned');
      closeDialog();
      navigate(`/drafter/${docId}`);
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.detail || err?.message || 'Failed to create from template');
    } finally {
      setIsCreating(false);
    }
  }, [selectedTemplate, branchForm, busy, closeDialog, navigate]);

  const canAnalyze = useMemo(() => !busy && text.trim().length > 0, [text, busy]);

  /* ------------------------------------------------------------------ */
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={closeDialog}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* =================== HEADER =================== */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                onClick={() => { setStep(step === 4 ? 3 : 1); setError(null); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
              {step === 3 ? (
                <BookTemplate className="h-5 w-5 text-blue-600" />
              ) : step === 4 ? (
                <GitBranch className="h-5 w-5 text-blue-600" />
              ) : step === 2 ? (
                <Sparkles className="h-5 w-5 text-blue-600" />
              ) : (
                <FileText className="h-5 w-5 text-blue-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {step === 1 ? dialogConfig.title
                  : step === 2 ? 'Review AI-extracted metadata'
                  : step === 3 ? 'Choose a template'
                  : `New from "${selectedTemplate?.name}"`}
              </h2>
              <p className="text-sm text-gray-500">
                {step === 1
                  ? dialogConfig.subtitle
                  : step === 2
                  ? 'Edit any field before creating your document.'
                  : step === 3
                  ? 'Pick a master document to use as your starting point.'
                  : 'Set a title and metadata, then create your document.'}
              </p>
            </div>
          </div>
          <button
            onClick={closeDialog}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
            aria-label="Close"
            disabled={busy}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* =================== BODY =================== */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* ---------- STEP 1: Creation modes + content input ---------- */}
          {step === 1 && (
            <>
              {/* ─── Creation mode cards, ordered by domain ─── */}
              {(() => {
                const cardOrder = dialogConfig.cardOrder || ['blank', 'template', 'ai_assist', 'quick_latex'];

                const CARDS = {
                  /* Quick LaTeX */
                  quick_latex: (
                    <div key="quick_latex" className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white px-5 py-4 flex flex-col gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Code className="h-4 w-4 text-indigo-600" />
                          <h3 className="text-base font-semibold text-gray-900">Quick LaTeX</h3>
                        </div>
                        <p className="text-sm text-gray-500">One LaTeX block with AI, placeholders &amp; bulk duplicate.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { closeDialog(); navigate('/quick-latex'); }}
                        disabled={busy}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                          busy ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                      >
                        Open Quick LaTeX
                      </button>
                    </div>
                  ),
                  /* From Template */
                  template: (
                    <div key="template" className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white px-5 py-4 flex flex-col gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <BookTemplate className="h-4 w-4 text-emerald-600" />
                          <h3 className="text-base font-semibold text-gray-900">From Template</h3>
                        </div>
                        <p className="text-sm text-gray-500">Pick a master template and customise title &amp; metadata.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenTemplates}
                        disabled={busy}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                          busy ? 'bg-emerald-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                      >
                        Browse templates
                      </button>
                    </div>
                  ),
                  /* AI Assist — wider card spanning 2 cols on lg */
                  ai_assist: (
                    <div key="ai_assist" className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-purple-50 to-white px-5 py-4 flex flex-col gap-3 lg:col-span-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Sparkles className="h-4 w-4 text-violet-500" />
                          <h3 className="text-base font-semibold text-gray-900">AI Assist</h3>
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full font-medium">Recommended</span>
                        </div>
                        <p className="text-sm text-gray-500">AI-guided setup — describe your document and let AI structure it, extract metadata, and suggest templates automatically.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          closeDialog();
                          setTimeout(() => window.dispatchEvent(new CustomEvent('openAIDocumentWizard')), 80);
                        }}
                        disabled={busy}
                        className={`w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors ${
                          busy ? 'bg-violet-300 cursor-not-allowed' : 'bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700'
                        }`}
                      >
                        Start AI Assist
                      </button>
                    </div>
                  ),
                  /* Blank document (Document Drafter) */
                  blank: (
                    <div key="blank" className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white px-5 py-4 flex flex-col gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">Blank Document</h3>
                        <p className="text-sm text-gray-500 mt-0.5">Open the editor with a clean slate.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateBlank}
                        disabled={busy}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                          busy ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                      >
                        {isCreating ? 'Creating...' : 'Create blank'}
                      </button>
                    </div>
                  ),
                };

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {cardOrder.map((key) => CARDS[key]).filter(Boolean)}
                  </div>
                );
              })()}

              {/* ─── Combined file upload + text input ─── */}
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div
                  className="border-b border-dashed border-gray-200 p-4 bg-gray-50/60 hover:bg-blue-50/40 transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="flex items-center gap-2 text-gray-600">
                      <UploadCloud className="h-5 w-5" />
                      <span className="text-sm font-medium">Drop a file here or upload</span>
                    </div>
                    <div className="flex-1" />
                    <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-white border border-gray-200 shadow-sm hover:bg-gray-100 cursor-pointer">
                      Choose file
                      <input
                        type="file"
                        accept=".txt,.md,.tex,.csv,text/plain,text/markdown"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </label>
                  </div>
                  {uploadedFileName && (
                    <p className="mt-2 text-xs text-gray-500">Loaded: <span className="font-medium">{uploadedFileName}</span></p>
                  )}
                </div>
                <textarea
                  ref={textAreaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Or paste / type your document text here…"
                  className="w-full min-h-[160px] px-4 py-3 text-sm text-gray-800 focus:outline-none resize-y placeholder:text-gray-400 border-0"
                />
              </div>
            </>
          )}

          {/* ---------- STEP 2: Metadata review ---------- */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Success banner */}
              <div className="flex items-start gap-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">AI extracted metadata from your text</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    Review and edit any field below before creating the document.
                  </p>
                </div>
              </div>

              {/* Core metadata grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Title" icon={FileText}>
                  <Input
                    value={meta.title}
                    onChange={(e) => updateMeta('title', e.target.value)}
                    placeholder="Document title"
                  />
                </Field>

                <Field label="Author" icon={User}>
                  <Input
                    value={meta.author}
                    onChange={(e) => updateMeta('author', e.target.value)}
                    placeholder="Author name"
                  />
                </Field>

                <Field label="Document Type" icon={Tag}>
                  <Select
                    value={meta.document_type}
                    onChange={(e) => updateMeta('document_type', e.target.value)}
                    options={DOCUMENT_TYPES}
                  />
                </Field>

                <Field label="Category" icon={Tag}>
                  <Select
                    value={meta.category}
                    onChange={(e) => updateMeta('category', e.target.value)}
                    options={CATEGORIES}
                  />
                </Field>

                <Field label="Jurisdiction" icon={Scale}>
                  <Input
                    value={meta.jurisdiction}
                    onChange={(e) => updateMeta('jurisdiction', e.target.value)}
                    placeholder="e.g. US-California"
                  />
                </Field>

                <Field label="Governing Law" icon={Scale}>
                  <Input
                    value={meta.governing_law}
                    onChange={(e) => updateMeta('governing_law', e.target.value)}
                    placeholder="e.g. Delaware"
                  />
                </Field>

                <Field label="Reference Number" icon={FileText}>
                  <Input
                    value={meta.reference_number}
                    onChange={(e) => updateMeta('reference_number', e.target.value)}
                    placeholder="e.g. CNT-001"
                  />
                </Field>

                <Field label="Project Name" icon={Building2}>
                  <Input
                    value={meta.project_name}
                    onChange={(e) => updateMeta('project_name', e.target.value)}
                    placeholder="Project name"
                  />
                </Field>

                <Field label="Effective Date" icon={Calendar}>
                  <Input
                    type="date"
                    value={meta.effective_date}
                    onChange={(e) => updateMeta('effective_date', e.target.value)}
                  />
                </Field>

                <Field label="Expiration Date" icon={Calendar}>
                  <Input
                    type="date"
                    value={meta.expiration_date}
                    onChange={(e) => updateMeta('expiration_date', e.target.value)}
                  />
                </Field>
              </div>

              {/* Parties */}
              <Field label="Parties" icon={Users}>
                <PartyEditor
                  parties={meta.parties}
                  onChange={(val) => updateMeta('parties', val)}
                />
              </Field>
            </div>
          )}

          {/* ---------- STEP 3: Template browser ---------- */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Search + filter row */}
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    placeholder="Search templates…"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={templateCategory}
                  onChange={(e) => setTemplateCategory(e.target.value)}
                  options={[{ value: '', label: 'All categories' }, ...CATEGORIES]}
                  className="w-44"
                />
              </div>

              {/* Template grid */}
              {loadingTemplates ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <BookTemplate className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">No master templates found</p>
                  <p className="text-xs mt-1">Create one from the Masters page or promote an existing document.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-1">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTemplate(t)}
                      className="text-left rounded-xl border border-gray-200 hover:border-emerald-300 hover:shadow-md p-4 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                            <BookTemplate className="h-4 w-4 text-emerald-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-emerald-700">{t.name}</p>
                            <p className="text-xs text-gray-500 capitalize">{t.category} · {t.document_type || 'document'}</p>
                          </div>
                        </div>
                      </div>
                      {t.description && (
                        <p className="text-xs text-gray-500 line-clamp-2 mb-2">{t.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <GitBranch className="h-3 w-3" /> {t.branch_count || 0} branches
                        </span>
                        {t.tags?.length > 0 && (
                          <span className="flex items-center gap-1 truncate">
                            <Tag className="h-3 w-3" /> {t.tags.slice(0, 3).join(', ')}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---------- STEP 4: Branch creation form ---------- */}
          {step === 4 && selectedTemplate && (
            <div className="space-y-5">
              {/* Template info banner */}
              <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                <BookTemplate className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-800">
                    Creating from &ldquo;{selectedTemplate.name}&rdquo;
                  </p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {selectedTemplate.description || 'This will create a new document branched from the master template.'}
                  </p>
                </div>
              </div>

              {/* Core fields: title + branch name */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Document Title" icon={FileText}>
                  <Input
                    value={branchForm.title}
                    onChange={(e) => setBranchForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Title for your new document"
                    autoFocus
                  />
                </Field>

                <Field label="Branch Name" icon={GitBranch}>
                  <Input
                    value={branchForm.branch_name}
                    onChange={(e) => setBranchForm((f) => ({ ...f, branch_name: e.target.value }))}
                    placeholder="e.g. Client X — Q1 2026 (optional)"
                  />
                  <p className="text-xs text-gray-400 mt-0.5">Leave blank to use the title</p>
                </Field>
              </div>

              {/* ── Dynamic custom metadata fields ([[placeholder]] values) ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <Tag className="h-3.5 w-3.5" />
                    Document Fields
                  </label>
                  {loadingPlaceholders && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> Scanning template…
                    </span>
                  )}
                </div>

                {templatePlaceholders.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 -mt-1">
                      Fill in values for the <code className="bg-gray-100 px-1 py-0.5 rounded text-[11px]">[[field]]</code> placeholders
                      used in this template. These will be applied to your new document.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {templatePlaceholders.map((field) => (
                        <div key={field} className="space-y-1">
                          <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                            <span className="text-emerald-500 font-mono text-[10px]">[[</span>
                            {field.replace(/_/g, ' ')}
                            <span className="text-emerald-500 font-mono text-[10px]">]]</span>
                          </label>
                          <Input
                            value={branchForm.customFields[field] ?? ''}
                            onChange={(e) =>
                              setBranchForm((f) => ({
                                ...f,
                                customFields: { ...f.customFields, [field]: e.target.value },
                              }))
                            }
                            placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : !loadingPlaceholders ? (
                  <div className="text-center py-4 text-gray-400 bg-gray-50 rounded-lg">
                    <p className="text-sm">No <code>[[placeholder]]</code> fields found in this template.</p>
                    <p className="text-xs mt-1">You can add custom fields below or edit them after creation.</p>
                  </div>
                ) : null}

                {/* Add custom field */}
                <div className="mt-3">
                  <AddCustomFieldRow
                    onAdd={(key, value) =>
                      setBranchForm((f) => ({
                        ...f,
                        customFields: { ...f.customFields, [key]: value },
                      }))
                    }
                  />
                </div>
              </div>

              {/* Parties */}
              <Field label="Parties" icon={Users}>
                <PartyEditor
                  parties={branchForm.parties}
                  onChange={(val) => setBranchForm((f) => ({ ...f, parties: val }))}
                />
              </Field>

              {/* Include content toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={branchForm.include_content}
                  onChange={(e) => setBranchForm((f) => ({ ...f, include_content: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm text-gray-700">Include all content from the template</span>
              </label>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* =================== FOOTER =================== */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
          {step === 1 && (
            <>
              <p className="text-xs text-gray-500 hidden sm:block">
                The document opens in the modern editor once created.
              </p>
              <div className="flex items-center gap-3 ml-auto">
                <button
                  onClick={closeDialog}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  onClick={handleQuickCreateAI}
                  disabled={!canAnalyze}
                  className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    canAnalyze
                      ? 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'
                      : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed'
                  }`}
                >
                  {isCreating ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating...
                    </span>
                  ) : (
                    'Quick create with AI'
                  )}
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze}
                  className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg text-white transition-colors ${
                    canAnalyze ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300 cursor-not-allowed'
                  }`}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Analysing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Analyse &amp; review
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <button
                onClick={() => { setStep(1); setError(null); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={closeDialog}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateWithAI}
                  disabled={busy}
                  className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg text-white transition-colors ${
                    busy ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Creating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Create document
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <button
                onClick={() => { setStep(1); setError(null); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                onClick={closeDialog}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </>
          )}

          {step === 4 && (
            <>
              <button
                onClick={() => { setStep(3); setError(null); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={closeDialog}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFromTemplate}
                  disabled={busy || !branchForm.title.trim()}
                  className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg text-white transition-colors ${
                    busy || !branchForm.title.trim() ? 'bg-emerald-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Creating...
                    </>
                  ) : (
                    <>
                      <GitBranch className="h-4 w-4" /> Create from template
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateDocumentDialog;
