/**
 * CrossReferenceOverlay — SVG overlay drawing lines between cross-referenced components.
 *
 * When enabled:
 *   • Clicking a component's cross-ref icon selects it as the "source"
 *   • Lines are drawn from source to every target component (lateral edge)
 *   • Line colour encodes importance: red = critical, blue = contextual
 *   • Line thickness encodes score (thicker = stronger relationship)
 *   • Target components get an underline/highlight matching the edge colour
 *   • Score percentage label shown on each line midpoint
 *
 * The overlay is an absolutely-positioned SVG that sits on top of the document.
 * It reads element positions via data-inference-id attributes.
 *
 * Props:
 *   enabled        — boolean, whether overlay is visible
 *   sourceId       — UUID of selected source component (null = nothing selected)
 *   sourceType     — 'paragraph' | 'table' | 'section' | 'latex_code' | etc.
 *   edges          — Array<{ target_id, target_type, edge_type, score, target_label, target_summary }>
 *   containerRef   — ref to the scrollable document container
 *   onSelectSource — (componentId, componentType) => void — called when user clicks a cross-ref icon
 *   onClearSource  — () => void — clear selection
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { X } from 'lucide-react';

// ── Edge colour config ──────────────────────────────────────────────

const EDGE_COLOURS = {
  critical: {
    line: '#EF4444',        // red-500
    lineLight: '#FCA5A5',   // red-300
    bg: 'rgba(239,68,68,0.08)',
    underline: '#EF4444',
    label: 'Critical',
  },
  contextual: {
    line: '#3B82F6',        // blue-500
    lineLight: '#93C5FD',   // blue-300
    bg: 'rgba(59,130,246,0.06)',
    underline: '#3B82F6',
    label: 'Contextual',
  },
};

const getEdgeColour = (edgeType) => EDGE_COLOURS[edgeType] || EDGE_COLOURS.contextual;

// ── Score to line width ─────────────────────────────────────────────

const scoreToWidth = (score) => {
  if (score == null) return 1.5;
  const s = Math.max(0, Math.min(1, score));
  return 1 + s * 2.5; // 1px → 3.5px
};

// ── Score to opacity ────────────────────────────────────────────────

const scoreToOpacity = (score) => {
  if (score == null) return 0.6;
  return 0.3 + Math.min(1, score) * 0.5; // 0.3 → 0.8
};

// ── Build path between two elements — arcs along the right margin ───

function buildCurvePath(sourceRect, targetRect, containerRect) {
  // Anchor on the RIGHT edge of each component
  const sx = sourceRect.right - containerRect.left;
  const sy = sourceRect.top + sourceRect.height / 2 - containerRect.top;
  const tx = targetRect.right - containerRect.left;
  const ty = targetRect.top + targetRect.height / 2 - containerRect.top;

  // How far the arc bows out to the right (proportional to vertical distance)
  const vertDist = Math.abs(ty - sy);
  const bulge = Math.min(80, 30 + vertDist * 0.12); // 30–80px outward

  // Right-side anchor X (further right than both start and end)
  const rightX = Math.max(sx, tx) + bulge;

  // Quadratic bezier: source → bow right → target
  const cx1 = rightX;
  const cy1 = sy + (ty - sy) * 0.25;
  const cx2 = rightX;
  const cy2 = sy + (ty - sy) * 0.75;

  const path = `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}`;
  const midX = rightX - 4; // label sits just inside the arc peak
  const midY = (sy + ty) / 2;

  return { path, midX, midY, sx, sy, tx, ty };
}

// ── Line + label for one edge ───────────────────────────────────────

const EdgeLine = ({ pathData, edge, colour }) => {
  const width = scoreToWidth(edge.score);
  const opacity = scoreToOpacity(edge.score);
  const scoreText = edge.score != null ? `${(edge.score * 100).toFixed(0)}%` : '';

  return (
    <g>
      {/* Glow / wide background */}
      <path
        d={pathData.path}
        fill="none"
        stroke={colour.lineLight}
        strokeWidth={width + 3}
        strokeLinecap="round"
        opacity={opacity * 0.3}
      />
      {/* Main line */}
      <path
        d={pathData.path}
        fill="none"
        stroke={colour.line}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={edge.edge_type === 'contextual' ? '6 3' : 'none'}
        opacity={opacity}
      />
      {/* Score label at midpoint */}
      {scoreText && (
        <>
          <rect
            x={pathData.midX - 14}
            y={pathData.midY - 8}
            width={28}
            height={16}
            rx={4}
            fill="white"
            stroke={colour.line}
            strokeWidth={0.5}
            opacity={0.95}
          />
          <text
            x={pathData.midX}
            y={pathData.midY + 4}
            textAnchor="middle"
            fill={colour.line}
            fontSize={9}
            fontWeight={600}
          >
            {scoreText}
          </text>
        </>
      )}
      {/* Source dot */}
      <circle cx={pathData.sx} cy={pathData.sy} r={4} fill={colour.line} opacity={0.8} />
      {/* Target dot */}
      <circle cx={pathData.tx} cy={pathData.ty} r={3.5} fill={colour.line} opacity={0.6} />
    </g>
  );
};

// ── Target highlight — adds underline/background to target elements ─

function applyTargetHighlights(edges, enabled) {
  // Clean up all highlights first
  document.querySelectorAll('[data-crossref-highlight]').forEach((el) => {
    el.style.removeProperty('box-shadow');
    el.style.removeProperty('background');
    el.style.removeProperty('border-bottom');
    el.removeAttribute('data-crossref-highlight');
  });

  if (!enabled || !edges?.length) return;

  edges.forEach((edge) => {
    // Try multiple selectors to find the target element
    // data-metadata-id is on paragraph/table/latex/image wrappers
    // data-section-id is on section wrappers
    // data-inference-id was on old InferenceIndicator (legacy fallback)
    let targetEl =
      document.querySelector(`[data-metadata-id="${edge.target_id}"]`) ||
      document.querySelector(`[data-section-id="${edge.target_id}"]`) ||
      document.querySelector(`[data-inference-id="${edge.target_id}"]`);

    if (!targetEl) return;

    // The data-metadata-id / data-section-id is already on the wrapper div,
    // so use it directly (or walk up to .relative if needed)
    const target = targetEl.classList?.contains('relative')
      ? targetEl
      : (targetEl.closest('.relative') || targetEl);

    const colour = getEdgeColour(edge.edge_type);
    target.setAttribute('data-crossref-highlight', edge.edge_type);
    target.style.background = colour.bg;
    target.style.borderBottom = `2px solid ${colour.underline}`;
    target.style.boxShadow = `inset 0 -2px 0 0 ${colour.underline}`;
  });
}

// ── Main overlay component ──────────────────────────────────────────

