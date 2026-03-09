import React, { useRef } from 'react';

/**
 * ParagraphDropZone - Simple wrapper for paragraph content
 * 
 * Note: Inline image insertion has been disabled.
 * Images should only be added as block-level ImageComponent elements.
 */
const ParagraphDropZone = ({ 
  paragraph,
  onUpdate,  // Function to update paragraph content - takes (updates) as parameter
  children,
  className = '' 
}) => {
  const containerRef = useRef(null);

  const handleDragOver = (e) => {
    const isImageDrag = e.dataTransfer.types.includes('application/json') || e.dataTransfer.types.includes('Files');

    // Block image drops - images should only be added as block-level components
    if (isImageDrag) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'none'; // Show "not allowed" cursor
      return;
    }
    
    // Allow text drops to pass through
  };

  const handleDrop = (e) => {
    const isImageDrop = e.dataTransfer.types.includes('application/json') || e.dataTransfer.types.includes('Files');
    
    // Block image drops - images should only be added as block-level ImageComponent
    if (isImageDrop) {
      e.preventDefault();
      e.stopPropagation();
      console.log('� Image drop blocked - use block-level ImageComponent instead');
      return;
    }
    
    // Allow text drops to pass through
  };

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative ${className}`}
    >
      {/* Content */}
      {children}
    </div>
  );
};

export default ParagraphDropZone;
