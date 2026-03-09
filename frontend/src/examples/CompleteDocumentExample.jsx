import React from 'react';
import { useCompleteDocument } from '../hooks/useCompleteDocument';
import { FileText, Loader2, RefreshCw } from 'lucide-react';

/**
 * Example component demonstrating Complete Document API usage
 * Shows how to use the useCompleteDocument hook for consistent state management
 */
const CompleteDocumentExample = ({ documentId }) => {
  // Use the Complete Document hook
  const {
    document,
    loading,
    error,
    stats,
    sections,
    allTables,
    allImageComponents,
    allFileComponents,
    comments,
    issues,
    attachments,
    refresh,
    getComponentsInSection,
    search,
    getSectionPath,
    isLoaded,
    hasError,
    isEmpty
  } = useCompleteDocument(documentId);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin" size={32} />
        <span className="ml-3 text-gray-600">Loading complete document...</span>
      </div>
    );
  }

  // Error state
  if (hasError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-semibold">Error Loading Document</h3>
        <p className="text-red-600">{error}</p>
        <button 
          onClick={refresh}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (isEmpty) {
    return (
      <div className="text-center p-8 text-gray-500">
        <FileText size={48} className="mx-auto mb-4" />
        <p>Document has no content</p>
      </div>
    );
  }

  // Render loaded document
  return (
    <div className="complete-document-example">
      {/* Header with stats */}
      <div className="bg-white border-b p-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{document.title}</h1>
            {document.author && (
              <p className="text-sm text-gray-600 mt-1">By {document.author}</p>
            )}
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {/* Statistics */}
        {stats && (
          <div className="flex flex-wrap gap-3 mt-4">
            {stats.sections_count > 0 && (
              <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                📄 {stats.sections_count} sections
              </div>
            )}
            {stats.paragraphs_count > 0 && (
              <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                📝 {stats.paragraphs_count} paragraphs
              </div>
            )}
            {stats.tables_count > 0 && (
              <div className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                📊 {stats.tables_count} tables
              </div>
            )}
            {stats.image_components_count > 0 && (
              <div className="px-3 py-1 bg-pink-100 text-pink-800 rounded-full text-sm">
                🖼️ {stats.image_components_count} images
              </div>
            )}
            {stats.file_components_count > 0 && (
              <div className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">
                📎 {stats.file_components_count} files
              </div>
            )}
            {comments && comments.length > 0 && (
              <div className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm">
                💬 {comments.length} comments
              </div>
            )}
            {issues && issues.length > 0 && (
              <div className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
                ⚠️ {issues.length} issues
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content sections */}
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-4">Document Structure</h2>
        
        {/* Render sections */}
        {sections.map((section) => (
          <SectionComponent
            key={section.id}
            section={section}
            getComponentsInSection={getComponentsInSection}
            getSectionPath={getSectionPath}
          />
        ))}
      </div>

      {/* Sidebar with additional info */}
      <aside className="bg-gray-50 border-t p-6">
        <h3 className="font-semibold mb-3">Document Insights</h3>
        
        {/* All tables */}
        {allTables.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">📊 Tables</h4>
            <ul className="space-y-1">
              {allTables.map((table) => (
                <li key={table.id} className="text-sm text-gray-600">
                  {table.title || 'Untitled Table'} ({table.num_rows} rows)
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* All images */}
        {allImageComponents.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">🖼️ Images</h4>
            <ul className="space-y-1">
              {allImageComponents.map((img) => (
                <li key={img.id} className="text-sm text-gray-600">
                  {img.caption || img.alt_text || 'Untitled Image'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* All file components */}
        {allFileComponents.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">📎 Files</h4>
            <ul className="space-y-1">
              {allFileComponents.map((file) => (
                <li key={file.id} className="text-sm text-gray-600">
                  {file.label || file.file_name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">📎 Attachments</h4>
            <ul className="space-y-1">
              {attachments.map((att) => (
                <li key={att.id} className="text-sm text-gray-600">
                  <a href={att.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {att.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
};

/**
 * Section component that renders all components in order
 */
const SectionComponent = ({ section, getComponentsInSection, getSectionPath }) => {
  const components = getComponentsInSection(section.id);
  const path = getSectionPath(section.id);

  return (
    <div className="mb-6 ml-4 border-l-2 border-gray-200 pl-4">
      {/* Breadcrumb */}
      <div className="text-xs text-gray-500 mb-1">
        {path.map((s, idx) => (
          <span key={s.id}>
            {idx > 0 && ' > '}
            {s.title}
          </span>
        ))}
      </div>

      <h3 className="text-lg font-semibold text-gray-800 mb-2">{section.title}</h3>

      {/* Render all components */}
      {components.map((comp, idx) => (
        <div key={idx} className="mb-3">
          {comp.type === 'paragraph' && (
            <p className="text-gray-700 leading-relaxed">
              {comp.data.content_text || comp.data.edited_text || comp.data.content}
            </p>
          )}
          {comp.type === 'table' && (
            <div className="bg-blue-50 p-2 rounded text-sm">
              📊 Table: {comp.data.title || 'Untitled'} ({comp.data.num_rows} rows, {comp.data.num_columns} cols)
            </div>
          )}
          {comp.type === 'image' && (
            <div className="bg-pink-50 p-2 rounded text-sm">
              🖼️ Image: {comp.data.caption || comp.data.alt_text || 'Untitled'}
            </div>
          )}
          {comp.type === 'file' && (
            <div className="bg-yellow-50 p-2 rounded text-sm">
              📎 File: {comp.data.label || comp.data.file_name}
            </div>
          )}
        </div>
      ))}

      {/* Render children sections */}
      {section.children?.map((child) => (
        <SectionComponent
          key={child.id}
          section={child}
          getComponentsInSection={getComponentsInSection}
          getSectionPath={getSectionPath}
        />
      ))}
    </div>
  );
};

export default CompleteDocumentExample;
