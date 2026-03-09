import React, { useMemo, useState, useEffect } from 'react';
import { X, Eye, EyeOff, Image as ImageIcon } from 'lucide-react';
import ImageAlignmentToolbar from './ImageAlignmentToolbar';

/** Map size_mode presets to slider percentage values */
const SIZE_MODE_TO_PERCENT = {
  small: 25,
  medium: 50,
  large: 75,
  full: 100,
  original: 100,
};

/** Reverse-map: find the closest preset for a percentage, or 'custom' */
const percentToSizeMode = (pct) => {
  if (pct === 25) return 'small';
  if (pct === 50) return 'medium';
  if (pct === 75) return 'large';
  if (pct === 100) return 'full';
  return 'custom';
};

const FloatingImageToolbar = ({
  isOpen,
  anchorRect,
  image,
  onUpdate,
  onDraftChange,
  onApply,
  onClose,
}) => {
  const positionStyle = useMemo(() => {
    if (!anchorRect) return { top: 96, left: 24 };
    const top = Math.max(12, anchorRect.top - 68 + window.scrollY);
    const left = Math.max(12, anchorRect.left + window.scrollX);
    return { top, left };
  }, [anchorRect]);

  const [draft, setDraft] = useState(image);

  useEffect(() => {
    setDraft(image);
  }, [image]);

  const handleDraftChange = (patch) => {
    const next = { ...(draft || {}), ...patch };
    setDraft(next);
    onDraftChange?.(patch);
    onUpdate?.(patch);
  };

  /** Derive current width % from draft — prefer custom_width_percent, fallback to size_mode preset */
  const currentWidthPercent = useMemo(() => {
    if (draft?.custom_width_percent) return draft.custom_width_percent;
    return SIZE_MODE_TO_PERCENT[draft?.size_mode] || 50;
  }, [draft?.custom_width_percent, draft?.size_mode]);

  const handleSizeSlider = (value) => {
    const pct = Number(value);
    const mode = percentToSizeMode(pct);
    handleDraftChange({
      custom_width_percent: pct,
      size_mode: mode,
    });
  };

  if (!isOpen || !image) return null;

  return (
    <div
      className="fixed z-50"
      style={{ top: positionStyle.top, left: positionStyle.left }}
    >
      <div className="bg-white border border-gray-200 rounded-lg shadow-xl px-3 py-2 min-w-[340px] max-w-[400px]">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon size={16} className="text-blue-600" />
          <span className="text-xs font-semibold text-gray-700">Image settings</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1 rounded hover:bg-gray-100 text-gray-600"
            title="Close toolbar"
          >
            <X size={14} />
          </button>
        </div>

        {/* Row 1: Alignment + Visibility */}
        <div className="flex items-start gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase text-gray-400">Alignment</span>
            <ImageAlignmentToolbar
              currentAlignment={draft?.alignment || 'center'}
              onAlignmentChange={(alignment) => handleDraftChange({ alignment })}
              className="bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase text-gray-400">Visibility</span>
            <button
              type="button"
              onClick={() => handleDraftChange({ is_visible: !(draft?.is_visible ?? true) })}
              className="flex items-center gap-1 text-xs px-2 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              {(draft?.is_visible ?? true) ? <Eye size={14} /> : <EyeOff size={14} />}
              {(draft?.is_visible ?? true) ? 'Visible' : 'Hidden'}
            </button>
          </div>
        </div>

        {/* Row 2: Size slider */}
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase text-gray-400">Size</span>
            <span className="text-[11px] font-medium text-gray-600">{currentWidthPercent}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={currentWidthPercent}
            onChange={(e) => handleSizeSlider(e.target.value)}
            className="w-full h-1.5 accent-blue-600 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>10%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Row 3: Caption + Figure number toggles */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleDraftChange({ show_caption: !(draft?.show_caption ?? true) })}
            className={`text-xs px-2 py-1 border rounded-md hover:bg-gray-50 ${
              (draft?.show_caption ?? true) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
            }`}
          >
            {(draft?.show_caption ?? true) ? '✓ Caption' : 'Caption'}
          </button>
          <button
            type="button"
            onClick={() => handleDraftChange({ show_figure_number: !(draft?.show_figure_number ?? false) })}
            className={`text-xs px-2 py-1 border rounded-md hover:bg-gray-50 ${
              (draft?.show_figure_number ?? false) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
            }`}
          >
            {(draft?.show_figure_number ?? false) ? '✓ Figure #' : 'Figure #'}
          </button>
        </div>

        {/* Row 4: Caption text + Figure number input (shown conditionally) */}
        <div className="mt-2 flex flex-col gap-2 text-xs">
          {(draft?.show_caption ?? true) && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase text-gray-400">Caption text</span>
              <textarea
                rows={2}
                value={draft?.caption || ''}
                onChange={(e) => handleDraftChange({ caption: e.target.value })}
                placeholder="Enter image caption…"
                className="border border-gray-200 rounded-md px-2 py-1 text-xs resize-none"
              />
            </div>
          )}
          {(draft?.show_figure_number ?? false) && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase text-gray-400">Figure number</span>
              <input
                type="text"
                value={draft?.figure_number || ''}
                onChange={(e) => handleDraftChange({ figure_number: e.target.value })}
                placeholder="e.g. 1, 2a, A-1"
                className="border border-gray-200 rounded-md px-2 py-1"
              />
            </div>
          )}
        </div>

        {/* Apply button */}
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            onClick={() => onApply?.(draft)}
            className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            Apply & Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default FloatingImageToolbar;
