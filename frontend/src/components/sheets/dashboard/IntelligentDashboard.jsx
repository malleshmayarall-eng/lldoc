/**
 * IntelligentDashboard — fullscreen dialog with AI-driven function-calling pipeline.
 *
 * Pipeline:
 *  Phase 1  POST /smart-analytics/         → AI picks functions, server executes them
 *  Phase 2  POST /generate-suggestions/    → AI analysis from results
 *           POST /generate-dashboard-ui/   → AI charts from results  (parallel)
 *  Phase 3  Render everything
 *
 * Features:
 *  - Per-phase loading indicators
 *  - "Analysis Plan" view showing which functions AI chose
 *  - Analytics results tab
 *  - AI suggestions tab
 *  - Charts + KPIs tab
 *  - PDF download
 *  - Prompt input for UI generation
 *  - Retry / regenerate controls
 */

import { useState, useCallback, useEffect, memo, useMemo, useRef } from 'react';
import {
  LayoutDashboard, Wand2, RefreshCw, X, Loader2,
  TrendingUp, TrendingDown, Minus,
  Sparkles, AlertTriangle, FileDown, ChevronDown,
  ChevronRight, Brain, Search, Lightbulb,
  Activity, Info, Beaker, Trash2,
  BarChart3, ListChecks, Database, CheckCircle2,
  ArrowRight, Cpu, Zap,
} from 'lucide-react';
import ChartCompiler from './ChartCompiler';
import ChartErrorBoundary from './ChartErrorBoundary';
import sheetsService from '../../../services/sheetsService';

// ── Phase step indicator ────────────────────────────────────────────

const PHASES = [
  { key: 'planning', label: 'AI Planning & Execution', icon: Cpu },
  { key: 'ai', label: 'AI Analysis & Charts', icon: Brain },
  { key: 'done', label: 'Dashboard Ready', icon: CheckCircle2 },
];

function PipelineProgress({ currentPhase }) {
  const phaseIdx = PHASES.findIndex((p) => p.key === currentPhase);
  return (
    <div className="flex items-center justify-center gap-2 py-5">
      {PHASES.map((phase, i) => {
        const PhIcon = phase.icon;
        const isActive = i === phaseIdx;
        const isDone = i < phaseIdx;
        return (
          <div key={phase.key} className="flex items-center gap-2">
            {i > 0 && (
              <ArrowRight className={`h-3.5 w-3.5 ${isDone ? 'text-indigo-400' : 'text-gray-200'}`} />
            )}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              isActive ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-200' :
              isDone ? 'bg-emerald-50 text-emerald-600' :
              'bg-gray-50 text-gray-400'
            }`}>
              {isActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isDone ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <PhIcon className="h-3.5 w-3.5" />
              )}
              {phase.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────

const KPICard = memo(function KPICard({ kpi }) {
  const Icon = kpi.changeType === 'positive' ? TrendingUp
    : kpi.changeType === 'negative' ? TrendingDown
    : Minus;
  const changeColor = kpi.changeType === 'positive' ? 'text-emerald-600'
    : kpi.changeType === 'negative' ? 'text-red-500'
    : 'text-gray-400';

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{kpi.label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
      {kpi.change && (
        <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${changeColor}`}>
          <Icon className="h-3 w-3" />
          <span>{kpi.change}</span>
        </div>
      )}
    </div>
  );
});

// ── Chart Card ──────────────────────────────────────────────────────

const ChartCard = memo(function ChartCard({ chart, onRetryExceeded }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <div className="px-4 py-3 border-b border-gray-50">
        <h4 className="text-sm font-semibold text-gray-800">{chart.title || 'Chart'}</h4>
      </div>
      <div className="h-72 p-3">
        <ChartErrorBoundary maxRetries={3} onMaxRetriesExceeded={onRetryExceeded}>
          <ChartCompiler chart={chart} />
        </ChartErrorBoundary>
      </div>
    </div>
  );
});

// ── Severity Badge ──────────────────────────────────────────────────

const SeverityBadge = memo(function SeverityBadge({ severity }) {
  const styles = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-green-100 text-green-700 border-green-200',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${styles[severity] || styles.low}`}>
      {severity}
    </span>
  );
});

