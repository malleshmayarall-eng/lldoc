import React, { useState, useEffect } from 'react';
import { X, FileText, Loader, AlertCircle } from 'lucide-react';
import { inlineReferenceService } from '../services';

/**
 * Simple Reference Content Modal
 * Shows the text content of a reference using the lightweight /text/ endpoint
 * Fast and efficient for quick preview/display
 */
const SimpleReferenceModal = ({ referenceId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);

  useEffect(() => {
    if (!referenceId) return;
    loadContent();
  }, [referenceId]);

  const loadContent = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('📖 Loading reference text for ID:', referenceId);
      
      const data = await inlineReferenceService.getReferenceText(referenceId);
      
      console.log('✅ Reference text loaded:', data);
      setContent(data);
      
    } catch (err) {
      console.error('❌ Error loading reference:', err);
      setError(err.response?.data?.error || err.message || 'Failed to load referenced content');
    } finally {
      setLoading(false);
    }
  };

  // Close on click outside
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Close on ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!referenceId) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">
              Referenced Content
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            title="Close (ESC)"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 text-blue-600 animate-spin" />
              <span className="ml-3 text-gray-600">Loading reference...</span>
            </div>
          )}

          {error && (
            <div className="flex items-start space-x-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div>
                <h3 className="font-medium text-red-900">Error</h3>
                <p className="text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {content && !loading && !error && (
            <div className="space-y-6">
              {/* Metadata */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Type:</span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium capitalize">
                    {content.type}
                  </span>
                </div>
                
                {content.title && (
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium text-gray-700">Title:</span>
                    <span className="text-sm text-gray-900 text-right flex-1 ml-4">
                      {content.title}
                    </span>
                  </div>
                )}
                
                {content.document_title && (
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium text-gray-700">Document:</span>
                    <span className="text-sm text-gray-600 text-right flex-1 ml-4">
                      {content.document_title}
                    </span>
                  </div>
                )}

                {content.display_text && (
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium text-gray-700">Reference:</span>
                    <span className="text-sm text-gray-600 text-right flex-1 ml-4 italic">
                      "{content.display_text}"
                    </span>
                  </div>
                )}
              </div>

              {/* Main Text Content */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Content</h3>
                
                {content.type === 'url' ? (
                  <div className="space-y-3">
                    <p className="text-gray-700">This reference points to an external URL:</p>
                    <a 
                      href={content.text} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-600 hover:text-blue-700 hover:underline font-medium"
                    >
                      {content.text}
                      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                ) : (
                  <div className="prose max-w-none">
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <pre className="whitespace-pre-wrap font-sans text-gray-800 leading-relaxed text-base">
                        {content.text}
                      </pre>
                    </div>
                  </div>
                )}
              </div>

              {/* Additional IDs for debugging/reference */}
              {(content.section_id || content.paragraph_id || content.reference_id) && (
                <div className="pt-4 border-t border-gray-200">
                  <details className="text-sm">
                    <summary className="cursor-pointer text-gray-600 hover:text-gray-900 select-none">
                      Technical Details
                    </summary>
                    <div className="mt-2 space-y-1 text-xs text-gray-500 font-mono bg-gray-50 p-3 rounded">
                      {content.reference_id && <div>Reference ID: {content.reference_id}</div>}
                      {content.section_id && <div>Section ID: {content.section_id}</div>}
                      {content.paragraph_id && <div>Paragraph ID: {content.paragraph_id}</div>}
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SimpleReferenceModal;
