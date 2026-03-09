import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, GitBranch, Link2, Maximize2, Minimize2, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import documentService from '../services/documentService';

/**
 * GraphDocument
 * Props:
 * - documentId: string
 * - height: number (optional, default 420)
 * - className: string
 * - onNodeSelect: (node) => void (optional)
 */
const GraphDocument = ({ documentId, height = 420, className = '', onNodeSelect }) => {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const svgRef = useRef(null);

  const loadGraph = async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await documentService.getDocumentGraph(documentId);
      setGraph(data);
    } catch (err) {
      console.error('Graph load failed', err);
      setError(err.response?.data?.detail || err.message || 'Unable to load document graph');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Flatten graph into nodes/edges
  const graphData = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };

    const nodes = [];
    const edges = [];

    const addSection = (section, depth = 0, parentId = null) => {
      nodes.push({ id: section.id, label: section.title || 'Untitled section', type: 'section', depth, numbering: section.numbering });

      if (parentId) edges.push({ from: parentId, to: section.id, type: 'hierarchy' });

      (section.paragraphs || []).forEach((p) => {
        nodes.push({ id: p.id, label: (p.effective_content || p.content_text || '').slice(0, 120), type: 'paragraph', depth: depth + 1 });
        edges.push({ from: section.id, to: p.id, type: 'contains' });
        (p.references || []).forEach((ref) => {
          if (ref.target_id) edges.push({ from: p.id, to: ref.target_id, type: 'reference' });
        });
      });

      (section.references || []).forEach((ref) => {
        if (ref.target_id) edges.push({ from: section.id, to: ref.target_id, type: 'reference' });
      });

      (section.children || []).forEach((child) => addSection(child, depth + 1, section.id));
    };

    (graph.sections || []).forEach((s) => addSection(s, 0, null));

    return { nodes, edges };
  }, [graph]);

  const layout = useMemo(() => {
    const { nodes, edges } = graphData;
    if (!nodes || nodes.length === 0) return { nodes: [], edges: [], width: 800, height: 360 };

    const numericHeight = typeof height === 'number' ? height : 420;
    const margin = 32;
    const columnWidth = 220;

    const maxDepth = Math.max(...nodes.map((n) => (typeof n.depth === 'number' ? n.depth : 0)), 0);
    const depthCounts = nodes.reduce((acc, n) => {
      const d = typeof n.depth === 'number' ? n.depth : 0;
      acc[d] = (acc[d] || 0) + 1;
      return acc;
    }, {});

    const maxRows = Math.max(...Object.values(depthCounts), 1);
    const svgHeight = Math.max(numericHeight - 120, 320);
    const rowSpacing = Math.max((svgHeight - margin * 2) / maxRows, 28);
    const svgWidth = Math.max((maxDepth + 1) * columnWidth + margin * 2, 320);

    const depthIndices = {};
    const laidOutNodes = nodes.map((n) => {
      const d = typeof n.depth === 'number' ? n.depth : 0;
      const idx = depthIndices[d] || 0;
      depthIndices[d] = idx + 1;
      return { ...n, x: margin + d * columnWidth, y: margin + idx * rowSpacing };
    });

    return { nodes: laidOutNodes, edges, width: svgWidth, height: svgHeight };
  }, [graphData, height]);

  const stats = useMemo(() => {
    if (!graph) return null;
    const s = graph.statistics || {};
    return {
      sections: s.sections_count ?? graph.sections?.length ?? 0,
      paragraphs: s.paragraphs_count ?? 0,
      sentences: s.sentences_count ?? 0,
      issues: s.issues_count ?? graph.issues?.total ?? 0,
      completion: s.completion_percentage ?? null,
    };
  }, [graph]);

  const handleTreeClick = (targetId) => {
    if (!targetId) return;
    handleNodeClick({ id: targetId });
  };

  const renderSections = (sections = [], depth = 0) => {
    return sections.map((section) => (
      <div key={section.id} className="mb-2">
        <button
          type="button"
          onClick={() => handleTreeClick(section.id)}
          className="flex items-start gap-2 text-left w-full hover:bg-slate-50 rounded px-1 py-0.5"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-gray-500">{section.numbering || '•'}</span>
            <span className="text-sm font-medium text-gray-900">{section.title || 'Untitled section'}</span>
          </div>
          {section.paragraphs?.length ? <span className="text-[11px] text-gray-500 ml-auto">{section.paragraphs.length} para</span> : null}
        </button>
        {section.paragraphs?.length ? (
          <div className="mt-1 ml-6 space-y-1">
            {section.paragraphs.slice(0, 3).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleTreeClick(p.id)}
                className="text-[12px] text-gray-600 truncate text-left w-full hover:text-blue-600"
                title={p.effective_content || p.content_text}
              >
                {p.effective_content || p.content_text || 'Empty paragraph'}
              </button>
            ))}
            {section.paragraphs.length > 3 && <p className="text-[11px] text-gray-500">+{section.paragraphs.length - 3} more paragraphs</p>}
          </div>
        ) : null}
        {section.children?.length ? renderSections(section.children, depth + 1) : null}
      </div>
    ));
  };

  const clampScale = (value) => Math.min(3, Math.max(0.5, value));

  const handleZoom = (delta) => {
    setScale((prev) => clampScale(prev + delta));
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      handleZoom(delta);
      return;
    }

    // Pan with regular scroll/trackpad
    e.preventDefault();
    setOffset((prev) => ({
      x: prev.x - e.deltaX,
      y: prev.y - e.deltaY,
    }));
  };

  const handlePointerDown = (e) => {
    if (e.target.closest('[data-graph-node]')) {
      return;
    }
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handlePointerMove = (e) => {
    if (!isPanning) return;
    setOffset({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
  };

  const handlePointerUp = () => {
    setIsPanning(false);
  };

  const downloadSvgAsImage = async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const image = new Image();
    image.crossOrigin = 'anonymous';
    const canvas = document.createElement('canvas');
  const { width = 800, height: h = 600 } = svgEl.getBoundingClientRect();
  const scaleFactor = Math.max(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(width * scaleFactor));
  canvas.height = Math.max(1, Math.round(h * scaleFactor));
    const ctx = canvas.getContext('2d');

    await new Promise((resolve, reject) => {
      image.onload = () => {
        ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, h);
        ctx.drawImage(image, 0, 0, width, h);
        resolve();
      };
      image.onerror = reject;
      image.src = url;
    });

    const pngUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = 'document-graph.png';
    a.click();

    URL.revokeObjectURL(url);
  };

  const scrollToNodeTarget = (node) => {
    if (!node?.id) return;
    const paragraphTarget = document.querySelector(`[data-paragraph-id="${node.id}"]`);
    const sectionTarget = document.querySelector(`[data-section-id="${node.id}"]`);
    const target = paragraphTarget || sectionTarget;
    if (!target) return;
    const scrollContainer = document.querySelector('[data-document-scroll]');
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offsetTop = targetRect.top - containerRect.top + scrollContainer.scrollTop;
      const desiredTop = Math.max(0, offsetTop - containerRect.height / 3);
      scrollContainer.scrollTo({ top: desiredTop, behavior: 'smooth' });
      try {
        target.focus?.();
      } catch (e) {}
      return;
    }
    try {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      target.scrollIntoView();
    }
    try {
      target.focus?.();
    } catch (e) {}
  };

  const handleNodeClick = (node) => {
    const handled = onNodeSelect?.(node);
    if (handled === true) return;

    if (isFullscreen) {
      setIsFullscreen(false);
      setTimeout(() => scrollToNodeTarget(node), 120);
      return;
    }

    scrollToNodeTarget(node);
  };

  const graphVisual = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase tracking-wide text-gray-500">Graph Visual</h4>
        <div className="flex items-center gap-2 text-[11px] text-gray-600">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-gray-400 block" /> hierarchy</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 block" /> references</span>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <button onClick={() => handleZoom(0.1)} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50" title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => handleZoom(-0.1)} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50" title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button onClick={resetView} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50" title="Reset view">
            Reset
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <button onClick={downloadSvgAsImage} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 flex items-center gap-1" title="Download graph as PNG">
            <Download size={14} /> Download
          </button>
        </div>
      </div>

      <div
        className="border border-gray-200 rounded-md bg-white relative overflow-hidden"
        style={{ minHeight: isFullscreen ? 520 : 300 }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${layout.width || 800} ${layout.height || 400}`}
          className="block"
        >
          <g transform={`translate(${offset.x}, ${offset.y}) scale(${scale})`}>
            {/* Edges */}
            {layout.edges.map((edge, idx) => {
              const from = layout.nodes.find((n) => n.id === edge.from);
              const to = layout.nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const isRef = edge.type === 'reference';
              const startX = from.x + 160;
              const startY = from.y + 24;
              const endX = to.x;
              const endY = to.y + 24;
              const midX = (startX + endX) / 2;
              const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
              return (
                <path
                  key={`${edge.from}-${edge.to}-${idx}`}
                  d={path}
                  stroke={isRef ? '#3b82f6' : '#94a3b8'}
                  strokeWidth={isRef ? 1.6 : 1.1}
                  strokeDasharray={isRef ? '4 3' : '0'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  opacity={0.9}
                />
              );
            })}

            {layout.nodes.map((node) => (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer"
                data-graph-node
                onClick={() => handleNodeClick(node)}
              >
                <rect
                  rx={8}
                  ry={8}
                  width={160}
                  height={48}
                  fill={node.type === 'section' ? '#eef2ff' : '#ecfeff'}
                  stroke={node.type === 'section' ? '#6366f1' : '#06b6d4'}
                  strokeWidth={1}
                  opacity={0.98}
                />
                <text x={10} y={18} fontSize={11} fill="#0f172a" fontWeight="600">
                  {node.type === 'section' ? (node.numbering ? `${node.numbering} ` : '') : '¶ '}
                  {node.label?.slice(0, 32) || 'Node'}
                  {node.label && node.label.length > 32 ? '…' : ''}
                </text>
                <text x={10} y={34} fontSize={10} fill="#475569">
                  {node.type === 'section' ? 'Section' : 'Paragraph'}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
        <Link2 size={12} /> Reference edges are dashed blue; hierarchy edges are gray.
      </p>
    </div>
  );

  const content = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2 text-gray-800 font-semibold">
          <GitBranch size={18} className="text-blue-600" />
          <span>Document Graph</span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={loadGraph} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Refresh graph" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setIsFullscreen((v) => !v)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen graph'}>
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3 flex-1 min-h-0">
        {!documentId && (
          <div className="text-sm text-gray-500 flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-500" />
            Provide a document id to load the graph.
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 flex items-center gap-2 bg-red-50 border border-red-100 px-3 py-2 rounded">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-gray-600 text-sm">
            <RefreshCw size={16} className="animate-spin" />
            Loading document graph...
          </div>
        )}

        {!loading && graph && (
          <>
            <div className="mt-1">{graphVisual}</div>

            {stats && (
              <div className="grid grid-cols-2 gap-2 text-sm mt-4">
                <StatItem label="Sections" value={stats.sections} />
                <StatItem label="Paragraphs" value={stats.paragraphs} />
                <StatItem label="Sentences" value={stats.sentences} />
                <StatItem label="Issues" value={stats.issues} />
                {typeof stats.completion === 'number' && (
                  <StatItem label="Completion" value={`${stats.completion}%`} />
                )}
              </div>
            )}

            <div className="mt-3">
              <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Sections</h4>
              <div className="space-y-2">
                {graph.sections?.length ? (
                  renderSections(graph.sections)
                ) : (
                  <p className="text-sm text-gray-500">No sections in this document yet.</p>
                )}
              </div>
            </div>

            {graph.issues?.critical?.length ? (
              <div className="mt-3">
                <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1">Critical Issues</h4>
                <ul className="space-y-1 text-sm text-red-700 bg-red-50 border border-red-100 rounded p-2">
                  {graph.issues.critical.slice(0, 3).map((issue) => (
                    <li key={issue.id} className="truncate" title={issue.description}>
                      • {issue.description || issue.issue_type}
                    </li>
                  ))}
                  {graph.issues.critical.length > 3 && (
                    <li className="text-xs text-red-600">+{graph.issues.critical.length - 3} more</li>
                  )}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/80 p-3">
        <div className="bg-white rounded-lg shadow-2xl border border-gray-200 flex flex-col w-full h-full">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-2 text-gray-800 font-semibold">
              <GitBranch size={18} className="text-blue-600" />
              <span>Document Graph (Fullscreen)</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={downloadSvgAsImage} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 flex items-center gap-1 text-sm text-gray-700" title="Download graph as PNG">
                <Download size={14} /> Download
              </button>
              <button onClick={() => setIsFullscreen(false)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600" title="Exit fullscreen">
                <Minimize2 size={16} />
              </button>
            </div>
          </div>
          <div className="p-4 flex-1 min-h-0 overflow-hidden">{graphVisual}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`border border-gray-200 rounded-lg shadow-sm bg-white flex flex-col ${className}`}
      style={{
        minHeight: 280,
        height,
        resize: 'both',
        overflow: 'auto',
      }}
    >
      {content}
    </div>
  );
};

const StatItem = ({ label, value }) => (
  <div className="bg-gray-50 border border-gray-100 rounded px-3 py-2">
    <p className="text-[11px] uppercase text-gray-500 tracking-wide">{label}</p>
    <p className="text-sm font-semibold text-gray-900">{value ?? '-'}</p>
  </div>
);

export default GraphDocument;
 