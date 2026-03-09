/**
 * InferenceIndicator — Subtle inline inference marker (no icons).
 *
 * Design philosophy:
 *   • NO visible icons in the document flow
 *   • 3px left-border with status colour (emerald=fresh, amber=stale, transparent=none)
 *   • On hover → slide-in tooltip panel with summary, tags, entities, cross-ref count
 *   • Cross-ref activation via click on the border area
 *   • Border is nearly invisible (opacity-50) until hover brightens + widens it
 *
 * Props:
 *   componentId    — UUID of the component
 *   componentType  — 'section' | 'paragraph' | 'table' | 'latex_code' | 'image' | 'file'
 *   inference      — inference data object | null
 *   isStale        — boolean
 *   isSection      — true if section aggregate
 *   onCrossRef     — callback(componentId, componentType) for lateral edge selection
 *   crossRefActive — boolean, this component is the cross-ref source
 *   crossRefCount  — number of lateral edges
 */

import React, { useState, useRef, useCallback } from 'react';

// ── Tooltip ──────────────────────────────────────────────────────────

const InferenceTooltip = ({ inference, isStale, isSection, crossRefCount, position }) => {
  if (!inference) return null;
  const summary = inference.summary || inference.aggregate_summary || '';
  const tags = inference.context_tags || [];
  const entities = inference.key_entities || [];
  const meta = inference.custom_metadata || {};

  return (
    <div
      className="fixed z-[9999] w-72"
      style={{ top: position.top, left: position.left }}
    >
      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-xl p-3 text-[11px] leading-relaxed">
        {/* Status line */}
        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-gray-100">
          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isStale ? 'bg-amber-400' : 'bg-emerald-500'}`} />
          <span className={`font-semibold ${isStale ? 'text-amber-700' : 'text-emerald-700'}`}>
            {isStale ? 'Needs refresh' : (isSection ? 'Section inferred' : 'Inferred')}
          </span>
          {crossRefCount > 0 && (
            <span className="ml-auto text-[10px] text-violet-600 font-medium">
              {crossRefCount} cross-ref{crossRefCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Summary */}
        {summary && (
          <p className="text-gray-700 mb-2 leading-snug line-clamp-4">{summary}</p>
        )}

        {/* Section purpose */}
        {isSection && meta.section_purpose && (
          <p className="text-gray-500 mb-2 italic line-clamp-2">
            {meta.section_purpose}
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.slice(0, 6).map((tag, i) => (
              <span key={i} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[9px]">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Entities */}
        {entities.length > 0 && (
          <div className="text-[10px] text-gray-400">
            {entities.slice(0, 8).join(' · ')}
          </div>
        )}

        {/* Section-specific fields */}
        {isSection && meta.key_obligations?.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 text-[10px]">
            <span className="text-amber-600 font-medium">Obligations: </span>
            <span className="text-gray-500">{meta.key_obligations.slice(0, 3).join('; ')}</span>
          </div>
        )}
        {isSection && meta.risk_indicators?.length > 0 && (
          <div className="text-[10px]">
            <span className="text-red-500 font-medium">Risks: </span>
            <span className="text-gray-500">{meta.risk_indicators.slice(0, 3).join('; ')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────

const InferenceIndicator = ({
  componentId,
  componentType = 'paragraph',
  inference = null,
  isStale = false,
  isSection = false,
  onCrossRef,
  crossRefActive = false,
  crossRefCount = 0,
}) => {
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const hoverTimerRef = useRef(null);

  const showTooltip = useCallback(() => {
    if (!inference || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({
      top: Math.max(8, rect.top - 4),
      left: rect.right + 10,
    });
    setHovered(true);
  }, [inference]);

  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(showTooltip, 280);
  }, [showTooltip]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    setHovered(false);
  }, []);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (onCrossRef && inference) {
      onCrossRef(componentId, componentType);
    }
  }, [onCrossRef, componentId, componentType, inference]);

  // Determine border colour
  let borderClass = 'border-l-transparent';
  let hoverBorderClass = '';
  let glowClass = '';

  if (inference) {
    if (crossRefActive) {
      borderClass = 'border-l-violet-400';
      hoverBorderClass = 'hover:border-l-violet-500';
      glowClass = 'shadow-[inset_2px_0_8px_-3px_rgba(139,92,246,0.3)]';
    } else if (isStale) {
      borderClass = 'border-l-amber-300';
      hoverBorderClass = 'hover:border-l-amber-400';
    } else {
      borderClass = 'border-l-emerald-300';
      hoverBorderClass = 'hover:border-l-emerald-400';
    }
  }

  return (
    <div
      ref={containerRef}
      className={`
        absolute left-0 top-0 bottom-0 w-[3px] rounded-full
        transition-all duration-200 cursor-default
        border-l-[3px] ${borderClass} ${hoverBorderClass} ${glowClass}
        ${hovered && inference ? 'w-[5px] !opacity-100' : inference ? 'opacity-50' : 'opacity-0'}
        ${crossRefActive ? '!opacity-100 w-[4px]' : ''}
      `}
      data-inference-id={componentId}
      data-inference-type={componentType}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Hover tooltip */}
      {hovered && inference && (
        <InferenceTooltip
          inference={inference}
          isStale={isStale}
          isSection={isSection}
          crossRefCount={crossRefCount}
          position={tooltipPos}
        />
      )}
    </div>
  );
};

export default InferenceIndicator;
