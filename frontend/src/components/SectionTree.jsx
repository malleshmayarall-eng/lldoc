import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { ChevronRight, ChevronDown, Plus, Trash2, MoreVertical, GripVertical } from 'lucide-react';

/**
 * SectionTree - Hierarchical section tree with drag-drop and inline editing
 * Shows document structure with nested subsections
 */
const SectionTree = ({ 
  section, 
  depth = 0,
  index = 0,
  onAddSubsection,
  onEditSection,
  onDeleteSection,
  onSelectSection,
  selectedSectionId,
  maxDepth = 6,
  draggableId,
  isDraggingOver = false
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);
  
  const indent = depth * 20;
  const hasChildren = section.children && section.children.length > 0;
  const sectionKey = section.id || section.client_id;
  const isSelected = selectedSectionId === sectionKey;
  const canAddSubsection = depth < maxDepth;

  const numbering = section.custom_metadata?.numbering || section.numbering || (typeof section.order === 'number' ? `${section.order + 1}` : section.id);
  const paragraphCount = Array.isArray(section.paragraphs) ? section.paragraphs.length : section.paragraph_count ?? 0;
  const childCount = Array.isArray(section.children) ? section.children.length : 0;
  const sectionType = section.section_type || getDepthLabel(depth).toLowerCase();
  
  const getDepthLabel = (depth) => {
    const labels = [
      'Article',
      'Section',
      'Subsection',
      'Clause',
      'Sub-clause',
      'Item',
      'Sub-item',
      'Point',
      'Sub-point',
      'Detail'
    ];
    return labels[depth] || `Level ${depth + 1}`;
  };

  return (
  <Draggable draggableId={draggableId || sectionKey} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className="section-tree-item"
        >
          <div 
            className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-all group hover:bg-gray-50 ${
              isSelected ? 'bg-blue-50 border-l-4 border-blue-600 pl-2' : ''
            } ${
              snapshot.isDragging ? 'bg-blue-100 shadow-lg opacity-90 rotate-1' : ''
            }`}
            style={{ marginLeft: `${indent}px` }}
            onMouseEnter={() => setShowActions(true)}
            onMouseLeave={() => setShowActions(false)}
          >
            {/* Drag Handle */}
            <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
              <GripVertical className="w-4 h-4 text-gray-400 hover:text-gray-600" />
            </div>

            {/* Expand/Collapse Toggle */}
            {hasChildren && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-0.5 hover:bg-gray-200 rounded transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-600" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                )}
              </button>
            )}
            
            {/* Spacer for items without children */}
            {!hasChildren && <div className="w-5" />}
            
            {/* Section Info */}
            <div 
              className="flex-1 flex items-center gap-2 cursor-pointer"
              onClick={() => onSelectSection?.(section)}
            >
              {/* Depth Badge */}
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide min-w-[60px]">
                {getDepthLabel(depth)}
              </span>
              
              {/* Numbering */}
              <span className="font-mono text-sm font-semibold text-blue-600 min-w-[40px]">
                {numbering}
              </span>
              
              {/* Title */}
              <div className="flex flex-col">
                <span className={`text-sm ${isSelected ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {section.title || 'Untitled Section'}
                </span>
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 capitalize">{sectionType}</span>
                  {paragraphCount > 0 && <span>{paragraphCount} {paragraphCount === 1 ? 'paragraph' : 'paragraphs'}</span>}
                  {childCount > 0 && <span>• {childCount} {childCount === 1 ? 'subsection' : 'subsections'}</span>}
                  <span className="text-gray-400">ID: {section.id?.slice(0, 8)}</span>
                </div>
              </div>
            </div>
            
            {/* Actions (show on hover) */}
            {(showActions || isSelected) && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {canAddSubsection && onAddSubsection && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!sectionKey) return;
                      onAddSubsection(sectionKey, depth);
                    }}
                    className="p-1 hover:bg-blue-100 rounded text-blue-600 transition-colors"
                    title={`Add ${getDepthLabel(depth + 1)}`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
                
                
                {onDeleteSection && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${section.title}"?`)) {
                        onDeleteSection(section.id);
                      }
                    }}
                    className="p-1 hover:bg-red-100 rounded text-red-600 transition-colors"
                    title="Delete Section"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
          
          {/* Children (recursive with nested droppable) */}
          {hasChildren && isExpanded && (
            <Droppable droppableId={`children-${sectionKey}`} type={`depth-${depth + 1}`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`section-tree-children ${snapshot.isDraggingOver ? 'bg-blue-50/50 rounded' : ''}`}
                >
                  {section.children.map((child, idx) => (
                    <SectionTree
                      key={child.id || child.client_id}
                      section={child}
                      depth={depth + 1}
                      index={idx}
                      onAddSubsection={onAddSubsection}
                      onEditSection={onEditSection}
                      onDeleteSection={onDeleteSection}
                      onSelectSection={onSelectSection}
                      selectedSectionId={selectedSectionId}
                      maxDepth={maxDepth}
                      draggableId={`${sectionKey}-${child.id || child.client_id}`}
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      )}
    </Draggable>
  );
};

/**
 * DocumentSectionTree - Complete tree view for document hierarchy with drag-and-drop
 */
export const DocumentSectionTree = ({ 
  document, 
  onAddSection,
  onAddSubsection,
  onEditSection,
  onDeleteSection,
  onSelectSection,
  onReorderSections, // NEW: callback for when sections are reordered
  selectedSectionId,
  maxDepth = 10,
}) => {
  const [isDirty, setIsDirty] = useState(false);

  /**
   * Handle drag end - updates section order
   */
  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;

    // Dropped outside or no movement
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) {
      return;
    }

    console.log('🎯 Drag end:', { source, destination, draggableId });

    // Get source and destination containers
    const sourceDroppableId = source.droppableId;
    const destDroppableId = destination.droppableId;

    // Clone sections for manipulation
    let updatedSections = JSON.parse(JSON.stringify(document.children || []));

    // Helper to find section by path
    const findSectionByPath = (sections, droppableId) => {
      if (droppableId === 'root-sections') {
        return { sections, parent: null };
      }

      // Parse children-<sectionId> format
  const parentId = droppableId.replace('children-', '');
      
      const findRecursive = (secs, path = []) => {
        for (let i = 0; i < secs.length; i++) {
          const sec = secs[i];
          const secKey = sec.id || sec.client_id;
          if (secKey === parentId) {
            return { sections: sec.children || [], parent: sec, path: [...path, i] };
          }
          if (sec.children && sec.children.length > 0) {
            const result = findRecursive(sec.children, [...path, i, 'children']);
            if (result) return result;
          }
        }
        return null;
      };

      return findRecursive(sections);
    };

    // Get source and destination arrays
    const sourceContainer = findSectionByPath(updatedSections, sourceDroppableId);
    const destContainer = findSectionByPath(updatedSections, destDroppableId);

    if (!sourceContainer || !destContainer) {
      console.error('Could not find source or destination container');
      return;
    }

    // Same container - reorder
    if (sourceDroppableId === destDroppableId) {
      const items = Array.from(sourceContainer.sections);
      const [removed] = items.splice(source.index, 1);
      items.splice(destination.index, 0, removed);

      // Update order values
      const reordered = items.map((item, idx) => ({
        ...item,
        order: idx
      }));

      // Update in the tree
      if (sourceDroppableId === 'root-sections') {
        updatedSections = reordered;
      } else {
        sourceContainer.parent.children = reordered;
      }
    }
    // Different containers - move to new parent
    else {
      const sourceItems = Array.from(sourceContainer.sections);
      const destItems = Array.from(destContainer.sections);

      const [movedItem] = sourceItems.splice(source.index, 1);
      destItems.splice(destination.index, 0, movedItem);

      // Update parent and depth for moved item
      const newDepth = destDroppableId === 'root-sections' ? 1 : (destContainer.parent.depth_level || 1) + 1;
      movedItem.depth_level = newDepth;
      movedItem.parent = destDroppableId === 'root-sections'
        ? null
        : (destContainer.parent.id || destContainer.parent.client_id);

      // Update order values
      const reorderedSource = sourceItems.map((item, idx) => ({ ...item, order: idx }));
      const reorderedDest = destItems.map((item, idx) => ({ ...item, order: idx }));

      // Update in tree
      if (sourceDroppableId === 'root-sections') {
        updatedSections = reorderedSource;
      } else {
        sourceContainer.parent.children = reorderedSource;
      }

      if (destDroppableId === 'root-sections') {
        updatedSections = reorderedDest;
      } else {
        destContainer.parent.children = reorderedDest;
      }
    }

    // Notify parent component
    setIsDirty(true);
    if (onReorderSections) {
      onReorderSections(updatedSections);
    }
  };

  if (!document || !document.children) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p className="mb-4">No sections yet</p>
        {onAddSection && (
          <button
            onClick={() => onAddSection()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add First Section
          </button>
        )}
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="document-section-tree space-y-1">
        {/* Document Title */}
        <div className="mb-4 pb-3 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">{document.title}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {document.children.length} {document.children.length === 1 ? 'section' : 'sections'}
            {isDirty && <span className="ml-2 text-orange-600 font-semibold">• Unsaved changes</span>}
          </p>
        </div>
        
        {/* Section Tree with Droppable */}
        <Droppable droppableId="root-sections" type="depth-0">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`space-y-1 ${snapshot.isDraggingOver ? 'bg-blue-50/30 rounded p-2' : ''}`}
            >
              {document.children.map((section, index) => (
                <SectionTree
                  key={section.id || section.client_id}
                  section={section}
                  depth={0}
                  index={index}
                  onAddSubsection={onAddSubsection}
                  onEditSection={onEditSection}
                  onDeleteSection={onDeleteSection}
                  onSelectSection={onSelectSection}
                  selectedSectionId={selectedSectionId}
                  maxDepth={maxDepth}
                  draggableId={`root-${section.id || section.client_id}`}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
        
        {/* Add Root Section */}
        {onAddSection && (
          <button
            onClick={() => onAddSection()}
            className="w-full mt-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Section
          </button>
        )}
      </div>
    </DragDropContext>
  );
};

export default SectionTree;
