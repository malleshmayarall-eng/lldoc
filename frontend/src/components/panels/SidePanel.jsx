import { X } from 'lucide-react';

/**
 * Reusable Side Panel Component
 * Slides in from the right side
 */
const SidePanel = ({ 
  isOpen, 
  onClose, 
  title, 
  icon: Icon,
  children,
  width = 'md', // 'sm' | 'md' | 'lg' | 'xl'
}) => {
  const widthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className={`
        fixed right-0 top-0 bottom-0 bg-white shadow-2xl z-50
        ${widthClasses[width]} w-full
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            {Icon && <Icon className="w-5 h-5 text-gray-700" />}
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100vh-73px)]">
          {children}
        </div>
      </div>
    </>
  );
};

export default SidePanel;
