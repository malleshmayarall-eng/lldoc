import React from 'react';

/**
 * Ribbon - Microsoft Word-like top toolbar with tabs
 * Props:
 * - tabs: [{ key, label }]
 * - activeTab: string
 * - onTabChange: (key) => void
 * - children: panel content rendered below the tab strip
 */
export default function Ribbon({ tabs = [], activeTab, onTabChange, children }) {
  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      {/* Tab strip */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center space-x-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onTabChange?.(t.key)}
              className={
                'px-4 py-3 text-sm font-medium rounded-t-lg transition-colors ' +
                (activeTab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Ribbon content area (panel under tabs) */}
      <div className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