const CrossReferenceOverlay = ({
  enabled = false,
  sourceId = null,
  sourceType = null,
  edges = [],
  containerRef,
  onClearSource,
}) => {
  const [lines, setLines] = useState([]);
  const svgRef = useRef(null);
  const rafRef = useRef(null);

  // Helper: find a DOM element by ID, trying multiple data-attribute selectors
  const findElementById = useCallback((container, id) => {
    if (!id || !container) return null;
    return (
      container.querySelector(`[data-inference-id="${id}"]`) ||
      container.querySelector(`[data-metadata-id="${id}"]`) ||
      container.querySelector(`[data-section-id="${id}"]`)
    );
  }, []);

  // Rebuild lines when source/edges/scroll changes
  const rebuildLines = useCallback(() => {
    if (!enabled || !sourceId || !edges.length || !containerRef?.current) {
      setLines([]);
      return;
    }

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    // Find source element via multi-selector fallback
    const sourceEl = findElementById(container, sourceId);
    if (!sourceEl) {
      setLines([]);
      return;
    }

    const sourceRect = sourceEl.getBoundingClientRect();
    const newLines = [];

    edges.forEach((edge) => {
      const targetEl = findElementById(container, edge.target_id);
      if (!targetEl) return;

      const targetRect = targetEl.getBoundingClientRect();
      const pathData = buildCurvePath(sourceRect, targetRect, containerRect);
      const colour = getEdgeColour(edge.edge_type);

      newLines.push({
        key: `${edge.target_id}-${edge.edge_type}`,
        pathData,
        edge,
        colour,
      });
    });

    setLines(newLines);
  }, [enabled, sourceId, edges, containerRef, findElementById]);

  // Rebuild on source/edges change
  useEffect(() => {
    rebuildLines();
  }, [rebuildLines]);

  // Rebuild on scroll / resize
  useEffect(() => {
    if (!enabled || !containerRef?.current) return;

    const handleUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(rebuildLines);
    };

    const scrollEl = containerRef.current;
    scrollEl.addEventListener('scroll', handleUpdate, { passive: true });
    window.addEventListener('resize', handleUpdate);

    return () => {
      scrollEl.removeEventListener('scroll', handleUpdate);
      window.removeEventListener('resize', handleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, containerRef, rebuildLines]);

  // Apply/clear target highlights
  useEffect(() => {
    applyTargetHighlights(edges, enabled && !!sourceId);
    return () => applyTargetHighlights([], false);
  }, [edges, enabled, sourceId]);

  // Don't render at all if disabled or no source selected
  if (!enabled || !sourceId) return null;

  // Container dimensions for SVG sizing
  const containerEl = containerRef?.current;
  const containerWidth = containerEl?.scrollWidth || 0;
  const containerHeight = containerEl?.scrollHeight || 0;

  return (
    <>
      {/* SVG overlay — only render if there are lines to draw */}
      {lines.length > 0 && (
        <svg
          ref={svgRef}
          className="absolute inset-0 pointer-events-none z-[50]"
          width={containerWidth}
          height={containerHeight}
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Arrow marker for critical edges */}
            <marker
              id="crossref-arrow-critical"
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={6}
              markerHeight={6}
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_COLOURS.critical.line} />
            </marker>
            <marker
              id="crossref-arrow-contextual"
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={6}
              markerHeight={6}
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_COLOURS.contextual.line} />
            </marker>
          </defs>
          {lines.map((line) => (
            <EdgeLine
              key={line.key}
              pathData={line.pathData}
              edge={line.edge}
              colour={line.colour}
            />
          ))}
        </svg>
      )}

      {/* Floating info bar — always visible when a source is selected */}
      <div className="sticky top-2 left-2 right-2 z-[51] flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 shadow-sm mx-4 mb-2">
        <span className="text-xs font-medium text-violet-800">
          Cross-references from <span className="font-bold">{sourceType}</span>
        </span>
        <div className="flex items-center gap-3 ml-auto">
          {edges.length > 0 ? (
            <>
              <span className="flex items-center gap-1 text-[10px]">
                <span className="h-2 w-4 rounded bg-red-400" />
                <span className="text-red-700 font-medium">
                  {edges.filter(e => e.edge_type === 'critical').length} critical
                </span>
              </span>
              <span className="flex items-center gap-1 text-[10px]">
                <span className="h-2 w-4 rounded bg-blue-400" />
                <span className="text-blue-700 font-medium">
                  {edges.filter(e => e.edge_type === 'contextual').length} contextual
                </span>
              </span>
            </>
          ) : (
            <span className="text-[10px] text-gray-500">No edges — run inference first</span>
          )}
          <button
            onClick={onClearSource}
            className="p-1 rounded hover:bg-violet-100 text-violet-500 hover:text-violet-700"
            title="Clear selection"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </>
  );
};

export default CrossReferenceOverlay;
