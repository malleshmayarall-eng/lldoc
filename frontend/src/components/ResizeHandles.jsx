import React, { useState, useRef, useEffect } from 'react';

/**
 * ResizeHandles - Microsoft Word-style draggable resize handles
 * 
 * Features:
 * - 8 resize handles (4 corners + 4 edges)
 * - Smooth drag interaction with cursor feedback
 * - Aspect ratio preservation
 * - Real-time dimension preview
 * - Optimistic UI updates (no page refresh during drag)
 * - Enhanced visual feedback with blue handles
 */

const ResizeHandles = ({
  width,
  height,
  minWidth = 100,
  minHeight = 100,
  maxWidth = 1200,
  maintainAspectRatio = true,
  onResize,
  onResizeEnd,
  children,
  className = ''
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState(null);
  const [dimensions, setDimensions] = useState({ width, height });
  const [previewDimensions, setPreviewDimensions] = useState(null);
  
  const containerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startDimensionsRef = useRef({ width: 0, height: 0 });
  const aspectRatioRef = useRef(width / height);

  // Update dimensions when props change
  useEffect(() => {
    setDimensions({ width, height });
    aspectRatioRef.current = width / height;
  }, [width, height]);

  const handleMouseDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    setDragHandle(handle);
    
    startPosRef.current = { x: e.clientX, y: e.clientY };
    startDimensionsRef.current = { ...dimensions };
    
    // Add global event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isDragging && !dragHandle) return;

    const deltaX = e.clientX - startPosRef.current.x;
    const deltaY = e.clientY - startPosRef.current.y;
    
    let newWidth = startDimensionsRef.current.width;
    let newHeight = startDimensionsRef.current.height;

    // Calculate new dimensions based on which handle is being dragged
    switch (dragHandle) {
      case 'nw': // Top-left corner
        newWidth = startDimensionsRef.current.width - deltaX;
        newHeight = startDimensionsRef.current.height - deltaY;
        break;
      case 'n': // Top edge
        newHeight = startDimensionsRef.current.height - deltaY;
        if (maintainAspectRatio) {
          newWidth = newHeight * aspectRatioRef.current;
        }
        break;
      case 'ne': // Top-right corner
        newWidth = startDimensionsRef.current.width + deltaX;
        newHeight = startDimensionsRef.current.height - deltaY;
        break;
      case 'w': // Left edge
        newWidth = startDimensionsRef.current.width - deltaX;
        if (maintainAspectRatio) {
          newHeight = newWidth / aspectRatioRef.current;
        }
        break;
      case 'e': // Right edge
        newWidth = startDimensionsRef.current.width + deltaX;
        if (maintainAspectRatio) {
          newHeight = newWidth / aspectRatioRef.current;
        }
        break;
      case 'sw': // Bottom-left corner
        newWidth = startDimensionsRef.current.width - deltaX;
        newHeight = startDimensionsRef.current.height + deltaY;
        break;
      case 's': // Bottom edge
        newHeight = startDimensionsRef.current.height + deltaY;
        if (maintainAspectRatio) {
          newWidth = newHeight * aspectRatioRef.current;
        }
        break;
      case 'se': // Bottom-right corner
        newWidth = startDimensionsRef.current.width + deltaX;
        newHeight = startDimensionsRef.current.height + deltaY;
        break;
      default:
        return;
    }

    // Apply aspect ratio if maintaining
    if (maintainAspectRatio && ['nw', 'ne', 'sw', 'se'].includes(dragHandle)) {
      // For corners, use the larger dimension change to preserve aspect ratio
      const widthRatio = newWidth / startDimensionsRef.current.width;
      const heightRatio = newHeight / startDimensionsRef.current.height;
      const ratio = Math.max(Math.abs(widthRatio - 1), Math.abs(heightRatio - 1)) === Math.abs(widthRatio - 1) ? widthRatio : heightRatio;
      
      newWidth = startDimensionsRef.current.width * ratio;
      newHeight = startDimensionsRef.current.height * ratio;
    }

    // Constrain to min/max dimensions
    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    newHeight = Math.max(minHeight, newHeight);
    
    // Re-apply aspect ratio after constraints
    if (maintainAspectRatio) {
      newHeight = newWidth / aspectRatioRef.current;
    }

    // Round to whole pixels
    newWidth = Math.round(newWidth);
    newHeight = Math.round(newHeight);

    // Update preview dimensions
    setPreviewDimensions({ width: newWidth, height: newHeight });
    
    // Call onResize callback for real-time updates
    if (onResize) {
      onResize({ width: newWidth, height: newHeight });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragHandle(null);
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // Call onResizeEnd with final dimensions
    if (previewDimensions && onResizeEnd) {
      onResizeEnd(previewDimensions);
      setDimensions(previewDimensions);
    }
    
    setPreviewDimensions(null);
  };

  const currentDimensions = previewDimensions || dimensions;

  const handles = [
    { id: 'nw', cursor: 'nwse-resize', position: 'top-0 left-0' },
    { id: 'n', cursor: 'ns-resize', position: 'top-0 left-1/2 -translate-x-1/2' },
    { id: 'ne', cursor: 'nesw-resize', position: 'top-0 right-0' },
    { id: 'w', cursor: 'ew-resize', position: 'top-1/2 left-0 -translate-y-1/2' },
    { id: 'e', cursor: 'ew-resize', position: 'top-1/2 right-0 -translate-y-1/2' },
    { id: 'sw', cursor: 'nesw-resize', position: 'bottom-0 left-0' },
    { id: 's', cursor: 'ns-resize', position: 'bottom-0 left-1/2 -translate-x-1/2' },
    { id: 'se', cursor: 'nwse-resize', position: 'bottom-0 right-0' }
  ];

  return (
    <div
      ref={containerRef}
      className={`resize-container relative inline-block ${className}`}
      style={{
        width: `${currentDimensions.width}px`,
        height: `${currentDimensions.height}px`,
        transition: isDragging ? 'none' : 'all 0.2s ease',
        userSelect: isDragging ? 'none' : 'auto'
      }}
    >
      {/* Content */}
      <div className="w-full h-full">
        {children}
      </div>

      {/* Resize Handles */}
      <div className="resize-handles absolute inset-0 pointer-events-none">
        {handles.map((handle) => (
          <div
            key={handle.id}
            className={`
              resize-handle
              absolute
              ${handle.position}
              w-2.5 h-2.5
              bg-blue-500
              border border-white
              rounded-full
              shadow-md
              pointer-events-auto
              hover:w-3 hover:h-3
              hover:bg-blue-600
              hover:scale-125
              transition-all
              ${isDragging && dragHandle === handle.id ? 'w-3 h-3 bg-blue-600 scale-125' : ''}
              ${isDragging && dragHandle !== handle.id ? 'opacity-20' : 'opacity-90'}
            `}
            style={{
              cursor: handle.cursor,
              zIndex: 10
            }}
            onMouseDown={(e) => handleMouseDown(e, handle.id)}
          />
        ))}
      </div>

      {/* Dimension Preview Tooltip */}
      {isDragging && previewDimensions && (
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-10 
                     bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-md shadow-lg
                     whitespace-nowrap pointer-events-none z-20"
        >
          {previewDimensions.width} × {previewDimensions.height} px
        </div>
      )}

      {/* Resize Indicator Border */}
      {isDragging && (
        <div
          className="absolute inset-0 border-2 border-dashed border-blue-400 pointer-events-none rounded"
          style={{ zIndex: 5 }}
        />
      )}
    </div>
  );
};

export default ResizeHandles;
