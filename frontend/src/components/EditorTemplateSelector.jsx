import React, { useState } from 'react';
import { getAllEditorTemplates } from '../templates/editorTemplates';
import { Settings, Check } from 'lucide-react';

/**
 * EditorTemplateSelector Component
 * Allows users to choose complete editor template (controls everything)
 */
const EditorTemplateSelector = ({ currentTemplateId, onTemplateChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const templates = getAllEditorTemplates();
  const currentTemplate = templates.find(t => t.id === currentTemplateId) || templates[0];
  
  return (
    <div className="relative inline-block">
      {/* Editor Mode Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-lg hover:from-purple-600 hover:to-blue-600 transition-all shadow-md"
      >
        <Settings className="w-4 h-4" />
        <span className="text-sm font-semibold">{currentTemplate.name}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Menu */}
          <div className="absolute top-full left-0 mt-2 w-96 bg-white border border-gray-200 rounded-xl shadow-2xl z-20 overflow-hidden">
            <div className="bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide">
                Editor Templates
              </div>
              <div className="text-xs opacity-90 mt-0.5">
                Complete editor experience configuration
              </div>
            </div>
            
            <div className="p-2 max-h-[500px] overflow-y-auto">
              {templates.map((template) => {
                const isActive = template.id === currentTemplateId;
                
                return (
                  <button
                    key={template.id}
                    onClick={() => {
                      onTemplateChange(template.id);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-3 rounded-lg transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200'
                        : 'hover:bg-gray-50 border-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {isActive ? (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900">
                          {template.name}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          {template.description}
                        </div>
                        
                        {/* Template Features Preview */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {/* Editor Mode */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            {template.editor?.mode}
                          </span>
                          
                          {/* Page Size */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            {template.page?.defaultSize?.toUpperCase()}
                          </span>
                          
                          {/* Font */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                            {template.typography?.fonts?.paragraph?.family}
                          </span>
                          
                          {/* Features Count */}
                          {template.toolbar?.enabled && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                              {Object.values(template.toolbar.buttons || {}).filter(b => b.enabled).length} tools
                            </span>
                          )}
                          
                          {/* Sidebars Count */}
                          {template.sidebars?.enabled && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                              {Object.values(template.sidebars.panels || {}).filter(p => p.enabled).length} panels
                            </span>
                          )}
                          
                          {/* Special Features */}
                          {template.features?.collaboration?.realtime && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                              Realtime
                            </span>
                          )}
                          
                          {template.editor?.trackChanges && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                              Track Changes
                            </span>
                          )}
                          
                          {template.validation?.enabled && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                              Validation
                            </span>
                          )}
                        </div>
                        
                        {/* Key Settings */}
                        <div className="text-xs text-gray-500 mt-2 space-y-0.5">
                          <div>
                            Max Depth: {template.editor?.maxDepth || 'unlimited'} • 
                            Auto-save: {template.features?.autosave?.interval ? `${template.features.autosave.interval / 1000}s` : 'off'}
                          </div>
                          {template.typography?.numbering?.enabled && (
                            <div>
                              Numbering: {template.typography.numbering.style}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            
            <div className="border-t border-gray-200 px-4 py-2 bg-gray-50">
              <div className="text-xs text-gray-600">
                💡 Editor templates control toolbar, panels, features, styling, and behavior
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EditorTemplateSelector;
