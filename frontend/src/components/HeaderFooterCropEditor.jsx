import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, Scissors, Search, X, Save, RefreshCw, BookOpen, Trash2, Check, AlertTriangle } from 'lucide-react';
import exportSettingsService from '../services/exportSettingsService';

/**
 * HeaderFooterCropEditor
 *
 * Full crop-editor panel + modal for visually selecting header / footer
 * strips from a PDF's first page. Replaces the old simple horizontal-line
 * overlay system with a dedicated crop workflow per the prompting guide.
 *
 * Props
 * ─────
 * documentId           – current document UUID
 * pdfFiles             – array of available PDF files [{ id, name, filename }]
 * headerPdfConfig      – current header_pdf from processing_settings (or null)
 * footerPdfConfig      – current footer_pdf from processing_settings (or null)
 * onSaveHeaderFooterPdf(type, config)  – persist header/footer PDF config
 * onRemoveHeaderFooterPdf(type)        – remove header/footer PDF
 * onUploadPdfFile(file) → uploaded     – upload a new PDF file
 * onRefreshPreview()                   – refresh the export preview
 */

const DEFAULT_HEADER_PT = 80;
const DEFAULT_FOOTER_PT = 60;

// ── Helpers ──────────────────────────────────────────────────────────────

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// ── Sub-components ───────────────────────────────────────────────────────

