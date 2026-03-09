import React from 'react';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

/**
 * ImageAlignmentToolbar - Simplified 3-option alignment (Word-style)
 * 
 * Only offers:
 * - Left: Image aligned to left edge
 * - Center: Image centered (default)
 * - Right: Image aligned to right edge
 * 
 * Removed: inline, float-left, float-right for simpler UX
 */

const ImageAlignmentToolbar = ({ 
  currentAlignment = 'center', 
  onAlignmentChange,
  className = ''
}) => {
  const alignments = [
    {
      value: 'left',
      label: 'Align Left',
      icon: AlignLeft,
      description: 'Align image to the left'
    },
    {
      value: 'center',
      label: 'Center',
      icon: AlignCenter,
      description: 'Center image (default)'
    },
    {
      value: 'right',
      label: 'Align Right',
      icon: AlignRight,
      description: 'Align image to the right'
    }
  ];

  const handleAlignmentClick = (value) => {
    if (onAlignmentChange) {
      onAlignmentChange(value);
    } else {
      console.error('❌ onAlignmentChange is not defined!');
    }
  };

  return (
    <div className={`image-alignment-toolbar flex items-center gap-1 ${className}`}>
      {alignments.map((alignment) => {
        const Icon = alignment.icon;
        const isActive = currentAlignment === alignment.value;
        
        return (
          <button
            key={alignment.value}
            onClick={() => handleAlignmentClick(alignment.value)}
            className={`
              alignment-button
              flex items-center justify-center
              w-8 h-8
              rounded
              border
              transition-all
              ${isActive 
                ? 'bg-blue-500 text-white border-blue-600 shadow-sm' 
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400'
              }
            `}
            title={alignment.description}
            aria-label={alignment.label}
          >
            <Icon size={16} strokeWidth={2} />
          </button>
        );
      })}
      
      {/* Alignment Label */}
      <span className="text-xs text-gray-600 ml-2 font-medium">
        {alignments.find(a => a.value === currentAlignment)?.label || 'Center'}
      </span>
    </div>
  );
};

export default ImageAlignmentToolbar;
