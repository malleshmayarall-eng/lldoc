import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, AlertCircle, RefreshCw, Brain, Zap } from 'lucide-react';

const formatScore = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  const numeric = Number(value);
  if (numeric <= 1) return `${Math.round(numeric * 100)}`;
  return `${Math.round(numeric)}`;
};

const getScoreTone = (value) => {
  const numeric = Number.isFinite(value) ? value : 0;
  if (numeric >= 0 && numeric <= 1) {
    return numeric < 0.4 ? 'red' : numeric < 0.7 ? 'amber' : 'emerald';
  }
  return numeric < 40 ? 'red' : numeric < 70 ? 'amber' : 'emerald';
};

const ScoreKnob = ({ value }) => {
  const normalized = Number.isFinite(value) ? value : 0;
  const percent = normalized <= 1 ? normalized * 100 : normalized;
  const size = 36;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  const tone = getScoreTone(normalized);
  const color = tone === 'red' ? '#EF4444' : tone === 'amber' ? '#F59E0B' : '#10B981';
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
        />
      </svg>
      <div className="absolute text-[10px] font-semibold text-gray-700">
        {formatScore(normalized)}
      </div>
    </div>
  );
};

const ParagraphAiSidebar = ({
  items = [],
  loading = false,
  showEmpty = false,
  layoutRef,
  contentScrollRef,
  width,
  minWidth = 280,
  maxWidth = 640,
  onResize,
  onHoverChange,
  activeParagraphId,
  onSelectParagraph,
  onRefresh,
  // Inference integration
  inferenceStaleIds,      // Set<string> of stale component IDs
  inferenceComponentMap,  // { [componentId]: { summary, context_tags, ... } }
}) => {
  const sidebarRef = useRef(null);
  const [linePaths, setLinePaths] = useState([]);
  const dragStateRef = useRef({ startX: 0, startWidth: 0, dragging: false });

  const clampWidth = useCallback(
    (value) => Math.min(maxWidth, Math.max(minWidth, value)),
    [minWidth, maxWidth]
  );

  const handleResizeStart = (event) => {
    if (!onResize) return;
    dragStateRef.current = {
      startX: event.clientX,
      startWidth: typeof width === 'number' ? width : sidebarRef.current?.offsetWidth || minWidth,
      dragging: true,
    };
    event.preventDefault();
  };

  useEffect(() => {
    if (!onResize) return undefined;
    const handleMove = (event) => {
      if (!dragStateRef.current.dragging) return;
      const delta = event.clientX - dragStateRef.current.startX;
      const nextWidth = clampWidth(dragStateRef.current.startWidth + delta);
      onResize(nextWidth);
    };

    const handleUp = () => {
      if (!dragStateRef.current.dragging) return;
      dragStateRef.current.dragging = false;
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [clampWidth, onResize]);

  const selectedItem = useMemo(() => {
    if (!items.length) return null;
    if (activeParagraphId) {
      return items.find((item) => String(item.paragraphId) === String(activeParagraphId)) || items[0];
    }
    return items[0];
  }, [activeParagraphId, items]);

  const visibleItems = useMemo(() => (selectedItem ? [selectedItem] : []), [selectedItem]);

  const itemMap = useMemo(
    () => new Map(visibleItems.map((item) => [String(item.paragraphId), item])),
    [visibleItems]
  );

  const rebuildLines = useCallback(() => {
    if (!layoutRef?.current || !sidebarRef.current) return;
    const layoutRect = layoutRef.current.getBoundingClientRect();
    const nextPaths = [];

    visibleItems.forEach((item) => {
      const paragraphId = String(item.paragraphId);
      const itemEl = sidebarRef.current.querySelector(`[data-ai-paragraph-id="${paragraphId}"]`);
      const paragraphEl = document.querySelector(`[data-metadata-id="${paragraphId}"]`);
      if (!itemEl || !paragraphEl) return;
      const itemRect = itemEl.getBoundingClientRect();
      const paraRect = paragraphEl.getBoundingClientRect();
      const startX = itemRect.right - layoutRect.left;
      const startY = itemRect.top + itemRect.height / 2 - layoutRect.top;
      const endX = paraRect.left - layoutRect.left;
      const endY = paraRect.top + paraRect.height / 2 - layoutRect.top;
      const controlX = startX + (endX - startX) * 0.5;
      nextPaths.push({
        id: paragraphId,
        d: `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`,
      });
    });

    setLinePaths(nextPaths);
  }, [visibleItems, layoutRef]);

  useEffect(() => {
    rebuildLines();
  }, [rebuildLines]);

  useEffect(() => {
    const handleUpdate = () => requestAnimationFrame(rebuildLines);
    const scrollEl = contentScrollRef?.current;
    window.addEventListener('resize', handleUpdate);
    scrollEl?.addEventListener('scroll', handleUpdate);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      scrollEl?.removeEventListener('scroll', handleUpdate);
    };
  }, [contentScrollRef, rebuildLines]);

  if (!visibleItems.length && !loading && !showEmpty) return null;

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col transition-[width] duration-200 ease-out"
        style={{ width: typeof width === 'number' ? width : undefined, minWidth, maxWidth }}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      >
        {onResize && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleResizeStart}
            className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-transparent hover:bg-blue-100/40 transition-colors"
          />
        )}
  <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between gap-2">
            <div className="h-8 w-8 rounded-xl bg-blue-600/10 flex items-center justify-center">
              <Sparkles size={16} className="text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">AI Paragraph Review</h3>
              <p className="text-xs text-slate-500">Scores & suggestions by paragraph</p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-white"
              title="Refresh AI review"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Loading AI paragraph review…
            </div>
          )}
          {!loading && visibleItems.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
              No paragraph AI review data yet.
            </div>
          )}
          {selectedItem && (() => {
            const hasSuggestions = (selectedItem.suggestions?.length || 0) > 0;
            const isStale = inferenceStaleIds?.has?.(String(selectedItem.paragraphId));
            const inferenceData = inferenceComponentMap?.[String(selectedItem.paragraphId)];
            return (
              <button
                type="button"
                data-ai-paragraph-id={selectedItem.paragraphId}
                onClick={() => onSelectParagraph?.(selectedItem)}
                className="w-full text-left rounded-xl border border-slate-200 bg-white px-3 py-3 hover:border-blue-300 hover:shadow-md transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs font-semibold text-slate-700">Paragraph</div>
                    {isStale && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                        <Zap size={8} /> stale
                      </span>
                    )}
                    {inferenceData && !isStale && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5">
                        <Brain size={8} /> inferred
                      </span>
                    )}
                  </div>
                  <div className={`flex items-center gap-1 text-[11px] ${hasSuggestions ? 'text-amber-600' : 'text-emerald-600'}`}>
                    <AlertCircle size={12} />
                    {selectedItem.suggestions?.length || 0} suggestions
                  </div>
                </div>
                {inferenceData?.summary && (
                  <div className="mt-1.5 text-[10px] text-indigo-600 bg-indigo-50/50 rounded px-2 py-1 border border-indigo-100">
                    <span className="font-semibold">Context:</span> {inferenceData.summary.slice(0, 120)}
                    {inferenceData.context_tags?.length > 0 && (
                      <span className="text-indigo-500"> · {inferenceData.context_tags.slice(0, 3).join(', ')}</span>
                    )}
                  </div>
                )}
                {selectedItem.aiResultCached && (
                  <div className="mt-1 text-[10px] text-slate-400">Cached result</div>
                )}
                {selectedItem.reviewSummary && (
                  <div className="mt-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">Review:</span> {selectedItem.reviewSummary}
                  </div>
                )}
                {selectedItem.reviewReasoning && (
                  <div className="mt-1 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">Reasoning:</span> {selectedItem.reviewReasoning}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-slate-600">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1">
                    <ScoreKnob value={selectedItem.scores?.grammar_score} />
                    <span>Grammar</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1">
                    <ScoreKnob value={selectedItem.scores?.clarity_score} />
                    <span>Clarity</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1">
                    <ScoreKnob value={selectedItem.scores?.legal_risk_score} />
                    <span>Risk</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1">
                    <ScoreKnob value={selectedItem.scores?.overall_score} />
                    <span>Overall</span>
                  </div>
                </div>
                {selectedItem.suggestions?.length > 0 && (
                  <div className="mt-3 text-[10px] text-slate-500">
                    {selectedItem.suggestions.length} recommendations available.
                  </div>
                )}
              </button>
            );
          })()}
        </div>
      </div>

      <svg
        className="absolute inset-0 pointer-events-none"
        width="100%"
        height="100%"
      >
        <defs>
          <linearGradient id="aiLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#93C5FD" />
            <stop offset="100%" stopColor="#60A5FA" />
          </linearGradient>
        </defs>
        {linePaths.map((line) => (
          <path
            key={line.id}
            d={line.d}
            fill="none"
            stroke="url(#aiLine)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.7"
          />
        ))}
      </svg>
    </>
  );
};

export default ParagraphAiSidebar;
