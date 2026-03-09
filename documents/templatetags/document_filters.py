"""
Custom template filters for document templates
"""

from django import template
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter(name='image_container_style')
def image_container_style(image):
    """Build inline style string for image container based on formatting fields."""
    if not image:
        return ''

    alignment = getattr(image, 'alignment', None) or 'center'
    margin_top = getattr(image, 'margin_top', 0) or 0
    margin_bottom = getattr(image, 'margin_bottom', 0) or 0
    margin_left = getattr(image, 'margin_left', 0) or 0
    margin_right = getattr(image, 'margin_right', 0) or 0

    return (
        f"text-align: {alignment}; "
        f"margin-top: {margin_top}px; "
        f"margin-bottom: {margin_bottom}px; "
        f"margin-left: {margin_left}px; "
        f"margin-right: {margin_right}px;"
    )


@register.filter(name='image_tag_style')
def image_tag_style(image):
    """Build inline style string for image tag based on formatting fields."""
    if not image:
        return ''

    size_mode = getattr(image, 'size_mode', None)
    custom_width_percent = getattr(image, 'custom_width_percent', None)
    custom_width_pixels = getattr(image, 'custom_width_pixels', None)
    custom_height_pixels = getattr(image, 'custom_height_pixels', None)
    maintain_aspect_ratio = getattr(image, 'maintain_aspect_ratio', True)

    width_style = ''
    if size_mode == 'custom' and custom_width_percent:
        width_style = f"width: {custom_width_percent}%;"
    elif size_mode == 'custom' and custom_width_pixels:
        width_style = f"width: {custom_width_pixels}px;"
    elif size_mode == 'small':
        width_style = "width: 25%;"
    elif size_mode == 'medium':
        width_style = "width: 50%;"
    elif size_mode == 'large':
        width_style = "width: 75%;"
    elif size_mode == 'full':
        width_style = "width: 100%;"

    height_style = "height: auto;"
    if not maintain_aspect_ratio and custom_height_pixels:
        height_style = f"height: {custom_height_pixels}px;"

    border_style = ''
    if getattr(image, 'show_border', False):
        border_width = getattr(image, 'border_width', 1) or 1
        border_color = getattr(image, 'border_color', '#cccccc') or '#cccccc'
        border_style = f"border: {border_width}px solid {border_color};"

    return " ".join(style for style in [width_style, height_style, border_style] if style)


@register.filter(name='get_item')
def get_item(dictionary, key):
    """
    Template filter to get an item from a dictionary.
    
    Usage in template:
        {{ my_dict|get_item:key_variable }}
        {{ row_data.cells|get_item:header.id }}
    
    Args:
        dictionary: The dictionary to access
        key: The key to look up
        
    Returns:
        The value at the given key, or None if not found
    """
    if not dictionary:
        return None
    
    if isinstance(dictionary, dict):
        return dictionary.get(key, None)
    
    # If it's not a dict, try to get the attribute
    try:
        return getattr(dictionary, key, None)
    except (AttributeError, TypeError):
        return None


@register.filter(name='render_paragraph')
def render_paragraph(paragraph):
    """
    Render a Paragraph model instance with document-level metadata applied.

    Usage in templates:
        {{ paragraph|render_paragraph }}

    This will pick the edited_text if present (paragraph.has_edits), otherwise
    the content_text, apply `Paragraph.render_with_metadata` using document
    metadata, and return a safe HTML string.
    """
    if not paragraph:
        return ''

    try:
        base = paragraph.edited_text if getattr(paragraph, 'has_edits', False) and paragraph.edited_text else paragraph.content_text or ''
        rendered = paragraph.render_with_metadata(None, base)
        return mark_safe(rendered)
    except Exception:
        # Fall back to raw content_text if rendering fails
        try:
            return mark_safe(paragraph.content_text or '')
        except Exception:
            return ''
