import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

/**
 * InlineImageControls
 * Small overlay control panel for editing inline image marker props.
 *
 * Props:
 * - marker: parsed marker object from parseBackendImageMarkers()
 *   (should include .props and .altText)
 * - onApply: (updatedProps, updatedAlt) => void
 * - onCancel: () => void
 */
const InlineImageControls = ({ marker, onApply, onCancel }) => {
  const initialProps = marker?.props || {};
  const [align, setAlign] = useState(initialProps.align || 'inline');
  const [mode, setMode] = useState(initialProps.mode || 'max-width');
  const [maxw, setMaxw] = useState(initialProps.maxw || (initialProps.w || '')); // prefer maxw
  const [w, setW] = useState(initialProps.w || '');
  const [mt, setMt] = useState(initialProps.mt || '');
  const [mb, setMb] = useState(initialProps.mb || '');
  const [border, setBorder] = useState(initialProps.border === '1' || initialProps.border === 1);
  const [borderColor, setBorderColor] = useState(initialProps.borderColor || '#cccccc');
  const [caption, setCaption] = useState(marker?.altText || initialProps.caption || '');

  useEffect(() => {
    // keep local state in sync if marker changes
    const p = marker?.props || {};
    setAlign(p.align || 'inline');
    setMode(p.mode || 'max-width');
    setMaxw(p.maxw || p.w || '');
    setW(p.w || '');
    setMt(p.mt || '');
    setMb(p.mb || '');
    setBorder(p.border === '1' || p.border === 1);
    setBorderColor(p.borderColor || '#cccccc');
    setCaption(marker?.altText || p.caption || '');
  }, [marker]);

  const gatherProps = () => {
    const out = { ...marker.props };
    out.align = align;
    out.mode = mode;
    if (maxw) out.maxw = String(maxw);
    if (w) out.w = String(w);
    if (mt) out.mt = String(mt);
    if (mb) out.mb = String(mb);
    out.border = border ? '1' : '0';
    out.borderColor = borderColor;
    if (caption) out.caption = caption;
    else delete out.caption;
    return out;
  };

  const handleApply = () => {
    const props = gatherProps();
    onApply(props, caption || '');
  };

  return (
    <div className="inline-image-controls p-2 bg-white border border-gray-200 rounded shadow-md w-72 text-sm">
      <div className="flex items-center justify-between mb-2">
        <strong className="text-xs">Image</strong>
        <div className="flex gap-1">
          <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
        </div>
      </div>

      <label className="block text-xs text-gray-600">Align</label>
      <select value={align} onChange={e => setAlign(e.target.value)} className="w-full mb-2 text-sm">
        <option value="inline">inline</option>
        <option value="left">left</option>
        <option value="center">center</option>
        <option value="right">right</option>
        <option value="float-left">float-left</option>
        <option value="float-right">float-right</option>
      </select>

      <label className="block text-xs text-gray-600">Size mode</label>
      <select value={mode} onChange={e => setMode(e.target.value)} className="w-full mb-2 text-sm">
        <option value="original">original</option>
        <option value="percent">percent</option>
        <option value="fixed">fixed</option>
        <option value="max-width">max-width</option>
        <option value="cover">cover</option>
        <option value="contain">contain</option>
      </select>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-xs text-gray-600">Max W (px)</label>
          <input value={maxw} onChange={e => setMaxw(e.target.value)} className="w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">W (px)</label>
          <input value={w} onChange={e => setW(e.target.value)} className="w-full text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="block text-xs text-gray-600">MT</label>
          <input value={mt} onChange={e => setMt(e.target.value)} className="w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">MB</label>
          <input value={mb} onChange={e => setMb(e.target.value)} className="w-full text-sm" />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <input id="borderToggle" type="checkbox" checked={border} onChange={e => setBorder(e.target.checked)} />
        <label htmlFor="borderToggle" className="text-xs text-gray-600">Border</label>
        <input value={borderColor} onChange={e => setBorderColor(e.target.value)} className="ml-2 text-sm" type="color" />
      </div>

      <label className="block text-xs text-gray-600">Caption / alt</label>
      <input value={caption} onChange={e => setCaption(e.target.value)} className="w-full mb-2 text-sm" />

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-2 py-1 text-xs border rounded">Cancel</button>
        <button onClick={handleApply} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Apply</button>
      </div>
    </div>
  );
};

InlineImageControls.propTypes = {
  marker: PropTypes.object,
  onApply: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired
};

export default InlineImageControls;
