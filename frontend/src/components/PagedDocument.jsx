import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import SimpleParagraphEditor from './SimpleParagraphEditor';
import LatexCodeEditor from './LatexCodeEditor';
import SectionHeader from './SectionHeader';
import { AddContentButton, DocumentTable, ImageComponent, ImageLibraryBrowser, DocumentFileComponent, DocumentLibraryBrowser, SectionReferenceComponent } from './';
import { Trash2, Plus, GripVertical, Bot, MessageCircle, Network, Sparkles } from 'lucide-react';
import { calculateImageSizeFromMetadata, IMAGE_SIZE_PRESETS } from '../utils/imageOptimizer';
import { sectionReferenceService } from '../services';
import { mergeMetadataSources } from '../utils/metadataMerge';
import api from '../services/api';
import CrossReferenceOverlay from './CrossReferenceOverlay';

/**
 * PagedDocument - Dimensional Page-Based Document Renderer
 * 
 * Features:
 * - Real page dimensions (A4, Letter, etc.)
 * - Automatic pagination based on content height
 * - Shows exactly how content will print
 * - Tracks element positions and dimensions
 * - Automatic page breaks when content overflows
 * - Supports tables alongside paragraphs
 */

const PagedDocument = ({
  document,
  pageSettings,
  isPreviewMode,
  onUpdate,
  onSectionUpdate,
  onSectionDelete,
  onParagraphUpdate,
  onParagraphDelete,
  onParagraphReorder,
  onLatexCodeUpdate,
  onLatexCodeDelete,
  onActiveEditorChange,
  onOpenMetadata,
  onParagraphAiPartialSave,
  onAiReviewResult,
  onAddParagraph,
  onAddLatexCode,
  onAddAILatexCode,
  onImageDrop,
  onImageSelect,
  onImageResize,
  onImageUpdateAlignment,
  onImageDelete,
  onImageToggleVisibility,
  getImageUrl,
  documentId,
  onAddSubsection,
  onAddSiblingSection,
  onSectionReorder,
  citationStyle,
  sectionTables,
  sectionComponents,
  onAddTable,
  onTableCreate,
  onTableUpdate,
  onTableDelete,
  onTableMove,
  onComponentMove,
  sectionImageComponents,
  onAddImageToDocument,
  onOpenImageSidebar,
  onImageComponentUpdate,
  onImageComponentDelete,
  onImageComponentSelect,
  selectedImageComponentId,
  sectionDocumentComponents,
  onAddDocumentToDocument,
  onOpenDocumentSidebar,
  onDocumentComponentUpdate,
  onDocumentComponentDelete,
  onOpenSectionBrowser,
  onOpenHistory,
  onAiChat,
  compareHighlights,
  aiReviewCallouts = [],
  reviewCommentCounts = {},
  onOpenReviewComments,
  aiScoringEnabled = true,
  // ── Cross-reference props ──────────────────────────────────────────
  crossRef = null,         // { enabled, sourceId, sourceType, edges, edgeCountMap, selectSource, clearSource, toggle }
}) => {
  const [pages, setPages] = useState([{ content: [], height: 0 }]);
  const contentRefs = useRef({});
  const [showingImageBrowserFor, setShowingImageBrowserFor] = useState(null);
  const [sectionReferences, setSectionReferences] = useState({});
  const documentContainerRef = useRef(null);

  const aiCalloutMaps = useMemo(() => {
    const bySection = new Map();
    const byParagraph = new Map();
    (aiReviewCallouts || []).forEach((callout, index) => {
      if (!callout) return;
      const sectionKey = callout.sectionId ? String(callout.sectionId) : null;
      const paragraphKey = callout.paragraphId ? String(callout.paragraphId) : null;
      const normalized = {
        ...callout,
        id: callout.id || `${sectionKey || 'section'}-${paragraphKey || 'paragraph'}-${index}`,
      };
      if (paragraphKey) {
        const list = byParagraph.get(paragraphKey) || [];
        list.push(normalized);
        byParagraph.set(paragraphKey, list);
        return;
      }
      if (sectionKey) {
        const list = bySection.get(sectionKey) || [];
        list.push(normalized);
        bySection.set(sectionKey, list);
      }
    });
    return { bySection, byParagraph };
  }, [aiReviewCallouts]);

  const documentMetadata = useMemo(() => (
    mergeMetadataSources(
      document?.document_metadata,
      document?.metadata?.document_metadata,
      document?.custom_metadata,
      document?.metadata?.custom_metadata
    )
  ), [document]);

  // ── Review-comment button for section hover bar ──────────────
  const renderCommentBadge = (elementId, elementType) => {
    if (!onOpenReviewComments) return null;
    const counts = reviewCommentCounts[elementId];
    const total = counts?.total || 0;
    const unresolved = counts?.unresolved || 0;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenReviewComments(elementId, elementType);
        }}
        title={
          total
            ? `${total} comment${total !== 1 ? 's' : ''}${unresolved ? ` (${unresolved} open)` : ' (all resolved)'}`
            : 'Review comments'
        }
        className={`p-1.5 rounded transition-colors relative ${
          unresolved > 0
            ? 'text-orange-500 hover:bg-orange-50'
            : total > 0
              ? 'text-green-500 hover:bg-green-50'
              : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
        }`}
      >
        <MessageCircle size={16} />
        {total > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold leading-none text-white bg-orange-500">
            {total}
          </span>
        )}
      </button>
    );
  };

  const getAiSeverityClass = (severity) => {
    const level = String(severity || '').toLowerCase();
    if (level.includes('high')) return 'bg-red-100 text-red-700 border-red-200';
    if (level.includes('moderate') || level.includes('medium')) return 'bg-amber-100 text-amber-700 border-amber-200';
    if (level.includes('low')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const renderAiReviewCallouts = (callouts = []) => {
    if (!callouts.length) return null;
    return (
      <div className="relative mb-3 space-y-2">
        {callouts.map((callout, index) => (
          <div key={callout.id || index} className="relative">
            <div className={`rounded-xl border border-slate-200 px-3 py-2 shadow-sm ${getAiSeverityClass(callout.severity)}`}>
              <div className={"flex items-center justify-between gap-2"}>
                <p className="text-xs font-semibold text-slate-900">
                  {callout.title || callout.label || `AI suggestion ${index + 1}`}
                </p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getAiSeverityClass(callout.severity)}`}>
                  {callout.severity || 'Review'}
                </span>
              </div>
              {callout.summary && (
                <p className="text-xs text-slate-500 mt-1">{callout.summary}</p>
              )}
              {callout.suggestion && (
                <p className="text-xs text-slate-700 mt-1">{callout.suggestion}</p>
              )}
            </div>
            <svg
              className="absolute left-6 -bottom-3 pointer-events-none"
              width="56"
              height="24"
              viewBox="0 0 56 24"
              fill="none"
            >
              <path
                d="M2 2C18 2 24 22 42 22H54"
                stroke="#CBD5F5"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ))}
      </div>
    );
  };

  const getHighlightClass = (type, id) => {
    if (!compareHighlights || !id) return '';
    const state = compareHighlights?.[type]?.[String(id)];
    if (!state) return '';
    if (state === 'added') {
      return 'bg-green-50 border border-green-200 rounded-md';
    }
    if (state === 'removed') {
      return 'bg-red-50 border border-red-200 rounded-md';
    }
    if (state === 'changed') {
      return 'bg-yellow-50 border border-yellow-200 rounded-md';
    }
    return '';
  };

  // Handle direct image addition from drag & drop on + button
  const handleDirectImageAdd = (sectionId, imageData, insertAfter = null) => {
    if (onAddImageToDocument && imageData) {
      // If imageData has an 'id', it's from the library (dragged from sidebar)
      // If it has a 'file', it would need to be uploaded first (not implemented yet)
      if (imageData.id) {
        onAddImageToDocument(imageData, sectionId, undefined, { insertAfter });
      } else if (imageData.file) {
        console.warn('⚠️ File upload from drag & drop not yet implemented');
        // Could implement file upload here if needed
      }
    }
  };

  // Handle section reference addition (menu click or drag & drop)
  const handleAddSectionReference = async (sectionId, referenceData, insertAfter = null) => {
    // If no referenceData is provided, open the sidebar for browsing
    if (!referenceData && onOpenSectionBrowser) {
      console.log('📖 Opening Section Browser from menu');
      onOpenSectionBrowser(sectionId, insertAfter);
      return;
    }
    
    // Otherwise, create the reference (from drag & drop)
  console.log('📖 Creating section reference:', { sectionId, referenceData, insertAfter });
    console.warn('⚠️ Section reference API not implemented yet. Would create reference to:', referenceData);
    
    // TODO: Enable when backend API is ready
  // try {
    //   if (referenceData?.referenced_section && referenceData?.referenced_document) {
    //     const newReference = await sectionReferenceService.createReference({
    //       source_document: documentId,
    //       referenced_section: referenceData.referenced_section,
  //       order: typeof insertAfter === 'number' ? insertAfter + 1 : 0,
    //       include_full_content: false,
    //     });
    //     setSectionReferences(prev => ({
    //       ...prev,
    //       [sectionId]: [...(prev[sectionId] || []), newReference]
    //     }));
    //   }
    // } catch (error) {
    //   console.error('❌ Error adding section reference:', error);
    // }
  };

  /**
   * API-first deep clone: creates every entity on the backend and returns the
   * hydrated tree with real UUIDs. Sequential POST calls are acceptable here
   * because section copying is an explicit user action, not a hot-path.
   */
  const cloneSectionViaApi = useCallback(async (sourceSection, parentId = null) => {
    if (!documentId) throw new Error('documentId is required to clone sections');

    // 1. Create the section itself
    const sectionRes = await api.post(`/documents/${documentId}/sections/`, {
      title: sourceSection.title || 'Cloned Section',
      section_type: sourceSection.section_type || 'clause',
      depth_level: sourceSection.depth_level || 1,
      parent: parentId,
      order: 0,
    });
    const newSection = sectionRes.data;
    const newId = newSection.id;

    // 2. Clone paragraphs
    const paragraphs = await Promise.all(
      (sourceSection.paragraphs || []).map((para, idx) =>
        api.post('/documents/paragraphs/', {
          section: newId,
          content: para.content_text || para.edited_text || para.content || '',
          order: idx,
          topic: para.topic || '',
        }).then(r => r.data)
      )
    );

    // 3. Clone tables
    const tables = await Promise.all(
      (sourceSection.tables || []).map((table, idx) =>
        api.post('/documents/tables/', {
          section: newId,
          title: table.title || '',
          description: table.description || '',
          table_type: table.table_type || 'data',
          order: idx,
          num_columns: table.num_columns || (table.column_headers || []).length || 1,
          num_rows: table.num_rows || (table.table_data || []).length || 1,
          column_headers: table.column_headers || [],
          table_data: table.table_data || [],
        }).then(r => r.data)
      )
    );

    // 4. Clone image components (reference only — re-uses existing DocumentImage)
    const imageComponents = await Promise.all(
      (sourceSection.image_components || []).map((img, idx) => {
        const refId = img.image_reference_id || img.image_reference || img.image?.id;
        if (!refId) return Promise.resolve(null);
        return api.post('/documents/image-components/', {
          section_id: newId,
          image_reference_id: refId,
          caption: img.caption || '',
          alt_text: img.alt_text || '',
          component_type: img.component_type || 'figure',
          size_mode: img.size_mode || 'medium',
          alignment: img.alignment || 'center',
          order: idx,
        }).then(r => r.data);
      })
    ).then(results => results.filter(Boolean));

    // 5. Clone file components (reference only)
    const fileComponents = await Promise.all(
      (sourceSection.file_components || []).map((file, idx) => {
        const refId = file.file_reference_id || file.file_reference || file.file?.id;
        if (!refId) return Promise.resolve(null);
        return api.post('/documents/file-components/', {
          section_id: newId,
          file_reference_id: refId,
          label: file.label || '',
          description: file.description || '',
          display_mode: file.display_mode || 'link',
          order: idx,
        }).then(r => r.data);
      })
    ).then(results => results.filter(Boolean));

    // 6. Recursively clone children
    const children = [];
    for (const child of (sourceSection.children || [])) {
      const clonedChild = await cloneSectionViaApi(child, newId);
      children.push(clonedChild);
    }

    return {
      ...newSection,
      paragraphs,
      tables,
      image_components: imageComponents,
      file_components: fileComponents,
      children,
    };
  }, [documentId]);

  // Handle copying entire section content (paragraphs, tables, images, subsections)
  const handleCopySection = async (targetSectionId, dropData) => {
    console.log('📋 Copying section structure and content:', { targetSectionId, dropData });
    
    const { section, contentType } = dropData;
    
    try {
      // If it's a specific content type (paragraph, table, image), copy just that into the section
      if (contentType === 'paragraph' && dropData.paragraphContent) {
        console.log('📝 Copying single paragraph');
        if (onAddParagraph) {
          await onAddParagraph(targetSectionId, dropData.paragraphContent);
        }
        return;
      } 
      
      if (contentType === 'table' && dropData.tableData) {
        console.log('📊 Copying single table');
        if (onTableCreate) {
          await onTableCreate(targetSectionId, dropData.tableData);
        }
        return;
      } 
      
      if (contentType === 'image' && dropData.imageData) {
        console.log('🖼️ Copying single image');
        if (onAddImageToDocument) {
          await handleDirectImageAdd(targetSectionId, dropData.imageData);
        }
        return;
      }
      
      // Copy entire section: Create via API so every item gets a real UUID
      if (contentType === 'section' || !contentType) {
        console.log(`📖 Copying entire section hierarchy: "${section.title}"`);
        console.log(`   Target parent section: ${targetSectionId}`);
        
        if (!onUpdate) {
          console.error('❌ onUpdate handler not available');
          return;
        }
        
        const startTime = Date.now();
        
        // Clone the section via API — every item gets a real UUID
        const clonedSection = await cloneSectionViaApi(section, targetSectionId);
        console.log('✅ Cloned section structure (API-first):', clonedSection);
        
        // Directly insert the cloned section into the document structure
        const updatedDocument = { ...document };
        
        // Find the parent section and add the cloned section as a child
        const insertSectionRecursive = (sections) => {
          return sections.map(sec => {
            if (sec.id === targetSectionId) {
              // Found the target - add cloned section as a child
              const children = [...(sec.children || []), clonedSection];
              // Reorder children
              const reorderedChildren = children.map((child, idx) => ({ ...child, order: idx }));
              return { ...sec, children: reorderedChildren };
            }
            
            // Recurse into children
            if (sec.children && sec.children.length > 0) {
              return { ...sec, children: insertSectionRecursive(sec.children) };
            }
            
            return sec;
          });
        };
        
        updatedDocument.sections = insertSectionRecursive(updatedDocument.sections || []);
        
        // Update the document
        onUpdate(updatedDocument);
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`✅ Section hierarchy "${section.title}" copied in ${elapsed}s`);
        console.log(`📊 Complete structure inserted with all content and ${section.children?.length || 0} subsections`);
      }
      
    } catch (error) {
      console.error('❌ Error copying section content:', error);
    }
  };

  // Load section references when document changes
  // DISABLED: API not ready yet, causing 404 errors
  // useEffect(() => {
  //   if (documentId) {
  //     sectionReferenceService.getByDocument(documentId)
  //       .then(references => {
  //         // Group by section
  //         const grouped = {};
  //         references.forEach(ref => {
  //           const secId = ref.source_section || 'document';
  //           if (!grouped[secId]) grouped[secId] = [];
  //           grouped[secId].push(ref);
  //         });
  //         setSectionReferences(grouped);
  //       })
  //       .catch(err => console.error('Failed to load section references:', err));
  //   }
  // }, [documentId]);

  // Debug logging (can be removed in production)
  useEffect(() => {
    // Removed for performance
  }, [document, isPreviewMode, sectionTables, sectionImageComponents, sectionDocumentComponents]);

  // Get page dimensions in pixels
  const getPageDimensions = () => {
    const config = PAGE_DIMENSIONS[pageSettings.size];
    const width = pageSettings.orientation === 'portrait' ? config.widthPx : config.heightPx;
    const height = pageSettings.orientation === 'portrait' ? config.heightPx : config.widthPx;
    return { width, height };
  };

  const PAGE_DIMENSIONS = {
    a4: { widthPx: 794, heightPx: 1123 },
    a3: { widthPx: 1123, heightPx: 1587 },
    letter: { widthPx: 816, heightPx: 1056 },
    legal: { widthPx: 816, heightPx: 1344 }
  };

  const { width: pageWidth, height: pageHeight } = getPageDimensions();
  const contentHeight = pageHeight - (pageSettings.margins * 2);

  const getParagraphText = (paragraph) => paragraph?.content ?? '';

  // Build flat content array with measurements
  const buildContentArray = () => {
    const content = [];
    const referencedPdfComponents = [];

    const sortByOrder = (items = []) => {
      return [...items].sort((a, b) => {
        const ao = typeof a?.order === 'number' ? a.order : 0;
        const bo = typeof b?.order === 'number' ? b.order : 0;
        return ao - bo;
      });
    };

    const getOrderedSectionComponents = (sectionKey) => {
      if (!sectionComponents) return [];
      if (sectionComponents instanceof Map) {
        return sectionComponents.get(sectionKey) || [];
      }
      return sectionComponents[sectionKey] || [];
    };
    
    // Title
    content.push({
      type: 'title',
      id: 'document-title',
      estimatedHeight: Math.ceil(pageSettings.fontSize * Math.pow(pageSettings.typeScale, 4) * 1.5) + 16, // title + spacing
      render: () => renderTitle()
    });

    // Sections recursively
    const processSection = (section, depth = 0, parentId = null, siblingIndex = 0, siblings = [], numberingPrefix = '') => {
      const sectionKey = section.id || section.client_id;
      // Prefer explicit order when provided; fallback to visual position
      const siblingNumber = typeof section?.order === 'number' ? section.order + 1 : siblingIndex + 1;
  const numbering = numberingPrefix ? `${numberingPrefix}.${siblingNumber}` : `${siblingNumber}`;
      // Section header
      content.push({
        type: 'section-header',
        id: `section-${sectionKey}`,
        sectionId: sectionKey,
        section: section, // Store full section for dragging
        depth,
        siblingIndex,
        siblingsCount: siblings?.length || 0,
        parentId,
        numbering,
        estimatedHeight: Math.ceil(pageSettings.fontSize * Math.pow(pageSettings.typeScale, 3 - depth) * 1.8) + 16,
        render: (dragHandleProps) => renderSectionHeader(section, depth, parentId, siblingIndex, siblings?.length || 0, numbering, dragHandleProps)
      });

      const paragraphOrder = sortByOrder(section.paragraphs || []);
      const tableOrder = sortByOrder(sectionTables?.[sectionKey] || []);
      const orderedComponents = getOrderedSectionComponents(sectionKey);
  const canReorder = typeof onComponentMove === 'function';

      orderedComponents.forEach((component, componentIndex) => {
        const type = component?.type;
        const data = component?.data;

  if (type === 'paragraph' && data) {
          const paraIndex = paragraphOrder.findIndex((p) => (p.id || p.client_id) === (data.id || data.client_id));
          const totalParas = paragraphOrder.length || 0;
          const isFirstComponent = componentIndex === 0;
          const isLastComponent = componentIndex === orderedComponents.length - 1;

          if (data.paragraph_type === 'page_break') {
            content.push({
              type: 'page-break',
              id: `para-${data.id || data.client_id}`,
              paragraphId: data.id || data.client_id,
              sectionId: sectionKey,
              estimatedHeight: 0,
              forceNewPage: true,
              render: () => renderParagraph(data, section, Math.max(0, paraIndex), totalParas, {
                onMoveUp: () => onComponentMove?.(sectionKey, componentIndex, componentIndex - 1),
                onMoveDown: () => onComponentMove?.(sectionKey, componentIndex, componentIndex + 1),
                isFirst: isFirstComponent,
                isLast: isLastComponent,
              })
            });
          } else {
            const paraText = getParagraphText(data);
            const textLines = Math.ceil((paraText.length || 50) / 80);
            const textHeight = textLines * pageSettings.fontSize * 1.6;

            content.push({
              type: 'paragraph',
              id: `para-${data.id || data.client_id}`,
              paragraphId: data.id || data.client_id,
              sectionId: sectionKey,
              estimatedHeight: textHeight + 24,
              render: () => renderParagraph(data, section, Math.max(0, paraIndex), totalParas, {
                onMoveUp: () => onComponentMove?.(sectionKey, componentIndex, componentIndex - 1),
                onMoveDown: () => onComponentMove?.(sectionKey, componentIndex, componentIndex + 1),
                isFirst: isFirstComponent,
                isLast: isLastComponent,
              })
            });
          }
        } else if (type === 'latex_code' && data) {
          const latexKey = data.id || data.client_id || `latex-${sectionKey}-${componentIndex}`;
          const codeText = data?.latex_code ?? data?.edited_code ?? '';
          const lineCount = Math.max(3, codeText.split('\n').length);
          const estimatedHeight = lineCount * (pageSettings.fontSize * 1.4) + 60;
          const canMoveUp = componentIndex > 0;
          const canMoveDown = componentIndex < orderedComponents.length - 1;

          content.push({
            type: 'latex-code',
            id: `latex-${latexKey}`,
            latexCodeId: latexKey,
            sectionId: sectionKey,
            estimatedHeight,
            render: () => renderLatexCode(data, sectionKey, componentIndex, orderedComponents.length, {
              canMoveUp,
              canMoveDown,
              onMoveUp: () => onComponentMove?.(sectionKey, componentIndex, componentIndex - 1),
              onMoveDown: () => onComponentMove?.(sectionKey, componentIndex, componentIndex + 1),
            })
          });
        } else if (type === 'table' && data) {
          const index = tableOrder.findIndex((t) => (t.id || t.client_id) === (data.id || data.client_id));
          const rowHeight = 40;
          const headerHeight = 50;
          const rowCount = data?.data?.rows?.length ?? data?.rows ?? 3;
          const tableHeight = headerHeight + rowCount * rowHeight + 60;
          const tableKey = data.id || data.client_id || `table-${sectionKey}-${componentIndex}`;
          const canMoveUp = componentIndex > 0;
          const canMoveDown = componentIndex < orderedComponents.length - 1;

          content.push({
            type: 'table',
            id: `table-${tableKey}`,
            tableId: tableKey,
            sectionId: sectionKey,
            estimatedHeight: tableHeight,
            render: () => renderTable(data, sectionKey, Math.max(0, index), tableOrder.length, {
              canMoveUp,
              canMoveDown,
              onMoveUp: () => onComponentMove?.(sectionKey, componentIndex, componentIndex - 1),
              onMoveDown: () => onComponentMove?.(sectionKey, componentIndex, componentIndex + 1),
            })
          });
        } else if (type === 'image' && data) {
          let estimatedHeight = 200;
          if (data.size_mode === 'small') estimatedHeight = 150;
          else if (data.size_mode === 'medium') estimatedHeight = 250;
          else if (data.size_mode === 'large') estimatedHeight = 350;
          else if (data.size_mode === 'full') estimatedHeight = 400;
          estimatedHeight += (data.margin_top || 10) + (data.margin_bottom || 10);
          if (data.show_caption && data.caption) {
            estimatedHeight += 40;
          }
          const canMoveUp = componentIndex > 0;
          const canMoveDown = componentIndex < orderedComponents.length - 1;
          const canReorder = typeof onComponentMove === 'function';

          content.push({
            type: 'image-component',
            id: `img-comp-${data.id || data.client_id}`,
            imageComponentId: data.id || data.client_id,
            sectionId: sectionKey,
            estimatedHeight,
            render: () => renderImageComponent(data, sectionKey, {
              canMoveUp,
              canMoveDown,
              onMoveUp: canReorder && canMoveUp
                ? () => onComponentMove(sectionKey, componentIndex, componentIndex - 1)
                : null,
              onMoveDown: canReorder && canMoveDown
                ? () => onComponentMove(sectionKey, componentIndex, componentIndex + 1)
                : null,
            })
          });
        } else if ((type === 'file' || type === 'document_reference') && data) {
          const referenceId = data.id || data.client_id || `${sectionKey}-${componentIndex}`;
          const fileUrl =
            data?.file_url ||
            data?.file_metadata?.file_url ||
            data?.file_metadata?.file ||
            data?.file;
          const rawFileType =
            data?.file_metadata?.file_type ||
            data?.file_type ||
            data?.file_metadata?.mime_type ||
            '';
          const fileType = String(rawFileType).toLowerCase();
          const referencedDocId =
            data?.referenced_document_id ||
            data?.file_metadata?.referenced_document_id ||
            data?.file_metadata?.document;
          const looksLikePdf =
            fileType === 'pdf' ||
            fileType === 'application/pdf' ||
            (fileUrl && fileUrl.toLowerCase().includes('.pdf'));
          const isReferenceLike =
            Boolean(referencedDocId) ||
            type === 'document_reference' ||
            data?.display_mode === 'reference';
          const isReferencedPdf = isReferenceLike && looksLikePdf;
          const canMoveUp = componentIndex > 0;
          const canMoveDown = componentIndex < orderedComponents.length - 1;
          const canReorder = typeof onComponentMove === 'function';
          const componentMove = {
            onMoveUp: canReorder && canMoveUp
              ? () => onComponentMove(sectionKey, componentIndex, componentIndex - 1)
              : null,
            onMoveDown: canReorder && canMoveDown
              ? () => onComponentMove(sectionKey, componentIndex, componentIndex + 1)
              : null,
          };

          if (isReferencedPdf) {
            content.push({
              type: 'document-reference-inline',
              id: `doc-ref-inline-${referenceId}`,
              documentComponentId: referenceId,
              sectionId: sectionKey,
              estimatedHeight: 140,
              render: () => renderDocumentReferenceMarker(data, referenceId, componentMove)
            });

            referencedPdfComponents.push({
              component: data,
              referenceId
            });
            return;
          }

          let estimatedHeight = 120;
          if (data.preview_enabled) {
            estimatedHeight = 200;
          }
          estimatedHeight += (data.margin_top || 10) + (data.margin_bottom || 10);
          if (data.show_caption && data.caption) {
            estimatedHeight += 40;
          }

          content.push({
            type: 'document-component',
            id: `doc-comp-${referenceId}`,
            documentComponentId: referenceId,
            sectionId: sectionKey,
            estimatedHeight,
            render: () => renderDocumentComponent(data, sectionKey, componentMove)
          });
        } else if (type === 'section_reference' && data) {
          const estimatedHeight = data.include_full_content ? 300 : 150;
          content.push({
            type: 'section-reference',
            id: `sec-ref-${data.id || data.client_id}`,
            sectionRefId: data.id || data.client_id,
            sectionId: sectionKey,
            estimatedHeight,
            render: () => renderSectionReference(data, sectionKey)
          });
        }

        // Add content button after each component (WITHOUT section controls)
        if (!isPreviewMode && onAddTable) {
          const addId = `${sectionKey}-${type || 'component'}-${componentIndex}`;
          content.push({
            type: 'add-content-button',
            id: `add-content-${addId}`,
            sectionId: sectionKey,
            estimatedHeight: 24,
            render: () => renderAddContentButton(sectionKey, depth, parentId, componentIndex, false)
          });
        }
      });

      // After all components, add final button WITH section controls
      if (!isPreviewMode && onAddTable) {
        const finalInsertAfter = orderedComponents.length > 0 ? orderedComponents.length - 1 : -1;
        content.push({
          type: 'add-content-button',
          id: `add-content-${sectionKey}-end`,
          sectionId: sectionKey,
          estimatedHeight: 24,
          render: () => renderAddContentButton(sectionKey, depth, parentId, finalInsertAfter, true)
        });
      }

  // Section references in this section
      // DISABLED: API not ready yet, preventing paragraph editing issues
      // const sectionRefs = sectionReferences?.[section.id] || [];
      // sectionRefs.forEach((sectionRef, refIndex) => {
      //   // Safety check - skip invalid references
      //   if (!sectionRef || !sectionRef.id) {
      //     console.warn('Skipping invalid section reference at index:', refIndex);
      //     return;
      //   }
      //   // Estimate section reference height
      //   let estimatedHeight = 150; // Collapsed height
      //   if (sectionRef.include_full_content) {
      //     estimatedHeight = 300; // Expanded content takes more space
      //   }
      //   content.push({
      //     type: 'section-reference',
      //     id: `sec-ref-${sectionRef.id}`,
      //     sectionRefId: sectionRef.id,
      //     sectionId: section.id,
      //     estimatedHeight: estimatedHeight,
      //     render: () => renderSectionReference(sectionRef, section.id)
      //   });
      // });

      // Insert button after each section (root or nested)
      // Section insert row removed to avoid duplicate add buttons.

      // Children sections (ordered)
  const children = sortByOrder(section.children || []);
  children.forEach((child, childIdx) => processSection(child, depth + 1, sectionKey, childIdx, children, numbering));
    };

    const rootSections = sortByOrder(document.sections || []);
    rootSections.forEach((section, idx) => processSection(section, 0, null, idx, rootSections, ''));

    if (referencedPdfComponents.length > 0) {
      content.push({
        type: 'page-break',
        id: 'doc-ref-appendix-break',
        estimatedHeight: 0,
        forceNewPage: true,
        render: () => null,
      });

      content.push({
        type: 'appendix-header',
        id: 'doc-ref-appendix-header',
        estimatedHeight: 50,
        render: () => (
          <div className="mb-4 text-lg font-semibold text-gray-900">Referenced PDFs</div>
        )
      });

      referencedPdfComponents.forEach((entry, index) => {
        if (index > 0) {
          content.push({
            type: 'page-break',
            id: `doc-ref-appendix-break-${entry.referenceId}`,
            estimatedHeight: 0,
            forceNewPage: true,
            render: () => null,
          });
        }

        content.push({
          type: 'document-reference-appendix',
          id: `doc-ref-appendix-${entry.referenceId}`,
          documentComponentId: entry.referenceId,
          sectionId: 'appendix',
          estimatedHeight: 600,
          render: () => renderDocumentAppendix(entry.component, entry.referenceId)
        });
      });
    }

    if (!isPreviewMode && onAddSiblingSection && rootSections.length === 0) {
      content.push({
        type: 'end-actions',
        id: 'end-actions',
        estimatedHeight: 40,
        render: () => renderEndOfDocumentActions(),
      });
    }

    return content;
  };

  // Paginate content based on measurements
  const paginateContent = () => {
    const content = buildContentArray();

    // Pagination disabled: render everything in a single page container.
    const newPages = [];
    let currentPage = { content: [], height: 0 };
    content.forEach((item) => {
      const willOverflow = currentPage.height + item.estimatedHeight > contentHeight;
      const isForceBreak = item.forceNewPage;
      if ((willOverflow || isForceBreak) && currentPage.content.length > 0) {
        newPages.push(currentPage);
        currentPage = { content: [], height: 0 };
      }
      if (!item.forceNewPage) {
        currentPage.content.push(item);
        currentPage.height += item.estimatedHeight;
      }
    });
    if (currentPage.content.length > 0) {
      newPages.push(currentPage);
    }
    return newPages.length > 0 ? newPages : [{ content: [], height: 0 }];
  };

  // Re-paginate when content or settings change
  useEffect(() => {
    if (document?.sections) {
      const newPages = paginateContent();
      setPages(newPages);
    }
  }, [
    document, 
    pageSettings.size, 
    pageSettings.orientation, 
    pageSettings.margins, 
    pageSettings.fontSize,
    pageSettings.typeScale,
    sectionTables,              // Re-paginate when tables data changes
    sectionImageComponents,      // Re-paginate when images data changes
    sectionDocumentComponents,   // Re-paginate when document components data changes
    // sectionReferences removed - not in use until API is ready
  ]);

  // Render functions
  const renderTitle = () => (
    <div className="mb-4 border-b border-gray-200 pb-3">
      {isPreviewMode ? (
        <h1 
          className="font-bold text-gray-900 leading-tight break-words overflow-wrap-anywhere"
          style={{ fontSize: 'var(--doc-h1-size)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
        >
          {document.title}
        </h1>
      ) : (
        <textarea
          value={document.title}
          onChange={(e) => {
            onUpdate({ title: e.target.value });
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          style={{ fontSize: 'var(--doc-h1-size)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          className="font-bold w-full border-none focus:ring-0 px-0 placeholder-gray-300 resize-none overflow-hidden leading-tight bg-transparent focus:outline-none break-words"
          placeholder="Document Title"
          rows={1}
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
        />
      )}
    </div>
  );

  const renderSectionHeader = (section, depth, parentId, siblingIndex, siblingsCount, numbering, dragHandleProps) => {
    const sectionId = section?.id || section?.client_id;
    const highlightClass = getHighlightClass('sections', sectionId);
    const sectionCallouts = sectionId ? (aiCalloutMaps.bySection.get(String(sectionId)) || []) : [];
    return (
    <div
      className={`group relative mb-1 transition-all rounded-lg hover:bg-gray-50/40 py-0.5 px-1 ${highlightClass}`}
      data-section-id={sectionId}
    >
      {!isPreviewMode && (
        <>
          {/* Drag Handle - Left side */}
          <div 
            {...dragHandleProps}
            className="absolute -left-8 top-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10"
            title="Drag to reorder section"
          >
            <GripVertical size={20} className="text-gray-400 hover:text-blue-600" />
          </div>
          
          {/* Action Buttons - Right side */}
          <div className="absolute top-1 right-1 flex gap-1 z-10">
            {/* Inference & Cross-ref — always subtly visible */}
            {crossRef && (
              <div className="flex gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity bg-white/80 rounded-md px-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); crossRef.selectSource(sectionId, 'section'); if (!crossRef.enabled) crossRef.toggle(); }}
                  className={`p-1.5 rounded transition-colors ${crossRef.sourceId === sectionId ? 'bg-indigo-100 text-indigo-600 !opacity-100' : 'text-gray-400 hover:bg-indigo-50 hover:text-indigo-500'}`}
                  title="Show cross-references"
                >
                  <Network size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (crossRef.runSectionInference) crossRef.runSectionInference(sectionId);
                    if (crossRef.openInferencePanel) crossRef.openInferencePanel();
                  }}
                  className="p-1.5 rounded text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                  title="Run inference — analyze this section"
                >
                  <Sparkles size={14} />
                </button>
              </div>
            )}
            {/* Other actions — hover only */}
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-md px-0.5">
            {renderCommentBadge(sectionId, 'section')}
            {onAiChat && (
              <button 
                onClick={() => onAiChat({ scope: 'section', scopeId: sectionId, scopeLabel: section.title || 'Untitled' })}
                className="p-1.5 hover:bg-purple-50 rounded text-gray-400 hover:text-purple-600 transition-colors" 
                title="AI Chat – this section"
              >
                <Bot size={16} />
              </button>
            )}
            <button 
              onClick={() => onSectionDelete(section.id)} 
              className="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 transition-colors" 
              title="Delete Section"
            >
              <Trash2 size={16} />
            </button>
            </div>
          </div>
        </>
      )}
      {renderAiReviewCallouts(sectionCallouts)}
      <SectionHeader 
        section={section}
        depth={depth}
        numbering={numbering}
        editable={!isPreviewMode}
        onTitleChange={(title) => {
          const sectionKey = section.id || section.client_id;
          if (sectionKey) {
            onSectionUpdate(sectionKey, { title });
          }
        }}
        onTypeChange={(type) => {
          const sectionKey = section.id || section.client_id;
          if (sectionKey) {
            onSectionUpdate(sectionKey, { section_type: type });
          }
        }}
        onOpenMetadata={onOpenMetadata}
      />

      {/* Inline hierarchy info removed */}
    </div>
    );
  };

  const renderEndOfDocumentActions = () => {
    if (isPreviewMode || !onAddSiblingSection) return null;

    const rootSections = document?.sections || [];
    const lastIndex = rootSections.length - 1;
    const lastSection = lastIndex >= 0 ? rootSections[lastIndex] : null;
    const lastSectionId = lastSection?.id || lastSection?.client_id || null;
    const lastDepth = typeof lastSection?.depth_level === 'number'
      ? Math.max(0, lastSection.depth_level - 1)
      : 0;
    const createRootSection = () => {
      const created = onAddSiblingSection({ parentId: null, insertAfter: lastIndex, depth: 0 });
      return created?.id || created?.client_id || null;
    };

    return (
      <div className="my-4 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => onAddSiblingSection({ parentId: null, insertAfter: lastIndex, depth: 0 })}
          className="px-2.5 py-1 text-[11px] border border-dashed border-blue-300 text-blue-600 rounded-full hover:bg-blue-50 transition-colors flex items-center gap-1.5"
          title="Add section here"
        >
          <Plus size={11} /> Add Section
        </button>
        <button
          onClick={() => {
            const targetId = lastSectionId || createRootSection();
            if (targetId) {
              onAddParagraph?.(targetId, '');
            }
          }}
          className="px-2.5 py-1 text-[11px] border border-dashed border-emerald-300 text-emerald-600 rounded-full hover:bg-emerald-50 transition-colors flex items-center gap-1.5"
          title="Add paragraph"
        >
          <Plus size={11} /> Add Paragraph
        </button>
        <button
          onClick={() => {
            const targetId = lastSectionId || createRootSection();
            if (targetId) {
              onAddSubsection?.(targetId, lastDepth);
            }
          }}
          className="px-2.5 py-1 text-[11px] border border-dashed border-purple-300 text-purple-600 rounded-full hover:bg-purple-50 transition-colors flex items-center gap-1.5"
          title="Add subsection"
        >
          <Plus size={11} /> Add Subsection
        </button>
      </div>
    );
  };

  const renderParagraph = (paragraph, section, paraIndex, totalParas, componentMove = null) => {
    const sectionId = section?.id || section?.client_id;
    const paragraphIdentifier = paragraph.id || paragraph.client_id;
    const isFirst = componentMove?.isFirst ?? paraIndex === 0;
    const isLast = componentMove?.isLast ?? totalParas - 1 === paraIndex;
    const highlightClass = getHighlightClass('paragraphs', paragraphIdentifier);
    const paragraphCallouts = paragraphIdentifier
      ? (aiCalloutMaps.byParagraph.get(String(paragraphIdentifier)) || [])
      : [];

    return (
      <div className={`relative ${highlightClass} ${highlightClass ? 'px-1 py-0.5' : ''}`} data-metadata-id={paragraphIdentifier}>
        {renderAiReviewCallouts(paragraphCallouts)}
        <SimpleParagraphEditor
          key={paragraphIdentifier}
          paragraph={paragraph}
          documentId={documentId}
          documentMetadata={documentMetadata}
          isPreviewMode={isPreviewMode}
          isFirst={isFirst}
          isLast={isLast}
          onOpenMetadata={onOpenMetadata}
          onOpenHistory={onOpenHistory}
          onAiChat={onAiChat}
          onPartialSaveForAi={onParagraphAiPartialSave}
          onAiReviewResult={onAiReviewResult}
          onInference={crossRef ? (id, type) => {
            if (crossRef.runComponentInference) crossRef.runComponentInference(type, id);
            if (crossRef.openInferencePanel) crossRef.openInferencePanel();
          } : undefined}
          onCrossRef={crossRef ? (id, type) => {
            if (!crossRef.enabled) crossRef.toggle();
            crossRef.selectSource(id, type);
          } : undefined}
          crossRefActive={crossRef?.sourceId === paragraphIdentifier}
          sectionId={sectionId}
          aiScoringEnabled={aiScoringEnabled}
          reviewCommentCount={reviewCommentCounts[paragraphIdentifier] || null}
          onOpenReviewComments={onOpenReviewComments ? () => onOpenReviewComments(paragraphIdentifier, 'paragraph') : undefined}
          onUpdate={(updates) => {
            onParagraphUpdate(paragraphIdentifier, updates);
          }}
          onDelete={() => onParagraphDelete(paragraphIdentifier)}
          onFocusEditor={onActiveEditorChange}
          onMoveUp={() => {
            if (componentMove?.onMoveUp) {
              componentMove.onMoveUp();
            } else if (onParagraphReorder && paraIndex > 0) {
              onParagraphReorder(sectionId, paraIndex, paraIndex - 1);
            }
          }}
          onMoveDown={() => {
            if (componentMove?.onMoveDown) {
              componentMove.onMoveDown();
            } else if (onParagraphReorder && paraIndex < totalParas - 1) {
              onParagraphReorder(sectionId, paraIndex, paraIndex + 1);
            }
          }}
        />
      </div>
    );
  };

  const renderLatexCode = (latexCode, sectionId, index, total, componentMove = null) => {
    const latexKey = latexCode?.id || latexCode?.client_id;
    const canMoveUp = componentMove?.canMoveUp ?? index > 0;
    const canMoveDown = componentMove?.canMoveDown ?? index < total - 1;
    return (
      <div key={`latex-${latexKey}`} className="group/ltx my-2 relative" data-metadata-id={latexKey}>
        {/* Inference + Cross-ref icons — top right, visible on hover */}
        {!isPreviewMode && crossRef && (
          <div className="absolute top-1 right-1 z-10 flex gap-1 opacity-0 group-hover/ltx:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); crossRef.selectSource(latexKey, 'latex_code'); if (!crossRef.enabled) crossRef.toggle(); }}
              className={`p-1 border rounded ${
                crossRef.sourceId === latexKey
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-600'
                  : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-500'
              }`}
              title="Show cross-references"
            >
              <Network size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); crossRef.selectSource(latexKey, 'latex_code'); if (!crossRef.enabled) crossRef.toggle(); }}
              className="p-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-600 rounded"
              title="Run inference — analyze this block"
            >
              <Sparkles size={12} />
            </button>
          </div>
        )}
        <LatexCodeEditor
          latexCode={latexCode}
          sectionId={sectionId}
          documentId={documentId}
          isPreviewMode={isPreviewMode}
          isFirst={!canMoveUp}
          isLast={!canMoveDown}
          onFocusEditor={onActiveEditorChange}
          onMoveUp={canMoveUp ? (componentMove?.onMoveUp || (() => onComponentMove?.(sectionId, index, index - 1))) : undefined}
          onMoveDown={canMoveDown ? (componentMove?.onMoveDown || (() => onComponentMove?.(sectionId, index, index + 1))) : undefined}
          onUpdate={(updates) => onLatexCodeUpdate?.(latexKey, updates)}
          onDelete={() => onLatexCodeDelete?.(latexKey)}
          reviewCommentCount={reviewCommentCounts[latexKey] || null}
          onOpenReviewComments={onOpenReviewComments ? () => onOpenReviewComments(latexKey, 'paragraph') : undefined}
          onOpenMetadata={onOpenMetadata}
        />
      </div>
    );
  };

  const renderAddContentButton = (sectionId, depth, parentId, insertAfter, showSectionControls = false) => (
    <div key={`add-content-${sectionId}`} className="group justify-center flex flex-wrap items-center gap-1 my-0.5">
      <AddContentButton
        onAddParagraph={(text) => onAddParagraph(sectionId, text, { insertAfter })}
        onAddLatexCode={() => onAddLatexCode?.(sectionId, { insertAfter })}
        onAddAILatexCode={() => onAddAILatexCode?.(sectionId, { insertAfter })}
        onAddTable={() => onAddTable(sectionId, { insertAfter })}
        onAddImage={onAddImageToDocument ? (imageData) => {
          // If imageData is provided (from drag & drop), handle it directly
          if (imageData) {
            handleDirectImageAdd(sectionId, imageData, insertAfter);
          } else {
            // Otherwise show the image browser or open sidebar
            if (onOpenImageSidebar) {
              onOpenImageSidebar(sectionId, insertAfter);
            } else {
              setShowingImageBrowserFor(sectionId);
            }
          }
        } : null}
        onAddDocument={onAddDocumentToDocument ? () => {
          if (onOpenDocumentSidebar) {
            onOpenDocumentSidebar(sectionId, insertAfter);
          } else {
            setShowingImageBrowserFor(`doc-${sectionId}`);
          }
        } : null}
  onAddSectionReference={(referenceData) => handleAddSectionReference(sectionId, referenceData, insertAfter)}
        onCopySection={(dropData) => handleCopySection(sectionId, dropData)}
        onAddComment={() => {/* Could add comment */}}
      />
      {showSectionControls && onAddSiblingSection && (
        <button
          onClick={() => onAddSiblingSection({ parentId, insertAfter, depth, sectionId })}
          className="px-2 py-1 text-[10px] border border-dashed border-blue-300 text-blue-600 rounded-full hover:bg-blue-50 transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
          title="Add section"
          type="button"
        >
          <Plus size={10} /> Section
        </button>
      )}
      {showSectionControls && onAddSubsection && (
        <button
          onClick={() => onAddSubsection(sectionId, depth)}
          className="px-2 py-1 text-[10px] border border-dashed border-purple-300 text-purple-600 rounded-full hover:bg-purple-50 transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
          title="Add subsection"
          type="button"
        >
          <Plus size={10} /> Subsection
        </button>
      )}
    </div>
  );

  const renderTable = (table, sectionId, index, total, componentMove = null) => {
    const tableKey = table.id || table.client_id;
    const canMoveUp = componentMove?.canMoveUp ?? index > 0;
    const canMoveDown = componentMove?.canMoveDown ?? index < total - 1;
    const highlightClass = getHighlightClass('tables', tableKey);
    return (
      <div key={`table-${tableKey}`} className={`group/tbl my-3 relative ${highlightClass} ${highlightClass ? 'p-1' : ''}`} data-metadata-id={tableKey}>
        {/* Inference + Cross-ref icons — top right, visible on hover */}
        {!isPreviewMode && crossRef && (
          <div className="absolute top-1 right-1 z-10 flex gap-1 opacity-0 group-hover/tbl:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); crossRef.selectSource(tableKey, 'table'); if (!crossRef.enabled) crossRef.toggle(); }}
              className={`p-1 border rounded ${
                crossRef.sourceId === tableKey
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-600'
                  : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-500'
              }`}
              title="Show cross-references"
            >
              <Network size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); crossRef.selectSource(tableKey, 'table'); if (!crossRef.enabled) crossRef.toggle(); }}
              className="p-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-600 rounded"
              title="Run inference — analyze this table"
            >
              <Sparkles size={12} />
            </button>
          </div>
        )}
        <DocumentTable
          table={table}
          sectionId={sectionId}
          editable={!isPreviewMode}
          onMoveUp={canMoveUp ? (componentMove?.onMoveUp || (() => onTableMove?.(sectionId, index, index - 1))) : undefined}
          onMoveDown={canMoveDown ? (componentMove?.onMoveDown || (() => onTableMove?.(sectionId, index, index + 1))) : undefined}
          onUpdate={(nextTable) => onTableUpdate(sectionId, tableKey, nextTable)}
          onDelete={() => onTableDelete(sectionId, tableKey)}
          onOpenMetadata={onOpenMetadata}
          onAiChat={onAiChat}
          onFocusEditor={onActiveEditorChange}
          reviewCommentCount={reviewCommentCounts[tableKey] || null}
          onOpenReviewComments={onOpenReviewComments ? () => onOpenReviewComments(tableKey, 'table') : undefined}
        />
      </div>
    );
  };

  const renderImageComponent = (imageComp, sectionId, componentMove = null) => {
    const imageId = imageComp?.id || imageComp?.client_id;
    const highlightClass = getHighlightClass('images', imageId);
    return (
      <div key={`img-comp-${imageComp.id}`} className={`my-2 relative ${highlightClass} ${highlightClass ? 'p-1' : ''}`} data-metadata-id={imageId}>
        <ImageComponent
          data={imageComp}
          onUpdate={onImageComponentUpdate}
          onDelete={onImageComponentDelete}
          onSelect={onImageComponentSelect}
          isSelected={selectedImageComponentId === imageComp.id}
          isEditable={!isPreviewMode}
          showControls={!isPreviewMode}
          onMoveUp={componentMove?.onMoveUp ?? undefined}
          onMoveDown={componentMove?.onMoveDown ?? undefined}
          isFirst={!componentMove?.canMoveUp}
          isLast={!componentMove?.canMoveDown}
          reviewCommentCount={reviewCommentCounts[imageId] || null}
          onOpenReviewComments={onOpenReviewComments ? () => onOpenReviewComments(imageId, 'image') : undefined}
        />
      </div>
    );
  };

  const renderDocumentComponent = (docComp, sectionId, componentMove = null) => {
    const fileId = docComp?.id || docComp?.client_id;
    const highlightClass = getHighlightClass('files', fileId);
    const fileUrl =
      docComp?.file_url ||
      docComp?.file_metadata?.file_url ||
      docComp?.file_metadata?.file ||
      docComp?.file;
    const rawFileType =
      docComp?.file_metadata?.file_type ||
      docComp?.file_type ||
      docComp?.file_metadata?.mime_type ||
      '';
    const fileType = String(rawFileType).toLowerCase();
    const isPdf =
      fileType === 'pdf' ||
      fileType === 'application/pdf' ||
      (fileUrl && fileUrl.toLowerCase().includes('.pdf'));

    const componentForRender = isPdf
      ? {
          ...docComp,
          display_mode: 'pages',
          preview_enabled: true,
        }
      : docComp;

    return (
      <div key={`doc-comp-${docComp.id}`} className={`my-2 relative ${highlightClass} ${highlightClass ? 'p-1' : ''}`} data-metadata-id={fileId}>
        <DocumentFileComponent
          component={componentForRender}
          onEdit={onDocumentComponentUpdate}
          onDelete={onDocumentComponentDelete}
          onMoveUp={componentMove?.onMoveUp ?? undefined}
          onMoveDown={componentMove?.onMoveDown ?? undefined}
          editable={!isPreviewMode}
          showControls={!isPreviewMode}
        />
      </div>
    );
  };

  const renderDocumentReferenceMarker = (docComp, referenceId, componentMove = null) => {
    const inlineComponent = {
      ...docComp,
      display_mode: 'reference',
      preview_enabled: false,
    };

    return (
      <div id={`doc-ref-marker-${referenceId}`} className="my-2">
        <DocumentFileComponent
          component={inlineComponent}
          onMoveUp={componentMove?.onMoveUp ?? undefined}
          onMoveDown={componentMove?.onMoveDown ?? undefined}
          editable={false}
          showControls={false}
        />
        <div className="text-xs text-blue-600 mt-2">
          <a href={`#doc-ref-appendix-${referenceId}`}>
            View referenced PDF pages in appendix
          </a>
        </div>
      </div>
    );
  };

  const renderDocumentAppendix = (docComp, referenceId) => {
    const appendixComponent = {
      ...docComp,
      display_mode: 'pages',
      preview_enabled: true,
    };

    const label = appendixComponent.label
      || appendixComponent.file_metadata?.name
      || appendixComponent.file_name
      || 'Referenced Document';

    return (
      <div className="my-6" id={`doc-ref-appendix-${referenceId}`}>
        <div className="mb-3 border-b border-gray-200 pb-2">
          <h3 className="text-base font-semibold text-gray-900">Referenced PDF: {label}</h3>
          <a className="text-xs text-blue-600" href={`#doc-ref-marker-${referenceId}`}>
            Back to reference
          </a>
        </div>
        <DocumentFileComponent
          component={appendixComponent}
          editable={false}
          showControls={false}
        />
      </div>
    );
  };

  const renderSectionReference = (sectionRef, sectionId) => {
    // Safety check - ensure we have a valid section reference
    if (!sectionRef || !sectionRef.id) {
      console.warn('Invalid section reference:', sectionRef);
      return null;
    }

    return (
      <div key={`sec-ref-${sectionRef.id}`} className="my-2">
        <SectionReferenceComponent
          reference={sectionRef}
          onUpdate={async (updates) => {
            try {
              const updated = await sectionReferenceService.updateReference(sectionRef.id, updates);
              // Update local state
              setSectionReferences(prev => ({
                ...prev,
                [sectionId]: prev[sectionId].map(ref => 
                  ref.id === sectionRef.id ? updated : ref
                )
              }));
            } catch (error) {
              console.error('Failed to update section reference:', error);
            }
          }}
          onDelete={async () => {
            try {
              await sectionReferenceService.deleteReference(sectionRef.id);
              // Update local state
              setSectionReferences(prev => ({
                ...prev,
                [sectionId]: prev[sectionId].filter(ref => ref.id !== sectionRef.id)
              }));
            } catch (error) {
              console.error('Failed to delete section reference:', error);
            }
          }}
          isEditable={!isPreviewMode}
        />
      </div>
    );
  };

  // Handle drag end for section reordering
  const handleDragEnd = (result) => {
    if (!result.destination || !onSectionReorder) return;
    
    const { source, destination } = result;
    if (source.index === destination.index) return;

    // Get flat list of root sections
    const sections = document?.sections || [];
    const reordered = Array.from(sections);
    const [moved] = reordered.splice(source.index, 1);
    reordered.splice(destination.index, 0, moved);

    // Update order values
    const withOrder = reordered.map((s, idx) => ({ ...s, order: idx }));
    
    // Call parent handler
    onSectionReorder(withOrder);
  };

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="space-y-6 relative" ref={documentContainerRef}>
          {/* Cross-reference SVG overlay */}
          {crossRef?.enabled && crossRef?.sourceId && (
            <CrossReferenceOverlay
              enabled={crossRef.enabled}
              sourceId={crossRef.sourceId}
              sourceType={crossRef.sourceType}
              edges={crossRef.edges || []}
              containerRef={documentContainerRef}
              onSelectSource={crossRef.selectSource}
              onClearSource={crossRef.clearSource}
            />
          )}
          {pages.map((page, pageIndex) => (
            <div
              key={pageIndex}
              className="bg-white shadow-2xl relative"
              style={{
                width: `${pageWidth}px`,
                minHeight: `${pageHeight}px`,
                padding: `${pageSettings.margins}px`,
                '--doc-margin-x': `${pageSettings.margins}px`,
                fontSize: `${pageSettings.fontSize}px`,
                '--doc-base-size': `${pageSettings.fontSize}px`,
                '--doc-h1-size': `${(pageSettings.fontSize * Math.pow(pageSettings.typeScale, 4)).toFixed(1)}px`,
                '--doc-h2-size': `${(pageSettings.fontSize * Math.pow(pageSettings.typeScale, 3)).toFixed(1)}px`,
                '--doc-h3-size': `${(pageSettings.fontSize * Math.pow(pageSettings.typeScale, 2)).toFixed(1)}px`,
                '--doc-h4-size': `${(pageSettings.fontSize * Math.pow(pageSettings.typeScale, 1)).toFixed(1)}px`,
              }}
            >
            {/* Page Number */}
            <div className="absolute bottom-4 right-8 text-xs text-gray-400 font-medium">
              Page {pageIndex + 1} of {pages.length}
            </div>

            {/* Logo on first page */}
            {pageIndex === 0 && document.logo_url && (
              <img 
                src={getImageUrl(document.logo_url)} 
                alt="Logo" 
                className="absolute top-8 right-8 h-16 object-contain" 
              />
            )}

            {/* Content - Wrap in Droppable for drag-and-drop */}
            <Droppable droppableId={`page-${pageIndex}`} type="section">
              {(provided, snapshot) => (
                <div 
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`relative ${snapshot.isDraggingOver ? 'bg-blue-50/20 rounded' : ''}`}
                >
                  {page.content.map((item, idx) => {
                    // Create a unique key for this item on this page
                    const uniqueKey = `page-${pageIndex}-${idx}-${item.id}`;
                    
                    // Wrap root section headers in Draggable
                    if (item.type === 'section-header' && !isPreviewMode && item.depth === 0) {
                      const sectionIndex = document?.sections?.findIndex(s => s.id === item.sectionId) || 0;
                      return (
                        <Draggable
                          key={uniqueKey}
                          draggableId={item.id}
                          index={sectionIndex}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`transition-all ${snapshot.isDragging ? 'bg-blue-100 shadow-lg rounded-lg opacity-90 rotate-1 z-50' : ''}`}
                            >
                              <div ref={el => contentRefs.current[item.id] = el}>
                                {item.render(provided.dragHandleProps)}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    }
                    
                    // Regular content (paragraphs, subsections, etc.)
                    return (
                      <div 
                        key={uniqueKey}
                        ref={el => contentRefs.current[item.id] = el}
                        className="transition-all"
                      >
                        {item.render && item.render()}
                      </div>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>

            {/* Dimension Debug Overlay - hidden by default to save space */}
          </div>
        ))}
      </div>
    </DragDropContext>
    
    {/* Image/Document Library Browser Modal */}
    {!isPreviewMode && showingImageBrowserFor && (onAddImageToDocument || onAddDocumentToDocument) && (
      <div className="image-library-modal-overlay" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem'
      }}>
        <div style={{ width: '90%', maxWidth: '900px' }}>
          {showingImageBrowserFor && showingImageBrowserFor.startsWith('doc-') ? (
            <DocumentLibraryBrowser
              onSelectDocument={(doc) => {
                const sectionId = showingImageBrowserFor.replace('doc-', '');
                onAddDocumentToDocument(doc, sectionId, 0);
                setShowingImageBrowserFor(null);
              }}
              onClose={() => setShowingImageBrowserFor(null)}
              showUpload={true}
            />
          ) : (
            <ImageLibraryBrowser
              onSelectImage={(image) => {
                onAddImageToDocument(image, showingImageBrowserFor, 0);
                setShowingImageBrowserFor(null);
              }}
              onClose={() => setShowingImageBrowserFor(null)}
              showUpload={true}
            />
          )}
        </div>
      </div>
    )}
  </>
  );
};

export default PagedDocument;
