import React, { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link,
  Image,
  ChevronDown,
  Palette,
  Type,
  GripVertical,
  X,
  Minimize2,
  Maximize2,
  Settings
} from 'lucide-react';
import MetadataTableEditor from './MetadataTableEditor';

/**
 * TextFormatToolbar - Floating, draggable Microsoft Word-style formatting toolbar
 * Can be moved around the screen and minimized/maximized
 */
const TextFormatToolbar = ({
  selectedRange = null,
  currentFormatting = {},
  onApplyFormat,
  onInsertImage,
  onInsertLink,
  disabled = false,
  onClose,
  documentId = null
}) => {
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showMetadataSidebar, setShowMetadataSidebar] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState(() => {
    // Load saved position from localStorage or default to bottom center
    const saved = localStorage.getItem('textToolbarPosition');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      x: window.innerWidth / 2 - 400, // Center horizontally (assuming ~800px width)
      y: window.innerHeight - 120 // Bottom of screen
    };
  });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const toolbarRef = useRef(null);
  const dragHandleRef = useRef(null);
  
  const fonts = [
    'Arial',
    'Times New Roman',
    'Courier New',
    'Georgia',
    'Verdana',
    'Calibri',
    'Cambria',
    'Garamond'
  ];

  const fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  
  const colors = [
    '#000000', '#434343', '#666666', '#999999', '#CCCCCC',
    '#FF0000', '#FF9900', '#FFFF00', '#00FF00', '#00FFFF',
    '#0000FF', '#9900FF', '#FF00FF'
  ];

  // Save position to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('textToolbarPosition', JSON.stringify(position));
  }, [position]);

  // Handle drag start
  const handleMouseDown = (e) => {
    if (!dragHandleRef.current?.contains(e.target)) return;
    
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle dragging
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      
      // Keep toolbar within viewport bounds
      const maxX = window.innerWidth - (toolbarRef.current?.offsetWidth || 800);
      const maxY = window.innerHeight - (toolbarRef.current?.offsetHeight || 80);
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setShowFontPicker(false);
        setShowColorPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const applyStyle = (style) => {
    if (!selectedRange || disabled) return;
    
    onApplyFormat({
      type: 'style',
      style,
      range: selectedRange
    });
  };

  const applyAlignment = (alignment) => {
    if (disabled) return;
    
    onApplyFormat({
      type: 'alignment',
      alignment
    });
  };

  const applyFont = (fontFamily) => {
    if (disabled) return;
    
    onApplyFormat({
      type: 'font',
      fontFamily
    });
    setShowFontPicker(false);
  };

  const applyFontSize = (fontSize) => {
    if (disabled) return;
    
    onApplyFormat({
      type: 'fontSize',
      fontSize
    });
  };

  const applyColor = (color) => {
    if (!selectedRange || disabled) return;
    
    onApplyFormat({
      type: 'color',
      color,
      range: selectedRange
    });
    setShowColorPicker(false);
  };

  const applyList = (listType) => {
    if (disabled) return;
    
    onApplyFormat({
      type: 'list',
      listType
    });
  };

  const hasStyle = (style) => {
    if (!currentFormatting.styles) return false;
    return currentFormatting.styles.some(s => s.style === style);
  };

  const ToolbarButton = ({ icon: Icon, onClick, active, title, disabled: btnDisabled }) => (
    <button
      onClick={onClick}
      disabled={disabled || btnDisabled}
      title={title}
      className={`p-2 rounded transition-all ${
        active
          ? 'bg-blue-600 text-white'
          : disabled || btnDisabled
          ? 'text-gray-300 cursor-not-allowed'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  const Separator = () => <div className="w-px h-6 bg-gray-300 mx-1" />;

  return (
    <div
      ref={toolbarRef}
      onMouseDown={handleMouseDown}
      className={`text-format-toolbar fixed bg-white border-2 border-gray-300 rounded-lg shadow-2xl z-50 transition-opacity ${
        isDragging ? 'cursor-grabbing opacity-90' : 'cursor-default'
      }`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        maxWidth: '95vw'
      }}
    >
      {/* Drag Handle Header */}
      <div
        ref={dragHandleRef}
        className={`flex items-center justify-between px-3 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-md ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="w-4 h-4" />
          <span className="text-sm font-medium">Format Toolbar</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-blue-700 rounded transition-colors"
            title={isMinimized ? 'Maximize' : 'Minimize'}
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-red-500 rounded transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar Content */}
      {!isMinimized && (
        <div className="flex items-center gap-1 p-3 flex-wrap">
          {/* Font Family */}
          <div className="relative">
            <button
              onClick={() => setShowFontPicker(!showFontPicker)}
              disabled={disabled}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-2 min-w-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Type className="w-4 h-4" />
              <span className="flex-1 text-left truncate">
                {currentFormatting.font_family || 'Font'}
              </span>
              <ChevronDown className="w-3 h-3" />
            </button>
            
            {showFontPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                {fonts.map(font => (
                  <button
                    key={font}
                    onClick={() => applyFont(font)}
                    className="w-full px-4 py-2 text-left hover:bg-blue-50 text-sm whitespace-nowrap"
                    style={{ fontFamily: font }}
                  >
                    {font}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Font Size */}
          <select
            value={currentFormatting.font_size || 12}
            onChange={(e) => applyFontSize(Number(e.target.value))}
            disabled={disabled}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fontSizes.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>

          <Separator />

          {/* Text Styles */}
          <ToolbarButton
            icon={Bold}
            onClick={() => applyStyle('bold')}
            active={hasStyle('bold')}
            title="Bold (Ctrl+B)"
            btnDisabled={!selectedRange}
          />
          <ToolbarButton
            icon={Italic}
            onClick={() => applyStyle('italic')}
            active={hasStyle('italic')}
            title="Italic (Ctrl+I)"
            btnDisabled={!selectedRange}
          />
          <ToolbarButton
            icon={Underline}
            onClick={() => applyStyle('underline')}
            active={hasStyle('underline')}
            title="Underline (Ctrl+U)"
            btnDisabled={!selectedRange}
          />
          <ToolbarButton
            icon={Strikethrough}
            onClick={() => applyStyle('strikethrough')}
            active={hasStyle('strikethrough')}
            title="Strikethrough"
            btnDisabled={!selectedRange}
          />

          <Separator />

          {/* Text Color */}
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              disabled={disabled || !selectedRange}
              className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed relative"
              title="Text Color"
            >
              <Palette className="w-4 h-4 text-gray-700" />
              <div 
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-1 rounded"
                style={{ backgroundColor: currentFormatting.color || '#000000' }}
              />
            </button>
            
            {showColorPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2">
                <div className="grid grid-cols-5 gap-1">
                  {colors.map(color => (
                    <button
                      key={color}
                      onClick={() => applyColor(color)}
                      className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Alignment */}
          <ToolbarButton
            icon={AlignLeft}
            onClick={() => applyAlignment('left')}
            active={currentFormatting.alignment === 'left'}
            title="Align Left"
          />
          <ToolbarButton
            icon={AlignCenter}
            onClick={() => applyAlignment('center')}
            active={currentFormatting.alignment === 'center'}
            title="Align Center"
          />
          <ToolbarButton
            icon={AlignRight}
            onClick={() => applyAlignment('right')}
            active={currentFormatting.alignment === 'right'}
            title="Align Right"
          />
          <ToolbarButton
            icon={AlignJustify}
            onClick={() => applyAlignment('justify')}
            active={currentFormatting.alignment === 'justify'}
            title="Justify"
          />

          <Separator />

          {/* Lists */}
          <ToolbarButton
            icon={List}
            onClick={() => applyList('bullet')}
            active={currentFormatting.list?.type === 'bullet'}
            title="Bullet List"
          />
          <ToolbarButton
            icon={ListOrdered}
            onClick={() => applyList('numbered')}
            active={currentFormatting.list?.type === 'numbered'}
            title="Numbered List"
          />

          <Separator />

          {/* Insert Options */}
          <ToolbarButton
            icon={Link}
            onClick={onInsertLink}
            title="Insert Link"
          />
          <ToolbarButton
            icon={Image}
            onClick={onInsertImage}
            title="Insert Image"
          />

          <Separator />

          {/* Settings - Metadata */}
          {documentId && (
            <ToolbarButton
              icon={Settings}
              onClick={() => setShowMetadataSidebar(!showMetadataSidebar)}
              active={showMetadataSidebar}
              title="Document Metadata"
            />
          )}
        </div>
      )}

      {/* Minimized State - Just show a slim bar */}
      {isMinimized && (
        <div className="px-3 py-1 text-xs text-gray-500 text-center">
          Click maximize to show toolbar
        </div>
      )}

      {/* Metadata Sidebar */}
      {showMetadataSidebar && documentId && (
        <>
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-30 z-40"
            onClick={() => setShowMetadataSidebar(false)}
          />
          
          {/* Sidebar */}
          <div className="fixed top-0 right-0 h-full w-full md:w-[600px] bg-white shadow-2xl z-50 overflow-hidden flex flex-col animate-slide-in">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
              <div>
                <h2 className="text-xl font-bold">Document Metadata</h2>
                <p className="text-sm text-blue-100">View and edit metadata fields</p>
              </div>
              <button
                onClick={() => setShowMetadataSidebar(false)}
                className="p-2 hover:bg-blue-700 rounded-full transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto">
              <MetadataTableEditor
                documentId={documentId}
                onSave={(metadata) => {
                  console.log('Metadata saved:', metadata);
                  setShowMetadataSidebar(false);
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TextFormatToolbar;
