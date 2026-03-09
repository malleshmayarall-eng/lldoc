import React from 'react';
import { GripVertical } from 'lucide-react';
import { fixImageUrl } from '../utils/imageUtils';

/**
 * DraggableImageItem - Makes images draggable for inline insertion
 * Can be dragged from gallery into paragraph text
 */
const DraggableImageItem = ({ image, children, className = '', onSelect }) => {
  const handleDragStart = (e) => {
    // Store image data in drag event
    const imageUrl = image.url || image.image_url || image.image;
  const fullUrl = fixImageUrl(imageUrl);
    
    const imageData = {
      id: image.id,
      url: fullUrl,
      type: image.type || image.image_type,
      name: image.name || image.filename,
      width: image.width,
      height: image.height,
      scope: image.scope || 'user'
    };
    
    e.dataTransfer.setData('application/json', JSON.stringify(imageData));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Create drag image preview
    const dragImage = e.currentTarget.cloneNode(true);
    dragImage.style.opacity = '0.8';
    dragImage.style.transform = 'scale(1.1)';
    e.dataTransfer.setDragImage(dragImage, 50, 50);
  };

  const handleDragEnd = (e) => {
    // Clean up any drag state if needed
    e.currentTarget.style.opacity = '1';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onSelect?.(image)}
      className={`relative group cursor-move ${className}`}
      title="Drag to insert into paragraph text"
    >
      {/* Drag indicator */}
      <div className="absolute top-2 right-2 bg-blue-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <GripVertical size={16} />
      </div>
      
      {/* Content (image thumbnail, etc.) */}
      {children}
      
      {/* Drag overlay hint */}
      <div className="absolute inset-0 bg-blue-500 bg-opacity-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded" />
    </div>
  );
};

export default DraggableImageItem;
