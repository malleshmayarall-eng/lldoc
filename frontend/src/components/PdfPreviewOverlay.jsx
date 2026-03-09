import React, { useState, useRef, useCallback, useEffect } from 'react';

/**
 * PdfPreviewOverlay – renders draggable horizontal lines on top of the
 * PDF preview iframe so users can visually see (and adjust) the applied
 * header / footer crop regions.
 *
 * Uses the same sky-400 / indigo-500 color scheme as the Crop Editor modal.
 *
 * Props
 * ─────
 * headerPdfConfig  – { file_id, height, … } | null
 * footerPdfConfig  – { file_id, height, … } | null
 * onSaveHeaderFooterPdf(type, config)
 * containerHeight  – current pixel height of the preview container
 */

const A4_HEIGHT_PT = 842;
const HEADER_DEFAULT_PT = 80;
const FOOTER_DEFAULT_PT = 60;
const LINE_HIT_ZONE = 12; // px either side of the line for grab cursor

const PdfPreviewOverlay = ({
  headerPdfConfig,
  footerPdfConfig,
  onSaveHeaderFooterPdf,
  containerHeight = 600,
}) => {
  // ── helpers ──────────────────────────────────────────────────────────
  const ptToPx = useCallback(
    (pt) => (pt / A4_HEIGHT_PT) * containerHeight,
    [containerHeight],
  );
  const pxToPt = useCallback(
    (px) => (px / containerHeight) * A4_HEIGHT_PT,
    [containerHeight],
  );

  // ── local pixel state (initialised from config) ─────────────────────
  const [headerPx, setHeaderPx] = useState(() =>
    ptToPx(headerPdfConfig?.height ?? HEADER_DEFAULT_PT),
  );
  const [footerPx, setFooterPx] = useState(() =>
    ptToPx(footerPdfConfig?.height ?? FOOTER_DEFAULT_PT),
  );

  // Sync when config changes externally
  useEffect(() => {
    setHeaderPx(ptToPx(headerPdfConfig?.height ?? HEADER_DEFAULT_PT));
  }, [headerPdfConfig?.height, ptToPx]);

  useEffect(() => {
    setFooterPx(ptToPx(footerPdfConfig?.height ?? FOOTER_DEFAULT_PT));
  }, [footerPdfConfig?.height, ptToPx]);

  // ── drag logic ──────────────────────────────────────────────────────
  const dragging = useRef(null);
  const overlayRef = useRef(null);

  const handlePointerDown = useCallback((type) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = type;
    overlayRef.current?.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handlePointerMove = useCallback(
    (e) => {
      if (!dragging.current) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (dragging.current === 'header') {
        const y = Math.max(0, Math.min(e.clientY - rect.top, containerHeight * 0.45));
        setHeaderPx(y);
      } else {
        const fromBottom = Math.max(0, Math.min(rect.bottom - e.clientY, containerHeight * 0.45));
        setFooterPx(fromBottom);
      }
    },
    [containerHeight],
  );

  const handlePointerUp = useCallback(
    (e) => {
      const type = dragging.current;
      if (!type) return;
      dragging.current = null;
      overlayRef.current?.releasePointerCapture(e.pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      if (type === 'header' && headerPdfConfig?.file_id) {
        const newPt = Math.round(pxToPt(headerPx));
        onSaveHeaderFooterPdf?.('header', { ...headerPdfConfig, height: newPt });
      }
      if (type === 'footer' && footerPdfConfig?.file_id) {
        const newPt = Math.round(pxToPt(footerPx));
        onSaveHeaderFooterPdf?.('footer', { ...footerPdfConfig, height: newPt });
      }
    },
    [headerPdfConfig, footerPdfConfig, headerPx, footerPx, pxToPt, onSaveHeaderFooterPdf],
  );

  const hasHeader = Boolean(headerPdfConfig?.file_id);
  const hasFooter = Boolean(footerPdfConfig?.file_id);

  if (!hasHeader && !hasFooter) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 pointer-events-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ touchAction: 'none' }}
    >
      {/* ── Header region ───────────────────────────────────────────── */}
      {hasHeader && (
        <>
          {/* Shaded overlay */}
          <div
            className="absolute inset-x-0 top-0 transition-[height] duration-75"
            style={{ height: headerPx, background: 'rgba(56,189,248,0.15)' }}
          />
          {/* Draggable line + handle */}
          <div
            className="absolute inset-x-0 pointer-events-auto cursor-row-resize group"
            style={{ top: headerPx - LINE_HIT_ZONE, height: LINE_HIT_ZONE * 2 }}
            onPointerDown={handlePointerDown('header')}
          >
            {/* Visible line with glow */}
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-px h-[3px] transition-all"
              style={{ background: '#38bdf8', boxShadow: '0 0 8px rgba(56,189,248,0.7)' }}
            >
              {/* Label pill */}
              <span
                className="absolute left-3 -top-5 select-none rounded px-1.5 py-0.5 text-[10px] font-semibold shadow whitespace-nowrap"
                style={{ background: '#38bdf8', color: '#0f172a' }}
              >
                HEADER ▼ {Math.round(pxToPt(headerPx))}pt
              </span>
              {/* Drag dots */}
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="w-1 h-1 rounded-full" style={{ background: '#0f172a' }} />
                <span className="w-1 h-1 rounded-full" style={{ background: '#0f172a' }} />
                <span className="w-1 h-1 rounded-full" style={{ background: '#0f172a' }} />
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Footer region ───────────────────────────────────────────── */}
      {hasFooter && (
        <>
          {/* Shaded overlay */}
          <div
            className="absolute inset-x-0 bottom-0 transition-[height] duration-75"
            style={{ height: footerPx, background: 'rgba(99,102,241,0.15)' }}
          />
          {/* Draggable line + handle */}
          <div
            className="absolute inset-x-0 pointer-events-auto cursor-row-resize group"
            style={{ bottom: footerPx - LINE_HIT_ZONE, height: LINE_HIT_ZONE * 2 }}
            onPointerDown={handlePointerDown('footer')}
          >
            {/* Visible line with glow */}
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-px h-[3px] transition-all"
              style={{ background: '#6366f1', boxShadow: '0 0 8px rgba(99,102,241,0.7)' }}
            >
              {/* Label pill */}
              <span
                className="absolute left-3 top-2 select-none rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow whitespace-nowrap"
                style={{ background: '#6366f1' }}
              >
                ▲ FOOTER {Math.round(pxToPt(footerPx))}pt
              </span>
              {/* Drag dots */}
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="w-1 h-1 rounded-full bg-white" />
                <span className="w-1 h-1 rounded-full bg-white" />
                <span className="w-1 h-1 rounded-full bg-white" />
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PdfPreviewOverlay;
