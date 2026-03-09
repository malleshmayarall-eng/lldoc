/**
 * AIDocumentWizard.jsx
 *
 * AI-driven document creation wizard.
 *
 * Flow:
 *   Step 1 — Pick document type (+ optional template)
 *   Step 2 — AI generates contextual questions; user answers one-by-one (skip available)
 *   Step 3 — Review collected answers → Create document
 *
 * The questions are NOT hard-coded: the backend (POST /api/ai/document-questions/)
 * uses Gemini (or smart fallbacks) to generate questions tailored to the specific
 * document type, so each type gets exactly the metadata questions that matter.
 *
 * Opened via:  window.dispatchEvent(new CustomEvent('openAIDocumentWizard'))
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FileSignature,
  FileText,
  Globe,
  LayoutTemplate,
  Loader2,
  Pencil,
  Scale,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Tag,
  User,
  Users,
  X,
} from 'lucide-react';
import aiService from '../services/aiService';
import { documentService } from '../services/documentService';

/* ====================================================================
   Constants
   ==================================================================== */

const DOCUMENT_TYPES = [
  { value: 'contract',    label: 'Contract',            icon: FileSignature, desc: 'Service, sales or general contracts' },
  { value: 'agreement',   label: 'Agreement',           icon: Briefcase,     desc: 'Partnership, consulting agreements' },
  { value: 'nda',         label: 'NDA',                 icon: ShieldCheck,   desc: 'Non-disclosure / confidentiality' },
  { value: 'policy',      label: 'Policy',              icon: FileText,      desc: 'Internal policies or guidelines' },
  { value: 'license',     label: 'License',             icon: Tag,           desc: 'Software, IP, or content licensing' },
  { value: 'terms',       label: 'Terms & Conditions',  icon: Scale,         desc: 'Terms of service or use' },
  { value: 'legal_brief', label: 'Legal Brief',         icon: FileText,      desc: 'Court filings, memos, briefs' },
  { value: 'regulation',  label: 'Regulation',          icon: Globe,         desc: 'Regulatory compliance documents' },
  { value: 'memo',        label: 'Memorandum',          icon: FileText,      desc: 'Internal or external memos' },
  { value: 'other',       label: 'Other',               icon: FileText,      desc: 'Any other document type' },
];

/** Maps document_type → backend template_name (when a matching template exists) */
const TYPE_TO_TEMPLATE = {
  contract:  'service_agreement',
  nda:       'nda',
  license:   'licensing_agreement',
};

const TEMPLATES = [
  { name: 'service_agreement',   label: 'Service Agreement',       type: 'contract', sections: 8,  desc: 'Provider-client service engagement' },
  { name: 'nda',                 label: 'Non-Disclosure Agreement', type: 'nda',      sections: 8,  desc: 'Mutual or one-way confidentiality' },
  { name: 'employment_contract', label: 'Employment Agreement',     type: 'contract', sections: 10, desc: 'Employer-employee relationship' },
  { name: 'lease_agreement',     label: 'Lease Agreement',         type: 'contract', sections: 10, desc: 'Property rental / lease terms' },
  { name: 'licensing_agreement', label: 'License Agreement',       type: 'license',  sections: 10, desc: 'IP licensing agreement' },
];

/* Model-level fields that go straight into createFromTemplate / createDocument */
const DIRECT_MODEL_FIELDS = new Set([
  'title', 'author', 'parties', 'signatories', 'effective_date', 'expiration_date',
  'governing_law', 'jurisdiction', 'term_length', 'reference_number', 'project_name',
]);

const GROUP_ICONS = {
  basics: FileText,
  parties: Users,
  dates: Calendar,
  legal: Scale,
  financial: Building2,
  details: Tag,
};

/* ====================================================================
   Tiny reusable primitives
   ==================================================================== */

const Input = (props) => (
  <input
    {...props}
    className={`w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800
      placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500
      transition ${props.className || ''}`}
  />
);

