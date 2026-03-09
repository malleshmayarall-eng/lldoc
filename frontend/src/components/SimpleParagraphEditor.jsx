import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GripVertical, Trash2, ChevronUp, ChevronDown, Table, History, Bot, MessageCircle, Network, Sparkles } from 'lucide-react';
import {
  applyPlaceholdersToHtml,
  serializePlaceholderHtml,
  handlePlaceholderKeyDown,
  applySuggestionHighlight,
  applySuggestionToText,
} from '../utils/paragraphAiPlaceholderRenderer';
import { aiServices } from '../services';
import paragraphInferenceManager from '../services/aiServices/paragraphInferenceManager';
import ParagraphScoreDots from './ParagraphScoreDots';
import MetadataPlaceholderPicker from './MetadataPlaceholderPicker';
import useMetadataStore from '../store/metadataStore';

/**
 * SimpleParagraphEditor - Clean, simple paragraph editor
 * Follows the API spec exactly: uses 'content' field only
 * Supports drag-and-drop reordering and move up/down
 * NOTE: Only document-level metadata is supported now (no paragraph/section metadata)
 */
const SimpleParagraphEditor = ({ 
  paragraph, 
  onUpdate, 
  onDelete,
  onMoveUp,
  onMoveDown,
  onFocusEditor,
  onOpenMetadata,
  onOpenHistory,
  onAiChat,
  onAiFetchStart,
  onAiFetchEnd,
  onPartialSaveForAi,
  onAiReviewResult,
  onInference,
  onCrossRef,
  crossRefActive = false,
  sectionId,
  documentId,
  documentMetadata, // Only document metadata now
  isPreviewMode = false,
  isFirst = false,
  isLast = false,
  reviewCommentCount = null,
  onOpenReviewComments,
  isDraggable = true,
  aiScoringEnabled = true,
}) => {
  const { updateField } = useMetadataStore();
  
  const renderedHtml = useMemo(
    () => applyPlaceholdersToHtml(paragraph?.content || '', documentMetadata || {}),
    [paragraph?.content, documentMetadata]
  );
  const [text, setText] = useState(renderedHtml);
  const [isDragging, setIsDragging] = useState(false);
  const [activeSuggestionId, setActiveSuggestionId] = useState(null);
  const [ignoredSuggestionIds, setIgnoredSuggestionIds] = useState(() => new Set());
  const [appliedSuggestionIds, setAppliedSuggestionIds] = useState(() => new Set());
  const [isFetchingAi, setIsFetchingAi] = useState(false);
  const [pendingAiResponse, setPendingAiResponse] = useState(null);
  const [cachedAiResponse, setCachedAiResponse] = useState(null);
  const [aiFetchError, setAiFetchError] = useState(null);
  const [lastAiContentSnapshot, setLastAiContentSnapshot] = useState(null);
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState(null);
  const [suggestionPopover, setSuggestionPopover] = useState(null);
  const [pinnedSuggestionId, setPinnedSuggestionId] = useState(null);
  const [localScores, setLocalScores] = useState(null);
  const [localScoreError, setLocalScoreError] = useState(null);
  const [showMetadataPicker, setShowMetadataPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerRangeRef = useRef(null);
  const editorRef = useRef(null);
  const localScoreTimeoutRef = useRef(null);
  const paragraphId = paragraph?.id || paragraph?.client_id;
  const enableLocalParagraphAi = aiScoringEnabled && (import.meta?.env?.VITE_ENABLE_LOCAL_AI ?? 'true') !== 'false';
  const isGrammarSuggestion = (suggestion) => {
    const type = String(suggestion?.type || '').toLowerCase();
    return type.includes('grammar');
  };

  const suggestions = useMemo(() => {
    const list = paragraph?.suggestions || paragraph?.ai_suggestions || [];
    return list.filter(
      (item) =>
        item &&
        !isGrammarSuggestion(item) &&
        !ignoredSuggestionIds.has(item.id) &&
        !appliedSuggestionIds.has(item.id)
    );
  }, [paragraph?.suggestions, paragraph?.ai_suggestions, ignoredSuggestionIds, appliedSuggestionIds]);
  const hoveredSuggestion = suggestions.find((item) => item.id === hoveredSuggestionId) || null;

  const aiRenderedPreviewHtml = useMemo(() => {
    if (!pendingAiResponse?.processed_text) return '';
    // Render with document metadata only
    return applyPlaceholdersToHtml(pendingAiResponse.processed_text, documentMetadata || {});
  }, [pendingAiResponse?.processed_text, documentMetadata]);

  const currentSerializedContent = useMemo(() => {
    return serializePlaceholderHtml(editorRef.current?.innerHTML || paragraph?.content || '');
  }, [text, paragraph?.content]);

  const showAiUpdatePrompt = useMemo(() => {
    if (!pendingAiResponse?.processed_text) return false;
    return pendingAiResponse.processed_text !== currentSerializedContent;
  }, [pendingAiResponse?.processed_text, currentSerializedContent]);

  const scoreLabels = useMemo(
    () => aiServices.paragraphInference?.SCORE_LABELS || [],
    []
  );

  const resolvedScores = useMemo(() => {
    if (!enableLocalParagraphAi) return null;
    return (
      localScores ||
      pendingAiResponse?.scores ||
      cachedAiResponse?.scores ||
      paragraph?.ai_review?.scores ||
      paragraph?.aiReview?.scores ||
      paragraph?.ai_review_result?.scores ||
      null
    );
  }, [enableLocalParagraphAi, localScores, pendingAiResponse?.scores, cachedAiResponse?.scores, paragraph?.ai_review, paragraph?.aiReview, paragraph?.ai_review_result]);

  const applyAiReviewResponse = (response) => {
    if (!response) return;
    setPendingAiResponse(response);
    setAiFetchError(null);
    onAiReviewResult?.(paragraphId, response);
  };

  useEffect(() => {
    const cached = paragraph?.ai_review || paragraph?.aiReview || paragraph?.ai_review_result || null;
    if (cached) {
      setCachedAiResponse(cached);
    }
  }, [paragraph?.ai_review, paragraph?.aiReview, paragraph?.ai_review_result]);

  useEffect(() => {
    if (!enableLocalParagraphAi) {
      setLocalScores(null);
      setLocalScoreError(null);
      return;
    }
    if (!currentSerializedContent?.trim()) {
      setLocalScores(null);
      setLocalScoreError(null);
      return;
    }
    if (localScoreTimeoutRef.current) {
      clearTimeout(localScoreTimeoutRef.current);
    }
    localScoreTimeoutRef.current = window.setTimeout(async () => {
      try {
        const { scores } = await paragraphInferenceManager.requestInference(
          paragraphId,
          currentSerializedContent,
        );
        setLocalScores(scores);
        setLocalScoreError(null);
      } catch (error) {
        setLocalScores(null);
        setLocalScoreError(error?.message || 'Failed to score paragraph.');
      }
    }, 600);
    return () => {
      if (localScoreTimeoutRef.current) {
        clearTimeout(localScoreTimeoutRef.current);
      }
    };
  }, [currentSerializedContent, enableLocalParagraphAi]);


  // Sync with props when paragraph changes
  useEffect(() => {
    const next = renderedHtml;
    setText(next);
    if (!editorRef.current) return;
    const isFocused = document.activeElement === editorRef.current;
    if (!isFocused && editorRef.current.innerHTML !== next) {
      editorRef.current.innerHTML = next;
    }
  }, [paragraph?.id, renderedHtml]);

  useEffect(() => {
    if (!editorRef.current) return;
    const isFocused = document.activeElement === editorRef.current;
    if (isFocused) return;
    const grammarSuggestions = suggestions.filter(isGrammarSuggestion);
    if (!grammarSuggestions.length) {
      if (editorRef.current.innerHTML !== text) {
        editorRef.current.innerHTML = text;
      }
      return;
    }
    let highlighted = text;
    grammarSuggestions.forEach((suggestion) => {
      highlighted = applySuggestionHighlight(
        highlighted,
        suggestion,
        'paragraph-suggestion-highlight'
      );
    });
    if (editorRef.current.innerHTML !== highlighted) {
      editorRef.current.innerHTML = highlighted;
    }
  }, [text, suggestions]);

  useEffect(() => {
    const editorEl = editorRef.current;
    if (!editorEl) return;

    const cleanup = () => {
      if (pinnedSuggestionId) return;
      setHoveredSuggestionId(null);
      setSuggestionPopover(null);
    };

    const handleMouseMove = (event) => {
      if (pinnedSuggestionId) return;
      const target = event.target.closest?.('[data-suggestion-id]');
      if (!target || !editorEl.contains(target)) {
        cleanup();
        return;
      }
      const suggestionId = target.getAttribute('data-suggestion-id');
      if (!suggestionId) return;
      if (suggestionId !== hoveredSuggestionId) {
        setHoveredSuggestionId(suggestionId);
      }
      const rect = target.getBoundingClientRect();
      setSuggestionPopover({
        id: suggestionId,
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
      });
    };

    const handleClick = (event) => {
      const target = event.target.closest?.('[data-suggestion-id]');
      if (!target || !editorEl.contains(target)) return;
      const suggestionId = target.getAttribute('data-suggestion-id');
      if (!suggestionId) return;
      const rect = target.getBoundingClientRect();
      setPinnedSuggestionId(suggestionId);
      setHoveredSuggestionId(suggestionId);
      setSuggestionPopover({
        id: suggestionId,
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
      });
      event.preventDefault();
    };

    const handleOutsideClick = (event) => {
      if (!pinnedSuggestionId) return;
      const target = event.target;
      if (editorEl.contains(target)) return;
      setPinnedSuggestionId(null);
      setHoveredSuggestionId(null);
      setSuggestionPopover(null);
    };

    const handleMouseLeave = (event) => {
      if (!editorEl.contains(event.relatedTarget)) {
        cleanup();
      }
    };

    editorEl.addEventListener('mousemove', handleMouseMove);
    editorEl.addEventListener('click', handleClick);
    editorEl.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('click', handleOutsideClick);
    return () => {
      editorEl.removeEventListener('mousemove', handleMouseMove);
      editorEl.removeEventListener('click', handleClick);
      editorEl.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [hoveredSuggestionId, pinnedSuggestionId]);

  const getTextBeforeCursor = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return '';
    const range = selection.getRangeAt(0);
    if (!editorRef.current?.contains(range.startContainer)) return '';
    const preRange = range.cloneRange();
    preRange.selectNodeContents(editorRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString();
  };

  const handleInput = () => {
    const html = editorRef.current?.innerHTML || '';
    setText(html);
    const textBeforeCursor = getTextBeforeCursor();
    const lastOpenIndex = textBeforeCursor.lastIndexOf('[[');
    const lastCloseIndex = textBeforeCursor.lastIndexOf(']]');

    if (lastOpenIndex !== -1 && lastOpenIndex > lastCloseIndex) {
      const query = textBeforeCursor.slice(lastOpenIndex + 2);
      setPickerQuery(query);
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0).cloneRange();
        pickerRangeRef.current = range;
        const rect = range.getBoundingClientRect();
        setPickerPosition({
          top: rect.bottom + window.scrollY + 8,
          left: Math.min(rect.left + window.scrollX, window.innerWidth - 520),
        });
      }
      setShowMetadataPicker(true);
    } else if (showMetadataPicker) {
      setShowMetadataPicker(false);
      setPickerQuery('');
      setPickerPosition(null);
    }
  };

  const handleBlur = () => {
    const html = editorRef.current?.innerHTML || '';
    const serialized = serializePlaceholderHtml(html);
    if (serialized !== (paragraph?.content || '')) {
      onUpdate({ content: serialized });
    }
    const normalized = applyPlaceholdersToHtml(serialized, documentMetadata || {});
    if (editorRef.current && editorRef.current.innerHTML !== normalized) {
      editorRef.current.innerHTML = normalized;
    }
    setText(normalized);
  };

  const handleTopicChange = (value) => {
    onUpdate({ topic: value });
  };

  const handleIgnoreSuggestion = (suggestionId) => {
    setIgnoredSuggestionIds((prev) => new Set([...prev, suggestionId]));
    if (activeSuggestionId === suggestionId) setActiveSuggestionId(null);
    if (hoveredSuggestionId === suggestionId) setHoveredSuggestionId(null);
    setSuggestionPopover(null);
    if (pinnedSuggestionId === suggestionId) setPinnedSuggestionId(null);
  };

  const handleApplySuggestion = (suggestion) => {
    if (!suggestion) return;
    if (!paragraphId) return;
    const processedText = pendingAiResponse?.processed_text ?? paragraph?.content ?? '';
    const renderedText = pendingAiResponse?.rendered_text ?? processedText;

    void (async () => {
      try {
        const response = await paragraphAiService.rewriteParagraphAiReview(paragraphId, {
          processed_text: processedText,
          rendered_text: renderedText,
          suggestions: [suggestion],
        });
        applyAiReviewResponse({ ...pendingAiResponse, ...response });
        setAppliedSuggestionIds((prev) => new Set([...prev, suggestion.id]));
        setActiveSuggestionId(null);
        setHoveredSuggestionId(null);
        setSuggestionPopover(null);
        setPinnedSuggestionId(null);
      } catch (error) {
        console.error('Failed to rewrite paragraph with suggestion:', error);
      }
    })();
  };

  const buildMergedMetadata = (detectedMetadata) => {
    // Removed: no longer merge paragraph metadata, AI-detected fields go to document level
    const detected = detectedMetadata || {};
    return {
      custom: detected,
      metadata: detected,
    };
  };

  const insertPlaceholderAtRange = (placeholderKey) => {
    const range = pickerRangeRef.current;
    if (!range) return;
    const selection = window.getSelection();
    if (!selection) return;

    const fallbackInsert = () => {
      const textNode = document.createTextNode(`[[${placeholderKey}]]`);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
    };

    if (range.startContainer?.nodeType === Node.TEXT_NODE) {
      const offset = range.startOffset;
      if (offset >= 2) {
        const cleanupRange = range.cloneRange();
        cleanupRange.setStart(range.startContainer, offset - 2);
        cleanupRange.setEnd(range.startContainer, offset);
        cleanupRange.deleteContents();
      }
      const textNode = document.createTextNode(`[[${placeholderKey}]]`);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      fallbackInsert();
    }

    const serialized = serializePlaceholderHtml(editorRef.current?.innerHTML || '');
    const normalized = applyPlaceholdersToHtml(serialized, documentMetadata || {});
    if (editorRef.current) {
      editorRef.current.innerHTML = normalized;
    }
    setText(normalized);
    onUpdate?.({ content: serialized });
  };

    const handleMetadataSelect = (key) => {
      if (!key) return;
      insertPlaceholderAtRange(key);
      setShowMetadataPicker(false);
      setPickerPosition(null);
    };

    const handleMetadataCreate = async (key, value) => {
      if (!key) return;
      insertPlaceholderAtRange(key);
      setShowMetadataPicker(false);
      setPickerPosition(null);
      
      // Always save to document metadata
      if (documentId) {
        try {
          // Determine target based on key format
          // Use 'custom_metadata' for user-friendly names (e.g., "Invoice No")
          // Use 'document_metadata' for dot-notation paths (e.g., "dates.invoice_date")
          const target = key.includes('.') ? 'document_metadata' : 'custom_metadata';
          await updateField(documentId, key, value, target);
        } catch (error) {
          console.error('Failed to update document metadata:', error);
        }
      }
    };

  const handleApplyAiResponse = () => {
    if (!pendingAiResponse) return;
    if (!paragraphId) return;
    const processedText = pendingAiResponse?.processed_text ?? paragraph?.content ?? '';
    const currentSerialized = serializePlaceholderHtml(
      editorRef.current?.innerHTML || paragraph?.content || ''
    );
    const isSameText = processedText === currentSerialized;
    const mergedMetadata = buildMergedMetadata(pendingAiResponse?.metadata_detected);
    const nextHtml = applyPlaceholdersToHtml(processedText, documentMetadata || {});
    if (editorRef.current) {
      editorRef.current.innerHTML = nextHtml;
    }
    setText(nextHtml);
    setIgnoredSuggestionIds(new Set());
    setAppliedSuggestionIds(new Set());
    setHoveredSuggestionId(null);
    setSuggestionPopover(null);
    setPinnedSuggestionId(null);
  // keep pendingAiResponse so scores/recommendations remain available
    setAiFetchError(null);
    setLastAiContentSnapshot(processedText);
    
    // Save AI-detected metadata to document level
    if (documentId && mergedMetadata.custom && Object.keys(mergedMetadata.custom).length > 0) {
      (async () => {
        try {
          for (const [key, value] of Object.entries(mergedMetadata.custom)) {
            // AI-detected metadata goes to custom_metadata
            await updateField(documentId, key, value, 'custom_metadata');
          }
        } catch (error) {
          console.error('Failed to update document metadata from AI:', error);
        }
      })();
    }
    
    onUpdate({
      content: processedText,
      paragraph_type: pendingAiResponse?.paragraph_type_detected || pendingAiResponse?.paragraph_type || paragraph?.paragraph_type,
      suggestions: pendingAiResponse?.suggestions || [],
      ai_review: pendingAiResponse,
    });
  // Always notify parent of the AI result immediately so scores/recommendations stay in sync.
    onAiReviewResult?.(paragraphId, pendingAiResponse);

    // If processed_text is identical to the current serialized paragraph content, skip the backend apply call to avoid unnecessary 404 or duplicate saves.
    if (isSameText) {
      return;
    }

    // Otherwise, persist the apply asynchronously but keep the panel visible.
    void (async () => {
      try {
        const response = await paragraphAiService.applyParagraphAiReview(paragraphId, {
          processed_text: pendingAiResponse?.processed_text,
          rendered_text: pendingAiResponse?.rendered_text,
          suggestions: pendingAiResponse?.suggestions || [],
        });
        if (response) {
          onAiReviewResult?.(paragraphId, response);
        }
      } catch (error) {
        console.error('Failed to apply AI paragraph review:', error);
      }
    })();
  };

  const handleKeepCurrent = () => {
    setPendingAiResponse(null);
    setHoveredSuggestionId(null);
    setSuggestionPopover(null);
    setPinnedSuggestionId(null);
    setAiFetchError(null);
  };

  const handleFetchAiExample = async () => {
    if (!paragraphId || isFetchingAi) return;
    const currentSerialized = serializePlaceholderHtml(editorRef.current?.innerHTML || paragraph?.content || '');
    if (lastAiContentSnapshot && currentSerialized === lastAiContentSnapshot && (pendingAiResponse || cachedAiResponse)) {
      return;
    }
    try {
      await onPartialSaveForAi?.();
    } catch (error) {
      console.error('Failed to partial-save paragraph before AI fetch:', error);
      return;
    }
    setAiFetchError(null);
    onAiFetchStart?.();
    setIsFetchingAi(true);
    try {
      if (!enableLocalParagraphAi) {
        setAiFetchError('Local AI inference is disabled.');
        return;
      }
      // Force re-inference for the explicit AI review button
      paragraphInferenceManager.invalidate(paragraphId);
      const { fullResult: localResult } = await paragraphInferenceManager.requestInference(
        paragraphId,
        currentSerialized,
      );
      if (!localResult) {
        setAiFetchError('Local AI inference returned no result.');
        return;
      }
      applyAiReviewResponse(localResult);
      setLastAiContentSnapshot(currentSerialized);
    } catch (error) {
      console.error('Failed to run local paragraph AI inference:', error);
      setAiFetchError(error?.message || 'Failed to run local AI inference.');
    } finally {
      setIsFetchingAi(false);
      onAiFetchEnd?.();
    }
  };


  const handleDragStart = (e) => {
    if (!isDraggable) return;
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', paragraph?.id || paragraph?.client_id);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  if (isPreviewMode) {
    return (
      <div className="mb-2 break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
    );
  }

  return (
    <div 
      className={`paragraph-editor-container mb-1 relative group flex items-start gap-1.5 overflow-visible ${isDragging ? 'opacity-50' : ''}`}
      data-metadata-anchor="paragraph"
      data-metadata-id={paragraphId}
      data-paragraph-id={paragraphId}
      data-section-id={sectionId}
    >
      <MetadataPlaceholderPicker
        isOpen={showMetadataPicker}
        documentMetadata={documentMetadata || {}}
        anchorPosition={pickerPosition}
        query={pickerQuery}
        onClose={() => setShowMetadataPicker(false)}
        onSelect={handleMetadataSelect}
        onCreate={handleMetadataCreate}
      />
      {enableLocalParagraphAi && (
      <div
        className="absolute -left-20 top-1 flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Paragraph score indicators"
      >
        <ParagraphScoreDots scores={resolvedScores || {}} labels={scoreLabels} />
        {localScoreError && (
          <div className="text-[10px] text-rose-500" title={localScoreError}>
            !
          </div>
        )}
      </div>
      )}
      {/* Drag handle */}
      {isDraggable && (
        <div 
          draggable={true}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className="flex-shrink-0 mt-2 cursor-move opacity-0 group-hover:opacity-100 transition-opacity"
          title="Drag to reorder"
        >
          <GripVertical size={16} className="text-gray-400" />
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 relative min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <label className="text-[10px] text-gray-400">Topic</label>
          <input
            list="paragraph-topics"
            value={paragraph?.topic || ''}
            onChange={(e) => handleTopicChange(e.target.value)}
            placeholder="Select or type"
            className="w-36 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <datalist id="paragraph-topics">
            <option value="Overview" />
            <option value="Background" />
            <option value="Scope" />
            <option value="Requirements" />
            <option value="Constraints" />
            <option value="Risks" />
            <option value="Assumptions" />
            <option value="Conclusion" />
          </datalist>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          onFocus={() => onFocusEditor?.(editorRef.current)}
          onKeyDown={(event) => handlePlaceholderKeyDown(event, editorRef.current)}
          className="rich-text-editor w-full min-h-[2em] rounded-sm border border-transparent hover:border-gray-200 focus:border-gray-300 px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 break-words"
          data-placeholder="Enter paragraph text..."
          data-paragraph-id={paragraphId}
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        />
        {suggestionPopover && hoveredSuggestion && (
          <div
            className="absolute z-20 rounded border border-amber-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-lg"
            style={{ top: suggestionPopover.top, left: suggestionPopover.left }}
          >
            <div className="font-semibold text-amber-900">{hoveredSuggestion.message || 'Suggestion'}</div>
            {hoveredSuggestion.original && hoveredSuggestion.replacement && (
              <div className="mt-1 text-[11px] text-amber-800">
                {hoveredSuggestion.original} → {hoveredSuggestion.replacement}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => handleIgnoreSuggestion(hoveredSuggestion.id)}
                className="rounded border border-amber-300 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
              >
                Ignore
              </button>
              {hoveredSuggestion.is_fixable !== false && (
                <button
                  type="button"
                  onClick={() => handleApplySuggestion(hoveredSuggestion)}
                  className="rounded border border-amber-400 bg-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-300"
                >
                  Apply
                </button>
              )}
            </div>
          </div>
        )}

        {pendingAiResponse && showAiUpdatePrompt && (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">AI update ready</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleKeepCurrent}
                  className="rounded border border-emerald-300 px-2 py-1 text-[11px] text-emerald-800 hover:bg-emerald-100"
                >
                  Keep current
                </button>
                {!pendingAiResponse?.ai_result_cached && (
                  <button
                    type="button"
                    onClick={handleApplyAiResponse}
                    className="rounded border border-emerald-400 bg-emerald-200 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-300"
                  >
                    Update
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3">
              <div className="rounded border-2 border-emerald-400 bg-white p-2">
                <div className="text-[11px] font-semibold text-emerald-700">Preview (rendered)</div>
                <div
                  className="rich-text-editor mt-1 text-[11px] text-emerald-900"
                  style={{ whiteSpace: 'pre-wrap' }}
                  dangerouslySetInnerHTML={{ __html: aiRenderedPreviewHtml }}
                />
              </div>
            </div>
          </div>
        )}


        {suggestions.length > 0 && (
          <div className="mt-2 space-y-2">
            <div className="text-xs font-semibold text-gray-500">AI Suggestions</div>
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-gray-700"
                onMouseEnter={() => setActiveSuggestionId(suggestion.id)}
                onMouseLeave={() => setActiveSuggestionId((prev) => (prev === suggestion.id ? null : prev))}
              >
                <div className="font-medium text-amber-900">{suggestion.message || 'Suggestion'}</div>
                <div className="mt-1 text-[11px] text-amber-800">
                  {suggestion.original ? `Original: ${suggestion.original}` : null}
                  {suggestion.replacement ? ` → ${suggestion.replacement}` : null}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleIgnoreSuggestion(suggestion.id)}
                    className="rounded border border-amber-300 px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                  >
                    Ignore
                  </button>
                  {suggestion.is_fixable !== false && (
                    <button
                      type="button"
                      onClick={() => handleApplySuggestion(suggestion)}
                      className="rounded border border-amber-400 bg-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-300"
                    >
                      Apply
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Action buttons */}
        <div className="absolute top-1 right-1 flex gap-1">
          {/* Inference & Cross-ref — always subtly visible */}
          {(onInference || onCrossRef) && (
            <div className="flex gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity">
          {/* Inference — what is this paragraph about */}
          {onInference && (
            <button
              type="button"
              onClick={() => onInference(paragraphId, 'paragraph')}
              className="p-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-600 rounded"
              title="Run inference — analyze this paragraph"
            >
              <Sparkles size={12} />
            </button>
          )}
          {/* Cross-references — show connected arcs */}
          {onCrossRef && (
            <button
              type="button"
              onClick={() => onCrossRef(paragraphId, 'paragraph')}
              className={`p-1 border rounded ${
                crossRefActive
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-600 !opacity-100'
                  : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-500'
              }`}
              title="Show cross-references"
            >
              <Network size={12} />
            </button>
          )}
            </div>
          )}
          {/* Other actions — hover only */}
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* History */}
          <button
            type="button"
            onClick={() => {
              if (!paragraphId) return;
              onOpenHistory?.({
                id: paragraphId,
                label: paragraph?.topic || `Paragraph`,
              });
            }}
            className="p-1 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-600 rounded"
            title="View edit history"
          >
            <History size={12} />
          </button>
          {/* AI Chat */}
          {onAiChat && (
            <button
              type="button"
              onClick={() => {
                if (!paragraphId) return;
                onAiChat({
                  scope: 'paragraph',
                  scopeId: paragraphId,
                  scopeLabel: paragraph?.topic || 'Paragraph',
                });
              }}
              className="p-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-600 rounded"
              title="AI Chat – this paragraph"
            >
              <Bot size={12} />
            </button>
          )}
          {/* Review Comments */}
          {onOpenReviewComments && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenReviewComments(); }}
              className={`p-1 border rounded relative ${
                reviewCommentCount?.unresolved > 0
                  ? 'bg-orange-50 hover:bg-orange-100 border-orange-300 text-orange-600'
                  : reviewCommentCount?.total > 0
                    ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-600'
                    : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-400'
              }`}
              title={
                reviewCommentCount?.total
                  ? `${reviewCommentCount.total} comment${reviewCommentCount.total !== 1 ? 's' : ''}${reviewCommentCount.unresolved ? ` (${reviewCommentCount.unresolved} open)` : ''}`
                  : 'Review comments'
              }
            >
              <MessageCircle size={12} />
              {reviewCommentCount?.total > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold leading-none text-white bg-orange-500">
                  {reviewCommentCount.total}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!paragraphId) return;
              onOpenMetadata?.({
                type: 'paragraph',
                id: paragraphId,
                label: paragraph?.topic || 'Paragraph',
                metadata: paragraph?.metadata || {},
              });
            }}
            className="p-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 rounded"
            title="Edit metadata"
          >
            <Table size={12} />
          </button>
          {/* Move up */}
          {onMoveUp && (
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className={`p-1 border rounded ${
                isFirst 
                  ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600'
              }`}
              title={isFirst ? "Can't move up (first paragraph)" : "Move up"}
            >
              <ChevronUp size={12} />
            </button>
          )}
          
          {/* Move down */}
          {onMoveDown && (
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className={`p-1 border rounded ${
                isLast 
                  ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-600'
              }`}
              title={isLast ? "Can't move down (last paragraph)" : "Move down"}
            >
              <ChevronDown size={12} />
            </button>
          )}
          
          {/* Delete */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded"
              title="Delete paragraph"
            >
              <Trash2 size={12} />
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimpleParagraphEditor;