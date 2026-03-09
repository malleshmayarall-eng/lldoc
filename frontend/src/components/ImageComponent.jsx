import React, { useState, useRef } from 'react';
import {
  Edit3,
  Trash2,
  Eye,
  EyeOff,
  Move,
  ChevronUp,
  ChevronDown,
  MessageCircle,
} from 'lucide-react';
import './ImageComponent.css';

/**
 * ImageComponent - Display and manage an image within a document section
 * Settings are handled via the floating image toolbar.
 */
const ImageComponent = ({
  data,
  onUpdate,
  onDelete,
  onReorder,
  onMoveUp,
  onMoveDown,
  onSelect,
  isSelected = false,
  isEditable = true,
  showControls = true,
  isFirst = false,
  isLast = false,
  reviewCommentCount = null,
  onOpenReviewComments,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCaption, setEditedCaption] = useState(data.caption || '');
  const [editedFigureNumber, setEditedFigureNumber] = useState(data.figure_number || '');
  const [editedAltText, setEditedAltText] = useState(data.alt_text || '');

  const imageRef = useRef(null);

  const showCaption = data.show_caption ?? true;
  const showFigureNumber = data.show_figure_number ?? false;

  const handleSelect = (event) => {
    if (!onSelect) return;
    if (event?.target?.closest('.image-controls')) return;
    onSelect(data, imageRef.current || event.currentTarget);
  };

  const getWidthStyle = () => {
    if (data.custom_width_percent) return `${data.custom_width_percent}%`;

    switch (data.size_mode || 'medium') {
      case 'original':
        return 'auto';
      case 'small':
        return '25%';
      case 'medium':
        return '50%';
      case 'large':
        return '75%';
      case 'full':
        return '100%';
      default:
        return '50%';
    }
  };

  const alignment = data.alignment || 'center';
  const alignmentMap = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: alignmentMap[alignment] || 'center',
    textAlign: alignment,
    opacity: data.is_visible === false ? 0.5 : 1,
  };

  const imageStyle = {
    width: getWidthStyle(),
    height: 'auto',
  };

  const handleSaveCaption = async () => {
    if (!onUpdate) return;

    try {
      await onUpdate(data.id, {
        caption: editedCaption,
        figure_number: editedFigureNumber,
        alt_text: editedAltText,
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update caption:', error);
      alert('Failed to update caption. Please try again.');
    }
  };

  const handleToggleVisibility = async () => {
    if (!onUpdate) return;

    try {
      await onUpdate(data.id, {
        is_visible: !data.is_visible,
      });
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    const confirmed = window.confirm(
      'Are you sure you want to remove this image from the document?\n\n' +
        'Note: The image will remain in your library and can be added again later.'
    );

    if (confirmed) {
      try {
        await onDelete(data.id);
      } catch (error) {
        console.error('Failed to delete image component:', error);
        alert('Failed to remove image. Please try again.');
      }
    }
  };

  const renderImage = () => {
    return (
      <img
        ref={imageRef}
        src={data.image_url}
        alt={data.alt_text || data.caption || 'Document image'}
        title={data.title || data.caption}
        style={imageStyle}
        className={`image-component-img ${data.component_type || 'figure'}`}
        loading="lazy"
      />
    );
  };

  const renderCaption = () => {
    if (!showCaption || (!data.caption && !isEditing)) return null;

    if (isEditing) {
      return (
        <figcaption className="image-caption editing">
          <div className="caption-editor">
            {showFigureNumber && (
              <input
                type="text"
                placeholder="Figure number (e.g., Figure 1)"
                value={editedFigureNumber}
                onChange={(e) => setEditedFigureNumber(e.target.value)}
                className="figure-number-input"
              />
            )}
            <textarea
              placeholder="Enter caption..."
              value={editedCaption}
              onChange={(e) => setEditedCaption(e.target.value)}
              className="caption-textarea"
              rows={2}
            />
            <input
              type="text"
              placeholder="Alt text (for accessibility)"
              value={editedAltText}
              onChange={(e) => setEditedAltText(e.target.value)}
              className="alt-text-input"
            />
            <div className="caption-actions">
              <button onClick={handleSaveCaption} className="save-btn">Save</button>
              <button onClick={() => setIsEditing(false)} className="cancel-btn">Cancel</button>
            </div>
          </div>
        </figcaption>
      );
    }

    return (
      <figcaption className="image-caption">
        {showFigureNumber && data.figure_number && (
          <span className="figure-number">{data.figure_number}: </span>
        )}
        <span className="caption-text">{data.caption}</span>
      </figcaption>
    );
  };

  const renderControls = () => {
    if (!showControls || !isEditable) return null;

    return (
      <div className="image-controls">
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="control-btn"
          title="Edit caption"
        >
          <Edit3 size={16} />
        </button>
        <button
          onClick={handleToggleVisibility}
          className="control-btn"
          title={data.is_visible === false ? 'Show' : 'Hide'}
        >
          {data.is_visible === false ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        {onMoveUp && (
          <button
            onClick={onMoveUp}
            className="control-btn"
            disabled={isFirst}
            title={isFirst ? "Can't move up (first item)" : 'Move up'}
          >
            <ChevronUp size={16} />
          </button>
        )}
        {onMoveDown && (
          <button
            onClick={onMoveDown}
            className="control-btn"
            disabled={isLast}
            title={isLast ? "Can't move down (last item)" : 'Move down'}
          >
            <ChevronDown size={16} />
          </button>
        )}
        {onReorder && (
          <button className="control-btn drag-handle" title="Drag to reorder">
            <Move size={16} />
          </button>
        )}
        {onOpenReviewComments && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenReviewComments(); }}
            className={`control-btn ${
              reviewCommentCount?.unresolved > 0
                ? 'text-orange-600'
                : reviewCommentCount?.total > 0
                  ? 'text-green-600'
                  : ''
            }`}
            title={
              reviewCommentCount?.total
                ? `${reviewCommentCount.total} comment${reviewCommentCount.total !== 1 ? 's' : ''}${reviewCommentCount.unresolved ? ` (${reviewCommentCount.unresolved} open)` : ''}`
                : 'Review comments'
            }
            style={{ position: 'relative' }}
          >
            <MessageCircle size={16} />
            {reviewCommentCount?.total > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 14, height: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%', fontSize: 8, fontWeight: 700,
                lineHeight: 1, color: '#fff', background: '#f97316',
              }}>
                {reviewCommentCount.total}
              </span>
            )}
          </button>
        )}
        <button
          onClick={handleDelete}
          className="control-btn delete-btn"
          title="Remove from document"
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  };

  return (
    <div
      className={`image-component-container ${data.component_type || 'figure'} ${data.is_visible === false ? 'hidden' : ''} ${isSelected ? 'selected' : ''}`}
      data-component-id={data.id}
      data-order={data.order}
      onClick={handleSelect}
    >
      {renderControls()}

      <figure style={containerStyle} className="image-figure">
        {renderImage()}
        {renderCaption()}
      </figure>

      {data.component_type && (
        <div className="component-type-badge">{data.component_type}</div>
      )}
    </div>
  );
};

export default ImageComponent;
