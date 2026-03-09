import React, { useState, useEffect } from 'react';
import { X, Loader, FileText, ChevronRight } from 'lucide-react';
import { inlineReferenceService } from '../services';

/**
 * Reference Content Modal
 * Shows full content of a referenced section when user clicks a citation
 */
const ReferenceContentModal = ({ referenceId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);

  useEffect(() => {
    const loadContent = async () => {
      if (!referenceId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        console.log('📖 Loading referenced content:', referenceId);
        const data = await inlineReferenceService.getReferencedContent(referenceId);
        console.log('✅ Referenced content loaded:', data);
        setContent(data);
      } catch (err) {
        console.error('❌ Failed to load referenced content:', err);
        setError(err.response?.data?.detail || 'Failed to load content');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [referenceId]);

  if (!referenceId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div 
        className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
          <div className="flex items-center gap-3">
            <FileText className="text-blue-600" size={24} />
            <h2 className="text-xl font-semibold text-gray-900">Referenced Content</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader className="animate-spin text-blue-600 mb-4" size={48} />
              <p className="text-gray-600">Loading content...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="text-red-600 mt-0.5">⚠️</div>
                <div>
                  <h3 className="font-semibold text-red-900 mb-1">Error Loading Content</h3>
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {content && !loading && (
            <div className="space-y-6">
              {/* Document Info */}
              {content.document && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="text-xs text-blue-600 font-semibold uppercase tracking-wider mb-1">
                    Document
                  </div>
                  <div className="text-lg font-semibold text-blue-900">
                    {content.document.title}
                  </div>
                  {content.document.version && (
                    <div className="text-sm text-blue-700 mt-1">
                      Version {content.document.version}
                    </div>
                  )}
                </div>
              )}

              {/* Breadcrumb */}
              {content.breadcrumb && content.breadcrumb.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  {content.breadcrumb.map((crumb, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <ChevronRight size={14} className="text-gray-400" />}
                      <span className={idx === content.breadcrumb.length - 1 ? 'font-semibold text-gray-900' : ''}>
                        {crumb.title || crumb.section_type}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* Section Content */}
              {content.section && (
                <div className="border-l-4 border-blue-500 pl-6 py-2">
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">
                    {content.section.title}
                  </h3>
                  
                  {content.section.section_type && (
                    <div className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full mb-4">
                      {content.section.section_type}
                    </div>
                  )}

                  {/* Paragraphs */}
                  {content.paragraphs && content.paragraphs.length > 0 && (
                    <div className="space-y-4">
                      {content.paragraphs.map((para, idx) => (
                        <div key={para.id || idx} className="text-gray-800 leading-relaxed">
                          <p className="whitespace-pre-wrap">
                            {para.effective_content || para.content || para.content_text}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Subsections */}
                  {content.subsections && content.subsections.length > 0 && (
                    <div className="mt-6 space-y-4">
                      <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
                        Subsections
                      </h4>
                      {content.subsections.map((subsection, idx) => (
                        <div key={subsection.id || idx} className="border-l-2 border-gray-300 pl-4 py-2">
                          <h5 className="text-lg font-semibold text-gray-900 mb-2">
                            {subsection.title}
                          </h5>
                          {subsection.paragraphs && subsection.paragraphs.length > 0 && (
                            <div className="space-y-2">
                              {subsection.paragraphs.map((para, pIdx) => (
                                <p key={para.id || pIdx} className="text-gray-700 leading-relaxed text-sm">
                                  {para.effective_content || para.content || para.content_text}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Paragraph Content (if reference is to a single paragraph) */}
              {content.paragraph && !content.section && (
                <div className="border-l-4 border-green-500 pl-6 py-2">
                  <div className="text-xs text-green-600 font-semibold uppercase tracking-wider mb-2">
                    Paragraph
                  </div>
                  <p className="text-gray-800 leading-relaxed">
                    {content.paragraph.effective_content || content.paragraph.content || content.paragraph.content_text}
                  </p>
                </div>
              )}

              {/* Metadata */}
              {content.metadata && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    {content.metadata.reference_type && (
                      <div>
                        <span className="text-gray-500">Type:</span>
                        <span className="ml-2 font-medium text-gray-900">{content.metadata.reference_type}</span>
                      </div>
                    )}
                    {content.metadata.created_at && (
                      <div>
                        <span className="text-gray-500">Created:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {new Date(content.metadata.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReferenceContentModal;