// ── Priority / Type badges ──────────────────────────────────────────

const PriorityBadge = memo(function PriorityBadge({ priority }) {
  const styles = {
    high: 'bg-red-50 text-red-700',
    medium: 'bg-amber-50 text-amber-700',
    low: 'bg-blue-50 text-blue-700',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${styles[priority] || styles.low}`}>
      {priority}
    </span>
  );
});

const TypeBadge = memo(function TypeBadge({ type }) {
  const config = {
    optimization: { color: 'bg-emerald-50 text-emerald-700', icon: Sparkles },
    warning: { color: 'bg-amber-50 text-amber-700', icon: AlertTriangle },
    insight: { color: 'bg-blue-50 text-blue-700', icon: Lightbulb },
    action: { color: 'bg-purple-50 text-purple-700', icon: Activity },
  };
  const c = config[type] || config.insight;
  const TypeIcon = c.icon;
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full ${c.color}`}>
      <TypeIcon className="h-3 w-3" />
      {type}
    </span>
  );
});

// ── Collapsible Section ─────────────────────────────────────────────

function CollapsibleSection({ title, icon: SectionIcon, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50/80 hover:bg-gray-100/80 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        {SectionIcon && <SectionIcon className="h-4 w-4 text-gray-500" />}
        <span className="text-sm font-semibold text-gray-800 flex-1">{title}</span>
        {badge}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

// ── Data Quality Meter ──────────────────────────────────────────────

function DataQualityMeter({ quality }) {
  if (!quality) return null;
  const pct = quality.completeness_pct ?? 100;
  const color = pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-600">Data Completeness</span>
          <span className={`text-xs font-bold ${textColor}`}>{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {quality.issues?.length > 0 && (
        <div className="flex flex-col gap-1">
          {quality.issues.map((issue, i) => (
            <span key={i} className="text-[10px] text-gray-500 flex items-center gap-1">
              <Info className="h-3 w-3 text-gray-400 shrink-0" />
              {issue}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Analytics Stats Panel ───────────────────────────────────────────

function AnalyticsPanel({ analytics }) {
  if (!analytics) return null;

  const { columns_stats = {}, correlations = [], data_quality = {}, summary_stats = {} } = analytics;
  const colEntries = Object.entries(columns_stats);

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Rows', value: summary_stats.total_rows ?? '—' },
          { label: 'Columns', value: summary_stats.total_columns ?? '—' },
          { label: 'Numeric', value: summary_stats.numeric_columns ?? '—' },
          { label: 'Completeness', value: `${data_quality.completeness_pct ?? 100}%` },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-lg border border-gray-100 p-3 text-center">
            <p className="text-lg font-bold text-gray-900">{item.value}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Column stats cards */}
      {colEntries.length > 0 && (
        <CollapsibleSection title="Column Statistics" icon={Database} defaultOpen={false}
          badge={<span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{colEntries.length} cols</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {colEntries.map(([name, stats]) => (
              <div key={name} className="bg-white rounded-lg border border-gray-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-800 truncate">{name}</span>
                  <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{stats.type}</span>
                </div>
                {stats.type === 'numeric' ? (
                  <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
                    {[
                      ['Mean', stats.mean?.toFixed(2)],
                      ['Median', stats.median?.toFixed(2)],
                      ['Std Dev', stats.std?.toFixed(2)],
                      ['Q1', stats.q1?.toFixed(2)],
                      ['Q3', stats.q3?.toFixed(2)],
                      ['Outliers', stats.outlier_count],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-gray-400">{k}</span>
                        <span className="text-gray-700 font-mono">{v ?? '—'}</span>
                      </div>
                    ))}
                    {stats.distribution_shape && (
                      <div className="col-span-3 mt-1">
                        <span className="text-gray-400">Shape: </span>
                        <span className="text-gray-600">{stats.distribution_shape}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] space-y-1">
                    <div className="flex justify-between"><span className="text-gray-400">Unique</span><span className="text-gray-700">{stats.unique}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Nulls</span><span className="text-gray-700">{stats.nulls}</span></div>
                    {stats.top_values?.length > 0 && (
                      <div className="mt-1.5">
                        <span className="text-gray-400 text-[10px]">Top values:</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {stats.top_values.slice(0, 5).map(([val, cnt]) => (
                            <span key={val} className="text-[10px] px-1.5 py-0.5 bg-gray-50 rounded text-gray-600">{val} ({cnt})</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Correlations */}
      {correlations.length > 0 && (
        <CollapsibleSection title="Correlations" icon={Activity} defaultOpen={false}
          badge={<span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{correlations.length}</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 font-semibold text-gray-500">Column A</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-500">Column B</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-500">r</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-500">Strength</th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-500">Direction</th>
                </tr>
              </thead>
              <tbody>
                {correlations.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 px-3 text-gray-700">{c.col_a}</td>
                    <td className="py-2 px-3 text-gray-700">{c.col_b}</td>
                    <td className="py-2 px-3 font-mono font-medium text-gray-800">{c.r?.toFixed(3)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        c.strength === 'strong' || c.strength === 'very_strong' ? 'bg-indigo-50 text-indigo-700' :
                        c.strength === 'moderate' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500'
                      }`}>{c.strength}</span>
                    </td>
                    <td className="py-2 px-3 text-gray-600">{c.direction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      {/* Data quality */}
      {data_quality && <DataQualityMeter quality={data_quality} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════

const TAB_CHARTS = 'charts';
const TAB_ANALYSIS = 'analysis';
const TAB_PLAN = 'plan';

function IntelligentDashboard({ sheetId, open, onClose }) {
  // ── state ──
  const [activeTab, setActiveTab] = useState(TAB_CHARTS);
  const [prompt, setPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [failedCharts, setFailedCharts] = useState(new Set());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState(null);

  // Pipeline phases
  const [phase, setPhase] = useState(null);       // null | 'planning' | 'ai' | 'done'
  const [smartData, setSmartData] = useState(null);  // { metadata, plan, results, plan_source, errors }
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [chartsLoading, setChartsLoading] = useState(false);

  // Persisted dashboard (for charts)
  const [dashboard, setDashboard] = useState(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const dashboardContentRef = useRef(null);

  // ── Load existing dashboard on open ──
  useEffect(() => {
    if (!sheetId || !open) return;
    let cancelled = false;
    setLoadingExisting(true);
    sheetsService.getDashboard(sheetId)
      .then(({ data }) => { if (!cancelled) setDashboard(data); })
      .catch(() => { if (!cancelled) setDashboard(null); })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
  }, [sheetId, open]);

  // ── Full pipeline: Smart Analytics → AI suggestions + charts ──
  const runPipeline = useCallback(async (userPrompt = '') => {
    if (!sheetId) return;
    setError(null);
    setFailedCharts(new Set());
    setSmartData(null);
    setSuggestions(null);

    // Phase 1: AI-driven planning + execution
    setPhase('planning');
    let smartResp;
    try {
      const { data } = await sheetsService.smartAnalytics(sheetId, userPrompt);
      smartResp = data;
      setSmartData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Smart analytics failed');
      setPhase(null);
      return;
    }

    // Phase 2: AI suggestions + AI dashboard UI (parallel), pass results
    setPhase('ai');
    setSuggestionsLoading(true);
    setChartsLoading(true);

    const results = smartResp.results || [];

    const suggestionsPromise = sheetsService.generateSuggestions(sheetId, { results })
      .then(({ data }) => {
        setSuggestions(data.suggestions || data);
        setSuggestionsLoading(false);
      })
      .catch((err) => {
        console.warn('Suggestions failed:', err);
        setSuggestionsLoading(false);
      });

    const chartsPromise = sheetsService.generateDashboardUI(sheetId, { results, prompt: userPrompt })
      .then(({ data }) => {
        setDashboard(data);
        setChartsLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Chart generation failed');
        setChartsLoading(false);
      });

    await Promise.allSettled([suggestionsPromise, chartsPromise]);

    // Phase 3: Done
    setPhase('done');
  }, [sheetId]);

  // ── Generate handler ──
  const handleGenerate = useCallback(() => {
    runPipeline(prompt);
    setShowPrompt(false);
  }, [runPipeline, prompt]);

  // ── Delete dashboard ──
  const handleDelete = useCallback(async () => {
    if (!sheetId) return;
    try {
      await sheetsService.deleteDashboard(sheetId);
      setDashboard(null);
      setSmartData(null);
      setSuggestions(null);
      setPhase(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [sheetId]);

  // ── PDF download ──
  const handleDownloadPdf = useCallback(async () => {
    const node = dashboardContentRef.current;
    if (!node) return;
    setExportingPdf(true);
    try {
      const { toPng } = await import('html-to-image');
      const { default: jsPDF } = await import('jspdf');

      const noPdfEls = node.querySelectorAll('[data-no-pdf]');
      noPdfEls.forEach((el) => { el.style.display = 'none'; });

      const dataUrl = await toPng(node, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      noPdfEls.forEach((el) => { el.style.display = ''; });

      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

      const imgW = img.width;
      const imgH = img.height;
      const pageW = 297;
      const scale = pageW / imgW;
      const pageH = imgH * scale;

      const pdf = new jsPDF({
        orientation: pageH > 210 ? 'portrait' : 'landscape',
        unit: 'mm',
        format: pageH > 210 ? [210, pageH] : [pageW, Math.max(pageH, 210)],
      });
      pdf.addImage(dataUrl, 'PNG', 0, 0, pageH > 210 ? 210 : pageW, pageH);

      const title = dashboard?.chart_config?.title || 'Dashboard';
      pdf.save(`${title}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      setError('PDF export failed');
    } finally {
      setExportingPdf(false);
    }
  }, [dashboard]);

  // ── Track chart failures ──
  const handleChartRetryExceeded = useCallback((chartId) => {
    setFailedCharts((prev) => new Set(prev).add(chartId));
  }, []);

  // ── Escape key ──
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Derived data ──
  const config = useMemo(() => dashboard?.chart_config || {}, [dashboard]);
  const charts = useMemo(() => config.charts || [], [config]);
  const kpis = useMemo(() => config.kpis || [], [config]);
  const analysis = useMemo(() => suggestions || config.analysis || {}, [suggestions, config]);
  const gridCols = config.columns || 2;

  const isGenerating = phase === 'planning' || phase === 'ai';
  const hasDashboard = !!dashboard || !!smartData;

  if (!open) return null;

  // ── Loading existing ──
  if (loadingExisting && !dashboard) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
        <div className="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-gray-500">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Empty state: no dashboard yet ──
  if (!hasDashboard && !isGenerating) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
        <div
          className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                <LayoutDashboard className="h-4 w-4 text-white" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">Intelligent Dashboard</h3>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col items-center px-6 py-10 gap-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
              <Brain className="h-10 w-10 text-indigo-500" />
            </div>
            <div className="text-center">
              <h4 className="text-lg font-semibold text-gray-900">Generate AI Dashboard</h4>
              <p className="text-sm text-gray-500 mt-1 max-w-sm">
                AI will analyse your data structure, pick the best analytics functions,
                execute them server-side, then generate insights and charts.
              </p>
            </div>

            {/* Pipeline preview */}
            <div className="w-full bg-gray-50 rounded-xl p-4 space-y-2.5">
              {[
                { step: '1', label: 'AI plans analysis', desc: 'AI picks which functions to run on your data', icon: Cpu },
                { step: '2', label: 'Server executes', desc: 'Functions run on real data — results only go to AI', icon: Zap },
                { step: '3', label: 'AI suggestions', desc: 'Analysis, significance tests, recommendations', icon: Lightbulb },
                { step: '4', label: 'AI charts', desc: 'Recharts-compatible visualisations + KPIs', icon: BarChart3 },
              ].map((s) => (
                <div key={s.step} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold shrink-0">{s.step}</div>
                  <s.icon className="h-4 w-4 text-gray-400 shrink-0" />
                  <div>
                    <span className="text-xs font-medium text-gray-800">{s.label}</span>
                    <span className="text-[11px] text-gray-400 ml-1.5">— {s.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="w-full">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional: describe chart preferences (e.g., 'Show revenue trends by month')…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 outline-none h-20 resize-none"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-200/50 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Generate Dashboard
            </button>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 px-4 py-2 rounded-lg">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Full Dashboard View
  // ═══════════════════════════════════════════════════════════════════

  const tabs = [
    { key: TAB_CHARTS, label: 'Charts & KPIs', icon: BarChart3, count: charts.length },
    { key: TAB_ANALYSIS, label: 'AI Analysis', icon: Brain, count: analysis.suggestions?.length || 0 },
    { key: TAB_PLAN, label: 'Analysis Plan', icon: Cpu, count: smartData?.plan?.length || 0 },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-gray-50 rounded-2xl shadow-2xl w-[95vw] max-w-7xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Dialog Header ── */}
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-sm">
              <LayoutDashboard className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {config.title || 'Intelligent Dashboard'}
              </h3>
              {config.description && (
                <p className="text-[11px] text-gray-400">{config.description}</p>
              )}
            </div>
            {dashboard?.generation_status === 'fallback' && (
              <span className="px-2 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 rounded-full border border-amber-200">
                Fallback
              </span>
            )}
          </div>

          <div className="flex items-center gap-1" data-no-pdf="true">
            <button
              onClick={() => setShowPrompt((p) => !p)}
              title="Regenerate with instructions"
              className={`p-2 rounded-lg transition-colors text-sm ${showPrompt ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <Wand2 className="h-4 w-4" />
            </button>

            <button
              onClick={handleDownloadPdf}
              disabled={exportingPdf}
              title="Download as PDF"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-30"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            </button>

            <button
              onClick={handleDelete}
              title="Delete dashboard"
              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <button
              onClick={onClose}
              title="Close"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Prompt input (collapsible) ── */}
        {showPrompt && (
          <div className="flex gap-2 px-6 py-3 bg-white border-b border-gray-100 shrink-0" data-no-pdf="true">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe desired charts… (e.g., 'Focus on monthly trends and top categories')"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 outline-none h-14 resize-none"
            />
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 self-end"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Regenerate'}
            </button>
          </div>
        )}

        {/* ── Pipeline progress (while generating) ── */}
        {isGenerating && <PipelineProgress currentPhase={phase} />}

        {/* ── Tab bar ── */}
        {!isGenerating && (
          <div className="flex items-center gap-1 px-6 pt-3 bg-gray-50 shrink-0" data-no-pdf="true">
            {tabs.map((tab) => {
              const TIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-lg transition-colors ${
                    activeTab === tab.key
                      ? 'bg-white text-indigo-600 border border-gray-200 border-b-white -mb-px'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                  }`}
                >
                  <TIcon className="h-3.5 w-3.5" />
                  {tab.label}
                  {tab.count != null && tab.count > 0 && (
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full ml-0.5">
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Scrollable content ── */}
        <div ref={dashboardContentRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 px-4 py-2 rounded-lg">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* ═══════ TAB: Charts & KPIs ═══════ */}
          {activeTab === TAB_CHARTS && (
            <>
              {chartsLoading ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <Loader2 className="h-6 w-6 text-indigo-500 animate-spin" />
                  <span className="text-sm text-gray-500">AI is generating charts…</span>
                </div>
              ) : (
                <>
                  {/* KPI Cards */}
                  {kpis.length > 0 && (
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: `repeat(${Math.min(kpis.length, 5)}, minmax(0, 1fr))` }}
                    >
                      {kpis.map((kpi, i) => <KPICard key={i} kpi={kpi} />)}
                    </div>
                  )}

                  {/* Charts Grid */}
                  {charts.length > 0 && (
                    <div
                      className="grid gap-4"
                      style={{ gridTemplateColumns: `repeat(${Math.min(gridCols, charts.length)}, minmax(0, 1fr))` }}
                    >
                      {charts.map((chart) => (
                        <ChartCard
                          key={chart.id}
                          chart={chart}
                          onRetryExceeded={() => handleChartRetryExceeded(chart.id)}
                        />
                      ))}
                    </div>
                  )}

                  {charts.length === 0 && !chartsLoading && (
                    <div className="flex flex-col items-center py-16 text-gray-400 gap-2">
                      <BarChart3 className="h-8 w-8" />
                      <p className="text-sm">No charts yet. Click <strong>Regenerate</strong> to create them.</p>
                    </div>
                  )}

                  {failedCharts.size > 0 && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg" data-no-pdf="true">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {failedCharts.size} chart(s) failed after 3 retries.
                      <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="ml-auto font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        Regenerate
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ═══════ TAB: AI Analysis ═══════ */}
          {activeTab === TAB_ANALYSIS && (
            <>
              {suggestionsLoading ? (
                <div className="flex items-center justify-center py-16 gap-3">
                  <Loader2 className="h-6 w-6 text-indigo-500 animate-spin" />
                  <span className="text-sm text-gray-500">AI is analysing your data…</span>
                </div>
              ) : analysis.summary ? (
                <>
                  {/* Executive Summary */}
                  <CollapsibleSection title="Executive Summary" icon={Brain} defaultOpen={true}>
                    <p className="text-sm text-gray-700 leading-relaxed">{analysis.summary}</p>
                    {analysis.data_quality && (
                      <div className="mt-4"><DataQualityMeter quality={analysis.data_quality} /></div>
                    )}
                  </CollapsibleSection>

                  {/* Scientific Significance */}
                  {analysis.scientific_significance?.length > 0 && (
                    <CollapsibleSection
                      title="Scientific Significance"
                      icon={Beaker}
                      defaultOpen={true}
                      badge={
                        <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                          {analysis.scientific_significance.length} finding{analysis.scientific_significance.length !== 1 ? 's' : ''}
                        </span>
                      }
                    >
                      <div className="space-y-3">
                        {analysis.scientific_significance.map((item, i) => (
                          <div key={i} className="flex gap-3 p-3 bg-white rounded-lg border border-gray-100">
                            <div className="shrink-0 mt-0.5"><SeverityBadge severity={item.significance} /></div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold text-gray-800">{item.test}</span>
                                {item.p_value && item.p_value !== 'N/A' && (
                                  <span className="text-[10px] text-gray-400 font-mono">{item.p_value}</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-600">{item.finding}</p>
                              {item.explanation && (
                                <p className="text-[11px] text-gray-400 mt-1 italic">{item.explanation}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}

                  {/* Outliers */}
                  {analysis.outliers?.length > 0 && (
                    <CollapsibleSection
                      title="Outlier Detection"
                      icon={Search}
                      defaultOpen={true}
                      badge={
                        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                          {analysis.outliers.length} outlier{analysis.outliers.length !== 1 ? 's' : ''}
                        </span>
                      }
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="text-left py-2 px-3 font-semibold text-gray-500">Row</th>
                              <th className="text-left py-2 px-3 font-semibold text-gray-500">Column</th>
                              <th className="text-left py-2 px-3 font-semibold text-gray-500">Value</th>
                              <th className="text-left py-2 px-3 font-semibold text-gray-500">Deviation</th>
                              <th className="text-left py-2 px-3 font-semibold text-gray-500">Severity</th>
                              <th className="text-left py-2 px-3 font-semibold text-gray-500">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.outliers.map((o, i) => (
                              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                                <td className="py-2 px-3 text-gray-700 font-medium">{o.row_label || '—'}</td>
                                <td className="py-2 px-3 text-gray-600">{o.column}</td>
                                <td className="py-2 px-3 font-mono text-gray-800 font-medium">{o.value}</td>
                                <td className="py-2 px-3 text-gray-500">{o.deviation}</td>
                                <td className="py-2 px-3"><SeverityBadge severity={o.severity} /></td>
                                <td className="py-2 px-3 text-gray-500">{o.recommendation || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleSection>
                  )}

                  {/* Suggestions */}
                  {analysis.suggestions?.length > 0 && (
                    <CollapsibleSection
                      title="Suggestions"
                      icon={Lightbulb}
                      defaultOpen={true}
                      badge={
                        <span className="text-[10px] font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                          {analysis.suggestions.length}
                        </span>
                      }
                    >
                      <div className="space-y-3">
                        {analysis.suggestions.map((s, i) => (
                          <div key={i} className="flex gap-3 p-3 bg-white rounded-lg border border-gray-100">
                            <div className="shrink-0 mt-0.5 flex flex-col gap-1.5 items-start">
                              <TypeBadge type={s.type} />
                              <PriorityBadge priority={s.priority} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-800 mb-0.5">{s.title}</p>
                              <p className="text-xs text-gray-600 leading-relaxed">{s.description}</p>
                              {s.affected_columns?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {s.affected_columns.map((col, ci) => (
                                    <span key={ci} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{col}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center py-16 text-gray-400 gap-2">
                  <Brain className="h-8 w-8" />
                  <p className="text-sm">No AI analysis yet. Click <strong>Regenerate</strong> to generate.</p>
                </div>
              )}
            </>
          )}

          {/* ═══════ TAB: Analysis Plan & Results ═══════ */}
          {activeTab === TAB_PLAN && (
            smartData ? (
              <div className="space-y-4">
                {/* Metadata summary */}
                {smartData.metadata && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Rows', value: smartData.metadata.row_count ?? '—' },
                      { label: 'Columns', value: smartData.metadata.columns?.length ?? '—' },
                      { label: 'Plan Source', value: smartData.plan_source === 'ai' ? '🤖 AI' : '📋 Fallback' },
                      { label: 'Functions Run', value: smartData.plan?.length ?? 0 },
                    ].map((item) => (
                      <div key={item.label} className="bg-white rounded-lg border border-gray-100 p-3 text-center">
                        <p className="text-lg font-bold text-gray-900">{item.value}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{item.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Function calls plan */}
                {smartData.plan?.length > 0 && (
                  <CollapsibleSection
                    title="Function Calls Plan"
                    icon={Cpu}
                    defaultOpen={true}
                    badge={
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        smartData.plan_source === 'ai'
                          ? 'text-indigo-600 bg-indigo-50'
                          : 'text-amber-600 bg-amber-50'
                      }`}>
                        {smartData.plan_source === 'ai' ? 'AI-generated' : 'Fallback'}
                      </span>
                    }
                  >
                    <div className="space-y-2">
                      {smartData.plan.map((call, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-gray-100">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-semibold text-gray-800 font-mono">{call.function}</span>
                            {call.params && Object.keys(call.params).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(call.params).map(([k, v]) => (
                                  <span key={k} className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-600 rounded font-mono">
                                    {k}={JSON.stringify(v)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleSection>
                )}

                {/* Execution results */}
                {smartData.results?.length > 0 && (
                  <CollapsibleSection
                    title="Execution Results"
                    icon={Zap}
                    defaultOpen={false}
                    badge={
                      <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        {smartData.results.filter(r => r.ok).length}/{smartData.results.length} succeeded
                      </span>
                    }
                  >
                    <div className="space-y-2">
                      {smartData.results.map((result, i) => (
                        <div key={i} className={`p-3 rounded-lg border ${result.ok ? 'bg-white border-gray-100' : 'bg-red-50 border-red-100'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-gray-800 font-mono">{result.function}</span>
                            {result.ok ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-red-500" />
                            )}
                          </div>
                          {result.ok ? (
                            <pre className="text-[10px] text-gray-600 bg-gray-50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                              {JSON.stringify(result.result, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-[10px] text-red-600">{result.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapsibleSection>
                )}

                {/* Errors during execution */}
                {smartData.errors?.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 px-4 py-3 rounded-lg">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium mb-1">{smartData.errors.length} function(s) had errors:</p>
                      {smartData.errors.map((e, i) => (
                        <p key={i} className="text-[10px] font-mono">{e}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-16 text-gray-400 gap-2">
                <Cpu className="h-8 w-8" />
                <p className="text-sm">No analysis plan yet. Click <strong>Regenerate</strong> to start.</p>
              </div>
            )
          )}

          {/* ── Generation info footer ── */}
          {dashboard && (
            <div className="flex items-center justify-between text-[10px] text-gray-300 px-1 pt-2 border-t border-gray-100">
              <span>
                Status: {dashboard.generation_status}
                {dashboard.retry_count > 0 && ` · ${dashboard.retry_count} retries`}
              </span>
              <span>
                Updated: {new Date(dashboard.updated_at).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(IntelligentDashboard);
