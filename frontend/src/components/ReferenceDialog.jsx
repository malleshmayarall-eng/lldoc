import React, { useState, useEffect } from 'react';
import { X, Search, Link2, FileText, Hash, Paperclip, Loader2, Building2, Users } from 'lucide-react';
import { inlineReferenceService } from '../services';

/**
 * ReferenceDialog - Add cross-references between sections
 * Allows users to create clickable references to other sections
 * Now supports searching across ALL accessible documents (organization/team/shared)
 */
const ReferenceDialog = ({
  isOpen,
  onClose,
  sourceSection,
  availableSections = [],
  availableParagraphs = [],
  onAddReference,
  selectedText = ''
}) => {
  const [referenceType, setReferenceType] = useState('section');
  const [target, setTarget] = useState(null); // { type, id, data }
  const [referenceStyle, setReferenceStyle] = useState('inline');
  const [customText, setCustomText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      // Reset state when dialog opens
      setTarget(null);
      setCustomText('');
      setSearchQuery('');
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
    }
  }, [isOpen]);

  // Search for references across all accessible documents
  useEffect(() => {
    const performSearch = async () => {
      if (!searchQuery || searchQuery.trim().length < 2) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError(null);

      try {
        const results = await inlineReferenceService.searchTargets(searchQuery, {
          limit: 20,
          types: referenceType === 'section' ? 'section' : 'paragraph'
        });
        
        // Transform results to match the expected format
        const formattedResults = (results?.results || results || []).map(item => ({
          type: item.type || referenceType,
          id: item.id,
          title: item.title || item.content_text?.substring(0, 100),
          numbering: item.numbering || item.custom_metadata?.numbering,
          paragraphText: item.content_text?.slice(0, 120),
          document_title: item.document_title || item.document?.title,
          document_id: item.document_id || item.document?.id,
          access_type: item.access_type, // 'owner', 'organization', 'team', 'shared'
          data: item,
        }));

        setSearchResults(formattedResults);
      } catch (err) {
        console.error('Search error:', err);
        setSearchError(err?.message || 'Failed to search references');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    };

    // Debounce search
    const timeoutId = setTimeout(performSearch, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, referenceType]);

  useEffect(() => {
    // Auto-generate reference text when target changes
    if (target) {
      generateReferenceText(target);
    }
  }, [target, referenceStyle, referenceType]);

  if (!isOpen) return null;

  const referenceTypes = [
    { value: 'section', label: 'Section', icon: FileText },
    { value: 'paragraph', label: 'Paragraph', icon: Hash },
    { value: 'definition', label: 'Definition', icon: Link2 },
    { value: 'exhibit', label: 'Exhibit', icon: Paperclip }
  ];

  const referenceStyles = [
    { value: 'inline', label: 'Inline', example: 'See Section 2.3' },
    { value: 'parenthetical', label: 'Parenthetical', example: '(Section 2.3)' },
    { value: 'footnote', label: 'Footnote', example: '¹' },
    { value: 'superscript', label: 'Superscript', example: '²' }
  ];

  const generateReferenceText = (tgt) => {
    if (!tgt) return '';
    const isParagraph = tgt.type === 'paragraph';
    const numbering = tgt.data?.custom_metadata?.numbering || tgt.data?.numbering || tgt.numbering || tgt.data?.id;
    const docTitle = tgt.document_title || tgt.data?.document_title;

    let text = '';
    switch (referenceStyle) {
      case 'inline':
        text = isParagraph 
          ? `See paragraph ${numbering}${docTitle ? ` in ${docTitle}` : ''}` 
          : `See Section ${numbering}${docTitle ? ` in ${docTitle}` : ''}`;
        break;
      case 'parenthetical':
        text = isParagraph 
          ? `(paragraph ${numbering}${docTitle ? `, ${docTitle}` : ''})` 
          : `(Section ${numbering}${docTitle ? `, ${docTitle}` : ''})`;
        break;
      case 'footnote':
        text = `¹`; // Would be auto-numbered in practice
        break;
      case 'superscript':
        text = `²`; // Would be auto-numbered in practice
        break;
    }

    setCustomText(text);
    return text;
  };

  // Get access type badge
  const getAccessBadge = (accessType) => {
    switch (accessType) {
      case 'owner':
        return { icon: Users, label: 'Your Document', className: 'bg-blue-100 text-blue-700' };
      case 'organization':
        return { icon: Building2, label: 'Organization', className: 'bg-purple-100 text-purple-700' };
      case 'team':
        return { icon: Users, label: 'Team', className: 'bg-green-100 text-green-700' };
      case 'shared':
        return { icon: Users, label: 'Shared', className: 'bg-yellow-100 text-yellow-700' };
      default:
        return null;
    }
  };

  const handleAddReference = () => {
    if (!target) return;
    const { type, data } = target;

    const textValue = customText || generateReferenceText(target) || '';

    const reference = {
      id: `ref_${Date.now()}`,
      type,
      target_id: data.id,
      target_title: type === 'paragraph' ? (data.section_title || data.title || 'Paragraph') : data.title,
      target_numbering: data.custom_metadata?.numbering || data.numbering,
      target_document_id: target.document_id || data.document_id,
      target_document_title: target.document_title || data.document_title,
      text: textValue,
      style: referenceStyle,
      clickable: true,
      created_at: new Date().toISOString()
    };

    if (type === 'paragraph') {
      reference.target_section_id = data.section_id || data.section;
      reference.target_paragraph_number = data.custom_metadata?.numbering || data.numbering;
    }

    onAddReference(reference);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Add Cross-Reference</h3>
              <p className="text-sm text-gray-600">
                Search and link to sections across all your documents
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Selected Text (if any) */}
          {selectedText && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs text-gray-600 mb-1">Selected text:</p>
              <p className="text-sm text-gray-800 italic">"{selectedText}"</p>
            </div>
          )}

          {/* Reference Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reference Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {referenceTypes.map(type => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.value}
                    onClick={() => setReferenceType(type.value)}
                    className={`p-3 border rounded-lg flex items-center gap-2 transition-all ${
                      referenceType === type.value
                        ? 'border-blue-600 bg-blue-50 text-blue-600'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{type.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Search (sections + paragraphs) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Across All Documents
            </label>
            <div className="relative mb-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sections or paragraphs..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              {searching && (
                <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
              )}
            </div>
            
            <p className="text-xs text-gray-500 mb-2">
              Search includes documents you own, from your organization, team, or shared with you
            </p>

            {/* Search Results */}
            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
              {searchError && (
                <div className="p-4 text-sm text-red-600 bg-red-50">
                  {searchError}
                </div>
              )}

              {searching && (
                <div className="p-8 text-center">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 text-blue-600 animate-spin" />
                  <p className="text-sm text-gray-500">Searching...</p>
                </div>
              )}

              {!searching && !searchError && searchQuery && searchResults.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">
                  No matches found. Try a different search term.
                </p>
              )}

              {!searching && !searchError && !searchQuery && (
                <div className="p-8 text-center">
                  <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm text-gray-500 mb-1">Start typing to search</p>
                  <p className="text-xs text-gray-400">
                    Search for sections or paragraphs across all your documents
                  </p>
                </div>
              )}

              {!searching && !searchError && searchResults.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {searchResults.map(item => {
                    const isSelected = target?.id === item.id && target?.type === item.type;
                    const accessBadge = getAccessBadge(item.access_type);
                    const AccessIcon = accessBadge?.icon;

                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        onClick={() => setTarget({ 
                          type: item.type, 
                          id: item.id, 
                          data: item.data,
                          document_id: item.document_id,
                          document_title: item.document_title,
                          numbering: item.numbering
                        })}
                        className={`w-full text-left px-3 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3 ${
                          isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                        }`}
                      >
                        <div className="flex flex-col flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 capitalize font-medium">
                              {item.type}
                            </span>
                            {accessBadge && AccessIcon && (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 ${accessBadge.className}`}>
                                <AccessIcon className="w-3 h-3" />
                                {accessBadge.label}
                              </span>
                            )}
                          </div>
                          
                          {item.document_title && (
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {item.document_title}
                            </div>
                          )}
                          
                          <div className="font-medium text-sm text-gray-900 truncate">
                            {item.numbering && (
                              <span className="font-mono text-blue-600 mr-2">{item.numbering}</span>
                            )}
                            {item.title || 'Untitled'}
                          </div>
                          
                          {item.paragraphText && (
                            <span className="text-xs text-gray-500 line-clamp-2 mt-1">
                              {item.paragraphText}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Reference Style */}
          {target && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reference Style
              </label>
              <div className="space-y-2">
                {referenceStyles.map(style => (
                  <label
                    key={style.value}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                      referenceStyle === style.value
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="referenceStyle"
                      value={style.value}
                      checked={referenceStyle === style.value}
                      onChange={(e) => setReferenceStyle(e.target.value)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {style.label}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Example: <span className="font-mono">{style.example}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Custom Reference Text */}
          {target && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reference Text
              </label>
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Enter custom reference text..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                This text will appear in the document as the clickable reference
              </p>
            </div>
          )}

          {/* Preview */}
          {target && customText && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-600 font-semibold mb-2">PREVIEW</p>
              <p className="text-sm text-gray-800">
                ...the payment terms{' '}
                <span className="text-blue-600 underline cursor-pointer hover:text-blue-800">
                  {customText}
                </span>
                {' '}apply to all transactions...
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAddReference}
            disabled={!target || !customText}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Link2 className="w-4 h-4" />
            Insert Reference
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReferenceDialog;
