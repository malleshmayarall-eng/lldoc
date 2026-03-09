import React from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Type,
  PaintBucket,
  Droplet,
  Copy,
  ClipboardPaste,
} from 'lucide-react';

/**
 * RichTextToolbar - Inline formatting toolbar for paragraph editor
 * Supports bold/italic/underline, lists, text color, background color, opacity.
 */
const RichTextToolbar = ({
  onCommand,
  textColor = '#000000',
  backgroundColor = '#ffffff',
  opacity = 1,
  fontSize = 14,
}) => {
  const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36];

  const handleMouseDown = (event) => {
    const isButton = event.target.closest('button');
    if (!isButton) return;
    event.preventDefault();
  };

  return (
    <div
      className="inline-flex items-center gap-2 overflow-x-auto whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 shadow-sm"
      onMouseDown={handleMouseDown}
    >
      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Bold"
        onClick={() => onCommand('bold')}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Italic"
        onClick={() => onCommand('italic')}
      >
        <Italic size={14} />
      </button>
      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Underline"
        onClick={() => onCommand('underline')}
      >
        <Underline size={14} />
      </button>

      <span className="h-4 w-px bg-gray-200" />

      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Bulleted list"
        onClick={() => onCommand('unorderedList')}
      >
        <List size={14} />
      </button>
      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Numbered list"
        onClick={() => onCommand('orderedList')}
      >
        <ListOrdered size={14} />
      </button>

      <span className="h-4 w-px bg-gray-200" />

      <label className="flex items-center gap-1 text-xs text-gray-600">
        <Type size={14} />
        <select
          value={fontSize}
          onChange={(e) => onCommand('fontSize', Number(e.target.value))}
          className="h-7 rounded border border-gray-200 bg-white px-2 text-xs"
          title="Font size"
        >
          {fontSizes.map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </label>

      <span className="h-4 w-px bg-gray-200" />

      <label className="flex items-center gap-1 text-xs text-gray-600">
        <Type size={14} />
        <input
          type="color"
          value={textColor}
          onChange={(e) => onCommand('textColor', e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border border-gray-200"
          title="Text color"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-gray-600">
        <PaintBucket size={14} />
        <input
          type="color"
          value={backgroundColor}
          onChange={(e) => onCommand('backgroundColor', e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border border-gray-200"
          title="Background color"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-gray-600">
        <Droplet size={14} />
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          value={opacity}
          onChange={(e) => onCommand('opacity', Number(e.target.value))}
          className="w-20"
          title="Text opacity"
        />
        <span className="w-8 text-right">{opacity.toFixed(1)}</span>
      </label>

      <span className="h-4 w-px bg-gray-200" />

      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Copy"
        onClick={() => onCommand('copy')}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        className="p-1 text-gray-700 hover:bg-gray-100 rounded"
        title="Paste"
        onClick={() => onCommand('paste')}
      >
        <ClipboardPaste size={14} />
      </button>
    </div>
  );
};

export default RichTextToolbar;
