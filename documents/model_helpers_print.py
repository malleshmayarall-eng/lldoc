"""
Model Utilities for Print Template

Add this method to your Section model to enable proper component ordering in templates.
"""

# Add this method to documents/models.py Section class:

def get_all_components(self):
    """
    Get all components (paragraphs, tables, images, files) in this section,
    sorted by their order field.
    
    Returns:
        List of dicts with 'type', 'order', and 'obj' keys
    """
    components = []
    
    # Collect paragraphs
    for para in self.paragraphs.all():
        components.append({
            'type': 'paragraph',
            'order': para.order,
            'obj': para
        })
    
    # Collect tables
    for table in self.tables.all():
        components.append({
            'type': 'table',
            'order': table.order,
            'obj': table
        })
    
    # Collect images
    for image in self.images.all():
        components.append({
            'type': 'image',
            'order': image.order,
            'obj': image
        })
    
    # Collect files
    for file in self.files.all():
        components.append({
            'type': 'file',
            'order': file.order,
            'obj': file
        })
    
    # Sort by order
    components.sort(key=lambda x: x['order'])
    
    return components


# ============================================
# ALTERNATIVE: Use this if you want to avoid N+1 queries
# ============================================

from django.db.models import Prefetch

def get_all_components_optimized(self):
    """
    Optimized version that uses prefetch_related to avoid N+1 queries.
    
    Returns:
        List of dicts with 'type', 'order', and 'obj' keys
    """
    components = []
    
    # Use select_related if components have foreign keys you need
    paragraphs = self.paragraphs.select_related().all()
    tables = self.tables.select_related().all()
    images = self.images.select_related().all()
    files = self.files.select_related().all()
    
    for para in paragraphs:
        components.append({'type': 'paragraph', 'order': para.order, 'obj': para})
    
    for table in tables:
        components.append({'type': 'table', 'order': table.order, 'obj': table})
    
    for image in images:
        components.append({'type': 'image', 'order': image.order, 'obj': image})
    
    for file in files:
        components.append({'type': 'file', 'order': file.order, 'obj': file})
    
    components.sort(key=lambda x: x['order'])
    
    return components
