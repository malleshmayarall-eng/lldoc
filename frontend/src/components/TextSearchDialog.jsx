import React, { useState, useEffect } from 'react';
import { X, Search, FileText } from 'lucide-react';
import { inlineReferenceService } from '../services';

/**
 * TextSearchDialog - Search and insert text from references
 * Allows users to search through document content and insert the actual text
 * (as opposed to inserting a reference marker)
 */
const TextSearchDialog = ({
  isOpen,
  onClose,
  onInsertText,
  documentId,
  position = { x: 0, y: 0 },
  onPositionChange
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Draggable dialog state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (isOpen) {
      // Reset state when dialog opens
      setSearchQuery('');
      setSearchResults([]);
      // Don't reset position - it persists now
    }
  }, [isOpen]);

  // Handle dialog dragging
  const handleMouseDown = (e) => {
    // Only start drag if clicking on the header area
    if (e.target.closest('.dialog-header') && !e.target.closest('button')) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const newPosition = {
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    };
    
    if (onPositionChange) {
      onPositionChange(newPosition);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart, position]);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const performSearch = async () => {
    try {
      setLoading(true);
      
      // Use the unified search API
      const response = await inlineReferenceService.searchTargets(searchQuery, {
        limit: 20
      });
      
      console.log('🔍 Search response:', response);
      
      // Handle both old and new API formats
      let results = [];
      if (response.results) {
        // New unified API format
        results = response.results;
      } else if (Array.isArray(response)) {
        // Old format (array of results)
        results = response;
      }
      
      setSearchResults(results || []);
      
    } catch (error) {
      console.error('❌ Search error:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchReferenceText = async (result) => {
    try {
      const refId = result.resource_id || result.reference_id || result.id;

      if (result.content && result.content.length > 0) {
        return result.content;
      }

      const data = await inlineReferenceService.getReferenceText(refId);
      return data?.text || '';
    } catch (error) {
      console.error('❌ Error fetching reference text:', error);
      return result.content || result.matched_content || '';
    }
  };

  const handleInsertResult = async (result) => {
    if (!result) return;
    const text = await fetchReferenceText(result);
    if (!text) return;
    onInsertText(text);
    onClose();
  };

  const handleDragStart = (e, text) => {
    // Set the text data for drag and drop
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copy';
    
    // Create a simple text-based drag image instead of the component
    const dragImage = document.createElement('div');
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.padding = '8px 12px';
    dragImage.style.background = '#7c3aed';
    dragImage.style.color = 'white';
    dragImage.style.borderRadius = '6px';
    dragImage.style.fontSize = '14px';
    dragImage.style.fontWeight = '500';
    dragImage.style.whiteSpace = 'nowrap';
    dragImage.style.maxWidth = '300px';
    dragImage.style.overflow = 'hidden';
    dragImage.style.textOverflow = 'ellipsis';
    dragImage.textContent = text.length > 50 ? text.substring(0, 50) + '...' : text;
    
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    
    // Clean up the drag image after a short delay
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
    
    console.log('🎯 Started dragging text:', text.substring(0, 50) + '...');
  };

  const handleDragEnd = (e) => {
    // No visual changes needed since we're using a custom drag image
    console.log('🎯 Drag ended');
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed top-24 right-6 z-50 w-96 max-w-[90vw]"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
      }}
    >
      <div className="bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
        <div
          className="dialog-header flex items-center justify-between px-4 py-3 border-b border-gray-200 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-purple-600 text-white text-xs">^</span>
            Search & Insert
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
            title="Close (ESC)"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sections, paragraphs, content..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              autoFocus
            />
          </div>
          {searchQuery.length > 0 && searchQuery.length < 2 && (
            <p className="text-xs text-gray-500 mt-2">Type at least 2 characters to search</p>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {loading && (
            <div className="text-center py-6 text-gray-500 text-sm">
              <Search className="w-6 h-6 animate-pulse mx-auto mb-2" />
              <p>Searching...</p>
            </div>
          )}

          {!loading && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm">
              <FileText className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p>No results found</p>
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700 mb-2">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
              </p>
              
              {searchResults.map((result, index) => {
                const previewText = result.matched_content || result.content || '';
                return (
                  <div
                    key={result.resource_id || result.id || index}
                    draggable={previewText.length > 0}
                    onDragStart={(e) => handleDragStart(e, previewText)}
                    onDragEnd={handleDragEnd}
                    className={`cursor-move ${previewText.length === 0 ? 'cursor-pointer' : ''}`}
                  >
                    <div className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-gray-50 transition-all">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            <h4 className="font-medium text-gray-900 text-sm line-clamp-1">
                              {result.title || 'Untitled'}
                            </h4>
                          </div>
                          {previewText && (
                            <p className="text-xs text-gray-600 line-clamp-2 ml-6">
                              {previewText.substring(0, 100)}...
                            </p>
                          )}
                          <div className="flex items-center space-x-2 mt-1 ml-6">
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                              {result.resource_type || result.type || 'section'}
                            </span>
                            {result.document_info?.title && (
                              <span className="text-xs text-gray-500 truncate">
                                {result.document_info.title}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleInsertResult(result)}
                          className="px-2 py-1 text-xs font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-md"
                        >
                          Insert
                        </button>
                      </div>
                    </div>
                    {previewText && (
                      <div className="text-[11px] text-purple-600 mt-1 ml-3 flex items-center">
                        <span className="opacity-75">↕️ Drag to insert</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && searchQuery.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">
              <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>Start typing to search</p>
              <p className="text-xs mt-1">Search through sections and paragraphs</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TextSearchDialog;
