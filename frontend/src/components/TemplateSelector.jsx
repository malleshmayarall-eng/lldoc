import React, { useState } from 'react';
import { getAllTemplates } from '../templates/documentTemplates';
import { FileText, Check, ChevronDown } from 'lucide-react';

/**
 * TemplateSelector - Dropdown to select document display template
 * Controls fonts, spacing, dimensions, element visibility
 */
const TemplateSelector = ({ currentTemplateId, onTemplateChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const templates = getAllTemplates();
  const currentTemplate = templates.find(t => t.id === currentTemplateId) || templates[0];

  return (
    <div className="relative inline-block">
      {/* Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
      >
        <FileText className="w-4 h-4 text-gray-600" />
        <div className="flex flex-col items-start">
          <span className="text-xs text-gray-500">Template</span>
          <span className="text-sm font-semibold text-gray-900">{currentTemplate.name}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
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
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-3">
              <div className="text-sm font-bold">Document Templates</div>
              <div className="text-xs opacity-90 mt-0.5">
                Control fonts, spacing, layout, and element visibility
              </div>
            </div>

            {/* Template List */}
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {templates.map((template) => {
                const isActive = template.id === currentTemplateId;

                return (
                  <button
                    key={template.id}
                    onClick={() => {
                      onTemplateChange(template.id);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-all mb-2 ${
                      isActive
                        ? 'bg-blue-50 border-2 border-blue-500'
                        : 'hover:bg-gray-50 border-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Selection Indicator */}
                      <div className="flex-shrink-0 mt-1">
                        {isActive ? (
                          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                        )}
                      </div>

                      {/* Template Info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-gray-900">
                          {template.name}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {template.description}
                        </div>

                        {/* Template Features */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {/* Page Size */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                            {template.page.size.toUpperCase()}
                          </span>

                          {/* Font */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            {template.typography.fonts.body.split(',')[0].replace(/"/g, '')}
                          </span>

                          {/* Font Size */}
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            {template.typography.baseFontSize}px
                          </span>

                          {/* Numbering */}
                          {template.sections.showNumbering && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                              Numbered
                            </span>
                          )}

                          {/* Images */}
                          {template.images.enabled ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                              Images
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                              No Images
                            </span>
                          )}

                          {/* Headers/Footers */}
                          {template.header.enabled && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                              Header
                            </span>
                          )}
                        </div>

                        {/* Detailed Preview */}
                        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 space-y-1">
                          <div className="flex justify-between">
                            <span>Line Height:</span>
                            <span className="font-mono">{template.typography.baseLineHeight}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Margins:</span>
                            <span className="font-mono">
                              {template.page.margins.top}/{template.page.margins.right}/
                              {template.page.margins.bottom}/{template.page.margins.left}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Alignment:</span>
                            <span className="font-mono">{template.paragraphs.textAlign}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer Info */}
            <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
              <div className="text-xs text-gray-600">
                💡 Templates control all visual aspects including fonts, spacing, margins, 
                element visibility, and page layout. Changes apply immediately to the document.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TemplateSelector;