const SelectInput = ({ options, placeholder, ...props }) => (
  <select
    {...props}
    className={`w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800
      focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition
      ${props.className || ''}`}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

/* ====================================================================
   Inline party chip editor
   ==================================================================== */

const PartyEditor = ({ parties = [], onChange }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  const add = () => {
    const t = name.trim();
    if (!t) return;
    onChange([...parties, { name: t, role: role.trim() || undefined }]);
    setName('');
    setRole('');
  };

  const remove = (i) => onChange(parties.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {parties.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {parties.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
              {p.name}
              {p.role && <span className="text-blue-400">({p.role})</span>}
              <button type="button" onClick={() => remove(i)} className="ml-1 hover:text-red-500"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Party name" className="flex-1" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" className="w-28" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button type="button" onClick={add} disabled={!name.trim()} className="shrink-0 rounded-lg bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 disabled:opacity-40">Add</button>
      </div>
    </div>
  );
};

/* ====================================================================
   Question renderer — handles different input types
   ==================================================================== */

const QuestionInput = ({ question, value, onChange }) => {
  if (question.type === 'date') {
    return <Input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
  if (question.type === 'number') {
    return <Input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={question.placeholder} />;
  }
  if (question.type === 'select' && question.options?.length) {
    return (
      <SelectInput
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        options={question.options}
        placeholder="Choose one…"
      />
    );
  }
  if (question.type === 'parties') {
    return (
      <PartyEditor
        parties={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  }
  // Default: text
  return (
    <Input
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={question.placeholder || ''}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
    />
  );
};

/* ====================================================================
   Step progress indicator
   ==================================================================== */

const STEP_LABELS = ['Document Type', 'AI Questions', 'Review & Create'];

const StepBar = ({ current }) => (
  <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 bg-gray-50/60">
    {STEP_LABELS.map((label, i) => {
      const stepNum = i + 1;
      const done = stepNum < current;
      const active = stepNum === current;
      return (
        <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
          <div className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 transition-colors
            ${done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : stepNum}
          </div>
          <span className={`text-[11px] font-medium truncate ${active ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
          {i < STEP_LABELS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 shrink-0 ml-auto" />}
        </div>
      );
    })}
  </div>
);

/* ====================================================================
   Main wizard component
   ==================================================================== */

const AIDocumentWizard = () => {
  const navigate = useNavigate();

  /* ---- visibility ------------------------------------------------ */
  const [isOpen, setIsOpen] = useState(false);

  /* ---- wizard state ---------------------------------------------- */
  const [step, setStep] = useState(1);

  // Step 1 — document type + template
  const [docType, setDocType] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  // Step 2 — AI questions
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  // Step 3 — creating
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  const busy = isCreating || isLoadingQuestions;

  /* ---- derived --------------------------------------------------- */
  const currentQuestion = questions[currentQ] || null;
  const isLastQuestion = currentQ >= questions.length - 1;
  const answeredCount = useMemo(
    () => Object.values(answers).filter((v) => (Array.isArray(v) ? v.length > 0 : !!v)).length,
    [answers],
  );

  const relevantTemplates = useMemo(() => {
    if (!docType) return TEMPLATES;
    return TEMPLATES.filter((t) => t.type === docType || (docType === 'agreement' && t.type === 'contract'));
  }, [docType]);

  /* ---- reset ----------------------------------------------------- */
  const resetAll = useCallback(() => {
    setStep(1);
    setDocType('');
    setSelectedTemplate('');
    setShowTemplates(false);
    setQuestions([]);
    setCurrentQ(0);
    setAnswers({});
    setIsLoadingQuestions(false);
    setIsCreating(false);
    setError(null);
  }, []);

  const open = useCallback(() => { resetAll(); setIsOpen(true); }, [resetAll]);
  const close = useCallback(() => { if (busy) return; setIsOpen(false); resetAll(); }, [busy, resetAll]);

  /* ---- events ---------------------------------------------------- */
  useEffect(() => {
    const h = () => open();
    window.addEventListener('openAIDocumentWizard', h);
    return () => window.removeEventListener('openAIDocumentWizard', h);
  }, [open]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, close]);

  /* ---- step 1 → step 2 transition: fetch AI questions ------------ */
  const proceedToQuestions = useCallback(async (type, template) => {
    setStep(2);
    setCurrentQ(0);
    setAnswers({});
    setIsLoadingQuestions(true);
    setError(null);

    try {
      const res = await aiService.getDocumentQuestions({
        document_type: type,
        template_name: template || '',
      });
      const qs = res?.questions || [];
      setQuestions(qs);

      // Pre-fill title default based on type
      const typeLabel = DOCUMENT_TYPES.find((t) => t.value === type)?.label || type;
      const tplLabel = template ? (TEMPLATES.find((t) => t.name === template)?.label || '') : '';
      const defaultTitle = tplLabel || `${typeLabel} — Draft`;
      setAnswers((prev) => ({ ...prev, title: prev.title || defaultTitle }));
    } catch {
      setError('Could not load AI questions. Using defaults.');
    } finally {
      setIsLoadingQuestions(false);
    }
  }, []);

  /* ---- step 1 handlers ------------------------------------------ */
  const handleSelectType = useCallback((type) => {
    setDocType(type);
    const tpl = TYPE_TO_TEMPLATE[type];
    setSelectedTemplate(tpl || '');
    setShowTemplates(true);
  }, []);

  const handleConfirmTypeAndTemplate = useCallback(() => {
    if (!docType) return;
    proceedToQuestions(docType, selectedTemplate);
  }, [docType, selectedTemplate, proceedToQuestions]);

  const handleSkipToCreate = useCallback(() => {
    setStep(3);
  }, []);

  /* ---- step 2 handlers ------------------------------------------ */
  const handleAnswer = useCallback((value) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.field]: value }));
  }, [currentQuestion]);

  const handleNextQuestion = useCallback(() => {
    if (isLastQuestion) {
      setStep(3);
    } else {
      setCurrentQ((i) => i + 1);
    }
  }, [isLastQuestion]);

  const handleSkipQuestion = useCallback(() => {
    handleNextQuestion();
  }, [handleNextQuestion]);

  const handlePrevQuestion = useCallback(() => {
    if (currentQ > 0) setCurrentQ((i) => i - 1);
    else { setStep(1); setShowTemplates(true); }
  }, [currentQ]);

  /* ---- step 3 — edit answer from review -------------------------- */
  const handleEditFromReview = useCallback((field) => {
    const qIndex = questions.findIndex((q) => q.field === field);
    if (qIndex >= 0) {
      setCurrentQ(qIndex);
      setStep(2);
    }
  }, [questions]);

  /* ---- step 3 — create the document ----------------------------- */
  const handleCreate = useCallback(async () => {
    if (busy) return;
    setIsCreating(true);
    setError(null);

    const metadata = {};
    const customMeta = {};
    const replacements = {};

    for (const [field, value] of Object.entries(answers)) {
      if (!value || (Array.isArray(value) && value.length === 0)) continue;

      if (DIRECT_MODEL_FIELDS.has(field)) {
        metadata[field] = value;
      } else {
        customMeta[field] = value;
        // Build template placeholder replacements — lowercase to match [[key]] format
        const phKey = field.toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (Array.isArray(value)) {
          // Arrays of objects (e.g. parties): serialize to readable string
          replacements[phKey] = value
            .map((v) =>
              typeof v === 'object' && v !== null
                ? Object.values(v).filter(Boolean).join(' — ')
                : String(v),
            )
            .join(', ');
        } else if (typeof value === 'object' && value !== null) {
          replacements[phKey] = JSON.stringify(value);
        } else {
          replacements[phKey] = String(value);
        }
      }
    }

    if (Object.keys(customMeta).length) {
      metadata.custom_metadata = customMeta;
    }

    try {
      let docId;

      if (selectedTemplate) {
        const res = await documentService.createFromTemplate({
          template_name: selectedTemplate,
          title: metadata.title || 'Untitled Document',
          metadata,
          replacements,
        });
        docId = res?.id || res?.document_id;
      } else {
        const res = await documentService.createDocument({
          title: metadata.title || 'Untitled Document',
          document_type: docType || 'contract',
          category: docType || 'contract',
          ...metadata,
        });
        docId = res?.id || res?.document_id;
      }

      if (!docId) throw new Error('Document ID not returned from server.');
      close();
      navigate(`/drafter/${docId}`);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Failed to create document');
    } finally {
      setIsCreating(false);
    }
  }, [busy, answers, selectedTemplate, docType, close, navigate]);

  /* ---- render ---------------------------------------------------- */
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={close}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

        {/* =================== HEADER =================== */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            {(step > 1) && (
              <button
                onClick={step === 2 ? handlePrevQuestion : () => setStep(2)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                disabled={busy}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI Document Assistant</h2>
              <p className="text-xs text-gray-500">
                {step === 1 && 'Choose your document type to begin'}
                {step === 2 && !isLoadingQuestions && currentQuestion && (
                  <span>Question {currentQ + 1} of {questions.length} — skip anything you&apos;ll add later</span>
                )}
                {step === 2 && isLoadingQuestions && 'AI is preparing smart questions for your document…'}
                {step === 3 && 'Review your answers and create the document'}
              </p>
            </div>
          </div>
          <button onClick={close} className="p-2 rounded-full hover:bg-gray-100 text-gray-500" disabled={busy}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* =================== STEP BAR =================== */}
        <StepBar current={step} />

        {/* =================== BODY =================== */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ========== STEP 1: Document type + template ========== */}
          {step === 1 && !showTemplates && (
            <div className="grid grid-cols-2 gap-3">
              {DOCUMENT_TYPES.map((t) => {
                const Icon = t.icon;
                const selected = docType === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => handleSelectType(t.value)}
                    className={`text-left rounded-xl border-2 p-4 transition-all hover:shadow-md ${
                      selected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-100 bg-white hover:border-blue-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-1">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{t.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Template selection (after type is picked) */}
          {step === 1 && showTemplates && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Type:</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                  {DOCUMENT_TYPES.find((t) => t.value === docType)?.label || docType}
                  <button onClick={() => { setShowTemplates(false); setDocType(''); }} className="hover:text-red-500"><X className="h-3 w-3" /></button>
                </span>
              </div>

              <button
                onClick={() => setSelectedTemplate('')}
                className={`w-full text-left rounded-xl border-2 p-4 transition-all hover:shadow-md ${
                  selectedTemplate === '' ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:border-blue-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Start from scratch</p>
                    <p className="text-xs text-gray-500">Blank structure — AI will set up the metadata</p>
                  </div>
                </div>
              </button>

              {relevantTemplates.length > 0 && (
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-1">Or pick a pre-built template</p>
              )}
              {relevantTemplates.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setSelectedTemplate(t.name)}
                  className={`w-full text-left rounded-xl border-2 p-4 transition-all hover:shadow-md ${
                    selectedTemplate === t.name ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white hover:border-blue-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-violet-50 flex items-center justify-center">
                      <LayoutTemplate className="h-5 w-5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{t.label}</p>
                      <p className="text-xs text-gray-500">{t.desc} · {t.sections} sections</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ========== STEP 2: AI questions one-by-one ========== */}
          {step === 2 && isLoadingQuestions && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center animate-pulse">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900">AI is analyzing your document type…</p>
                <p className="text-xs text-gray-500 mt-1">Generating the right questions for a {DOCUMENT_TYPES.find((t) => t.value === docType)?.label || docType}</p>
              </div>
              <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
            </div>
          )}

          {step === 2 && !isLoadingQuestions && questions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <p className="text-sm text-gray-600">No questions generated. You can proceed to create your document directly.</p>
              <button
                onClick={() => setStep(3)}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Continue to create
              </button>
            </div>
          )}

          {step === 2 && !isLoadingQuestions && currentQuestion && (
            <div className="space-y-5">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5 justify-center">
                {questions.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentQ(i)}
                    className={`h-2 rounded-full transition-all ${
                      i === currentQ ? 'w-6 bg-blue-600' : i < currentQ ? 'w-2 bg-green-400' : 'w-2 bg-gray-200'
                    }`}
                  />
                ))}
              </div>

              {/* Question card */}
              <div className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-50/80 p-6 space-y-4">
                {currentQuestion.group && (
                  <div className="flex items-center gap-1.5">
                    {(() => { const GIcon = GROUP_ICONS[currentQuestion.group] || Tag; return <GIcon className="h-3.5 w-3.5 text-gray-400" />; })()}
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                      {currentQuestion.group}
                    </span>
                    {currentQuestion.required && (
                      <span className="ml-auto text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Required</span>
                    )}
                  </div>
                )}

                <h3 className="text-lg font-semibold text-gray-900 leading-snug">
                  {currentQuestion.question}
                </h3>

                <QuestionInput
                  question={currentQuestion}
                  value={answers[currentQuestion.field]}
                  onChange={handleAnswer}
                />
              </div>
            </div>
          )}

          {/* ========== STEP 3: Review & create ========== */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">
                      Ready to create — {answeredCount} of {questions.length} questions answered
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">
                      You can edit anything below or just hit Create to get started.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                  {DOCUMENT_TYPES.find((t) => t.value === docType)?.label || docType || 'Document'}
                </span>
                {selectedTemplate && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 border border-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
                    <LayoutTemplate className="h-3 w-3" />
                    {TEMPLATES.find((t) => t.name === selectedTemplate)?.label || selectedTemplate}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
                {questions.map((q) => {
                  const val = answers[q.field];
                  const hasValue = Array.isArray(val) ? val.length > 0 : !!val;
                  let displayVal = '—';

                  if (hasValue) {
                    if (q.type === 'parties' && Array.isArray(val)) {
                      displayVal = val.map((p) => `${p.name || ''}${p.role ? ` (${p.role})` : ''}`).join(', ');
                    } else if (q.type === 'select' && q.options) {
                      displayVal = q.options.find((o) => o.value === val)?.label || String(val);
                    } else if (Array.isArray(val)) {
                      displayVal = val
                        .map((v) =>
                          typeof v === 'object' && v !== null
                            ? Object.values(v).filter(Boolean).join(' — ')
                            : String(v),
                        )
                        .join(', ');
                    } else if (typeof val === 'object' && val !== null) {
                      displayVal = Object.entries(val)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ');
                    } else {
                      displayVal = String(val);
                    }
                  }

                  return (
                    <div key={q.id} className="flex items-center justify-between px-4 py-2.5 group">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-gray-500 shrink-0">
                          {q.field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        </span>
                        {q.required && !hasValue && (
                          <span className="text-[10px] text-amber-500 font-medium">Missing</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium text-right max-w-[50%] truncate ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>
                          {displayVal}
                        </span>
                        <button
                          onClick={() => handleEditFromReview(q.field)}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 opacity-0 group-hover:opacity-100 transition"
                          title="Edit"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {questions.length === 0 && (
                  <div className="px-4 py-3 text-xs text-gray-500">
                    No metadata collected — a blank document will be created with the selected type and template.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
        </div>

        {/* =================== FOOTER =================== */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/80 shrink-0">
          <div className="text-xs text-gray-400">
            {step === 2 && !isLoadingQuestions && questions.length > 0 && (
              <span>{currentQ + 1} / {questions.length}</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={close} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700" disabled={busy}>
              Cancel
            </button>

            {/* Step 1: Continue button */}
            {step === 1 && showTemplates && (
              <button
                onClick={handleConfirmTypeAndTemplate}
                disabled={!docType}
                className={`inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-lg text-white transition ${
                  docType ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300 cursor-not-allowed'
                }`}
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}

            {/* Step 2: Skip + Next */}
            {step === 2 && !isLoadingQuestions && currentQuestion && (
              <>
                <button
                  onClick={handleSkipToCreate}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition"
                >
                  Skip all → Create
                </button>
                <button
                  onClick={handleSkipQuestion}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition"
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </button>
                <button
                  onClick={handleNextQuestion}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  {isLastQuestion ? 'Review' : 'Next'} <ArrowRight className="h-4 w-4" />
                </button>
              </>
            )}

            {/* Step 3: Create */}
            {step === 3 && (
              <button
                onClick={handleCreate}
                disabled={busy}
                className={`inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg text-white transition ${
                  busy ? 'bg-blue-300 cursor-not-allowed' : 'bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 shadow-lg shadow-blue-500/25'
                }`}
              >
                {isCreating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Create Document</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIDocumentWizard;
