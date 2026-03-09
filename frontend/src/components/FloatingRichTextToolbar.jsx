import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import RichTextToolbar from './RichTextToolbar';

/**
 * FloatingRichTextToolbar - Single floating toolbar for rich text formatting
 * Mobile-friendly, closable, and draggable by handle.
 */
const FloatingRichTextToolbar = ({
  isOpen,
  onClose,
  onCommand,
  textColor,
  backgroundColor,
  opacity,
  fontSize,
  hasActiveEditor = false,
  topOffset = 96,
}) => {
  const toolbarRef = useRef(null);
  const handleRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: topOffset });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setPosition((prev) => ({ ...prev, y: topOffset }));
  }, [topOffset]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!isDragging) return;
      const maxX = window.innerWidth - (toolbarRef.current?.offsetWidth || 0);
      const maxY = window.innerHeight - (toolbarRef.current?.offsetHeight || 0);
      const nextX = Math.max(0, Math.min(event.clientX - dragOffset.x, maxX));
      const nextY = Math.max(0, Math.min(event.clientY - dragOffset.y, maxY));
      setPosition({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  useEffect(() => {
    const handleTouchMove = (event) => {
      if (!isDragging) return;
      const touch = event.touches[0];
      const maxX = window.innerWidth - (toolbarRef.current?.offsetWidth || 0);
      const maxY = window.innerHeight - (toolbarRef.current?.offsetHeight || 0);
      const nextX = Math.max(0, Math.min(touch.clientX - dragOffset.x, maxX));
      const nextY = Math.max(0, Math.min(touch.clientY - dragOffset.y, maxY));
      setPosition({ x: nextX, y: nextY });
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, dragOffset]);

  const startDrag = (event) => {
    if (!handleRef.current?.contains(event.target)) return;
    const rect = toolbarRef.current?.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0),
    });
  };

  const startTouchDrag = (event) => {
    if (!handleRef.current?.contains(event.target)) return;
    const touch = event.touches[0];
    const rect = toolbarRef.current?.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: touch.clientX - (rect?.left || 0),
      y: touch.clientY - (rect?.top || 0),
    });
  };

  if (!isOpen) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 px-4"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <div className="inline-block">
        <div
          className={`bg-white border border-gray-200 rounded-lg shadow-xl px-3 py-2 ${
            isDragging ? 'cursor-grabbing' : 'cursor-default'
          }`}
          onMouseDown={startDrag}
          onTouchStart={startTouchDrag}
        >
          <div className="flex items-stretch gap-2">
            <div className="flex items-center">
              <button
                type="button"
                onClick={onClose}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-gray-100 text-gray-600"
                title="Close toolbar"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center">
              <div className="flex justify-center w-full">
                <RichTextToolbar
                  onCommand={onCommand}
                  textColor={textColor}
                  backgroundColor={backgroundColor}
                  opacity={opacity}
                  fontSize={fontSize}
                />
              </div>
            </div>
            <div
              ref={handleRef}
              className="w-2 rounded bg-gray-200 hover:bg-gray-300 cursor-grab active:cursor-grabbing"
              title="Drag toolbar"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloatingRichTextToolbar;