const StatusMessage = ({ message, ok }) => {
  if (!message) return null;
  return (
    <div className={`text-xs px-2 py-1 rounded ${ok ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
      {message}
    </div>
  );
};

const ActiveIndicator = ({ type, config, onConfigChange, onRemove }) => {
  const isHeader = type === 'header';
  const name = config?.name || (isHeader ? 'Header' : 'Footer');
  const height = config?.height ?? (isHeader ? DEFAULT_HEADER_PT : DEFAULT_FOOTER_PT);
  const opacity = config?.opacity ?? 1;
  const showOnAllPages = config?.show_on_all_pages ?? true;
  const showOnFirstPage = config?.show_on_first_page ?? true;
  const showPages = config?.show_pages ?? '';
  const page = config?.page ?? 1;

  const update = (field, value) => {
    onConfigChange?.({ ...config, [field]: value });
  };

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 space-y-2">
      {/* Title row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Check size={14} className="text-green-600 shrink-0" />
          <span className="text-xs font-medium text-green-800 truncate">
            {isHeader ? 'Header' : 'Footer'}: {name} ({height}pt)
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
          title="Remove"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Overlay options grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {/* Height */}
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-gray-500 whitespace-nowrap">Height (pt)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={height}
            onChange={(e) => update('height', Math.max(0, Number(e.target.value) || 0))}
            className="w-14 text-[10px] rounded border border-gray-200 px-1 py-0.5 text-right"
          />
        </div>

        {/* Opacity */}
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-gray-500 whitespace-nowrap">Opacity</label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={opacity}
            onChange={(e) => update('opacity', clamp(Number(e.target.value) || 0, 0, 1))}
            className="w-14 text-[10px] rounded border border-gray-200 px-1 py-0.5 text-right"
          />
        </div>

        {/* Show on all pages */}
        <label className="flex items-center gap-1.5 col-span-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnAllPages}
            onChange={(e) => {
              const all = e.target.checked;
              onConfigChange?.({
                ...config,
                show_on_all_pages: all,
                ...(all ? { show_on_first_page: true } : {}),
              });
            }}
            className="h-3 w-3 rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-[10px] text-gray-600">Show on all pages</span>
        </label>

        {/* Show on first page */}
        <label className="flex items-center gap-1.5 col-span-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnFirstPage}
            onChange={(e) => update('show_on_first_page', e.target.checked)}
            className="h-3 w-3 rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-[10px] text-gray-600">Show on first page</span>
        </label>

        {/* Show on specific pages (only when NOT all pages) */}
        {!showOnAllPages && (
          <div className="col-span-2 flex items-center gap-1">
            <label className="text-[10px] text-gray-500 whitespace-nowrap">Pages</label>
            <input
              type="text"
              value={showPages}
              onChange={(e) => update('show_pages', e.target.value)}
              placeholder="e.g. 1,3,5-8"
              className="flex-1 text-[10px] rounded border border-gray-200 px-1.5 py-0.5"
            />
          </div>
        )}

        {/* Page number (footer-specific, for starting page num) */}
        {!isHeader && (
          <div className="col-span-2 flex items-center gap-1">
            <label className="text-[10px] text-gray-500 whitespace-nowrap">Start page #</label>
            <input
              type="number"
              min={1}
              step={1}
              value={page}
              onChange={(e) => update('page', Math.max(1, Number(e.target.value) || 1))}
              className="w-14 text-[10px] rounded border border-gray-200 px-1 py-0.5 text-right"
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// CROP MODAL
// ═══════════════════════════════════════════════════════════════════════════

const CropModal = ({
  open,
  onClose,
  sourceFileId,
  documentId,
  onSaved,
}) => {
  // ── state ────────────────────────────────────────────────────────────
  const [regionType, setRegionType] = useState('both'); // 'header' | 'footer' | 'both'
  const [headerPts, setHeaderPts] = useState(DEFAULT_HEADER_PT);
  const [footerPts, setFooterPts] = useState(DEFAULT_FOOTER_PT);
  const [headerName, setHeaderName] = useState('');
  const [footerName, setFooterName] = useState('');
  const [pageInfo, setPageInfo] = useState(null); // { width, height } in pts
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState({ message: '', ok: true });

  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const [imgHeight, setImgHeight] = useState(0);

  const pageHeightPts = pageInfo?.height || 841.89;
  const scale = imgHeight > 0 ? imgHeight / pageHeightPts : 0;

  const showHeader = regionType === 'header' || regionType === 'both';
  const showFooter = regionType === 'footer' || regionType === 'both';

  const headerPx = Math.round(headerPts * scale);
  const footerPx = Math.round(footerPts * scale);

  const maxPts = Math.round(pageHeightPts * 0.45);
  const hasOverlap = showHeader && showFooter && (headerPx + footerPx > imgHeight - 30);

  // ── load preview on open ─────────────────────────────────────────────
  useEffect(() => {
    if (!open || !sourceFileId) return;
    let cancelled = false;

    const load = async () => {
      setPreviewLoading(true);
      setStatus({ message: '', ok: true });
      try {
        // Fetch page info
        const info = await exportSettingsService.getHfPdfPageInfo({ sourceFileId, page: 1 });
        if (cancelled) return;
        setPageInfo({ width: info.width || info.page_width, height: info.height || info.page_height });

        // Fetch preview image
        const blob = await exportSettingsService.getHfPdfPreview({ sourceFileId, page: 1, dpi: 150 });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch (err) {
        if (!cancelled) setStatus({ message: err?.response?.data?.detail || 'Failed to load preview', ok: false });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [open, sourceFileId]);

  // ── measure image after load ─────────────────────────────────────────
  const handleImageLoad = useCallback(() => {
    // Double requestAnimationFrame for accurate layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (imgRef.current) {
          setImgHeight(imgRef.current.clientHeight);
        }
      });
    });
  }, []);

  // ── resize handler ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (imgRef.current) setImgHeight(imgRef.current.clientHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  // ── escape key ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── cleanup blob URL ─────────────────────────────────────────────────
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // ── drag logic ───────────────────────────────────────────────────────
  const dragRef = useRef(null); // { type, startY, startVal }

  const onPointerDown = useCallback((type) => (e) => {
    e.preventDefault();
    const currentVal = type === 'header' ? headerPts : footerPts;
    dragRef.current = { type, startY: e.clientY, startVal: currentVal };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [headerPts, footerPts]);

  useEffect(() => {
    if (!open) return;

    const onMove = (e) => {
      if (!dragRef.current || scale === 0) return;
      const { type, startY, startVal } = dragRef.current;
      const dy = e.clientY - startY;
      const deltaPts = dy / scale;

      if (type === 'header') {
        setHeaderPts(clamp(Math.round(startVal + deltaPts), 0, maxPts));
      } else {
        setFooterPts(clamp(Math.round(startVal - deltaPts), 0, maxPts));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [open, scale, maxPts]);

  // ── auto-detect ──────────────────────────────────────────────────────
  const runAutoDetect = useCallback(async () => {
    if (!sourceFileId) return;
    setDetecting(true);
    setStatus({ message: '', ok: true });
    try {
      const result = await exportSettingsService.autoDetectHfPdf({ sourceFileId, page: 1 });
      if (result.header?.crop_height) setHeaderPts(Math.round(result.header.crop_height));
      if (result.footer?.crop_height) setFooterPts(Math.round(result.footer.crop_height));
      setStatus({ message: 'Auto-detected header & footer boundaries', ok: true });
    } catch (err) {
      setStatus({ message: err?.response?.data?.detail || 'Auto-detect failed', ok: false });
    } finally {
      setDetecting(false);
    }
  }, [sourceFileId]);

  // ── save & apply ─────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!sourceFileId || !documentId) return;
    setSaving(true);
    setStatus({ message: '', ok: true });

    try {
      const regions = [];
      if (showHeader) {
        regions.push({
          source_file_id: sourceFileId,
          region_type: 'header',
          name: headerName || 'Header',
          page: 1,
          crop_top_offset: 0,
          crop_height: headerPts,
        });
      }
      if (showFooter) {
        regions.push({
          source_file_id: sourceFileId,
          region_type: 'footer',
          name: footerName || 'Footer',
          page: 1,
          crop_top_offset: pageHeightPts - footerPts,
          crop_height: footerPts,
        });
      }

      // Create + apply each region
      for (const payload of regions) {
        const created = await exportSettingsService.createHfPdf(payload);
        await exportSettingsService.applyHfPdf(created.id, {
          documentId,
          showOnFirstPage: true,
        });
      }

      setStatus({ message: 'Saved & applied successfully!', ok: true });
      onSaved?.();
      setTimeout(() => onClose(), 600);
    } catch (err) {
      setStatus({ message: err?.response?.data?.detail || 'Save failed', ok: false });
    } finally {
      setSaving(false);
    }
  }, [sourceFileId, documentId, showHeader, showFooter, headerName, footerName, headerPts, footerPts, pageHeightPts, onSaved, onClose]);

  // ── render ───────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}>
      <div className="relative w-full max-w-4xl max-h-[95vh] bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        {/* ── Title bar ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2 text-white">
            <Scissors size={18} />
            <span className="text-sm font-semibold">Crop Header / Footer Region</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700" title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* ── Region type radios ────────────────────────────────────── */}
        <div className="flex items-center gap-4 px-5 py-2 bg-gray-800/50">
          {[
            { value: 'header', label: 'Header only' },
            { value: 'footer', label: 'Footer only' },
            { value: 'both', label: 'Both' },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
              <input
                type="radio"
                name="hfRegionType"
                value={opt.value}
                checked={regionType === opt.value}
                onChange={() => setRegionType(opt.value)}
                className="accent-sky-400"
              />
              {opt.label}
            </label>
          ))}
        </div>

        {/* ── Preview area ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-4">
          <div
            ref={containerRef}
            className="relative mx-auto bg-gray-800 rounded-lg overflow-hidden"
            style={{ maxWidth: 760, lineHeight: 0 }}
          >
            {/* Loading spinner */}
            {previewLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-900/80">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-500" />
              </div>
            )}

            {/* PDF preview image */}
            {previewUrl && (
              <img
                ref={imgRef}
                src={previewUrl}
                alt="PDF page 1 preview"
                onLoad={handleImageLoad}
                className="w-full h-auto select-none"
                draggable={false}
              />
            )}

            {/* ── Header overlay ───────────────────────────────────── */}
            {showHeader && imgHeight > 0 && (
              <>
                {/* Shaded zone */}
                <div
                  className="absolute inset-x-0 top-0 transition-[height] duration-[50ms] linear"
                  style={{
                    height: headerPx,
                    background: 'rgba(56,189,248,0.15)',
                  }}
                />
                {/* Draggable line */}
                <div
                  className="absolute inset-x-0 z-[6] transition-[top] duration-[50ms] linear"
                  style={{
                    top: headerPx - 1,
                    height: 3,
                    background: '#38bdf8',
                    boxShadow: '0 0 8px rgba(56,189,248,0.7)',
                  }}
                />
                {/* Label */}
                <div
                  className="absolute z-[7] left-3 text-[10px] font-semibold px-2 py-0.5 rounded select-none whitespace-nowrap transition-[top] duration-[50ms] linear"
                  style={{
                    top: headerPx + 4,
                    background: '#38bdf8',
                    color: '#0f172a',
                  }}
                >
                  HEADER ▼ {headerPts}pt
                </div>
                {/* Drag handle (invisible hit-area) */}
                <div
                  className="absolute inset-x-0 z-[12] cursor-row-resize"
                  style={{ top: headerPx - 14, height: 28 }}
                  onPointerDown={onPointerDown('header')}
                />
              </>
            )}

            {/* ── Footer overlay ───────────────────────────────────── */}
            {showFooter && imgHeight > 0 && (
              <>
                {/* Shaded zone */}
                <div
                  className="absolute inset-x-0 bottom-0 transition-[height] duration-[50ms] linear"
                  style={{
                    height: footerPx,
                    background: 'rgba(99,102,241,0.15)',
                  }}
                />
                {/* Line */}
                <div
                  className="absolute inset-x-0 z-[6] transition-[bottom] duration-[50ms] linear"
                  style={{
                    bottom: footerPx - 1,
                    height: 3,
                    background: '#6366f1',
                    boxShadow: '0 0 8px rgba(99,102,241,0.7)',
                  }}
                />
                {/* Label */}
                <div
                  className="absolute z-[7] left-3 text-[10px] font-semibold px-2 py-0.5 rounded select-none whitespace-nowrap text-white transition-[bottom] duration-[50ms] linear"
                  style={{
                    bottom: footerPx + 4,
                    background: '#6366f1',
                  }}
                >
                  ▲ FOOTER {footerPts}pt
                </div>
                {/* Drag handle */}
                <div
                  className="absolute inset-x-0 z-[12] cursor-row-resize"
                  style={{ bottom: footerPx - 14, height: 28 }}
                  onPointerDown={onPointerDown('footer')}
                />
              </>
            )}
          </div>

          {/* Overlap warning */}
          {hasOverlap && (
            <div className="flex items-center gap-2 mt-2 px-3 py-1.5 rounded bg-amber-900/50 text-amber-300 text-xs mx-auto max-w-[760px]">
              <AlertTriangle size={14} />
              Header and footer regions overlap — adjust before saving.
            </div>
          )}
        </div>

        {/* ── Controls area ─────────────────────────────────────────── */}
        <div className="border-t border-gray-700 px-5 py-3 space-y-3 bg-gray-800/50">

          {/* Sliders */}
          <div className="space-y-2">
            {showHeader && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-sky-400 font-medium w-28 shrink-0">⬒ Header height</span>
                <input
                  type="range"
                  min={0}
                  max={maxPts}
                  step={1}
                  value={headerPts}
                  onChange={(e) => setHeaderPts(Number(e.target.value))}
                  className="flex-1 accent-sky-400"
                />
                <input
                  type="number"
                  min={0}
                  max={maxPts}
                  value={headerPts}
                  onChange={(e) => setHeaderPts(clamp(Number(e.target.value) || 0, 0, maxPts))}
                  className="w-16 rounded border border-gray-600 bg-gray-700 text-white text-xs px-2 py-1 text-center"
                />
                <span className="text-[10px] text-gray-400">pt</span>
              </div>
            )}
            {showFooter && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-indigo-400 font-medium w-28 shrink-0">⬓ Footer height</span>
                <input
                  type="range"
                  min={0}
                  max={maxPts}
                  step={1}
                  value={footerPts}
                  onChange={(e) => setFooterPts(Number(e.target.value))}
                  className="flex-1 accent-indigo-400"
                />
                <input
                  type="number"
                  min={0}
                  max={maxPts}
                  value={footerPts}
                  onChange={(e) => setFooterPts(clamp(Number(e.target.value) || 0, 0, maxPts))}
                  className="w-16 rounded border border-gray-600 bg-gray-700 text-white text-xs px-2 py-1 text-center"
                />
                <span className="text-[10px] text-gray-400">pt</span>
              </div>
            )}
          </div>

          {/* Name inputs */}
          <div className="flex items-center gap-3">
            {showHeader && (
              <div className="flex-1">
                <label className="text-[10px] text-gray-400 block mb-0.5">Header name</label>
                <input
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="e.g. Corporate Header"
                  className="w-full rounded border border-gray-600 bg-gray-700 text-white text-xs px-2 py-1.5"
                />
              </div>
            )}
            {showFooter && (
              <div className="flex-1">
                <label className="text-[10px] text-gray-400 block mb-0.5">Footer name</label>
                <input
                  value={footerName}
                  onChange={(e) => setFooterName(e.target.value)}
                  placeholder="e.g. Corporate Footer"
                  className="w-full rounded border border-gray-600 bg-gray-700 text-white text-xs px-2 py-1.5"
                />
              </div>
            )}
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between gap-2">
            <StatusMessage message={status.message} ok={status.ok} />
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={runAutoDetect}
                disabled={detecting || !sourceFileId}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
              >
                <Search size={13} />
                {detecting ? 'Detecting…' : 'Auto-Detect'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || hasOverlap}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Save size={13} />
                {saving ? 'Saving…' : 'Save & Apply'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY PANEL
// ═══════════════════════════════════════════════════════════════════════════

const LibraryPanel = ({ documentId, onApplied, filterType }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(null);

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await exportSettingsService.getHfPdfLibrary();
      setItems(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLibrary(); }, [fetchLibrary]);

  // Filter by region type when showOnly is set
  const filteredItems = useMemo(() => {
    if (!filterType) return items;
    return items.filter((item) => item.region_type === filterType);
  }, [items, filterType]);

  const handleApply = useCallback(async (item) => {
    if (!documentId) return;
    setApplying(item.id);
    try {
      await exportSettingsService.applyHfPdf(item.id, { documentId, showOnFirstPage: true });
      onApplied?.();
    } catch {
      // silent
    } finally {
      setApplying(null);
    }
  }, [documentId, onApplied]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <BookOpen size={14} className="text-indigo-500" />
          My Header/Footer Library
        </div>
        <button
          type="button"
          onClick={fetchLibrary}
          disabled={loading}
          className="text-[10px] text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic py-2">No saved crops yet.</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-700 truncate">
                  {item.name || (item.region_type === 'header' ? 'Header' : item.region_type === 'footer' ? 'Footer' : 'Unnamed')}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium capitalize ${
                    item.region_type === 'header'
                      ? 'bg-sky-50 text-sky-600'
                      : 'bg-indigo-50 text-indigo-600'
                  }`}>
                    {item.region_type === 'header' ? 'Header' : item.region_type === 'footer' ? 'Footer' : item.region_type}
                  </span>
                  <span>{item.crop_height}pt</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleApply(item)}
                disabled={applying === item.id}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded border border-blue-200 hover:bg-blue-50 disabled:opacity-50"
              >
                {applying === item.id ? '…' : 'Apply'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT – HeaderFooterCropEditor
// ═══════════════════════════════════════════════════════════════════════════

const HeaderFooterCropEditor = ({
  documentId,
  pdfFiles = [],
  headerPdfConfig,
  footerPdfConfig,
  onSaveHeaderFooterPdf,
  onRemoveHeaderFooterPdf,
  onUploadPdfFile,
  onRefreshPreview,
  showOnly, // 'header' | 'footer' | undefined (show both)
}) => {
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ message: '', ok: true });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const normalizedFiles = useMemo(() => {
    if (Array.isArray(pdfFiles)) return pdfFiles;
    if (pdfFiles?.results) return pdfFiles.results;
    return [];
  }, [pdfFiles]);

  // Auto-select first available file
  useEffect(() => {
    if (!selectedSourceId && normalizedFiles.length > 0) {
      setSelectedSourceId(normalizedFiles[0].id);
    }
  }, [selectedSourceId, normalizedFiles]);

  // ── upload handler ───────────────────────────────────────────────────
  const handleUpload = useCallback(async (file) => {
    if (!file || !onUploadPdfFile) return;
    setUploading(true);
    setUploadStatus({ message: '', ok: true });
    try {
      const uploaded = await onUploadPdfFile(file);
      if (uploaded?.id) {
        setSelectedSourceId(uploaded.id);
        setUploadStatus({ message: `Uploaded: ${file.name}`, ok: true });
      }
    } catch (err) {
      setUploadStatus({ message: err?.message || 'Upload failed', ok: false });
    } finally {
      setUploading(false);
    }
  }, [onUploadPdfFile]);

  // ── open crop modal + optional auto-detect ───────────────────────────
  const openCropEditor = useCallback(() => {
    if (!selectedSourceId) return;
    setCropModalOpen(true);
  }, [selectedSourceId]);

  const openAutoDetect = useCallback(() => {
    if (!selectedSourceId) return;
    setCropModalOpen(true);
    // Auto-detect is triggered inside the modal when it opens
  }, [selectedSourceId]);

  // ── after save ───────────────────────────────────────────────────────
  const handleCropSaved = useCallback(() => {
    onRefreshPreview?.();
  }, [onRefreshPreview]);

  // Determine if the relevant type already has an active config
  const hasActiveConfig = useMemo(() => {
    if (showOnly === 'header') return !!headerPdfConfig?.file_id;
    if (showOnly === 'footer') return !!footerPdfConfig?.file_id;
    return !!(headerPdfConfig?.file_id && footerPdfConfig?.file_id);
  }, [showOnly, headerPdfConfig, footerPdfConfig]);

  return (
    <>
      {/* ── Panel Card ─────────────────────────────────────────────── */}
      <div className="space-y-3">

        {/* Active indicators (always visible when config exists) */}
        {(!showOnly || showOnly === 'header') && headerPdfConfig?.file_id && (
          <ActiveIndicator
            type="header"
            config={headerPdfConfig}
            onConfigChange={(cfg) => onSaveHeaderFooterPdf?.('header', cfg)}
            onRemove={() => onRemoveHeaderFooterPdf?.('header')}
          />
        )}
        {(!showOnly || showOnly === 'footer') && footerPdfConfig?.file_id && (
          <ActiveIndicator
            type="footer"
            config={footerPdfConfig}
            onConfigChange={(cfg) => onSaveHeaderFooterPdf?.('footer', cfg)}
            onRemove={() => onRemoveHeaderFooterPdf?.('footer')}
          />
        )}

        {/* Source PDF selection + crop actions — only when no active config for the current type */}
        {!hasActiveConfig && (
          <>
            <div className="space-y-2">
              <label className="text-[11px] text-gray-500">Source PDF</label>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs"
              >
                <option value="">Select a PDF…</option>
                {normalizedFiles.map((f) => (
                  <option key={f.id} value={f.id}>{f.name || f.filename || f.id}</option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Upload size={11} />
                  {uploading ? '…' : 'Choose file'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                    e.target.value = '';
                  }}
                />
              </div>
              <StatusMessage message={uploadStatus.message} ok={uploadStatus.ok} />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openCropEditor}
                disabled={!selectedSourceId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Scissors size={13} />
                Open Crop Editor
              </button>
              <button
                type="button"
                onClick={openAutoDetect}
                disabled={!selectedSourceId}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Search size={13} />
                Auto-Detect
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Library ────────────────────────────────────────────────── */}
      <LibraryPanel documentId={documentId} onApplied={handleCropSaved} filterType={showOnly} />

      {/* ── Crop Modal ─────────────────────────────────────────────── */}
      <CropModal
        open={cropModalOpen}
        onClose={() => setCropModalOpen(false)}
        sourceFileId={selectedSourceId}
        documentId={documentId}
        onSaved={handleCropSaved}
      />
    </>
  );
};

export default HeaderFooterCropEditor;
