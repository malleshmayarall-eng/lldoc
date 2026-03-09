import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  Download,
  FileText,
  RefreshCw,
  Type,
  Upload,
  X,
  GitBranch,
  User,
  MessageSquare,
  CheckCircle,
  Clock,
  XCircle,
  Search,
  Filter,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Link2,
  Unlink,
} from 'lucide-react';
import MetadataSidebar from '../../../components/MetadataSidebar';
import MetadataFormEditor from '../../../components/MetadataFormEditor';
import MetadataTableEditor from '../../../components/MetadataTableEditor';
import GraphDocument from '../../../components/GraphDocument';
import AccessManager from '../../../components/AccessManager';
import SectionBrowser from '../../../components/SectionBrowser';
import DraggableImageItem from '../../../components/DraggableImageItem';
import DocumentLibraryBrowser from '../../../components/DocumentLibraryBrowser';
import ExportSettingsPanel from '../../../components/ExportSettingsPanel';
import AIChatPanel from '../../../components/AIChatPanel';
import ReviewCommentsPanel from '../../../components/ReviewCommentsPanel';
import WorkflowPanel from '../../../components/WorkflowPanel';
import AIServicesPanel from '../../../components/AIServicesPanel';
import InferencePanel from '../../../components/InferencePanel';

const RightSidebar = ({
  activeSidebar,
  setActiveSidebar,
  metadataSidebar,
  metadataSidebarRef,
  closeMetadataSidebar,
  handleMetadataSave,
  metadataViewMode,
  setMetadataViewMode,
  pageSettings,
  setPageSettings,
  pageDimensions,
  typographyScales,
  sidebarTab,
  setSidebarTab,
  handleImageUpload,
  uploadingImage,
  loadingSidebarImages,
  sidebarImages,
  getImageUrl,
  onSidebarImageSelect,
  pendingImageSectionId,
  imageSearchQuery,
  imageTypeFilter,
  onImageSearchChange,
  onImageTypeFilterChange,
  // Image slots (placeholder mapping)
  imageSlots,
  imageSlotsLoading,
  onMapImage,
  onRefreshImageSlots,
  onSidebarDocumentSelect,
  pendingDocumentSectionId,
  completeDocument,
  referencesSidebar,
  documentWorkflows,
  workflowsLoading,
  setShowWorkflowAssignment,
  versions,
  versionsLoading,
  versionsError,
  versionForm,
  setVersionForm,
  onCreateVersion,
  onRestoreVersion,
  changeLog,
  changeLogLoading,
  changeLogError,
  auditTab,
  setAuditTab,
  onCompareVersion,
  onCompareLeftVersion,
  onClearLeftVersion,
  compareVersionId,
  compareVersion,
  compareLeftVersionId,
  compareLeftVersion,
  compareLoading,
  compareError,
  onExitCompare,
  canModifyContent,
  id,
  aiScore,
  aiScoreLoading,
  aiScoreError,
  onRunAiReview,
  onFetchAiReview,
  onOpenAiReview,
  exportDraft,
  exportLoading,
  exportSaving,
  exportError,
  exportDirty,
  exportTemplates,
  exportImages,
  exportPdfFiles,
  exportMetadataSnapshot,
  onUpdateExportSetting,
  onSaveExportSettings,
  onResetExportSettings,
  onUploadExportImage,
  onUploadPdfFile,
  onSaveHeaderFooterPdf,
  onRemoveHeaderFooterPdf,
  onRefreshExportPreview,
  // AI Chat
  aiChatScope,
  aiChatScopeId,
  aiChatScopeLabel,
  onAiApplyEdit,
  // Review-comments (per-element focus)
  focusedReviewElement,
  onClearReviewFocus,
  onCommentCountsLoaded,
  // Inference + Cross-reference
  inference,
  crossRef,
  inferenceCache,
}) => {
  // ── Local state for image sub-tabs & slot mapping ─────────────────
  const [imageSubTab, setImageSubTab] = useState('browse'); // 'browse' | 'slots'
  const [mappingSlot, setMappingSlot] = useState(null);     // which slot is being mapped
  const [slotPickerImages, setSlotPickerImages] = useState([]);
  const [slotSearchQuery, setSlotSearchQuery] = useState('');
  const [loadingSlotPicker, setLoadingSlotPicker] = useState(false);

  // Load images for the inline slot picker
  const loadSlotPickerImages = useCallback(async (search = '') => {
    setLoadingSlotPicker(true);
    try {
      const { imageService } = await import('../../../services/imageService');
      const params = { upload_scope: 'user' };
      if (search.trim()) params.search = search.trim();
      const response = await imageService.getImages(params);
      const images = Array.isArray(response) ? response : response?.results || [];
      setSlotPickerImages(images);
    } catch {
      setSlotPickerImages([]);
    } finally {
      setLoadingSlotPicker(false);
    }
  }, []);

  // Debounced search for slot picker
  useEffect(() => {
    if (!mappingSlot) return;
    const timer = setTimeout(() => loadSlotPickerImages(slotSearchQuery), 300);
    return () => clearTimeout(timer);
  }, [slotSearchQuery, mappingSlot, loadSlotPickerImages]);

  // When opening a slot for mapping, load images immediately
  useEffect(() => {
    if (mappingSlot) {
      loadSlotPickerImages(slotSearchQuery);
    }
  }, [mappingSlot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeSidebar) return null;

  const sidebarTitle = activeSidebar === 'ai-review'
    ? 'AI Review'
    : activeSidebar === 'export'
      ? 'Export Studio'
      : activeSidebar === 'ai-chat'
        ? 'AI Chat'
        : activeSidebar === 'review-comments'
          ? 'Review Comments'
          : activeSidebar === 'ai-services'
            ? 'AI Services'
            : activeSidebar === 'inference'
              ? 'Inference Engine'
              : activeSidebar;
  const getScoreColorClasses = (value) => {
    const safeValue = Number.isFinite(value) ? value : 0;
    if (safeValue < 40) return { text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' };
    if (safeValue < 70) return { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' };
    return { text: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-100' };
  };

  const getRiskColorClasses = (risk) => {
    const normalized = String(risk || '').toLowerCase();
    if (normalized.includes('high')) return { text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' };
    if (normalized.includes('moderate') || normalized.includes('medium')) {
      return { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' };
    }
    if (normalized.includes('low')) return { text: 'text-teal-600', bg: 'bg-teal-50', border: 'border-teal-100' };
    return { text: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-100' };
  };
  const renderScoreKnob = (value) => {
    const size = 56;
    const stroke = 6;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const safeValue = Number.isFinite(value) ? value : 0;
    const clamped = Math.min(100, Math.max(0, safeValue));
    const offset = circumference - (clamped / 100) * circumference;
    const color = clamped < 40 ? '#EF4444' : clamped < 70 ? '#22C55E' : '#14B8A6';
    const glowClass = clamped < 40 ? 'bg-red-400' : clamped < 70 ? 'bg-emerald-400' : 'bg-teal-400';

    return (
      <div className="relative flex items-center justify-center">
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#E5E7EB"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <div className="absolute text-xs font-semibold text-gray-900">
          {Number.isFinite(value) ? value : '—'}
        </div>
        <div className={`absolute inset-0 rounded-full blur-[10px] opacity-30 ${glowClass}`} />
      </div>
    );
  };

  return (
    <div className="w-full md:w-[340px] lg:w-[360px] max-w-full shrink-0 bg-white rounded-lg shadow-lg overflow-hidden flex flex-col border border-gray-200 h-full self-stretch">
      {activeSidebar === 'metadata' ? (
        <>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div>
              <h3 className="font-semibold text-gray-900">Metadata</h3>
              <p className="text-xs text-gray-500">
                {metadataSidebar.type === 'section' ? 'Section' : metadataSidebar.type === 'latex' ? 'LaTeX block' : metadataSidebar.type === 'table' ? 'Table' : 'Paragraph'} · {metadataSidebar.label || 'Untitled'}
              </p>
            </div>
            <button onClick={closeMetadataSidebar} className="p-1 hover:bg-gray-200 rounded">
              <X size={18} />
            </button>
          </div>
          <MetadataSidebar
            ref={metadataSidebarRef}
            embedded
            isOpen={metadataSidebar.open}
            targetType={metadataSidebar.type}
            targetLabel={metadataSidebar.label}
            metadata={metadataSidebar.metadata}
            onClose={closeMetadataSidebar}
            onSave={handleMetadataSave}
          />
        </>
      ) : (
        <>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <h3 className="font-semibold text-gray-900 capitalize">{sidebarTitle}</h3>
            <button onClick={() => setActiveSidebar(null)} className="p-1 hover:bg-gray-200 rounded">
              <X size={18} />
            </button>
          </div>

          <div className={`flex-1 overflow-y-auto ${activeSidebar === 'ai-chat' ? 'p-0 overflow-hidden' : activeSidebar === 'inference' ? 'p-0 overflow-hidden' : 'p-4'}`}>
            {activeSidebar === 'ai-review' && (
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-xl bg-blue-600/10 flex items-center justify-center">
                        <Sparkles size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">AI Review</p>
                        <p className="text-sm text-gray-600">Latest scoring snapshot</p>
                      </div>
                    </div>
                    {aiScore?.analysis_timestamp && (
                      <p className="text-[11px] text-gray-400">
                        {new Date(aiScore.analysis_timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {(() => {
                      const scoreValue = aiScore?.final_aggregated_score;
                      const scoreStyles = getScoreColorClasses(Number(scoreValue));
                      return (
                        <div className={`rounded-xl border px-3 py-2 shadow-sm ${scoreStyles.bg} ${scoreStyles.border}`}>
                          <p className="text-[11px] text-gray-500">Final Score</p>
                          <div className="flex items-center gap-2">
                            <p className={`text-2xl font-semibold ${scoreStyles.text}`}>
                              {scoreValue ?? '—'}
                            </p>
                            {aiScoreLoading && (
                              <span className="text-xs text-blue-500 animate-pulse">Updating…</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const riskValue = aiScore?.overall_risk_category ?? '—';
                      const riskStyles = getRiskColorClasses(riskValue);
                      return (
                        <div className={`rounded-xl border px-3 py-2 shadow-sm ${riskStyles.bg} ${riskStyles.border}`}>
                          <p className="text-[11px] text-gray-500">Risk</p>
                          <p className={`text-sm font-semibold ${riskStyles.text}`}>
                            {riskValue}
                          </p>
                          {aiScore?.review_priority && (
                            <p className={`text-[11px] ${riskStyles.text}`}>Priority {aiScore.review_priority}</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {aiScoreError && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span>{aiScoreError}</span>
                  </div>
                )}

                {aiScoreLoading && !aiScore && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                      <p className="text-sm font-semibold text-gray-800">Running AI review…</p>
                    </div>
                    <div className="space-y-3">
                      <div className="h-12 rounded-xl bg-gray-100 animate-pulse" />
                      <div className="h-20 rounded-xl bg-gray-100 animate-pulse" />
                      <div className="h-14 rounded-xl bg-gray-100 animate-pulse" />
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</p>
                    {aiScoreLoading && (
                      <span className="text-[11px] text-blue-500 animate-pulse">Running…</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => onRunAiReview?.()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-60"
                      disabled={aiScoreLoading}
                      type="button"
                    >
                      <Sparkles size={16} />
                      {aiScoreLoading ? 'Running…' : 'Run AI Review'}
                    </button>
                    <button
                      onClick={() => onFetchAiReview?.()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 text-gray-700 px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                      disabled={aiScoreLoading}
                      type="button"
                    >
                      <RefreshCw size={16} />
                      Fetch Latest
                    </button>
                  </div>
                </div>

                {aiScore?.core_score_dimensions && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck size={16} className="text-emerald-600" />
                      <p className="text-sm font-semibold text-gray-800">Core score dimensions</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(aiScore.core_score_dimensions)
                        .filter(([key]) => key !== '_logic')
                        .map(([key, value]) => (
                          <div key={key} className="rounded-xl border border-gray-100 px-2 py-3 text-center">
                            {renderScoreKnob(value)}
                            <p className="mt-2 text-[11px] text-gray-600 capitalize">
                              {key.replace(/_/g, ' ')}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {Array.isArray(aiScore?.clause_level_review) && aiScore.clause_level_review.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp size={16} className="text-purple-600" />
                      <p className="text-sm font-semibold text-gray-800">Clause-level review</p>
                    </div>
                    <div className="space-y-2">
                      {aiScore.clause_level_review.map((item, idx) => {
                        const severity = String(item.severity || '').toLowerCase();
                        const severityClass = severity.includes('high')
                          ? 'bg-red-100 text-red-700'
                          : severity.includes('moderate')
                            ? 'bg-amber-100 text-amber-700'
                            : severity.includes('low')
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-100 text-gray-700';
                        const calloutId = item.id || item.clause_id || `clause-${idx}`;
                        const handleClick = () => {
                          // Try paragraph first, then section
                          const paragraphId = item.paragraph_id || item.paragraphId || item.paragraph || null;
                          const sectionId = item.section_id || item.sectionId || item.section || null;
                          let target = null;
                          if (paragraphId) target = document.querySelector(`[data-paragraph-id="${paragraphId}"]`);
                          if (!target && sectionId) target = document.querySelector(`[data-section-id="${sectionId}"]`);
                          if (target) {
                            try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
                            // focus for accessibility
                            try { target.focus?.(); } catch (e) {}
                          }
                        };

                        return (
                        <div
                          key={`${calloutId}-${idx}`}
                          data-callout-id={calloutId}
                          onClick={handleClick}
                          className="rounded-xl border border-gray-100 px-3 py-3 cursor-pointer hover:bg-gray-50"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-gray-900">
                              {item.clause_type || item.clause_id || `Clause ${idx + 1}`}
                            </p>
                            <span className={`text-[11px] px-2 py-1 rounded-full ${severityClass}`}>
                              {item.severity || 'N/A'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{item.section_path || item.source_location || 'Unknown location'}</p>
                          {item.suggested_revision && (
                            <p className="text-xs text-gray-700 mt-2">{item.suggested_revision}</p>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeSidebar === 'layout' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Page Size</h4>
                  <div className="space-y-2">
                    {Object.entries(pageDimensions).map(([key, config]) => (
                      <button
                        key={key}
                        onClick={() => setPageSettings((prev) => ({ ...prev, size: key }))}
                        className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between ${
                          pageSettings.size === key
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'hover:bg-gray-50 text-gray-700 border border-transparent'
                        }`}
                      >
                        <span>{config.label}</span>
                        {pageSettings.size === key && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Orientation</h4>
                  <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                      onClick={() => setPageSettings((prev) => ({ ...prev, orientation: 'portrait' }))}
                      className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                        pageSettings.orientation === 'portrait'
                          ? 'bg-white shadow text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Portrait
                    </button>
                    <button
                      onClick={() => setPageSettings((prev) => ({ ...prev, orientation: 'landscape' }))}
                      className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                        pageSettings.orientation === 'landscape'
                          ? 'bg-white shadow text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Landscape
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Typography</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm text-gray-600 mb-1 block">Base Font Size</label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() =>
                            setPageSettings((prev) => ({ ...prev, fontSize: Math.max(10, prev.fontSize - 1) }))
                          }
                          className="p-1 hover:bg-gray-100 rounded border border-gray-200"
                        >
                          <Type size={14} className="transform scale-75" />
                        </button>
                        <span className="flex-1 text-center font-mono text-sm">{pageSettings.fontSize}px</span>
                        <button
                          onClick={() =>
                            setPageSettings((prev) => ({ ...prev, fontSize: Math.min(32, prev.fontSize + 1) }))
                          }
                          className="p-1 hover:bg-gray-100 rounded border border-gray-200"
                        >
                          <Type size={18} />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm text-gray-600 mb-1 block">Type Scale</label>
                      <select
                        value={pageSettings.typeScale}
                        onChange={(e) => setPageSettings((prev) => ({ ...prev, typeScale: parseFloat(e.target.value) }))}
                        className="w-full text-sm border-gray-200 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      >
                        {Object.entries(typographyScales).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">View Zoom</h4>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPageSettings((prev) => ({ ...prev, zoom: Math.max(50, prev.zoom - 10) }))}
                      className="p-1 hover:bg-gray-100 rounded border border-gray-200"
                    >
                      <span className="text-lg leading-none">-</span>
                    </button>
                    <span className="flex-1 text-center font-mono text-sm">{pageSettings.zoom}%</span>
                    <button
                      onClick={() => setPageSettings((prev) => ({ ...prev, zoom: Math.min(200, prev.zoom + 10) }))}
                      className="p-1 hover:bg-gray-100 rounded border border-gray-200"
                    >
                      <span className="text-lg leading-none">+</span>
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Margins</h4>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="96"
                      step="8"
                      value={pageSettings.margins}
                      onChange={(e) => setPageSettings((prev) => ({ ...prev, margins: parseInt(e.target.value, 10) }))}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono w-12 text-right">{pageSettings.margins}px</span>
                  </div>
                </div>
              </div>
            )}

            {activeSidebar === 'audit' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1 text-xs">
                  {[
                    { key: 'timeline', label: 'Timeline' },
                    { key: 'versions', label: 'Versions' },
                    { key: 'compare', label: 'Compare' },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setAuditTab(tab.key)}
                      className={`flex-1 px-2 py-1 rounded-md ${
                        auditTab === tab.key
                          ? 'bg-white shadow text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="max-h-[65vh] overflow-y-auto pr-1">
                  {auditTab === 'timeline' && (
                    <div className="space-y-4">
                      <div className="text-xs text-gray-500">
                        Audit trail of edits for this document.
                      </div>
                      {changeLogError && (
                        <div className="text-xs text-red-500">{changeLogError}</div>
                      )}
                      {changeLogLoading && (
                        <div className="text-xs text-gray-500">Loading history…</div>
                      )}
                      {!changeLogLoading && (!changeLog || changeLog.length === 0) && (
                        <div className="text-xs text-gray-500">No history yet.</div>
                      )}
                      <div className="space-y-3">
                        {(changeLog || []).map((entry) => (
                          <div key={entry.id || `${entry.change_type}-${entry.created_at}`} className="relative pl-6">
                            <div className="absolute left-1 top-2 w-2 h-2 rounded-full bg-blue-500" />
                            <div className="absolute left-2 top-4 w-px h-full bg-gray-200" />
                            <div className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
                              <div className="flex items-center justify-between text-xs text-gray-500">
                                <span>{entry.changed_by || entry.user || 'Unknown user'}</span>
                                <span>
                                  {entry.created_at
                                    ? new Date(entry.created_at).toLocaleString()
                                    : ''}
                                </span>
                              </div>
                              <div className="text-sm font-medium text-gray-800 mt-1">
                                {entry.description || entry.change_type || 'Update'}
                              </div>
                              {entry.change_summary && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {entry.change_summary}
                                </div>
                              )}
                              {entry.fields_changed && entry.fields_changed.length > 0 && (
                                <div className="text-xs text-gray-500 mt-2">
                                  Fields: {entry.fields_changed.join(', ')}
                                </div>
                              )}
                              {entry.version_at_change && (
                                <div className="text-[11px] text-gray-400 mt-1">
                                  Version {entry.version_at_change}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {auditTab === 'versions' && (
                    <div className="space-y-4">
                      <div className="p-3 bg-gray-50 rounded space-y-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Create Version</h4>
                        <input
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          placeholder="Version number (e.g., 1.2)"
                          value={versionForm?.version_number || ''}
                          onChange={(e) => setVersionForm((prev) => ({ ...prev, version_number: e.target.value }))}
                        />
                        <input
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          placeholder="Version name (Draft 2)"
                          value={versionForm?.version_name || ''}
                          onChange={(e) => setVersionForm((prev) => ({ ...prev, version_name: e.target.value }))}
                        />
                        <textarea
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                          rows={2}
                          placeholder="Change summary"
                          value={versionForm?.change_summary || ''}
                          onChange={(e) => setVersionForm((prev) => ({ ...prev, change_summary: e.target.value }))}
                        />
                        <label className="flex items-center gap-2 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={versionForm?.is_major_version || false}
                            onChange={(e) => setVersionForm((prev) => ({ ...prev, is_major_version: e.target.checked }))}
                          />
                          Major version
                        </label>
                        <button
                          onClick={onCreateVersion}
                          className="w-full bg-blue-600 text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700"
                        >
                          Create Version
                        </button>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Version History</h4>
                        {versionsError && (
                          <div className="text-xs text-red-500">{versionsError}</div>
                        )}
                        {versionsLoading && (
                          <div className="text-xs text-gray-500">Loading versions…</div>
                        )}
                        {!versionsLoading && (!versions || versions.length === 0) && (
                          <div className="text-xs text-gray-500">No versions yet.</div>
                        )}
                        {(versions || []).map((version) => (
                          <div key={version.id} className="p-3 border border-gray-200 rounded text-sm space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">
                                {version.version_number || version.version_name || `Version ${version.id}`}
                              </div>
                              <button
                                onClick={() => onRestoreVersion(version.id)}
                                className="text-xs text-blue-600 hover:text-blue-700"
                              >
                                Restore
                              </button>
                            </div>
                            {version.version_name && (
                              <div className="text-xs text-gray-500">{version.version_name}</div>
                            )}
                            {version.change_summary && (
                              <div className="text-xs text-gray-500">{version.change_summary}</div>
                            )}
                            {(version.created_at || version.created_on) && (
                              <div className="text-[11px] text-gray-400">
                                {new Date(version.created_at || version.created_on).toLocaleString()}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                onCompareVersion?.(version.id);
                                setAuditTab('compare');
                              }}
                              className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                            >
                              Compare with Current
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {auditTab === 'compare' && (
                    <div className="space-y-4">
                      <div className="text-xs text-gray-500">
                        Compare any two versions, or compare a version against the current document.
                      </div>

                      {/* Base (left) version dropdown */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Base version</label>
                        <select
                          value={compareLeftVersionId ? String(compareLeftVersionId) : '__current__'}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__current__') {
                              onClearLeftVersion?.();
                            } else {
                              onCompareLeftVersion?.(val);
                            }
                          }}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300"
                        >
                          <option value="__current__">Current document</option>
                          {(versions || []).map((v) => (
                            <option key={`base-${v.id}`} value={String(v.id)}>
                              {v.version_number || v.version_name || `Version ${String(v.id).slice(0, 8)}`}
                              {v.created_at ? ` — ${new Date(v.created_at).toLocaleDateString()}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Compare with (right) version dropdown */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Compare with</label>
                        <select
                          value={compareVersionId ? String(compareVersionId) : ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              onCompareVersion?.(val);
                            }
                          }}
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-300"
                        >
                          <option value="" disabled>Select a version…</option>
                          {(versions || []).map((v) => (
                            <option
                              key={`cmp-${v.id}`}
                              value={String(v.id)}
                              disabled={compareLeftVersionId && String(compareLeftVersionId) === String(v.id)}
                            >
                              {v.version_number || v.version_name || `Version ${String(v.id).slice(0, 8)}`}
                              {v.created_at ? ` — ${new Date(v.created_at).toLocaleDateString()}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {compareError && (
                        <div className="text-xs text-red-500">{compareError}</div>
                      )}
                      {compareLoading && (
                        <div className="text-xs text-gray-500">Loading comparison…</div>
                      )}

                      {/* Selection summary */}
                      {(compareVersion || compareLeftVersion) && (
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold text-gray-700">
                              {(compareLeftVersion
                                ? (compareLeftVersion.version_number || compareLeftVersion.version_name || `Version ${String(compareLeftVersion.id).slice(0, 8)}`)
                                : 'Current')}
                              <span className="mx-1.5 text-gray-400">→</span>
                              {(compareVersion
                                ? (compareVersion.version_number || compareVersion.version_name || `Version ${String(compareVersion.id).slice(0, 8)}`)
                                : '—')}
                            </div>
                            <button
                              onClick={onExitCompare}
                              className="text-[11px] text-gray-500 hover:text-red-600"
                            >
                              Clear
                            </button>
                          </div>
                          {compareVersion?.change_summary && (
                            <div className="text-xs text-gray-500">{compareVersion.change_summary}</div>
                          )}
                        </div>
                      )}

                      {(!versions || versions.length === 0) && (
                        <div className="text-xs text-gray-500">No versions available. Create a version first.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSidebar === 'images' && (
              <>
                {/* Top-level sub-tabs: Browse | Slots */}
                <div className="flex border-b border-gray-200 mb-3">
                  {[
                    { key: 'browse', label: 'Browse' },
                    { key: 'slots', label: `Slots${imageSlots?.length ? ` (${imageSlots.length})` : ''}` },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setImageSubTab(key)}
                      className={`flex-1 py-2 text-sm font-medium ${
                        imageSubTab === key
                          ? 'border-b-2 border-blue-600 text-blue-600'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Browse sub-tab ─────────────────────────────────── */}
                {imageSubTab === 'browse' && (
                  <>
                    {/* Scope tabs */}
                    <div className="flex gap-1 mb-3">
                      {['user', 'document', 'team'].map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setSidebarTab(tab)}
                          className={`flex-1 py-1.5 text-xs font-medium capitalize rounded-md ${
                            sidebarTab === tab
                              ? 'bg-blue-50 text-blue-600 border border-blue-200'
                              : 'text-gray-500 hover:bg-gray-50 border border-transparent'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {/* Search bar */}
                    <div className="relative mb-3">
                      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search images…"
                        value={imageSearchQuery || ''}
                        onChange={(e) => onImageSearchChange?.(e.target.value)}
                        className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                      />
                      {imageSearchQuery && (
                        <button
                          onClick={() => onImageSearchChange?.('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Type filter + Upload row */}
                    <div className="flex gap-2 mb-3">
                      <div className="relative flex-1">
                        <select
                          value={imageTypeFilter || ''}
                          onChange={(e) => onImageTypeFilterChange?.(e.target.value)}
                          className="w-full appearance-none pl-7 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 cursor-pointer"
                        >
                          <option value="">All Types</option>
                          <option value="logo">Logo</option>
                          <option value="signature">Signature</option>
                          <option value="stamp">Stamp / Seal</option>
                          <option value="diagram">Diagram</option>
                          <option value="figure">Figure</option>
                          <option value="chart">Chart</option>
                          <option value="photo">Photo</option>
                          <option value="picture">Picture</option>
                          <option value="watermark">Watermark</option>
                          <option value="other">Other</option>
                        </select>
                        <Filter size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                      <label className="shrink-0">
                        <div className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center gap-1.5 cursor-pointer border border-blue-200 text-sm">
                          <Upload size={15} />
                          {uploadingImage ? 'Uploading…' : 'Upload'}
                        </div>
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploadingImage} />
                      </label>
                    </div>

                    {/* Pending insert indicator */}
                    {pendingImageSectionId && (
                      <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-xs text-blue-700">
                        <ImageIcon size={14} />
                        Click an image below to insert into the selected section.
                      </div>
                    )}

                    {/* Image grid */}
                    {loadingSidebarImages ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                        <span className="ml-2 text-sm text-gray-500">Loading…</span>
                      </div>
                    ) : sidebarImages.length === 0 ? (
                      <div className="text-center py-8">
                        <ImageIcon size={32} className="mx-auto mb-2 text-gray-300" />
                        <p className="text-sm text-gray-500">No images found.</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {imageSearchQuery || imageTypeFilter
                            ? 'Try adjusting your search or filter.'
                            : 'Upload an image to get started.'}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {sidebarImages.map((image) => (
                          <DraggableImageItem
                            key={image.id}
                            image={image}
                            onSelect={onSidebarImageSelect}
                          >
                            <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200 relative group-hover:border-blue-400 group-hover:shadow-sm transition-all">
                              <img
                                src={getImageUrl(image.thumbnail_url || image.url)}
                                alt={image.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-end justify-center opacity-0 group-hover:opacity-100">
                                <span className="mb-1 px-2 py-0.5 bg-white/90 rounded text-[10px] font-medium text-gray-700 shadow-sm">
                                  {pendingImageSectionId ? 'Click to insert' : 'Drag or click'}
                                </span>
                              </div>
                            </div>
                            <div className="mt-1 flex items-start gap-1 px-0.5">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs text-gray-700 truncate font-medium" title={image.name}>
                                  {image.name}
                                </div>
                                {image.image_type && image.image_type !== 'other' && (
                                  <div className="text-[10px] text-gray-400 capitalize">{image.image_type}</div>
                                )}
                              </div>
                            </div>
                          </DraggableImageItem>
                        ))}
                      </div>
                    )}

                    {!loadingSidebarImages && sidebarImages.length > 0 && (
                      <p className="mt-2 text-[10px] text-gray-400 text-center">
                        {sidebarImages.length} image{sidebarImages.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </>
                )}

                {/* ── Slots sub-tab ──────────────────────────────────── */}
                {imageSubTab === 'slots' && (
                  <div className="space-y-2">
                    {/* Refresh button */}
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-gray-500">
                        Image placeholders found in document content.
                      </p>
                      <button
                        onClick={() => onRefreshImageSlots?.()}
                        className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                        title="Refresh slots"
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>

                    {imageSlotsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 size={20} className="animate-spin text-blue-600" />
                        <span className="ml-2 text-sm text-gray-500">Scanning document…</span>
                      </div>
                    ) : !imageSlots || imageSlots.length === 0 ? (
                      <div className="text-center py-8">
                        <Link2 size={28} className="mx-auto mb-2 text-gray-300" />
                        <p className="text-sm text-gray-500">No image placeholders found.</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Use <code className="bg-gray-100 px-1 rounded">[[image:name]]</code> in
                          your content to create image slots.
                        </p>
                      </div>
                    ) : (
                      imageSlots.map((slot) => (
                        <div
                          key={slot.name}
                          className={`p-3 rounded-lg border transition-colors ${
                            slot.is_mapped
                              ? 'bg-green-50 border-green-200'
                              : 'bg-amber-50 border-amber-200'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-800 truncate" title={slot.name}>
                              {slot.name.replace(/_/g, ' ')}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              slot.is_mapped
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {slot.is_mapped ? 'Mapped' : 'Unmapped'}
                            </span>
                          </div>

                          {/* Mapped preview */}
                          {slot.is_mapped && slot.mapped_image_id && (
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-10 h-10 rounded border border-green-200 overflow-hidden bg-white flex-shrink-0">
                                <img
                                  src={getImageUrl(
                                    sidebarImages.find((i) => i.id === slot.mapped_image_id)?.thumbnail_url ||
                                    sidebarImages.find((i) => i.id === slot.mapped_image_id)?.url ||
                                    ''
                                  )}
                                  alt={slot.name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-500 truncate flex-1">
                                {sidebarImages.find((i) => i.id === slot.mapped_image_id)?.name || slot.mapped_image_id}
                              </span>
                            </div>
                          )}

                          {/* Action buttons */}
                          <div className="flex gap-1.5">
                            {mappingSlot === slot.name ? (
                              <button
                                onClick={() => { setMappingSlot(null); setSlotSearchQuery(''); }}
                                className="flex-1 text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                              >
                                Cancel
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => setMappingSlot(slot.name)}
                                  className="flex-1 text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors flex items-center justify-center gap-1"
                                >
                                  <Link2 size={12} />
                                  {slot.is_mapped ? 'Change' : 'Map Image'}
                                </button>
                                {slot.is_mapped && (
                                  <button
                                    onClick={() => onMapImage?.(slot.name, null)}
                                    className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors flex items-center gap-1"
                                  >
                                    <Unlink size={12} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>

                          {/* Inline image picker for this slot */}
                          {mappingSlot === slot.name && (
                            <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                              <div className="relative mb-2">
                                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                  type="text"
                                  placeholder="Search images…"
                                  value={slotSearchQuery}
                                  onChange={(e) => setSlotSearchQuery(e.target.value)}
                                  className="w-full pl-7 pr-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  autoFocus
                                />
                              </div>
                              {loadingSlotPicker ? (
                                <div className="flex justify-center py-3">
                                  <Loader2 size={16} className="animate-spin text-blue-500" />
                                </div>
                              ) : slotPickerImages.length === 0 ? (
                                <p className="text-[10px] text-gray-400 text-center py-2">No images found.</p>
                              ) : (
                                <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                                  {slotPickerImages.map((img) => (
                                    <div
                                      key={img.id}
                                      onClick={() => {
                                        onMapImage?.(slot.name, img.id);
                                        setMappingSlot(null);
                                        setSlotSearchQuery('');
                                      }}
                                      className={`aspect-square rounded border cursor-pointer overflow-hidden transition-all hover:border-blue-400 hover:shadow-sm ${
                                        slot.mapped_image_id === img.id
                                          ? 'border-blue-500 ring-1 ring-blue-300'
                                          : 'border-gray-200'
                                      }`}
                                      title={img.name}
                                    >
                                      <img
                                        src={getImageUrl(img.thumbnail_url || img.url)}
                                        alt={img.name}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}

            {activeSidebar === 'attachments' && (
              <div className="space-y-3">
                {completeDocument.attachments?.map((att) => (
                  <div key={att.id} className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <div className="flex items-start gap-3">
                      <FileText className="text-blue-500 mt-1" size={20} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{att.name}</p>
                        <p className="text-xs text-gray-500">
                          {att.file_name} • {(att.file_size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <a href={att.url} target="_blank" rel="noopener noreferrer" className="p-1 text-gray-400 hover:text-blue-600">
                        <Download size={16} />
                      </a>
                    </div>
                  </div>
                ))}
                {(!completeDocument.attachments || completeDocument.attachments.length === 0) && (
                  <p className="text-center text-gray-500 py-8">No attachments</p>
                )}
              </div>
            )}

            {activeSidebar === 'documents' && (
              <div className="h-full flex flex-col">
                {pendingDocumentSectionId && (
                  <div className="px-3 py-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg mb-3">
                    Select a document to insert into the chosen section.
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  <DocumentLibraryBrowser
                    embedded
                    showUpload
                    onSelectDocument={(doc) => onSidebarDocumentSelect?.(doc)}
                    onClose={() => setActiveSidebar(null)}
                  />
                </div>
              </div>
            )}

            {activeSidebar === 'export' && (
              <ExportSettingsPanel
                documentId={completeDocument?.id || id}
                exportDraft={exportDraft}
                exportLoading={exportLoading}
                exportSaving={exportSaving}
                exportError={exportError}
                exportDirty={exportDirty}
                templates={exportTemplates}
                images={exportImages}
                pdfFiles={exportPdfFiles}
                metadataSnapshot={exportMetadataSnapshot}
                onUpdate={onUpdateExportSetting}
                onSave={onSaveExportSettings}
                onReset={onResetExportSettings}
                onUploadImage={onUploadExportImage}
                onUploadPdfFile={onUploadPdfFile}
                onSaveHeaderFooterPdf={onSaveHeaderFooterPdf}
                onRemoveHeaderFooterPdf={onRemoveHeaderFooterPdf}
                onRefreshPreview={onRefreshExportPreview}
              />
            )}


            {activeSidebar === 'properties' && (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">Metadata:</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setMetadataViewMode('form')}
                      className={`px-3 py-1 rounded text-xs font-medium ${
                        metadataViewMode === 'form'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      📝 Form
                    </button>
                    <button
                      onClick={() => setMetadataViewMode('table')}
                      className={`px-3 py-1 rounded text-xs font-medium ${
                        metadataViewMode === 'table'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      📊 Table
                    </button>
                    <button
                      onClick={() => setActiveSidebar(null)}
                      className="p-1 rounded hover:bg-gray-200 transition-colors"
                      title="Close sidebar"
                    >
                      <X size={18} className="text-gray-600" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  {metadataViewMode === 'form' ? (
                    <MetadataFormEditor documentId={id} />
                  ) : (
                    <MetadataTableEditor documentId={id} />
                  )}
                </div>

                {/* Image Placeholders Section */}
                {imageSlots && imageSlots.length > 0 && (
                  <div className="border-t border-gray-200">
                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                          🖼️ Image Placeholders
                          <span className="bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                            {imageSlots.filter(s => s.is_mapped).length}/{imageSlots.length}
                          </span>
                        </span>
                        <button
                          onClick={onRefreshImageSlots}
                          className="text-amber-600 hover:text-amber-800 p-0.5"
                          title="Refresh image slots"
                        >
                          <RefreshCw size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                      {imageSlots.map((slot) => (
                        <div key={slot.name} className="px-4 py-2 flex items-center gap-2">
                          {slot.is_mapped && slot.image_thumbnail_url ? (
                            <img
                              src={slot.image_thumbnail_url || slot.image_url}
                              alt={slot.name}
                              className="w-8 h-8 object-cover rounded border border-gray-200"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded border border-dashed border-amber-300 bg-amber-50 flex items-center justify-center">
                              <span className="text-amber-400 text-xs">?</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">{slot.name}</p>
                            <p className="text-[10px] text-gray-500">
                              {slot.is_mapped ? (
                                <span className="text-green-600">✓ Mapped{slot.image_name ? ` → ${slot.image_name}` : ''}</span>
                              ) : (
                                <span className="text-amber-600">Unmapped</span>
                              )}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setActiveSidebar('images');
                            }}
                            className="text-[10px] text-blue-600 hover:text-blue-800 whitespace-nowrap"
                          >
                            {slot.is_mapped ? 'Change' : 'Map'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSidebar === 'issues' && (
              <div className="space-y-3">
                {completeDocument.issues?.map((issue) => (
                  <div key={issue.id} className="p-3 border border-yellow-200 bg-yellow-50 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="text-yellow-600 mt-0.5" size={16} />
                      <div>
                        <p className="font-medium text-yellow-900 text-sm">{issue.title}</p>
                        <p className="text-xs text-yellow-700 mt-1">{issue.description}</p>
                        {issue.suggestion && (
                          <div className="mt-2 text-xs bg-white p-2 rounded border border-yellow-100">
                            <span className="font-semibold">Suggestion:</span> {issue.suggestion}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {(!completeDocument.issues || completeDocument.issues.length === 0) && (
                  <p className="text-center text-gray-500 py-8">No issues detected</p>
                )}
              </div>
            )}

            {activeSidebar === 'graph' && (
              <GraphDocument documentId={id} height="100%" className="min-h-[320px]" />
            )}

            {activeSidebar === 'references' && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-wide text-gray-500">References</h4>
                  <button
                    onClick={() => setActiveSidebar(null)}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                  >
                    Close
                  </button>
                </div>

                {referencesSidebar.loading && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <RefreshCw size={14} className="animate-spin" /> Loading references...
                  </div>
                )}

                {referencesSidebar.error && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1">
                    {referencesSidebar.error}
                  </div>
                )}

                {!referencesSidebar.loading && !referencesSidebar.error && referencesSidebar.items.length === 0 && (
                  <p className="text-gray-500 text-sm">No references found in this document.</p>
                )}

                <div className="space-y-2">
                  {referencesSidebar.items.map((ref, idx) => (
                    <div key={ref.id || idx} className="p-2 border border-gray-200 rounded-lg bg-white">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span className="font-mono text-[11px] text-gray-500">{idx + 1}</span>
                        <span className="uppercase text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{ref.reference_type || 'ref'}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate" title={ref.selected_text}>
                        {ref.selected_text || ref.text || 'Reference'}
                      </p>
                      <p className="text-xs text-gray-600 truncate" title={ref.comment || ref.annotation || ref.preview}>
                        {ref.comment || ref.annotation || ref.preview || ref.target_title || ''}
                      </p>
                      <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-2">
                        {ref.target_document && <span>Doc: {ref.target_document_title || ref.target_document}</span>}
                        {ref.target_section && <span>Sec: {ref.target_section_title || ref.target_section}</span>}
                        {ref.target_paragraph && <span>Para: {ref.target_paragraph}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSidebar === 'sharing' && completeDocument?.id && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-wide text-gray-500">Access Control</h4>
                  <button
                    onClick={() => setActiveSidebar(null)}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                  >
                    Close
                  </button>
                </div>

                <AccessManager
                  contentType="document"
                  objectId={completeDocument.id}
                  showQuickActions={true}
                  className="text-sm"
                />
              </div>
            )}

            {activeSidebar === 'workflow' && completeDocument?.id && (
              <WorkflowPanel
                documentId={completeDocument.id}
                canModifyContent={canModifyContent}
                onCreateWorkflow={() => setShowWorkflowAssignment(true)}
                documentWorkflows={documentWorkflows}
                workflowsLoading={workflowsLoading}
                onClose={() => setActiveSidebar(null)}
              />
            )}

            {activeSidebar === 'info' && (
              <div className="space-y-4 text-sm">
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-gray-500 text-xs">Document ID</p>
                  <p className="font-mono text-xs mt-1">{completeDocument.id}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-700">AI Review</p>
                    {aiScore?.analysis_timestamp && (
                      <p className="text-[11px] text-gray-400">
                        {new Date(aiScore.analysis_timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {aiScoreError && (
                    <p className="text-xs text-red-600">{aiScoreError}</p>
                  )}
                  {aiScore && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-gray-50 px-2 py-1">
                        <p className="text-gray-500">Score</p>
                        <p className="font-semibold text-gray-800">{aiScore.final_aggregated_score ?? '—'}</p>
                      </div>
                      <div className="rounded bg-gray-50 px-2 py-1">
                        <p className="text-gray-500">Risk</p>
                        <p className="font-semibold text-gray-800">{aiScore.overall_risk_category ?? '—'}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onRunAiReview?.()}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700"
                      disabled={aiScoreLoading}
                      type="button"
                    >
                      {aiScoreLoading ? 'Running…' : 'Run AI Review'}
                    </button>
                    <button
                      onClick={() => onFetchAiReview?.()}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                      disabled={aiScoreLoading}
                      type="button"
                    >
                      Fetch Latest
                    </button>
                    {aiScore && (
                      <button
                        onClick={() => onOpenAiReview?.()}
                        className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                        type="button"
                      >
                        View Report
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-gray-500 text-xs">Created By</p>
                  <p className="font-medium mt-1">{completeDocument.metadata?.created_by}</p>
                  <p className="text-xs text-gray-400">
                    {completeDocument.metadata?.created_at && new Date(completeDocument.metadata?.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-gray-500 text-xs">Last Modified</p>
                  <p className="font-medium mt-1">{completeDocument.metadata?.last_modified_by}</p>
                  <p className="text-xs text-gray-400">
                    {completeDocument.metadata?.updated_at && new Date(completeDocument.metadata?.updated_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {activeSidebar === 'ai-chat' && (
              <AIChatPanel
                documentId={id}
                scope={aiChatScope || 'document'}
                scopeId={aiChatScopeId}
                scopeLabel={aiChatScopeLabel}
                onClose={() => setActiveSidebar(null)}
                onApplyEdit={onAiApplyEdit}
              />
            )}

            {activeSidebar === 'sections' && (
              <div className="h-full flex flex-col">
                <SectionBrowser
                  documentId={id}
                  onSelectSection={(section) => {
                    console.log('Section selected:', section);
                    setActiveSidebar(null);
                  }}
                  onClose={() => setActiveSidebar(null)}
                  isOpen={true}
                />
              </div>
            )}

            {activeSidebar === 'ai-services' && (
              <AIServicesPanel documentId={id} />
            )}

            {activeSidebar === 'inference' && (
              <InferencePanel
                documentId={id}
                inference={inference}
                crossRef={crossRef}
                cache={inferenceCache}
              />
            )}

            {activeSidebar === 'review-comments' && completeDocument?.id && (
              <ReviewCommentsPanel
                documentId={completeDocument.id}
                focusedElementId={focusedReviewElement?.id || null}
                focusedElementType={focusedReviewElement?.type || null}
                onClearFocus={onClearReviewFocus}
                onCommentCountsLoaded={onCommentCountsLoaded}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default RightSidebar;
