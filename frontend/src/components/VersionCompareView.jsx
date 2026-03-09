/**
 * VersionCompareView — GitHub-style side-by-side version comparison
 *
 * Features:
 *   • Full document text diff (not scaled-down PagedDocument)
 *   • Word-level inline diff highlighting (green for added, red for removed)
 *   • Unified / split view toggle
 *   • Change summary stats (+N additions, -N removals, ~N modifications)
 *   • Synchronized scrolling between left and right panels
 *   • Section-level navigation via jump links
 *   • Expand/collapse unchanged sections
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  GitCompare,
  Plus,
  Minus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  Columns,
  AlignJustify,
  Eye,
  EyeOff,
} from 'lucide-react';

// ─── Word-level diff engine ──────────────────────────────────────
// Compute longest common subsequence on word arrays for inline diffs

function tokenize(text) {
  if (!text) return [];
  return text.split(/(\s+)/).filter(Boolean);
}

function lcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function wordDiff(oldText, newText) {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  if (oldTokens.length === 0 && newTokens.length === 0) return [];
  if (oldTokens.length === 0) return newTokens.map((w) => ({ type: 'added', text: w }));
  if (newTokens.length === 0) return oldTokens.map((w) => ({ type: 'removed', text: w }));

  // For very large texts, fall back to simple comparison
  if (oldTokens.length * newTokens.length > 500000) {
    if (oldText === newText) return [{ type: 'unchanged', text: oldText }];
    return [
      { type: 'removed', text: oldText },
      { type: 'added', text: newText },
    ];
  }

  const dp = lcsMatrix(oldTokens, newTokens);
  const result = [];
  let i = oldTokens.length;
  let j = newTokens.length;

  const stack = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      stack.push({ type: 'unchanged', text: oldTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', text: newTokens[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', text: oldTokens[i - 1] });
      i--;
    }
  }

  stack.reverse();

  // Merge consecutive tokens of same type
  for (const tok of stack) {
    if (result.length > 0 && result[result.length - 1].type === tok.type) {
      result[result.length - 1].text += tok.text;
    } else {
      result.push({ ...tok });
    }
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────
const normalizeText = (value) =>
  (value || '').toString().replace(/\s+/g, ' ').trim();

const getParagraphText = (p) =>
  normalizeText(p?.content_text ?? p?.content ?? p?.edited_text ?? '');

const getSectionTitle = (s) =>
  normalizeText(s?.title || 'Untitled Section');

const getVersionLabel = (version) => {
  if (!version) return 'Current';
  return (
    version.version_number ||
    version.version_name ||
    `Version ${version.id?.toString().slice(0, 8) || '?'}`
  );
};

// Flatten section tree into ordered list with depth
function flattenSections(sections = [], depth = 0) {
  const result = [];
  for (const section of sections) {
    if (!section) continue;
    result.push({ ...section, _depth: depth });
    if (section.children?.length) {
      result.push(...flattenSections(section.children, depth + 1));
    }
  }
  return result;
}

// Build a lookup map: sectionId -> { section, paragraphs }
function buildSectionMap(doc) {
  const map = new Map();
  const flat = flattenSections(doc?.sections || []);
  for (const section of flat) {
    const id = String(section.id || section.client_id || '');
    map.set(id, {
      section,
      paragraphs: section.paragraphs || [],
      tables: section.tables || section.table_components || [],
      images: section.image_components || section.images || [],
      files: section.file_components || section.files || [],
    });
  }
  return { map, flat };
}

// ─── Diff row types ─────────────────────────────────────────────
// 'section-header' | 'paragraph' | 'table' | 'image' | 'file'
// status: 'unchanged' | 'added' | 'removed' | 'changed'

function computeDiffRows(leftDoc, rightDoc) {
  const { map: leftMap, flat: leftFlat } = buildSectionMap(leftDoc);
  const { map: rightMap, flat: rightFlat } = buildSectionMap(rightDoc);

  const rows = [];
  const processedRightSections = new Set();
  let stats = { additions: 0, removals: 0, modifications: 0, unchanged: 0 };

  // Process left sections in order, matching with right
  for (const leftSection of leftFlat) {
    const sectionId = String(leftSection.id || leftSection.client_id || '');
    const rightData = rightMap.get(sectionId);
    processedRightSections.add(sectionId);

    const leftTitle = getSectionTitle(leftSection);
    const rightTitle = rightData ? getSectionTitle(rightData.section) : '';
    const titleChanged = rightData && leftTitle !== rightTitle;

    if (!rightData) {
      // Section removed
      rows.push({
        type: 'section-header',
        status: 'removed',
        left: { title: leftTitle, depth: leftSection._depth },
        right: null,
      });
      stats.removals++;
      for (const p of leftSection.paragraphs || []) {
        rows.push({
          type: 'paragraph',
          status: 'removed',
          left: { text: getParagraphText(p), id: p.id },
          right: null,
        });
        stats.removals++;
      }
    } else {
      // Section exists in both
      rows.push({
        type: 'section-header',
        status: titleChanged ? 'changed' : 'unchanged',
        left: { title: leftTitle, depth: leftSection._depth },
        right: { title: rightTitle, depth: rightData.section._depth },
      });
      if (titleChanged) stats.modifications++;
      else stats.unchanged++;

      // Diff paragraphs within section
      const leftParas = leftSection.paragraphs || [];
      const rightParas = rightData.paragraphs || [];
      const rightParaMap = new Map();
      rightParas.forEach((p) => rightParaMap.set(String(p.id || p.client_id), p));

      const processedRightParas = new Set();

      for (const lp of leftParas) {
        const pid = String(lp.id || lp.client_id);
        const rp = rightParaMap.get(pid);
        processedRightParas.add(pid);

        const leftText = getParagraphText(lp);
        if (!rp) {
          rows.push({ type: 'paragraph', status: 'removed', left: { text: leftText, id: pid }, right: null });
          stats.removals++;
        } else {
          const rightText = getParagraphText(rp);
          if (leftText === rightText) {
            rows.push({ type: 'paragraph', status: 'unchanged', left: { text: leftText, id: pid }, right: { text: rightText, id: pid } });
            stats.unchanged++;
          } else {
            rows.push({ type: 'paragraph', status: 'changed', left: { text: leftText, id: pid }, right: { text: rightText, id: pid } });
            stats.modifications++;
          }
        }
      }

      // Paragraphs only in right
      for (const rp of rightParas) {
        const pid = String(rp.id || rp.client_id);
        if (!processedRightParas.has(pid)) {
          rows.push({ type: 'paragraph', status: 'added', left: null, right: { text: getParagraphText(rp), id: pid } });
          stats.additions++;
        }
      }

      // Diff tables
      const leftTables = leftSection.tables || leftSection.table_components || [];
      const rightTables = rightData.tables || [];
      const rightTableMap = new Map();
      rightTables.forEach((t) => rightTableMap.set(String(t.id || t.client_id), t));
      const processedRightTables = new Set();

      for (const lt of leftTables) {
        const tid = String(lt.id || lt.client_id);
        const rt = rightTableMap.get(tid);
        processedRightTables.add(tid);
        const leftSig = JSON.stringify(lt.column_headers || lt.data?.headers || []) + JSON.stringify(lt.table_data || lt.data?.rows || []);
        if (!rt) {
          rows.push({ type: 'table', status: 'removed', left: { id: tid, label: lt.title || 'Table' }, right: null });
          stats.removals++;
        } else {
          const rightSig = JSON.stringify(rt.column_headers || rt.data?.headers || []) + JSON.stringify(rt.table_data || rt.data?.rows || []);
          rows.push({ type: 'table', status: leftSig === rightSig ? 'unchanged' : 'changed', left: { id: tid, label: lt.title || 'Table' }, right: { id: tid, label: rt.title || 'Table' } });
          if (leftSig !== rightSig) stats.modifications++;
          else stats.unchanged++;
        }
      }
      for (const rt of rightTables) {
        const tid = String(rt.id || rt.client_id);
        if (!processedRightTables.has(tid)) {
          rows.push({ type: 'table', status: 'added', left: null, right: { id: tid, label: rt.title || 'Table' } });
          stats.additions++;
        }
      }
    }
  }

  // Sections only in right
  for (const rightSection of rightFlat) {
    const sectionId = String(rightSection.id || rightSection.client_id || '');
    if (processedRightSections.has(sectionId)) continue;

    rows.push({
      type: 'section-header',
      status: 'added',
      left: null,
      right: { title: getSectionTitle(rightSection), depth: rightSection._depth },
    });
    stats.additions++;

    for (const p of rightSection.paragraphs || []) {
      rows.push({
        type: 'paragraph',
        status: 'added',
        left: null,
        right: { text: getParagraphText(p), id: p.id },
      });
      stats.additions++;
    }
  }

  return { rows, stats };
}

// ─── Inline diff renderer ─────────────────────────────────────

const InlineDiff = ({ oldText, newText }) => {
  const tokens = useMemo(() => wordDiff(oldText || '', newText || ''), [oldText, newText]);

  return (
    <span>
      {tokens.map((tok, i) => {
        if (tok.type === 'removed') {
          return (
            <span key={i} className="bg-red-200 text-red-900 line-through decoration-red-400/60 rounded-sm px-[1px]">
              {tok.text}
            </span>
          );
        }
        if (tok.type === 'added') {
          return (
            <span key={i} className="bg-green-200 text-green-900 rounded-sm px-[1px]">
              {tok.text}
            </span>
          );
        }
        return <span key={i}>{tok.text}</span>;
      })}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

const VersionCompareView = ({
  leftDocument,
  rightDocument,
  leftVersion,
  rightVersion,
  onExit,
  compareLoading,
  compareError,
}) => {
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'unified'
  const [hideUnchanged, setHideUnchanged] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState(new Set());

  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const isSyncing = useRef(false);

  const leftLabel = getVersionLabel(leftVersion);
  const rightLabel = getVersionLabel(rightVersion);

  // Compute diff
  const { rows, stats } = useMemo(
    () => computeDiffRows(leftDocument, rightDocument),
    [leftDocument, rightDocument]
  );

  // Filter rows based on hideUnchanged
  const displayRows = useMemo(() => {
    if (!hideUnchanged) return rows;
    // Keep section headers if any child in that section has changes
    const filtered = [];
    let lastSectionHadChanges = false;
    let pendingSectionHeader = null;

    for (const row of rows) {
      if (row.type === 'section-header') {
        if (pendingSectionHeader && lastSectionHadChanges) {
          filtered.push(pendingSectionHeader);
        }
        pendingSectionHeader = row;
        lastSectionHadChanges = row.status !== 'unchanged';
        continue;
      }
      if (row.status !== 'unchanged') {
        if (pendingSectionHeader) {
          filtered.push(pendingSectionHeader);
          pendingSectionHeader = null;
        }
        lastSectionHadChanges = true;
        filtered.push(row);
      }
    }
    // Flush last section
    if (pendingSectionHeader && lastSectionHadChanges) {
      filtered.push(pendingSectionHeader);
    }

    return filtered;
  }, [rows, hideUnchanged]);

  // Synchronized scrolling
  const handleLeftScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (rightPanelRef.current && leftPanelRef.current) {
      const left = leftPanelRef.current;
      const right = rightPanelRef.current;
      const ratio = left.scrollTop / (left.scrollHeight - left.clientHeight || 1);
      right.scrollTop = ratio * (right.scrollHeight - right.clientHeight);
    }
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, []);

  const handleRightScroll = useCallback(() => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (leftPanelRef.current && rightPanelRef.current) {
      const right = rightPanelRef.current;
      const left = leftPanelRef.current;
      const ratio = right.scrollTop / (right.scrollHeight - right.clientHeight || 1);
      left.scrollTop = ratio * (left.scrollHeight - left.clientHeight);
    }
    requestAnimationFrame(() => { isSyncing.current = false; });
  }, []);

  const toggleSection = (sectionTitle) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionTitle)) next.delete(sectionTitle);
      else next.add(sectionTitle);
      return next;
    });
  };

  // Section collapse tracking
  const isSectionCollapsed = useCallback(
    (row) => {
      if (row.type !== 'section-header') return false;
      const title = row.left?.title || row.right?.title || '';
      return collapsedSections.has(title);
    },
    [collapsedSections]
  );

  // Build visible rows respecting collapsed sections
  const visibleRows = useMemo(() => {
    const result = [];
    let skipUntilDepth = null;

    for (const row of displayRows) {
      if (row.type === 'section-header') {
        const depth = row.left?.depth ?? row.right?.depth ?? 0;
        if (skipUntilDepth !== null && depth > skipUntilDepth) continue;
        skipUntilDepth = null;

        result.push(row);
        const title = row.left?.title || row.right?.title || '';
        if (collapsedSections.has(title)) {
          skipUntilDepth = depth;
        }
      } else {
        if (skipUntilDepth !== null) continue;
        result.push(row);
      }
    }

    return result;
  }, [displayRows, collapsedSections]);

  // ─── Status styling helpers ───────────────────────────────────
  const rowBg = (status, side) => {
    if (status === 'added') return side === 'right' ? 'bg-green-50' : 'bg-gray-50';
    if (status === 'removed') return side === 'left' ? 'bg-red-50' : 'bg-gray-50';
    if (status === 'changed') return 'bg-amber-50/50';
    return '';
  };

  const rowBorder = (status) => {
    if (status === 'added') return 'border-l-2 border-l-green-400';
    if (status === 'removed') return 'border-l-2 border-l-red-400';
    if (status === 'changed') return 'border-l-2 border-l-amber-400';
    return 'border-l-2 border-l-transparent';
  };

  const statusIcon = (status) => {
    if (status === 'added') return <Plus className="h-3 w-3 text-green-600" />;
    if (status === 'removed') return <Minus className="h-3 w-3 text-red-600" />;
    if (status === 'changed') return <RefreshCw className="h-3 w-3 text-amber-600" />;
    return null;
  };

  // ─── Render row content ─────────────────────────────────────
  const renderSectionHeader = (row, side) => {
    const data = side === 'left' ? row.left : row.right;
    if (!data && row.status !== 'unchanged') {
      return <div className="py-2 px-3 bg-gray-50 min-h-[36px]" />;
    }
    const d = data || row.left || row.right;
    const depth = d?.depth ?? 0;
    const title = d?.title || 'Untitled';
    const collapsed = isSectionCollapsed(row);

    return (
      <div
        className={`flex items-center gap-2 py-2 px-3 cursor-pointer select-none ${rowBg(row.status, side)} ${rowBorder(row.status)}`}
        onClick={() => toggleSection(title)}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        )}
        <span
          className="font-semibold text-gray-900"
          style={{ paddingLeft: `${depth * 16}px`, fontSize: `${Math.max(11, 15 - depth)}px` }}
        >
          {title}
        </span>
        {statusIcon(row.status)}
      </div>
    );
  };

  const renderParagraph = (row, side) => {
    const data = side === 'left' ? row.left : row.right;

    if (!data) {
      // Empty cell for the opposite side of an added/removed row
      return <div className={`py-2 px-4 min-h-[32px] ${rowBg(row.status, side)} ${rowBorder(row.status)}`} />;
    }

    if (row.status === 'changed') {
      return (
        <div className={`py-2 px-4 text-sm leading-relaxed ${rowBg(row.status, side)} ${rowBorder(row.status)}`}>
          {side === 'left' ? (
            <InlineDiff oldText={row.left?.text || ''} newText={row.right?.text || ''} />
          ) : (
            <InlineDiff oldText={row.left?.text || ''} newText={row.right?.text || ''} />
          )}
        </div>
      );
    }

    return (
      <div className={`py-2 px-4 text-sm leading-relaxed ${rowBg(row.status, side)} ${rowBorder(row.status)}`}>
        {row.status === 'removed' && side === 'left' && (
          <span className="bg-red-100 text-red-800 rounded-sm">{data.text}</span>
        )}
        {row.status === 'added' && side === 'right' && (
          <span className="bg-green-100 text-green-800 rounded-sm">{data.text}</span>
        )}
        {row.status === 'unchanged' && <span className="text-gray-700">{data.text}</span>}
      </div>
    );
  };

  const renderTable = (row, side) => {
    const data = side === 'left' ? row.left : row.right;
    if (!data) {
      return <div className={`py-2 px-4 min-h-[28px] ${rowBg(row.status, side)} ${rowBorder(row.status)}`} />;
    }
    return (
      <div className={`py-1.5 px-4 text-xs ${rowBg(row.status, side)} ${rowBorder(row.status)}`}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-gray-600 font-medium">
          📊 {data.label}
          {statusIcon(row.status)}
        </span>
      </div>
    );
  };

  const renderRow = (row, side) => {
    if (row.type === 'section-header') return renderSectionHeader(row, side);
    if (row.type === 'paragraph') return renderParagraph(row, side);
    if (row.type === 'table' || row.type === 'image' || row.type === 'file') return renderTable(row, side);
    return null;
  };

  // ─── Unified view row ──────────────────────────────────────
  const renderUnifiedRow = (row) => {
    if (row.type === 'section-header') {
      const d = row.left || row.right;
      const depth = d?.depth ?? 0;
      const title = d?.title || 'Untitled';
      const collapsed = isSectionCollapsed(row);
      return (
        <div
          className={`flex items-center gap-2 py-2 px-4 cursor-pointer select-none border-b border-gray-100 bg-gray-50 ${rowBorder(row.status)}`}
          onClick={() => toggleSection(title)}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
          <span className="font-semibold text-gray-900" style={{ paddingLeft: `${depth * 16}px`, fontSize: `${Math.max(11, 15 - depth)}px` }}>
            {title}
          </span>
          {statusIcon(row.status)}
        </div>
      );
    }

    if (row.type === 'paragraph') {
      if (row.status === 'unchanged') {
        return (
          <div className="py-2 px-4 text-sm leading-relaxed text-gray-700 border-l-2 border-l-transparent">
            {row.left?.text}
          </div>
        );
      }
      if (row.status === 'removed') {
        return (
          <div className="py-2 px-4 text-sm leading-relaxed bg-red-50 border-l-2 border-l-red-400">
            <Minus className="inline h-3 w-3 text-red-500 mr-1.5" />
            <span className="bg-red-100 text-red-800 rounded-sm">{row.left?.text}</span>
          </div>
        );
      }
      if (row.status === 'added') {
        return (
          <div className="py-2 px-4 text-sm leading-relaxed bg-green-50 border-l-2 border-l-green-400">
            <Plus className="inline h-3 w-3 text-green-500 mr-1.5" />
            <span className="bg-green-100 text-green-800 rounded-sm">{row.right?.text}</span>
          </div>
        );
      }
      if (row.status === 'changed') {
        return (
          <div className="space-y-0">
            <div className="py-2 px-4 text-sm leading-relaxed bg-red-50 border-l-2 border-l-red-400">
              <Minus className="inline h-3 w-3 text-red-500 mr-1.5" />
              <InlineDiff oldText={row.left?.text || ''} newText={row.right?.text || ''} />
            </div>
            <div className="py-2 px-4 text-sm leading-relaxed bg-green-50 border-l-2 border-l-green-400">
              <Plus className="inline h-3 w-3 text-green-500 mr-1.5" />
              <InlineDiff oldText={row.left?.text || ''} newText={row.right?.text || ''} />
            </div>
          </div>
        );
      }
    }

    if (row.type === 'table' || row.type === 'image' || row.type === 'file') {
      const data = row.left || row.right;
      return (
        <div className={`py-1.5 px-4 text-xs ${rowBg(row.status, 'left')} ${rowBorder(row.status)}`}>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-gray-600 font-medium">
            📊 {data?.label || 'Component'} {statusIcon(row.status)}
          </span>
        </div>
      );
    }

    return null;
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  if (compareLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-3 text-sm text-gray-500">Loading comparison…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header bar ──────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <GitCompare className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Version Comparison</div>
              <div className="text-xs text-gray-500">
                <span className="font-medium text-emerald-700">{leftLabel}</span>
                <span className="mx-1.5 text-gray-400">→</span>
                <span className="font-medium text-purple-700">{rightLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Stats badges */}
            <div className="hidden sm:flex items-center gap-1.5 mr-2">
              {stats.additions > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-full bg-green-100 text-green-800 border border-green-200">
                  <Plus className="h-2.5 w-2.5" />{stats.additions}
                </span>
              )}
              {stats.removals > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-full bg-red-100 text-red-800 border border-red-200">
                  <Minus className="h-2.5 w-2.5" />{stats.removals}
                </span>
              )}
              {stats.modifications > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  <RefreshCw className="h-2.5 w-2.5" />{stats.modifications}
                </span>
              )}
            </div>

            {/* View mode toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('split')}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  viewMode === 'split' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Side-by-side view"
              >
                <Columns className="h-3 w-3" />
                Split
              </button>
              <button
                onClick={() => setViewMode('unified')}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  viewMode === 'unified' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Unified view"
              >
                <AlignJustify className="h-3 w-3" />
                Unified
              </button>
            </div>

            {/* Toggle unchanged */}
            <button
              onClick={() => setHideUnchanged(!hideUnchanged)}
              className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                hideUnchanged
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
              title={hideUnchanged ? 'Show all content' : 'Hide unchanged content'}
            >
              {hideUnchanged ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {hideUnchanged ? 'Changes only' : 'Show all'}
            </button>

            {/* Exit */}
            <button
              onClick={onExit}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-all"
            >
              <X className="h-3.5 w-3.5" />
              Exit
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────── */}
      {compareError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {compareError}
        </div>
      )}

      {/* ── Diff content ─────────────────────────────────────── */}
      {viewMode === 'split' ? (
        /* ═══ SPLIT VIEW ═══ */
        <div className="grid grid-cols-2 gap-0 border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
          {/* Column headers */}
          <div className="px-4 py-2 bg-emerald-50 border-b border-r border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-emerald-800">{leftLabel}</span>
              {leftVersion?.created_at && (
                <span className="text-[10px] text-emerald-600/70 ml-auto">
                  {new Date(leftVersion.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="px-4 py-2 bg-purple-50 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              <span className="text-xs font-semibold text-purple-800">{rightLabel}</span>
              {rightVersion?.created_at && (
                <span className="text-[10px] text-purple-600/70 ml-auto">
                  {new Date(rightVersion.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div
            ref={leftPanelRef}
            onScroll={handleLeftScroll}
            className="overflow-y-auto border-r border-gray-200"
            style={{ maxHeight: 'calc(100vh - 220px)' }}
          >
            {visibleRows.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                No content to display
              </div>
            ) : (
              visibleRows.map((row, idx) => (
                <div key={`l-${idx}`} className="border-b border-gray-100">
                  {renderRow(row, 'left')}
                </div>
              ))
            )}
          </div>
          <div
            ref={rightPanelRef}
            onScroll={handleRightScroll}
            className="overflow-y-auto"
            style={{ maxHeight: 'calc(100vh - 220px)' }}
          >
            {visibleRows.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                No content to display
              </div>
            ) : (
              visibleRows.map((row, idx) => (
                <div key={`r-${idx}`} className="border-b border-gray-100">
                  {renderRow(row, 'right')}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* ═══ UNIFIED VIEW ═══ */
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
          {/* Header */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-medium text-emerald-800">{leftLabel}</span>
              </span>
              <span className="text-gray-400">→</span>
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="font-medium text-purple-800">{rightLabel}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              {stats.additions > 0 && <span className="text-green-700">+{stats.additions}</span>}
              {stats.removals > 0 && <span className="text-red-700">-{stats.removals}</span>}
              {stats.modifications > 0 && <span className="text-amber-700">~{stats.modifications}</span>}
            </div>
          </div>

          {/* Content */}
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            {visibleRows.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-gray-400">
                {hideUnchanged ? 'No changes detected' : 'No content to display'}
              </div>
            ) : (
              visibleRows.map((row, idx) => (
                <div key={`u-${idx}`} className="border-b border-gray-100">
                  {renderUnifiedRow(row)}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-green-400" /> Added</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-red-400" /> Removed</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-amber-400" /> Modified</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-gray-300" /> Unchanged</span>
      </div>
    </div>
  );
};

export default VersionCompareView;
