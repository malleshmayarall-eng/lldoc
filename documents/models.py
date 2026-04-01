from django.db import models
from django.contrib.auth.models import User
from django.contrib.contenttypes.fields import GenericRelation
import uuid
import json
import re
from django.utils import timezone


class HeaderFooterTemplate(models.Model):
    """
    Reusable header and footer templates that can be shared across documents.
    Users can create custom templates and apply them to multiple documents.
    
    USAGE:
    1. Create a template:
        template = HeaderFooterTemplate.objects.create(
            name='Corporate Header',
            created_by=user,
            template_type='header',
            is_public=True
        )
        
    2. Add icons to template:
        template.add_icon(logo_image_id, 'logo', 'left', 'medium')
        template.add_icon(cert_image_id, 'certification', 'right', 'small')
        
    3. Set text:
        template.set_text(left='Company Name', center='Document Title', right='Page {page}')
        
    4. Apply to document:
        document.header_template = template
        document.save()
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Template Info
    name = models.CharField(max_length=255, help_text="Template name (e.g., 'Corporate Header', 'Legal Footer')")
    description = models.TextField(null=True, blank=True, help_text="Template description and usage notes")
    
    # Template Type
    TEMPLATE_TYPES = [
        ('header', 'Header Template'),
        ('footer', 'Footer Template'),
    ]
    template_type = models.CharField(max_length=20, choices=TEMPLATE_TYPES, help_text="Header or Footer")
    
    # Template Configuration (same structure as header_config/footer_config)
    config = models.JSONField(default=dict, blank=True, help_text="""
        Template configuration with icons, text, and styling:
        {
            'icons': [
                {
                    'image_id': 'uuid-of-image',
                    'type': 'logo',
                    'position': 'left',
                    'size': 'medium',
                    'order': 0
                }
            ],
            'text': {
                'left': 'Company Name',
                'center': 'Document Title',
                'right': 'Page {page} of {total}'
            },
            'style': {
                'height': '60px',
                'background_color': '#ffffff',
                'border_bottom': '1px solid #cccccc',
                'font_family': 'Arial',
                'font_size': '12px',
                'padding': '10px'
            },
            'show_on_first_page': true,
            'show_on_all_pages': true
        }
    """)
    
    # Ownership and Sharing
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_templates', help_text="Template creator")
    is_public = models.BooleanField(default=False, help_text="Available to all users")
    is_system = models.BooleanField(default=False, help_text="System-provided template (cannot be deleted)")
    
    # Sharing with specific users
    shared_with = models.ManyToManyField(User, blank=True, related_name='shared_templates',
                                        help_text="Users who can use this template")
    
    # Usage Tracking
    usage_count = models.IntegerField(default=0, help_text="Number of documents using this template")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Categorization
    tags = models.JSONField(default=list, blank=True, help_text="Tags for organizing templates")
    category = models.CharField(max_length=100, null=True, blank=True, 
                               help_text="Category (e.g., 'Corporate', 'Legal', 'Government')")
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['template_type', 'is_public']),
            models.Index(fields=['created_by', '-created_at']),
        ]
        verbose_name = "Header/Footer Template"
        verbose_name_plural = "Header/Footer Templates"
    
    def __str__(self):
        return f"{self.name} ({self.get_template_type_display()})"
    
    def can_user_access(self, user):
        """Check if a user can access this template."""
        if self.is_public or self.is_system:
            return True
        if self.created_by == user:
            return True
        if user in self.shared_with.all():
            return True
        return False
    
    def add_icon(self, image_id, icon_type='logo', position='left', size='medium', order=None):
        """
        Add an icon to the template.
        
        Args:
            image_id: UUID of DocumentImage
            icon_type: Type of icon (logo, certification, seal, etc.)
            position: Position (left, center, right)
            size: Icon size (small, medium, large)
            order: Display order (None = append to end)
        
        Returns:
            dict: Icon configuration that was added
        """
        if not isinstance(self.config, dict):
            self.config = {}
        
        if 'icons' not in self.config:
            self.config['icons'] = []
        
        if order is None:
            order = len(self.config['icons'])
        
        icon_config = {
            'image_id': str(image_id),
            'type': icon_type,
            'position': position,
            'size': size,
            'order': order
        }
        
        self.config['icons'].append(icon_config)
        self.save(update_fields=['config', 'updated_at'])
        
        return icon_config
    
    def remove_icon(self, image_id=None, icon_type=None, position=None):
        """Remove icon(s) from template based on criteria."""
        if not isinstance(self.config, dict) or 'icons' not in self.config:
            return 0
        
        original_count = len(self.config['icons'])
        
        filtered_icons = []
        for icon in self.config['icons']:
            keep = True
            
            if image_id and icon.get('image_id') == str(image_id):
                keep = False
            elif icon_type and icon.get('type') == icon_type:
                keep = False
            elif position and icon.get('position') == position:
                keep = False
            
            if keep:
                filtered_icons.append(icon)
        
        self.config['icons'] = filtered_icons
        removed_count = original_count - len(filtered_icons)
        
        if removed_count > 0:
            self.save(update_fields=['config', 'updated_at'])
        
        return removed_count
    
    def set_text(self, left=None, center=None, right=None):
        """Set text sections for the template."""
        if not isinstance(self.config, dict):
            self.config = {}
        
        if 'text' not in self.config:
            self.config['text'] = {}
        
        if left is not None:
            self.config['text']['left'] = left
        if center is not None:
            self.config['text']['center'] = center
        if right is not None:
            self.config['text']['right'] = right
        
        self.save(update_fields=['config', 'updated_at'])
    
    def set_style(self, **style_options):
        """
        Set styling options for the template.
        
        Args:
            **style_options: Style properties (height, background_color, border_bottom, etc.)
        """
        if not isinstance(self.config, dict):
            self.config = {}
        
        if 'style' not in self.config:
            self.config['style'] = {}
        
        self.config['style'].update(style_options)
        self.save(update_fields=['config', 'updated_at'])
    
    def get_icons(self):
        """Get all icons with their image objects."""
        if not isinstance(self.config, dict) or 'icons' not in self.config:
            return []
        
        icons_with_images = []
        for icon_config in self.config['icons']:
            try:
                from documents.models import DocumentImage
                image = DocumentImage.objects.get(id=icon_config['image_id'])
                icons_with_images.append({
                    'config': icon_config,
                    'image': image
                })
            except:
                pass
        
        return sorted(icons_with_images, key=lambda x: x['config'].get('order', 0))
    
    def duplicate(self, new_name=None, user=None):
        """Create a copy of this template."""
        new_template = HeaderFooterTemplate.objects.create(
            name=new_name or f"{self.name} (Copy)",
            description=self.description,
            template_type=self.template_type,
            config=self.config.copy() if self.config else {},
            created_by=user or self.created_by,
            is_public=False,  # Copies are private by default
            tags=self.tags.copy() if self.tags else [],
            category=self.category
        )
        return new_template
    
    def increment_usage(self):
        """Increment usage count when applied to a document."""
        self.usage_count += 1
        self.save(update_fields=['usage_count'])
    
    def decrement_usage(self):
        """Decrement usage count when removed from a document."""
        if self.usage_count > 0:
            self.usage_count -= 1
            self.save(update_fields=['usage_count'])


class Document(models.Model):
    """
    Flexible root container for legal documents.
    
    DESIGN PHILOSOPHY:
    - Structured yet flexible: Core fields for queries/indexes, JSON for extensibility
    - All editing functions support any field modification
    - Document metadata uses nested JSON for unlimited field types
    - Version tracking integrated with all edit operations
    - Change logging automatic on all modifications
    
    EDITING CAPABILITIES:
    All document editing functions can modify:
    - Direct fields (title, author, status, etc.)
    - Nested metadata (financial, legal, dates, provisions, etc.)
    - Attachments (add/remove/update)
    - Images (logo, watermark, background, icons)
    - Custom metadata (any structure you need)
    
    USAGE EXAMPLES:
    
    1. Update nested metadata:
        doc.update_metadata('financial.contract_value', '50000.00')
        doc.update_metadata('legal.governing_law', 'Delaware')
    
    2. Bulk updates:
        doc.bulk_update_fields({
            'title': 'New Title',
            'status': 'approved',
            'metadata.dates.effective_date': '2026-01-01',
            'parties': [{'name': 'Company A', 'role': 'Provider'}]
        }, user=request.user)
    
    3. Manage attachments:
        doc.add_attachment('Exhibit A', '/path/to/file.pdf', 'exhibit')
        doc.remove_attachment('Exhibit A')
    
    4. Update images:
        doc.update_image('logo', image_uuid)
        doc.update_image('watermark', None)  # Remove watermark
    
    5. Get complete state:
        data = doc.get_all_data()  # Returns all data for versioning
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Source of Truth - Content
    raw_text = models.TextField(help_text="Original unmodified text")
    current_text = models.TextField(help_text="Current version with accepted edits", blank=True)

    # LaTeX document support
    is_latex_code = models.BooleanField(
        default=False,
        help_text="If true, document content is stored as LaTeX code",
    )
    latex_code = models.TextField(
        null=True,
        blank=True,
        help_text="Raw LaTeX source used for PDF rendering",
    )

    # Document Mode — determines the UI and workflow used for this document
    DOCUMENT_MODE_CHOICES = [
        ('standard', 'Standard Document'),
        ('quick_latex', 'Quick LaTeX Document'),
    ]
    document_mode = models.CharField(
        max_length=20,
        choices=DOCUMENT_MODE_CHOICES,
        default='standard',
        db_index=True,
        help_text=(
            "Controls the editing experience. "
            "'quick_latex' creates a single-section, single-LatexCode-block document "
            "optimised for LaTeX-only editing, AI generation, metadata placeholders, "
            "and rapid duplication from repositories."
        ),
    )
    
    # Core Metadata (indexed for performance)
    title = models.CharField(max_length=255, default="Untitled Document", db_index=True)
    author = models.CharField(max_length=255, null=True, blank=True)
    version = models.CharField(max_length=50, default="1.0", db_index=True)
    document_type = models.CharField(max_length=100, default="contract", db_index=True)
    
    # Version Management
    version_number = models.IntegerField(default=1, help_text="Numeric version number")
    major_version = models.IntegerField(default=1, help_text="Major version (e.g., 2 in v2.3)")
    minor_version = models.IntegerField(default=0, help_text="Minor version (e.g., 3 in v2.3)")
    patch_version = models.IntegerField(default=0, help_text="Patch version (e.g., 1 in v2.3.1)")
    is_draft = models.BooleanField(default=True, help_text="Draft vs. finalized version")
    is_latest_version = models.BooleanField(default=True, help_text="Is this the latest version")
    version_label = models.CharField(max_length=100, null=True, blank=True, 
                                     help_text="e.g., 'Final', 'Draft for Review', 'Signed Copy'")
    
    # Version History
    previous_version = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='next_versions', help_text="Link to previous version")
    original_document = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                         related_name='all_versions', help_text="Link to first version")
    version_notes = models.TextField(null=True, blank=True, help_text="Notes about this version")
    version_created_at = models.DateTimeField(null=True, blank=True, help_text="When this version was created")
    version_created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                          related_name='versioned_documents', help_text="Who created this version")
    
    # Flexible Document Fields (JSON-based for extensibility)
    # All fields stored in structured JSON - edit functions can modify any field
    document_metadata = models.JSONField(default=dict, blank=True, help_text="""
        Flexible metadata structure for all document details:
        {
            'parties': [...],
            'signatories': [...],
            'dates': {
                'effective_date': '2026-01-01',
                'expiration_date': '2027-01-01',
                'execution_date': '2025-12-15'
            },
            'legal': {
                'governing_law': 'Delaware',
                'jurisdiction': 'US-DE',
                'reference_number': 'CNT-001'
            },
            'financial': {
                'contract_value': '50000.00',
                'currency': 'USD',
                'payment_terms': 'Net 30'
            },
            'terms': {
                'term_length': '12 months',
                'auto_renewal': true,
                'renewal_terms': '...',
                'notice_period': '30 days'
            },
            'provisions': {
                'liability_cap': '...',
                'indemnification': '...',
                'insurance': '...',
                'termination': '...'
            },
            'compliance': {
                'regulatory_requirements': [...],
                'certifications': [...]
            },
            'confidentiality': {
                'period': '2 years',
                'nda_type': 'mutual'
            },
            'dispute_resolution': {
                'method': 'arbitration',
                'location': 'New York, NY'
            },
            'classification': {
                'category': 'contract',
                'status': 'draft',
                'tags': [...]
            }
        }
    """)
    
    # Parties and Stakeholders (kept for quick access, also in document_metadata)
    parties = models.JSONField(default=list, blank=True, help_text="List of parties involved")
    signatories = models.JSONField(default=list, blank=True, help_text="Required signatories")

    # Key dates (kept for indexing, also in document_metadata)
    effective_date = models.DateField(null=True, blank=True, db_index=True)
    expiration_date = models.DateField(null=True, blank=True, db_index=True)
    execution_date = models.DateField(null=True, blank=True)
    
    # Critical fields (kept for queries, also in document_metadata)
    governing_law = models.CharField(max_length=255, null=True, blank=True)
    reference_number = models.CharField(max_length=100, null=True, blank=True, db_index=True)
    project_name = models.CharField(max_length=255, null=True, blank=True)
    
    # Document Relationships
    parent_document = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, 
                                       related_name='amendments')
    related_documents = models.JSONField(default=list, blank=True)
    
    # Term fields (kept for quick filtering)
    term_length = models.CharField(max_length=100, null=True, blank=True)
    auto_renewal = models.BooleanField(default=False)
    renewal_terms = models.TextField(null=True, blank=True)




    # Document Classification
    DOCUMENT_CATEGORIES = [
        ('contract', 'Contract/Agreement'),
        ('policy', 'Policy Document'),
        ('regulation', 'Regulation/Compliance'),
        ('legal_brief', 'Legal Brief'),
        ('terms', 'Terms & Conditions'),
        ('nda', 'Non-Disclosure Agreement'),
        ('license', 'License Agreement'),
        ('other', 'Other'),
    ]
    category = models.CharField(max_length=50, choices=DOCUMENT_CATEGORIES, default='contract')
    jurisdiction = models.CharField(max_length=100, null=True, blank=True, help_text="Legal jurisdiction (e.g., 'US-California')")
    
    # Status & Workflow
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('under_review', 'Under Review'),
        ('done', 'Done'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft', db_index=True)
    
    # User & Ownership
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, 
                                  related_name='created_documents', db_index=True)
    last_modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, 
                                        related_name='modified_documents')
    
    # Change Tracking
    changes_from_previous = models.TextField(null=True, blank=True)
    auto_save_enabled = models.BooleanField(default=True)
    last_auto_saved_at = models.DateTimeField(null=True, blank=True)
    
    # Analysis Tracking
    last_analyzed_at = models.DateTimeField(null=True, blank=True)
    analysis_version = models.CharField(max_length=50, null=True, blank=True)
    total_issues_count = models.IntegerField(default=0)
    critical_issues_count = models.IntegerField(default=0)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    
    # Files & Attachments (JSON-based for flexibility)
    source_file = models.FileField(upload_to='documents/source/%Y/%m/', null=True, blank=True)
    source_file_name = models.CharField(max_length=255, null=True, blank=True)
    source_file_type = models.CharField(max_length=50, null=True, blank=True)
    source_file_size = models.BigIntegerField(null=True, blank=True)
    
    attachments = models.JSONField(default=list, blank=True, help_text="""
        Flexible attachments structure - edit functions can add/remove:
        [
            {
                'name': 'Exhibit A',
                'file_path': 'path/to/file.pdf',
                'type': 'exhibit',
                'size': 1024,
                'uploaded_by': 'username',
                'uploaded_at': '2026-01-01T00:00:00Z'
            }
        ]
    """)
    
    # OCR/Scan info
    is_scanned = models.BooleanField(default=False)
    ocr_confidence = models.FloatField(null=True, blank=True)
    page_count = models.IntegerField(null=True, blank=True)
    
    # Images (flexible references - edit functions can update these)
    logo_image = models.ForeignKey('DocumentImage', on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='documents_with_logo')
    watermark_image = models.ForeignKey('DocumentImage', on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='documents_with_watermark')
    background_image = models.ForeignKey('DocumentImage', on_delete=models.SET_NULL, null=True, blank=True,
                                         related_name='documents_with_background')
    
    # Header and Footer Templates (reusable templates created by users)
    header_template = models.ForeignKey('HeaderFooterTemplate', on_delete=models.SET_NULL, 
                                       null=True, blank=True,
                                       related_name='documents_with_header',
                                       limit_choices_to={'template_type': 'header'},
                                       help_text="Selected header template")
    
    footer_template = models.ForeignKey('HeaderFooterTemplate', on_delete=models.SET_NULL,
                                       null=True, blank=True,
                                       related_name='documents_with_footer',
                                       limit_choices_to={'template_type': 'footer'},
                                       help_text="Selected footer template")
    
    # Header and Footer Override (optional - to customize template for this specific document)
    header_config = models.JSONField(default=dict, blank=True, help_text="""
        Optional header configuration override. If empty, uses header_template.
        Use this to customize a template for this specific document without changing the template itself.
        Same structure as HeaderFooterTemplate.config
    """)
    
    footer_config = models.JSONField(default=dict, blank=True, help_text="""
        Optional footer configuration override. If empty, uses footer_template.
        Use this to customize a template for this specific document without changing the template itself.
        Same structure as HeaderFooterTemplate.config
    """)
    
    # Extensible metadata (edit functions can add any custom fields)
    custom_metadata = models.JSONField(default=dict, blank=True, help_text="""
        Completely flexible custom fields - all edit functions support this:
        {
            'custom_field1': 'value',
            'nested': {'key': 'value'},
            'arrays': [...],
            'anything': 'you want'
        }
    """)
    
    # Content integrity
    content_hash = models.CharField(max_length=64, null=True, blank=True, db_index=True)
    
    # Denormalized component indexes for fast lookup (auto-updated on save)
    # These store IDs of all components that belong to this document
    section_ids = models.JSONField(default=list, blank=True, help_text="""
        List of all section IDs in this document (auto-maintained).
        Example: ['s1', 's2', 's2.1', 's3']
    """)
    
    paragraph_ids = models.JSONField(default=list, blank=True, help_text="""
        List of all paragraph IDs in this document (auto-maintained).
        Example: ['p1', 'p2', 'p3']
    """)
    
    table_ids = models.JSONField(default=list, blank=True, help_text="""
        List of all table IDs in this document (auto-maintained).
        Example: ['t1', 't2', 't3']
    """)
    
    image_component_ids = models.JSONField(default=list, blank=True, help_text="""
        List of all image component IDs in this document (auto-maintained).
        Example: ['img1', 'img2']
    """)
    
    file_component_ids = models.JSONField(default=list, blank=True, help_text="""
        List of all file component IDs in this document (auto-maintained).
        Example: ['file1', 'file2']
    """)
    
    # Component counts for quick stats (auto-maintained)
    sections_count = models.IntegerField(default=0, help_text="Total number of sections")
    paragraphs_count = models.IntegerField(default=0, help_text="Total number of paragraphs")
    tables_count = models.IntegerField(default=0, help_text="Total number of tables")
    images_count = models.IntegerField(default=0, help_text="Total number of image components")
    files_count = models.IntegerField(default=0, help_text="Total number of file components")
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at']),
            models.Index(fields=['document_type', 'category']),
            models.Index(fields=['is_draft', 'is_latest_version']),
            models.Index(fields=['effective_date']),
            models.Index(fields=['reference_number']),
            models.Index(fields=['created_by', '-created_at']),
        ]
        verbose_name = "Document"
        verbose_name_plural = "Documents"
    
    def __str__(self):
        return f"{self.title} ({self.id})"
    
    def calculate_hash(self):
        """Calculate SHA256 hash of current content."""
        import hashlib
        return hashlib.sha256(self.current_text.encode()).hexdigest()
    
    def save(self, *args, **kwargs):
        if not self.current_text:
            self.current_text = self.raw_text
        self.content_hash = self.calculate_hash()
        super().save(*args, **kwargs)
    
    # ==== FLEXIBLE DOCUMENT EDITING METHODS ====
    
    def update_metadata(self, field_path, value):
        """
        Update any field in document_metadata using dot notation.
        
        Examples:
            doc.update_metadata('dates.effective_date', '2026-01-01')
            doc.update_metadata('financial.contract_value', '50000.00')
            doc.update_metadata('legal.governing_law', 'Delaware')
        """
        keys = field_path.split('.')
        current = self.document_metadata
        
        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]
        
        current[keys[-1]] = value
        self.save(update_fields=['document_metadata', 'updated_at'])
    
    def get_metadata(self, field_path, default=None):
        """
        Get any field from document_metadata using dot notation.
        
        Examples:
            value = doc.get_metadata('financial.contract_value')
            date = doc.get_metadata('dates.effective_date')
        """
        keys = field_path.split('.')
        current = self.document_metadata
        
        try:
            for key in keys:
                current = current[key]
            return current
        except (KeyError, TypeError):
            return default
    
    # ==== COMPONENT INDEX MANAGEMENT ====
    
    def rebuild_component_indexes(self):
        """
        Rebuild all component indexes and counts from actual database records.
        This is the source of truth - use this when indexes might be out of sync.
        
        Call this:
        - After bulk operations
        - During migrations
        - When troubleshooting inconsistencies
        
        Returns:
            dict: Summary of what was indexed
        """
        # Get all sections (ordered by order field)
        sections = self.sections.all().order_by('order').values_list('id', flat=True)
        self.section_ids = [str(s) for s in sections]
        self.sections_count = len(self.section_ids)
        
        # Get all paragraphs across all sections (ordered by section, then order)
        paragraphs = Paragraph.objects.filter(
            section__document=self
        ).order_by('section__order', 'order').values_list('id', flat=True)
        self.paragraph_ids = [str(p) for p in paragraphs]
        self.paragraphs_count = len(self.paragraph_ids)
        
        # Get all tables (via sections only, since table.section is optional but document is not directly linked)
        tables = Table.objects.filter(
            section__document=self
        ).values_list('id', flat=True)
        self.table_ids = [str(t) for t in tables]
        self.tables_count = len(self.table_ids)
        
        # Get all image components
        images = ImageComponent.objects.filter(
            section__document=self
        ).values_list('id', flat=True)
        self.image_component_ids = [str(i) for i in images]
        self.images_count = len(self.image_component_ids)
        
        # Get all file components (set to 0 for now - FileComponent not implemented yet)
        self.file_component_ids = []
        self.files_count = 0
        
        # Save all indexes
        self.save(update_fields=[
            'section_ids', 'sections_count',
            'paragraph_ids', 'paragraphs_count',
            'table_ids', 'tables_count',
            'image_component_ids', 'images_count',
            'file_component_ids', 'files_count',
            'updated_at'
        ])
        
        return {
            'sections': self.sections_count,
            'paragraphs': self.paragraphs_count,
            'tables': self.tables_count,
            'images': self.images_count,
            'files': self.files_count,
            'total_components': (
                self.sections_count + self.paragraphs_count + 
                self.tables_count + self.images_count + self.files_count
            )
        }
    
    def add_component_to_index(self, component, component_type):
        """
        Add a single component to the index (for incremental updates).
        
        Args:
            component: The component instance (Section, Paragraph, Table, etc.)
            component_type: 'section', 'paragraph', 'table', 'image', 'file'
        """
        component_id = str(component.id)
        
        if component_type == 'section':
            if component_id not in self.section_ids:
                self.section_ids.append(component_id)
                self.sections_count = len(self.section_ids)
                self.save(update_fields=['section_ids', 'sections_count', 'updated_at'])
                
        elif component_type == 'paragraph':
            if component_id not in self.paragraph_ids:
                self.paragraph_ids.append(component_id)
                self.paragraphs_count = len(self.paragraph_ids)
                self.save(update_fields=['paragraph_ids', 'paragraphs_count', 'updated_at'])
                
        elif component_type == 'table':
            if component_id not in self.table_ids:
                self.table_ids.append(component_id)
                self.tables_count = len(self.table_ids)
                self.save(update_fields=['table_ids', 'tables_count', 'updated_at'])
                
        elif component_type == 'image':
            if component_id not in self.image_component_ids:
                self.image_component_ids.append(component_id)
                self.images_count = len(self.image_component_ids)
                self.save(update_fields=['image_component_ids', 'images_count', 'updated_at'])
                
        elif component_type == 'file':
            if component_id not in self.file_component_ids:
                self.file_component_ids.append(component_id)
                self.files_count = len(self.file_component_ids)
                self.save(update_fields=['file_component_ids', 'files_count', 'updated_at'])
    
    def remove_component_from_index(self, component, component_type):
        """
        Remove a single component from the index (for incremental updates).
        
        Args:
            component: The component instance or ID
            component_type: 'section', 'paragraph', 'table', 'image', 'file'
        """
        component_id = str(component.id if hasattr(component, 'id') else component)
        
        if component_type == 'section' and component_id in self.section_ids:
            self.section_ids.remove(component_id)
            self.sections_count = len(self.section_ids)
            self.save(update_fields=['section_ids', 'sections_count', 'updated_at'])
            
        elif component_type == 'paragraph' and component_id in self.paragraph_ids:
            self.paragraph_ids.remove(component_id)
            self.paragraphs_count = len(self.paragraph_ids)
            self.save(update_fields=['paragraph_ids', 'paragraphs_count', 'updated_at'])
            
        elif component_type == 'table' and component_id in self.table_ids:
            self.table_ids.remove(component_id)
            self.tables_count = len(self.table_ids)
            self.save(update_fields=['table_ids', 'tables_count', 'updated_at'])
            
        elif component_type == 'image' and component_id in self.image_component_ids:
            self.image_component_ids.remove(component_id)
            self.images_count = len(self.image_component_ids)
            self.save(update_fields=['image_component_ids', 'images_count', 'updated_at'])
            
        elif component_type == 'file' and component_id in self.file_component_ids:
            self.file_component_ids.remove(component_id)
            self.files_count = len(self.file_component_ids)
            self.save(update_fields=['file_component_ids', 'files_count', 'updated_at'])
    
    def get_all_component_ids(self):
        """
        Get all component IDs in a structured format.
        Use this for fast lookups without database queries.
        
        Returns:
            dict: Component IDs organized by type
        """
        return {
            'sections': self.section_ids,
            'paragraphs': self.paragraph_ids,
            'tables': self.table_ids,
            'images': self.image_component_ids,
            'files': self.file_component_ids,
            'counts': {
                'sections': self.sections_count,
                'paragraphs': self.paragraphs_count,
                'tables': self.tables_count,
                'images': self.images_count,
                'files': self.files_count,
            }
        }
    
    def link_components(self, sections=None, paragraphs=None, tables=None, images=None, rebuild=True):
        """
        Link components to this document and optionally rebuild indexes.
        
        This enables the flexible creation pattern:
        1. Create components without parent IDs
        2. Link them all at once to the document
        3. Rebuild indexes automatically
        
        Args:
            sections: List of Section instances or IDs
            paragraphs: List of Paragraph instances or IDs
            tables: List of Table instances or IDs
            images: List of ImageComponent instances or IDs
            rebuild: Whether to rebuild indexes after linking (default: True)
        
        Example:
            # Create components without document
            sec1 = Section.objects.create(id='s1', title='Introduction')
            para1 = Paragraph.objects.create(id='p1', content_text='Some text')
            table1 = Table.objects.create(id='t1', title='Data Table')
            
            # Link all at once
            document.link_components(
                sections=[sec1],
                paragraphs=[para1],
                tables=[table1]
            )
            # Auto-rebuilds indexes, components now accessible via document.section_ids etc.
        
        Returns:
            dict: Summary of linked components
        """
        linked_count = 0
        
        # Link sections
        if sections:
            for item in sections:
                section = item if isinstance(item, Section) else Section.objects.get(id=item)
                if section.document != self:
                    section.document = self
                    section.save(update_fields=['document'])
                    linked_count += 1
        
        # Link paragraphs (via their sections)
        if paragraphs:
            for item in paragraphs:
                para = item if isinstance(item, Paragraph) else Paragraph.objects.get(id=item)
                # Paragraph needs a section, which needs a document
                if para.section and para.section.document != self:
                    para.section.document = self
                    para.section.save(update_fields=['document'])
                    linked_count += 1
        
        # Link tables
        if tables:
            for item in tables:
                table = item if isinstance(item, Table) else Table.objects.get(id=item)
                # Tables can be linked via section or directly
                if table.section and table.section.document != self:
                    table.section.document = self
                    table.section.save(update_fields=['document'])
                    linked_count += 1
        
        # Link images
        if images:
            for item in images:
                img = item if isinstance(item, ImageComponent) else ImageComponent.objects.get(id=item)
                if img.section and img.section.document != self:
                    img.section.document = self
                    img.section.save(update_fields=['document'])
                    linked_count += 1
        
        # Rebuild indexes if requested
        if rebuild:
            summary = self.rebuild_component_indexes()
            summary['newly_linked'] = linked_count
            return summary
        
        return {'newly_linked': linked_count, 'rebuild_skipped': True}
    
    # ==== UTILITY METHODS ====
    
    def bulk_update_fields(self, updates_dict, user=None):
        """
        Update multiple document fields at once (flexible editing).
        Supports both direct fields and metadata fields.
        
        Args:
            updates_dict: Dictionary of field:value pairs
            user: User making the changes
        
        Example:
            doc.bulk_update_fields({
                'title': 'New Title',
                'status': 'approved',
                'metadata.financial.value': '50000',
                'parties': [{'name': 'Company A'}],
                'attachments': [...]
            }, user=request.user)
        """
        from django.utils import timezone
        
        changed_fields = []
        
        for field, value in updates_dict.items():
            if field.startswith('metadata.'):
                # Update metadata field
                meta_path = field.replace('metadata.', '')
                old_value = self.get_metadata(meta_path)
                if old_value != value:
                    self.update_metadata(meta_path, value)
                    changed_fields.append(field)
            elif hasattr(self, field):
                # Update direct field
                old_value = getattr(self, field)
                if old_value != value:
                    setattr(self, field, value)
                    changed_fields.append(field)
        
        if user:
            self.last_modified_by = user
        
        if changed_fields:
            self.save()
        
        return changed_fields
    
    def add_attachment(self, name, file_path, attachment_type='other', **kwargs):
        """Add an attachment to the document (flexible editing)."""
        from django.utils import timezone
        
        attachment = {
            'name': name,
            'file_path': file_path,
            'type': attachment_type,
            'added_at': timezone.now().isoformat(),
            **kwargs
        }
        
        if not isinstance(self.attachments, list):
            self.attachments = []
        
        self.attachments.append(attachment)
        self.save(update_fields=['attachments', 'updated_at'])
        return attachment
    
    def remove_attachment(self, name):
        """Remove an attachment by name (flexible editing)."""
        if isinstance(self.attachments, list):
            self.attachments = [a for a in self.attachments if a.get('name') != name]
            self.save(update_fields=['attachments', 'updated_at'])
            return True
        return False
    
    def update_image(self, image_type, image_id):
        """
        Update any image field (flexible editing).
        
        Args:
            image_type: 'logo', 'watermark', 'background'
            image_id: UUID of DocumentImage or None to remove
        """
        field_name = f"{image_type}_image"
        if hasattr(self, field_name):
            if image_id:
                from .models import DocumentImage
                try:
                    image = DocumentImage.objects.get(id=image_id)
                    setattr(self, field_name, image)
                except DocumentImage.DoesNotExist:
                    return False
            else:
                setattr(self, field_name, None)
            
            self.save(update_fields=[field_name, 'updated_at'])
            return True
        return False
    
    # ==== HEADER/FOOTER TEMPLATE MANAGEMENT ====
    
    def set_header_template(self, template_id, user=None):
        """
        Apply a header template to this document.
        
        Args:
            template_id: UUID of HeaderFooterTemplate or None to remove
            user: User applying the template (for access check)
        
        Returns:
            bool: True if successful, False if template not found or no access
        """
        if template_id:
            try:
                template = HeaderFooterTemplate.objects.get(id=template_id, template_type='header')
                
                # Check user access
                if user and not template.can_user_access(user):
                    return False
                
                # Decrement old template usage
                if self.header_template:
                    self.header_template.decrement_usage()
                
                # Set new template
                self.header_template = template
                template.increment_usage()
                
                # Clear override config when using template
                self.header_config = {}
                
                self.save(update_fields=['header_template', 'header_config', 'updated_at'])
                return True
            except HeaderFooterTemplate.DoesNotExist:
                return False
        else:
            # Remove template
            if self.header_template:
                self.header_template.decrement_usage()
                self.header_template = None
                self.save(update_fields=['header_template', 'updated_at'])
            return True
    
    def set_footer_template(self, template_id, user=None):
        """
        Apply a footer template to this document.
        
        Args:
            template_id: UUID of HeaderFooterTemplate or None to remove
            user: User applying the template (for access check)
        
        Returns:
            bool: True if successful, False if template not found or no access
        """
        if template_id:
            try:
                template = HeaderFooterTemplate.objects.get(id=template_id, template_type='footer')
                
                # Check user access
                if user and not template.can_user_access(user):
                    return False
                
                # Decrement old template usage
                if self.footer_template:
                    self.footer_template.decrement_usage()
                
                # Set new template
                self.footer_template = template
                template.increment_usage()
                
                # Clear override config when using template
                self.footer_config = {}
                
                self.save(update_fields=['footer_template', 'footer_config', 'updated_at'])
                return True
            except HeaderFooterTemplate.DoesNotExist:
                return False
        else:
            # Remove template
            if self.footer_template:
                self.footer_template.decrement_usage()
                self.footer_template = None
                self.save(update_fields=['footer_template', 'updated_at'])
            return True
    
    def get_effective_header_config(self):
        """
        Get the effective header configuration.
        Returns override config if set, otherwise template config.
        Falls back to org defaults only when an active template reference exists.
        """
        processing_defaults = self.get_processing_defaults()
        default_header = processing_defaults.get('header_footer') if isinstance(processing_defaults, dict) else {}
        if not isinstance(default_header, dict):
            default_header = {}

        if self.header_template and self.header_template.config:
            import copy
            base = copy.deepcopy(self.header_template.config)
            if self.header_config and isinstance(self.header_config, dict):
                return self._merge_config(base, self.header_config)
            return base
        if self.header_config:
            return self.header_config
        if default_header:
            template_id = default_header.get('header_template')
            header_config = default_header.get('header_config') if isinstance(default_header.get('header_config'), dict) else {}
            if template_id:
                try:
                    template = HeaderFooterTemplate.objects.get(id=template_id, template_type='header')
                    import copy
                    base = copy.deepcopy(template.config) if template.config else {}
                    if header_config:
                        return self._merge_config(base, header_config)
                    return base
                except HeaderFooterTemplate.DoesNotExist:
                    pass
            # Only use bare header_config from defaults when a template reference
            # existed (even if the template wasn't found).  If template_id is
            # explicitly None the user cleared the header — don't fall back to
            # stale org-level config.
            if header_config and template_id:
                return header_config
        return {}
    
    def get_effective_footer_config(self):
        """
        Get the effective footer configuration.
        Returns override config if set, otherwise template config.
        Falls back to org defaults only when an active template reference exists.
        """
        processing_defaults = self.get_processing_defaults()
        default_footer = processing_defaults.get('header_footer') if isinstance(processing_defaults, dict) else {}
        if not isinstance(default_footer, dict):
            default_footer = {}

        if self.footer_template and self.footer_template.config:
            import copy
            base = copy.deepcopy(self.footer_template.config)
            if self.footer_config and isinstance(self.footer_config, dict):
                return self._merge_config(base, self.footer_config)
            return base
        if self.footer_config:
            return self.footer_config
        if default_footer:
            template_id = default_footer.get('footer_template')
            footer_config = default_footer.get('footer_config') if isinstance(default_footer.get('footer_config'), dict) else {}
            if template_id:
                try:
                    template = HeaderFooterTemplate.objects.get(id=template_id, template_type='footer')
                    import copy
                    base = copy.deepcopy(template.config) if template.config else {}
                    if footer_config:
                        return self._merge_config(base, footer_config)
                    return base
                except HeaderFooterTemplate.DoesNotExist:
                    pass
            # Only use bare footer_config from defaults when a template reference
            # existed (even if the template wasn't found).  If template_id is
            # explicitly None the user cleared the footer — don't fall back to
            # stale org-level config.
            if footer_config and template_id:
                return footer_config
        return {}

    def get_org_processing_defaults(self):
        """Fetch organization-level processing defaults for this document."""
        try:
            from user_management.models import OrganizationDocumentSettings
        except Exception:
            return {}

        try:
            organization = self.created_by.profile.organization
        except Exception:
            return {}

        try:
            settings_obj = OrganizationDocumentSettings.objects.filter(organization=organization).first()
        except Exception:
            return {}

        if not settings_obj or not isinstance(settings_obj.preferences, dict):
            return {}

        processing_defaults = settings_obj.preferences.get('processing_defaults')
        return processing_defaults if isinstance(processing_defaults, dict) else {}

    def get_processing_defaults(self):
        """Return merged processing defaults (org defaults with document overrides).
        
        Document-level settings override org-level settings.
        A key set to ``None`` or the string ``"__removed__"`` in the document
        settings explicitly removes that key from the merged result so that
        stale org defaults never leak through.
        """
        import copy

        org_defaults = self.get_org_processing_defaults()
        document_defaults = {}
        if isinstance(self.custom_metadata, dict):
            document_defaults = self.custom_metadata.get('processing_settings') or {}
        if not isinstance(document_defaults, dict):
            document_defaults = {}

        if not org_defaults and not document_defaults:
            return {}

        merged = copy.deepcopy(org_defaults) if isinstance(org_defaults, dict) else {}
        if not isinstance(merged, dict):
            merged = {}
        if document_defaults:
            merged = self._merge_config(merged, document_defaults)

        # Honour explicit removal markers: if a key's value is None or
        # "__removed__", strip it from the merged result so the export
        # pipeline never sees a ghost config.
        removal_keys = [
            k for k, v in merged.items()
            if v is None or v == '__removed__'
        ]
        for k in removal_keys:
            del merged[k]

        return merged

    def get_search_metadata(self, include_custom_metadata=True):
        """Build a metadata snapshot for quick search and PDF embedding.
        
        Args:
            include_custom_metadata: If False, excludes custom_metadata to prevent circular references
        """
        organization = None
        if self.created_by:
            try:
                organization = self.created_by.profile.organization
            except Exception:
                organization = None

        metadata = {
            "document_id": str(self.id) if self.id else None,
            "title": self.title or "",
            "author": self.author or "",
            "document_type": getattr(self, "document_type", "") or "",
            "reference_number": getattr(self, "reference_number", "") or "",
            "status": getattr(self, "status", "") or "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

        if self.created_by:
            try:
                metadata["created_by"] = self.created_by.get_full_name() or self.created_by.username
            except Exception:
                metadata["created_by"] = ""

        if organization:
            metadata["organization"] = {
                "id": str(organization.id),
                "name": organization.name or "",
                "email": organization.email or "",
                "phone": organization.phone or "",
                "website": organization.website or "",
            }

        # Only include custom_metadata if requested (to prevent circular references)
        if include_custom_metadata and isinstance(self.custom_metadata, dict):
            metadata["custom_metadata"] = self.custom_metadata
        if isinstance(self.document_metadata, dict):
            metadata["document_metadata"] = self.document_metadata

        return metadata

    def _merge_config(self, base, override):
        """Deep merge header/footer configs, keeping template defaults."""
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                base[key] = self._merge_config(base.get(key, {}), value)
            else:
                base[key] = value
        return base
    
    def customize_header(self, **config_updates):
        """
        Customize header for this document (creates an override).
        This allows modifying the template for this specific document.
        
        Args:
            **config_updates: Configuration updates (icons, text, style, etc.)
        """
        # Start with template config if exists
        if self.header_template and not self.header_config:
            self.header_config = self.header_template.config.copy()
        
        if not isinstance(self.header_config, dict):
            self.header_config = {}
        
        self.header_config.update(config_updates)
        self.save(update_fields=['header_config', 'updated_at'])
    
    def customize_footer(self, **config_updates):
        """
        Customize footer for this document (creates an override).
        This allows modifying the template for this specific document.
        
        Args:
            **config_updates: Configuration updates (icons, text, style, etc.)
        """
        # Start with template config if exists
        if self.footer_template and not self.footer_config:
            self.footer_config = self.footer_template.config.copy()
        
        if not isinstance(self.footer_config, dict):
            self.footer_config = {}
        
        self.footer_config.update(config_updates)
        self.save(update_fields=['footer_config', 'updated_at'])
    
    def reset_header_to_template(self):
        """Clear header override and use template as-is."""
        self.header_config = {}
        self.save(update_fields=['header_config', 'updated_at'])
    
    def reset_footer_to_template(self):
        """Clear footer override and use template as-is."""
        self.footer_config = {}
        self.save(update_fields=['footer_config', 'updated_at'])
    
    # ==== PLACEHOLDER RESOLUTION METHODS ====
    
    def resolve_placeholders(self, text, page_number=None, total_pages=None):
        """
        Replace placeholders in text with actual values from organization and document.
        
        Supported placeholders:
        - Company info: {company_name}, {company_address}, {company_phone}, {company_email}, {company_website}
        - Document info: {document_title}, {document_type}, {status}, {version}, {reference_number}
        - Date/time: {date}, {year}, {revision_date}
        - Navigation: {page}, {total}, {file_path}
        - User info: {author}, {created_by}
        
        Args:
            text: Text containing placeholders
            page_number: Current page number (optional)
            total_pages: Total number of pages (optional)
            
        Returns:
            Text with placeholders replaced
        """
        if not text or not isinstance(text, str):
            return text
        
        # Get organization from document creator
        organization = None
        if self.created_by:
            try:
                if hasattr(self.created_by, 'profile') and self.created_by.profile:
                    organization = self.created_by.profile.organization
            except Exception:
                pass
        
        # Build replacement dictionary
        replacements = {}

        def _flatten_metadata(prefix, value, target):
            if isinstance(value, dict):
                for key, child in value.items():
                    new_prefix = f"{prefix}.{key}" if prefix else str(key)
                    _flatten_metadata(new_prefix, child, target)
            elif isinstance(value, list):
                target[f"{{{prefix}}}"] = ", ".join([str(item) for item in value])
            else:
                target[f"{{{prefix}}}"] = str(value) if value is not None else ""
        
        # Company/Organization placeholders
        if organization:
            replacements['{company_name}'] = organization.name or ''
            replacements['{company_email}'] = organization.email or ''
            replacements['{company_phone}'] = organization.phone or ''
            replacements['{company_website}'] = organization.website or ''
            
            # Build full address
            address_parts = [
                organization.address_line1 or '',
                organization.address_line2 or '',
                f"{organization.city or ''}, {organization.state or ''} {organization.postal_code or ''}".strip(),
                organization.country or ''
            ]
            full_address = ', '.join([p for p in address_parts if p])
            replacements['{company_address}'] = full_address
        else:
            # Fallback if no organization
            replacements['{company_name}'] = ''
            replacements['{company_email}'] = ''
            replacements['{company_phone}'] = ''
            replacements['{company_website}'] = ''
            replacements['{company_address}'] = ''
        
        # Document placeholders
        replacements['{document_title}'] = self.title or ''
        replacements['{document_type}'] = self.document_type or ''
        replacements['{status}'] = self.status or ''
        replacements['{version}'] = str(self.version_number) if self.version_number else ''
        replacements['{reference_number}'] = self.reference_number or ''

        # Custom metadata placeholders
        if isinstance(self.custom_metadata, dict):
            _flatten_metadata('', self.custom_metadata, replacements)
        
        # Date placeholders
        from django.utils import timezone
        now = timezone.now()
        replacements['{date}'] = now.strftime('%B %d, %Y')  # e.g., "January 13, 2026"
        replacements['{year}'] = now.strftime('%Y')
        if self.updated_at:
            replacements['{revision_date}'] = self.updated_at.strftime('%B %d, %Y')
        else:
            replacements['{revision_date}'] = replacements['{date}']
        
        # Navigation placeholders
        replacements['{page}'] = str(page_number) if page_number else ''
        replacements['{total}'] = str(total_pages) if total_pages else ''
        replacements['{file_path}'] = f"/documents/{self.id}/" if self.id else ''
        
        # User placeholders
        if self.created_by:
            replacements['{author}'] = self.created_by.get_full_name() or self.created_by.username
            replacements['{created_by}'] = self.created_by.get_full_name() or self.created_by.username
        else:
            replacements['{author}'] = ''
            replacements['{created_by}'] = ''
        
        # Replace all placeholders
        result = text
        for placeholder, value in replacements.items():
            result = result.replace(placeholder, value)
        
        return result
    
    def get_rendered_header_config(self, page_number=None, total_pages=None):
        """
        Get header configuration with all placeholders resolved.
        
        Args:
            page_number: Current page number (optional)
            total_pages: Total number of pages (optional)
            
        Returns:
            dict: Header config with resolved placeholders
        """
        config = self.get_effective_header_config()
        if not config:
            return {}
        
        # Deep copy to avoid modifying original
        import copy
        rendered_config = copy.deepcopy(config)
        
        # Resolve text placeholders
        if 'text' in rendered_config and isinstance(rendered_config['text'], dict):
            for position in ['left', 'center', 'right']:
                if position in rendered_config['text']:
                    rendered_config['text'][position] = self.resolve_placeholders(
                        rendered_config['text'][position],
                        page_number,
                        total_pages
                    )
        
        return rendered_config
    
    def get_rendered_footer_config(self, page_number=None, total_pages=None):
        """
        Get footer configuration with all placeholders resolved.
        
        Args:
            page_number: Current page number (optional)
            total_pages: Total number of pages (optional)
            
        Returns:
            dict: Footer config with resolved placeholders
        """
        config = self.get_effective_footer_config()
        if not config:
            return {}
        
        # Deep copy to avoid modifying original
        import copy
        rendered_config = copy.deepcopy(config)
        
        # Resolve text placeholders
        if 'text' in rendered_config and isinstance(rendered_config['text'], dict):
            for position in ['left', 'center', 'right']:
                if position in rendered_config['text']:
                    rendered_config['text'][position] = self.resolve_placeholders(
                        rendered_config['text'][position],
                        page_number,
                        total_pages
                    )
        
        return rendered_config
    
    # ==== LEGACY METHODS (for backward compatibility) ====
    
    def add_header_icon(self, image_id, icon_type='logo', position='left', size='medium', order=None):
        """
        Add an icon to the document header (creates override if using template).
        
        Args:
            image_id: UUID of DocumentImage
            icon_type: Type of icon (logo, certification, company_icon, etc.)
            position: Position in header (left, center, right)
            size: Icon size (small, medium, large)
            order: Display order (None = append to end)
        
        Returns:
            dict: Icon configuration that was added
        """
        # Ensure we have a config dict (copy from template if needed)
        if not self.header_config and self.header_template:
            self.header_config = self.header_template.config.copy()
        
        if not isinstance(self.header_config, dict):
            self.header_config = {}
        
        if 'icons' not in self.header_config:
            self.header_config['icons'] = []
        
        # Determine order
        if order is None:
            order = len(self.header_config['icons'])
        
        icon_config = {
            'image_id': str(image_id),
            'type': icon_type,
            'position': position,
            'size': size,
            'order': order
        }
        
        self.header_config['icons'].append(icon_config)
        self.save(update_fields=['header_config', 'updated_at'])
        
        return icon_config
    
    def remove_header_icon(self, image_id=None, icon_type=None, position=None):
        """
        Remove icon(s) from header based on criteria.
        
        Args:
            image_id: Remove icon with specific image_id
            icon_type: Remove icons of specific type
            position: Remove icons at specific position
        
        Returns:
            int: Number of icons removed
        """
        # Ensure we have a config dict (copy from template if needed)
        if not self.header_config and self.header_template:
            self.header_config = self.header_template.config.copy()
        
        if not isinstance(self.header_config, dict) or 'icons' not in self.header_config:
            return 0
        
        original_count = len(self.header_config['icons'])
        
        # Filter icons based on criteria
        filtered_icons = []
        for icon in self.header_config['icons']:
            keep = True
            
            if image_id and icon.get('image_id') == str(image_id):
                keep = False
            elif icon_type and icon.get('type') == icon_type:
                keep = False
            elif position and icon.get('position') == position:
                keep = False
            
            if keep:
                filtered_icons.append(icon)
        
        self.header_config['icons'] = filtered_icons
        removed_count = original_count - len(filtered_icons)
        
        if removed_count > 0:
            self.save(update_fields=['header_config', 'updated_at'])
        
        return removed_count
    
    def add_footer_icon(self, image_id, icon_type='seal', position='center', size='medium', order=None):
        """
        Add an icon to the document footer (creates override if using template).
        
        Args:
            image_id: UUID of DocumentImage
            icon_type: Type of icon (seal, logo, certification, etc.)
            position: Position in footer (left, center, right)
            size: Icon size (small, medium, large)
            order: Display order (None = append to end)
        
        Returns:
            dict: Icon configuration that was added
        """
        # Ensure we have a config dict (copy from template if needed)
        if not self.footer_config and self.footer_template:
            self.footer_config = self.footer_template.config.copy()
        
        if not isinstance(self.footer_config, dict):
            self.footer_config = {}
        
        if 'icons' not in self.footer_config:
            self.footer_config['icons'] = []
        
        # Determine order
        if order is None:
            order = len(self.footer_config['icons'])
        
        icon_config = {
            'image_id': str(image_id),
            'type': icon_type,
            'position': position,
            'size': size,
            'order': order
        }
        
        self.footer_config['icons'].append(icon_config)
        self.save(update_fields=['footer_config', 'updated_at'])
        
        return icon_config
    
    def remove_footer_icon(self, image_id=None, icon_type=None, position=None):
        """
        Remove icon(s) from footer based on criteria.
        
        Args:
            image_id: Remove icon with specific image_id
            icon_type: Remove icons of specific type
            position: Remove icons at specific position
        
        Returns:
            int: Number of icons removed
        """
        # Ensure we have a config dict (copy from template if needed)
        if not self.footer_config and self.footer_template:
            self.footer_config = self.footer_template.config.copy()
        
        if not isinstance(self.footer_config, dict) or 'icons' not in self.footer_config:
            return 0
        
        original_count = len(self.footer_config['icons'])
        
        # Filter icons based on criteria
        filtered_icons = []
        for icon in self.footer_config['icons']:
            keep = True
            
            if image_id and icon.get('image_id') == str(image_id):
                keep = False
            elif icon_type and icon.get('type') == icon_type:
                keep = False
            elif position and icon.get('position') == position:
                keep = False
            
            if keep:
                filtered_icons.append(icon)
        
        self.footer_config['icons'] = filtered_icons
        removed_count = original_count - len(filtered_icons)
        
        if removed_count > 0:
            self.save(update_fields=['footer_config', 'updated_at'])
        
        return removed_count
    
    def update_header_text(self, left=None, center=None, right=None):
        """
        Update header text sections (creates override if using template).
        
        Args:
            left: Left header text
            center: Center header text
            right: Right header text (supports {page}, {total} placeholders)
        """
        # Ensure we have a config dict (copy from template if needed)
        if not self.header_config and self.header_template:
            self.header_config = self.header_template.config.copy()
        
        if not isinstance(self.header_config, dict):
            self.header_config = {}
        
        if 'text' not in self.header_config:
            self.header_config['text'] = {}
        
        if left is not None:
            self.header_config['text']['left'] = left
        if center is not None:
            self.header_config['text']['center'] = center
        if right is not None:
            self.header_config['text']['right'] = right
        
        self.save(update_fields=['header_config', 'updated_at'])
    
    def update_footer_text(self, left=None, center=None, right=None):
        """
        Update footer text sections (creates override if using template).
        
        Args:
            left: Left footer text
            center: Center footer text
            right: Right footer text (supports {page}, {total} placeholders)
        """
        # Ensure we have a config dict (copy from template if needed)
        if not self.footer_config and self.footer_template:
            self.footer_config = self.footer_template.config.copy()
        
        if not isinstance(self.footer_config, dict):
            self.footer_config = {}
        
        if 'text' not in self.footer_config:
            self.footer_config['text'] = {}
        
        if left is not None:
            self.footer_config['text']['left'] = left
        if center is not None:
            self.footer_config['text']['center'] = center
        if right is not None:
            self.footer_config['text']['right'] = right
        
        self.save(update_fields=['footer_config', 'updated_at'])
    
    def get_header_icons(self):
        """
        Get all header icons with their image objects.
        
        Returns:
            List of dicts with icon config and image object
        """
        config = self.get_effective_header_config()
        
        if not isinstance(config, dict) or 'icons' not in config:
            return []
        
        icons_with_images = []
        for icon_config in config['icons']:
            try:
                from documents.models import DocumentImage
                image = DocumentImage.objects.get(id=icon_config['image_id'])
                icons_with_images.append({
                    'config': icon_config,
                    'image': image
                })
            except:
                pass
        
        return sorted(icons_with_images, key=lambda x: x['config'].get('order', 0))
    
    def get_footer_icons(self):
        """
        Get all footer icons with their image objects.
        
        Returns:
            List of dicts with icon config and image object
        """
        config = self.get_effective_footer_config()
        
        if not isinstance(config, dict) or 'icons' not in config:
            return []
        
        icons_with_images = []
        for icon_config in config['icons']:
            try:
                from documents.models import DocumentImage
                image = DocumentImage.objects.get(id=icon_config['image_id'])
                icons_with_images.append({
                    'config': icon_config,
                    'image': image
                })
            except:
                pass
        
        return sorted(icons_with_images, key=lambda x: x['config'].get('order', 0))


    
    def sync_metadata_to_fields(self):
        """
        Sync common fields from document_metadata to direct fields for indexing.
        Called automatically by edit functions.
        """
        # Sync dates
        dates = self.get_metadata('dates', {})
        if dates.get('effective_date'):
            from datetime import datetime
            try:
                self.effective_date = datetime.fromisoformat(dates['effective_date']).date()
            except:
                pass
        
        # Sync legal fields
        legal = self.get_metadata('legal', {})
        if legal.get('governing_law'):
            self.governing_law = legal['governing_law']
        if legal.get('reference_number'):
            self.reference_number = legal['reference_number']
        
        # Sync parties
        if self.get_metadata('parties'):
            self.parties = self.get_metadata('parties')
        
        self.save()
    
    @property
    def semantic_version(self):
        """Get semantic version string."""
        return f"{self.major_version}.{self.minor_version}.{self.patch_version}"
    
    def get_all_data(self):
        """
        Get all document data in a structured format for editing/versioning.
        Used by edit functions to capture complete state.
        """
        return {
            'id': str(self.id),
            'title': self.title,
            'author': self.author,
            'version': self.version,
            'document_type': self.document_type,
            'status': self.status,
            'content': self.current_text,
            'metadata': self.document_metadata,
            'parties': self.parties,
            'signatories': self.signatories,
            'attachments': self.attachments,
            'custom_metadata': self.custom_metadata,
            'dates': {
                'effective_date': str(self.effective_date) if self.effective_date else None,
                'expiration_date': str(self.expiration_date) if self.expiration_date else None,
                'execution_date': str(self.execution_date) if self.execution_date else None,
            },
            'images': {
                'logo': str(self.logo_image.id) if self.logo_image else None,
                'watermark': str(self.watermark_image.id) if self.watermark_image else None,
                'background': str(self.background_image.id) if self.background_image else None,
            },
            'header_config': self.header_config,
            'footer_config': self.footer_config,
        }
    
    # ==== DOCUMENT HIERARCHY & RELATIONSHIP METHODS ====
    
    def set_parent(self, parent_doc, relationship_type='amendment'):
        """
        Set parent document and add to related_documents.
        
        Args:
            parent_doc: Parent Document instance or UUID
            relationship_type: Type of relationship (amendment, addendum, etc.)
        """
        if isinstance(parent_doc, str):
            parent_doc = Document.objects.get(id=parent_doc)
        
        self.parent_document = parent_doc
        
        # Add to related_documents
        if not isinstance(self.related_documents, list):
            self.related_documents = []
        
        # Remove existing parent reference if any
        self.related_documents = [
            r for r in self.related_documents 
            if r.get('relationship') != 'parent'
        ]
        
        # Add new parent reference
        self.related_documents.append({
            'id': str(parent_doc.id),
            'title': parent_doc.title,
            'relationship': 'parent',
            'type': relationship_type
        })
        
        self.save()
        return True
    
    def add_related_document(self, related_doc, relationship_type='related', bidirectional=True):
        """
        Add a related document reference.
        
        Args:
            related_doc: Related Document instance or UUID
            relationship_type: Type (related, parent, child, amendment, supersedes, etc.)
            bidirectional: Also add reverse relationship
        """
        if isinstance(related_doc, str):
            related_doc = Document.objects.get(id=related_doc)
        
        if not isinstance(self.related_documents, list):
            self.related_documents = []
        
        # Check if already exists
        exists = any(
            r.get('id') == str(related_doc.id) 
            for r in self.related_documents
        )
        
        if not exists:
            self.related_documents.append({
                'id': str(related_doc.id),
                'title': related_doc.title,
                'relationship': relationship_type,
                'added_at': timezone.now().isoformat() if 'timezone' in dir() else None
            })
            self.save()
        
        # Add bidirectional relationship
        if bidirectional:
            reverse_type = self._get_reverse_relationship(relationship_type)
            if not isinstance(related_doc.related_documents, list):
                related_doc.related_documents = []
            
            exists_reverse = any(
                r.get('id') == str(self.id) 
                for r in related_doc.related_documents
            )
            
            if not exists_reverse:
                related_doc.related_documents.append({
                    'id': str(self.id),
                    'title': self.title,
                    'relationship': reverse_type,
                })
                related_doc.save()
        
        return True
    
    def remove_related_document(self, doc_id):
        """Remove a related document reference."""
        if isinstance(self.related_documents, list):
            self.related_documents = [
                r for r in self.related_documents 
                if r.get('id') != str(doc_id)
            ]
            self.save()
            return True
        return False
    
    def get_children(self):
        """Get all child documents (amendments, addendums, etc.)."""
        return Document.objects.filter(parent_document=self).order_by('-created_at')
    
    def get_amendments(self):
        """Get all amendments to this document."""
        return self.amendments.all().order_by('-created_at')
    
    def get_hierarchy_tree(self, depth=0, max_depth=5):
        """
        Get complete document hierarchy tree.
        
        Returns structure:
        {
            'document': {...},
            'children': [
                {'document': {...}, 'children': [...]},
                ...
            ],
            'depth': 0
        }
        """
        if depth > max_depth:
            return None
        
        tree = {
            'id': str(self.id),
            'title': self.title,
            'version': self.version,
            'status': self.status,
            'document_type': self.document_type,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'depth': depth,
            'children': []
        }
        
        # Get children recursively
        for child in self.get_children():
            child_tree = child.get_hierarchy_tree(depth + 1, max_depth)
            if child_tree:
                tree['children'].append(child_tree)
        
        return tree
    
    def get_ancestors(self):
        """Get all ancestor documents (parent, grandparent, etc.)."""
        ancestors = []
        current = self.parent_document
        
        # Prevent infinite loops
        seen = set()
        
        while current and current.id not in seen:
            ancestors.append(current)
            seen.add(current.id)
            current = current.parent_document
        
        return ancestors
    
    def get_root_document(self):
        """Get the root document in the hierarchy."""
        current = self
        seen = set()
        
        while current.parent_document and current.id not in seen:
            seen.add(current.id)
            current = current.parent_document
        
        return current
    
    def get_all_related(self, relationship_type=None):
        """
        Get all related documents, optionally filtered by relationship type.
        
        Args:
            relationship_type: Filter by specific relationship (parent, child, amendment, etc.)
        """
        if not isinstance(self.related_documents, list):
            return []
        
        related = self.related_documents
        
        if relationship_type:
            related = [r for r in related if r.get('relationship') == relationship_type]
        
        # Fetch full document objects
        doc_ids = [r.get('id') for r in related if r.get('id')]
        return Document.objects.filter(id__in=doc_ids)
    
    def get_document_lineage(self):
        """
        Get complete lineage: ancestors + this document + descendants.
        
        Returns:
        {
            'ancestors': [...],
            'current': {...},
            'descendants': [...]
        }
        """
        return {
            'ancestors': [
                {
                    'id': str(a.id),
                    'title': a.title,
                    'version': a.version,
                    'created_at': a.created_at.isoformat() if a.created_at else None
                }
                for a in self.get_ancestors()
            ],
            'current': {
                'id': str(self.id),
                'title': self.title,
                'version': self.version,
                'status': self.status,
                'created_at': self.created_at.isoformat() if self.created_at else None
            },
            'descendants': self.get_hierarchy_tree().get('children', [])
        }
    
    def _get_reverse_relationship(self, relationship_type):
        """Get reverse relationship type for bidirectional links."""
        reverse_map = {
            'parent': 'child',
            'child': 'parent',
            'amendment': 'amended_by',
            'amended_by': 'amendment',
            'supersedes': 'superseded_by',
            'superseded_by': 'supersedes',
            'related': 'related',
        }
        return reverse_map.get(relationship_type, 'related')
    
    @classmethod
    def get_orphaned_documents(cls):
        """Get documents with no parent and no children."""
        return cls.objects.filter(
            parent_document__isnull=True
        ).exclude(
            id__in=cls.objects.filter(
                parent_document__isnull=False
            ).values_list('parent_document', flat=True)
        )
    
    @classmethod
    def get_root_documents(cls):
        """Get all root documents (no parent)."""
        return cls.objects.filter(parent_document__isnull=True).order_by('-created_at')


class Section(models.Model):
    """
    Hierarchical unit of a document (e.g., Article, Clause).
    Supports nested subsections with full edit tracking.
    
    Flexible Creation:
    - document field is OPTIONAL for easier creation
    - Can create sections first, then link to document
    - Document indexes will be rebuilt after linking
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, 
        on_delete=models.CASCADE, 
        related_name='sections',
        null=True,
        blank=True,
        help_text="Optional during creation - can be set later"
    )
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')
    
    title = models.CharField(max_length=500, null=True, blank=True)
    
    # Content span in the raw document
    content_start = models.IntegerField(default=0, null=True, blank=True)
    content_end = models.IntegerField(default=0, null=True, blank=True)
    content_text = models.TextField(blank=True, default='')
    
    # Edited content (if user modified)
    edited_text = models.TextField(null=True, blank=True, help_text="User-edited version of content")
    has_edits = models.BooleanField(default=False)
    
    # Classification
    SECTION_TYPES = [
        ('header', 'Document Header'),
        ('preamble', 'Preamble'),
        ('definitions', 'Definitions'),
        ('body', 'Main Body'),
        ('clause', 'Clause/Article'),
        ('schedule', 'Schedule/Exhibit'),
        ('signature', 'Signature Block'),
        ('other', 'Other'),
    ]
    section_type = models.CharField(max_length=50, choices=SECTION_TYPES, default='clause')
    
    # Importance & Analysis
    importance_level = models.IntegerField(default=3, help_text="1=Critical, 5=Low importance")
    is_boilerplate = models.BooleanField(default=False)
    requires_specialist_review = models.BooleanField(default=False)
    
    # Routing to specialist models
    specialist_model_type = models.CharField(max_length=100, null=True, blank=True, 
                                            help_text="Type of specialist model needed (e.g., 'termination_clause_expert')")
    specialist_review_status = models.CharField(max_length=20, default='pending',
                                                choices=[('pending', 'Pending'), ('in_progress', 'In Progress'), 
                                                        ('completed', 'Completed'), ('not_required', 'Not Required')])
    
    # Tags and metadata
    tags = models.JSONField(default=list, blank=True, help_text="Tags like ['confidential', 'payment', 'liability']")
    last_modified = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    custom_metadata = models.JSONField(default=dict, blank=True)
    
    # Version control for concurrent editing
    version = models.IntegerField(default=1, help_text="Version number for optimistic locking")
    last_modified_by_username = models.CharField(max_length=150, null=True, blank=True, 
                                                 help_text="Username of last editor for conflict resolution")
    
    # Ordering and hierarchy
    order = models.IntegerField(default=0)
    depth_level = models.IntegerField(default=0, help_text="Nesting level (0=root, 1=subsection, etc.)")

    # Reverse generic relation to viewer comments
    viewer_comments = GenericRelation('viewer.ViewerComment', content_type_field='content_type', object_id_field='object_id')
    
    class Meta:
        ordering = ['document', 'order']
        indexes = [
            models.Index(fields=['document', 'section_type']),
            models.Index(fields=['requires_specialist_review']),
            models.Index(fields=['document', 'version']),  # For conflict detection
        ]
    
    def __str__(self):
        return f"{self.id}: {self.title or 'Untitled'}"
    
    def save(self, *args, **kwargs):
        """Increment version on save for optimistic locking."""
        if self.pk:  # Updating existing record
            self.version += 1
        super().save(*args, **kwargs)
    
    def get_effective_content(self):
        """Return edited text if exists, otherwise original."""
        return self.edited_text if self.has_edits else self.content_text

    def needs_ai_recheck(self, document_version_number=None):
        """Return True if the latest AI result is missing or stale for this version."""
        if not self.section or not self.section.document:
            return True

        document = self.section.document
        version_number = document_version_number or document.version_number

        result = (
            ParagraphAIResult.objects.filter(
                paragraph=self,
                document=document,
                document_version_number=version_number,
                is_latest_for_version=True,
            )
            .order_by('-analysis_timestamp')
            .first()
        )

        if not result:
            return True

        if (self.edit_count or 0) != (result.paragraph_edit_count or 0):
            return True

        if self.last_modified and result.paragraph_last_modified:
            return self.last_modified > result.paragraph_last_modified

        if self.last_modified and not result.paragraph_last_modified:
            return True

        return False

    def reorder(self, new_order, user=None):
        """
        Move section to a new position in the document.
        Automatically adjusts order of other sections.
        
        Args:
            new_order: New position (0-based index)
            user: User performing the action
        
        Returns:
            dict: Summary of reordering with affected sections
        """
        from django.db import transaction
        
        old_order = self.order
        if old_order == new_order:
            return {'moved': False, 'message': 'Already at target position'}
        
        with transaction.atomic():
            # Get all sibling sections (same parent or both None)
            if self.parent:
                siblings = Section.objects.filter(
                    document=self.document,
                    parent=self.parent
                ).exclude(id=self.id).order_by('order')
            else:
                siblings = Section.objects.filter(
                    document=self.document,
                    parent__isnull=True
                ).exclude(id=self.id).order_by('order')
            
            # Move down (increasing order)
            if new_order > old_order:
                # Shift sections between old and new position up
                for sibling in siblings:
                    if old_order < sibling.order <= new_order:
                        sibling.order -= 1
                        sibling.save(update_fields=['order'])
            # Move up (decreasing order)
            else:
                # Shift sections between new and old position down
                for sibling in siblings:
                    if new_order <= sibling.order < old_order:
                        sibling.order += 1
                        sibling.save(update_fields=['order'])
            
            # Update this section's order
            self.order = new_order
            if user:
                self.modified_by = user
            self.save()
            
            return {
                'moved': True,
                'old_order': old_order,
                'new_order': new_order,
                'section_id': self.id,
                'siblings_affected': siblings.count()
            }
    
    def move_to_parent(self, new_parent, new_order=None, user=None):
        """
        Move section to a different parent (or to root level).
        Converts to subsection or promotes to main section.
        
        Args:
            new_parent: New parent Section or None for root level
            new_order: Position under new parent (None = append to end)
            user: User performing the action
        
        Returns:
            dict: Summary of move operation
        """
        from django.db import transaction
        
        old_parent = self.parent
        old_order = self.order
        
        with transaction.atomic():
            # Remove from old siblings
            if old_parent:
                old_siblings = Section.objects.filter(
                    document=self.document,
                    parent=old_parent
                ).exclude(id=self.id).filter(order__gt=old_order)
            else:
                old_siblings = Section.objects.filter(
                    document=self.document,
                    parent__isnull=True
                ).exclude(id=self.id).filter(order__gt=old_order)
            
            # Shift old siblings up
            for sibling in old_siblings:
                sibling.order -= 1
                sibling.save(update_fields=['order'])
            
            # Determine new order
            if new_order is None:
                # Append to end
                if new_parent:
                    max_order = Section.objects.filter(
                        document=self.document,
                        parent=new_parent
                    ).aggregate(models.Max('order'))['order__max']
                else:
                    max_order = Section.objects.filter(
                        document=self.document,
                        parent__isnull=True
                    ).aggregate(models.Max('order'))['order__max']
                
                new_order = (max_order or -1) + 1
            else:
                # Insert at specific position, shift others down
                if new_parent:
                    new_siblings = Section.objects.filter(
                        document=self.document,
                        parent=new_parent
                    ).filter(order__gte=new_order)
                else:
                    new_siblings = Section.objects.filter(
                        document=self.document,
                        parent__isnull=True
                    ).filter(order__gte=new_order)
                
                for sibling in new_siblings:
                    sibling.order += 1
                    sibling.save(update_fields=['order'])
            
            # Update this section
            self.parent = new_parent
            self.order = new_order
            
            # Update depth level
            if new_parent:
                self.depth_level = new_parent.depth_level + 1
            else:
                self.depth_level = 1
            
            if user:
                self.modified_by = user
            
            self.save()
            
            return {
                'moved': True,
                'old_parent': str(old_parent.id) if old_parent else None,
                'new_parent': str(new_parent.id) if new_parent else None,
                'old_order': old_order,
                'new_order': new_order,
                'new_depth': self.depth_level
            }
    
    @classmethod
    def normalize_orders(cls, document, parent=None):
        """
        Normalize order values for sections (0, 1, 2, 3...).
        Useful after bulk operations or to fix gaps.
        
        Args:
            document: Document to normalize
            parent: Parent section (None for root sections)
        """
        if parent:
            sections = cls.objects.filter(
                document=document,
                parent=parent
            ).order_by('order')
        else:
            sections = cls.objects.filter(
                document=document,
                parent__isnull=True
            ).order_by('order')
        
        for idx, section in enumerate(sections):
            if section.order != idx:
                section.order = idx
                section.save(update_fields=['order'])
        
        return sections.count()
    
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
        for image in self.image_components.all():
            components.append({
                'type': 'image',
                'order': image.order,
                'obj': image
            })
        
        # Collect files
        for file in self.file_components.all():
            components.append({
                'type': 'file',
                'order': file.order,
                'obj': file
            })
        
        # Sort by order
        components.sort(key=lambda x: x['order'])
        
        return components


class SectionReference(models.Model):
    """
    References to sections from other documents that the user has access to.
    Allows embedding/referencing content from other documents within a document.
    
    USAGE:
    1. Create a section reference:
        ref = SectionReference.objects.create(
            source_document=main_doc,
            referenced_section=other_section,
            created_by=user,
            position='after_section_1'
        )
    
    2. Access control is enforced - users can only reference sections from documents they have access to
    3. When previewing a document, referenced section data is fetched and included
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Source document (the document that contains this reference)
    source_document = models.ForeignKey(
        Document, 
        on_delete=models.CASCADE, 
        related_name='section_references',
        help_text="Document that contains this section reference"
    )
    
    # Referenced section (from another document)
    referenced_section = models.ForeignKey(
        'Section',
        on_delete=models.CASCADE,
        related_name='referenced_by',
        help_text="Section being referenced from another document"
    )
    
    # Position/ordering within the source document
    order = models.IntegerField(default=0, help_text="Order of this reference in the document")
    position_description = models.CharField(
        max_length=255, 
        null=True, 
        blank=True,
        help_text="Human-readable position (e.g., 'After Section 2.1')"
    )
    
    # Metadata
    created_by = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True,
        related_name='created_section_references',
        help_text="User who created this reference"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    
    # Optional note about why this section is referenced
    note = models.TextField(
        null=True, 
        blank=True,
        help_text="Optional note explaining why this section is referenced"
    )
    
    # Display preferences
    include_full_content = models.BooleanField(
        default=True,
        help_text="Whether to include full section content or just a link/preview"
    )
    
    class Meta:
        ordering = ['source_document', 'order']
        indexes = [
            models.Index(fields=['source_document', 'order']),
            models.Index(fields=['referenced_section']),
            models.Index(fields=['created_by']),
        ]
        # Prevent duplicate references
        unique_together = [['source_document', 'referenced_section', 'order']]
    
    def __str__(self):
        return f"Reference to {self.referenced_section} in {self.source_document}"
    
    def get_referenced_document(self):
        """Get the document that contains the referenced section."""
        return self.referenced_section.document
    
    def can_access(self, user):
        """
        Check if the user has access to both the source document and the referenced document.
        
        Args:
            user: User to check access for
        
        Returns:
            bool: True if user can access both documents
        """
        from django.contrib.contenttypes.models import ContentType
        from sharing.models import Share
        
        # Get Document content type
        doc_content_type = ContentType.objects.get_for_model(self.source_document.__class__)
        
        # Check access to source document
        source_access = (
            self.source_document.created_by == user or
            Share.objects.filter(
                content_type=doc_content_type,
                object_id=str(self.source_document.id),
                shared_with_user=user
            ).exists()
        )
        
        # Check access to referenced document
        referenced_doc = self.get_referenced_document()
        referenced_access = (
            referenced_doc.created_by == user or
            Share.objects.filter(
                content_type=doc_content_type,
                object_id=str(referenced_doc.id),
                shared_with_user=user
            ).exists()
        )
        
        return source_access and referenced_access
    
    def get_reference_data(self):
        """
        Get complete data about the referenced section for preview/display.
        
        Returns:
            dict: Section data including title, content, metadata
        """
        section = self.referenced_section
        doc = section.document
        
        return {
            'reference_id': str(self.id),
            'section': {
                'id': section.id,
                'title': section.title,
                'content': section.get_effective_content(),
                'section_type': section.section_type,
                'order': section.order,
            },
            'source_document': {
                'id': str(doc.id),
                'title': doc.title,
                'created_by': doc.created_by.username if doc.created_by else None,
            },
            'include_full_content': self.include_full_content,
            'note': self.note,
            'created_at': self.created_at.isoformat(),
        }


class Paragraph(models.Model):
    """
    A distinct block of text within a section (e.g., a clause body).
    Supports inline editing and change tracking.
    
    Flexible Creation:
    - section field is OPTIONAL for easier creation
    - Can create paragraphs first, then link to section/document
    - Document indexes will be rebuilt after linking
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    section = models.ForeignKey(
        Section,
        on_delete=models.CASCADE,
        related_name='paragraphs',
        null=True,
        blank=True,
        help_text="Optional during creation - can be set later"
    )
    
    # Content span
    content_start = models.IntegerField(default=0, null=True, blank=True)
    content_end = models.IntegerField(default=0, null=True, blank=True)
    content_text = models.TextField(blank=True, default='')
    
    # Edited content
    edited_text = models.TextField(null=True, blank=True, help_text="User-edited version")
    has_edits = models.BooleanField(default=False)
    
    # Paragraph classification
    PARAGRAPH_TYPES = [
        ('standard', 'Standard Paragraph'),
        ('definition', 'Definition'),
        ('obligation', 'Obligation/Duty'),
        ('right', 'Right/Permission'),
        ('condition', 'Condition/Requirement'),
        ('exception', 'Exception/Exclusion'),
        ('example', 'Example/Illustration'),
    ]
    paragraph_type = models.CharField(max_length=50, choices=PARAGRAPH_TYPES, default='standard')

    # Short topic/label for what the paragraph is about
    topic = models.CharField(max_length=255, blank=True, default='')
    
    # Analysis flags
    is_ambiguous = models.BooleanField(default=False)
    is_conflicting = models.BooleanField(default=False)
    complexity_score = models.FloatField(default=0.0, help_text="Readability/complexity score (0-1)")
    
    # Change tracking
    last_modified = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    edit_count = models.IntegerField(default=0, help_text="Number of times edited")
    
    # Metadata
    custom_metadata = models.JSONField(default=dict, blank=True)
    
    # Ordering
    order = models.IntegerField(default=0)

    # Reverse generic relation to viewer comments
    viewer_comments = GenericRelation('viewer.ViewerComment', content_type_field='content_type', object_id_field='object_id')
    
    class Meta:
        ordering = ['section', 'order']
    
    def __init__(self, *args, **kwargs):
        """
        Initialize Paragraph, accepting extra keyword arguments that might be passed
        but not used (like 'created_by') to prevent unexpected keyword argument errors.
        """
        # Remove any extra kwargs that aren't actual model fields
        extra_kwargs = ['created_by']
        for key in extra_kwargs:
            kwargs.pop(key, None)
        
        super().__init__(*args, **kwargs)
    
    def __str__(self):
        return f"{self.id}: {self.content_text[:50]}..."
    
    def get_effective_content(self):
        """Return edited text if exists, otherwise original."""
        return self.edited_text if self.has_edits else self.content_text

    def render_with_metadata(self, metadata=None, text=None):
        """
        Render paragraph text by replacing placeholders like [[field_name]] or
        [[paragraph_id.field_name]] with values from metadata.

    Uses document-level metadata when available.
        """
        source_text = text if text is not None else self.get_effective_content() or ''
        if not source_text:
            return source_text

        if metadata is None:
            metadata = {}
            try:
                section = getattr(self, 'section', None)
                document = getattr(section, 'document', None) if section else None
                if document:
                    metadata = (document.document_metadata or {}).copy()
                    custom_metadata = document.custom_metadata or {}
                    self._deep_merge_metadata(metadata, custom_metadata)
            except Exception:
                metadata = {}

            if not metadata:
                metadata = {}

        metadata = metadata or {}

        def flatten(data, parent_key='', sep='.'):
            items = {}
            for key, value in (data or {}).items():
                new_key = f"{parent_key}{sep}{key}" if parent_key else str(key)
                if isinstance(value, dict):
                    items.update(flatten(value, new_key, sep=sep))
                else:
                    items[new_key] = value
            return items

        def normalize_key(key: str) -> str:
            base = key.split('.')[-1]
            base = re.sub(r'[^A-Za-z0-9]+', '_', base).strip('_')
            return base.lower()

        def normalize_path(key: str) -> str:
            normalized = re.sub(r'[^A-Za-z0-9]+', '_', key).strip('_')
            return normalized.lower()

        flat_metadata = flatten(metadata)
        rendered = source_text
        normalized_lookup = {}
        for key, value in flat_metadata.items():
            if value is None:
                continue
            key_str = str(key)
            leaf = key_str.split('.')[-1]
            normalized_lookup[normalize_path(key_str)] = str(value)
            normalized_lookup[normalize_path(leaf)] = str(value)
            normalized_lookup[normalize_key(key_str)] = str(value)

        if normalized_lookup:
            pattern = re.compile(r'\[\[([^\]]+)\]\]')

            def replace_placeholder(match):
                token = match.group(1).strip()
                prefix = f"{self.id}."
                if token.startswith(prefix):
                    token = token[len(prefix):]
                normalized_token = normalize_path(token)
                return normalized_lookup.get(normalized_token, match.group(0))

            rendered = pattern.sub(replace_placeholder, rendered)

        return rendered


class LatexCode(models.Model):
    """
    LaTeX code block within a section.
    Stored similarly to paragraphs but dedicated to LaTeX content.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    section = models.ForeignKey(
        Section,
        on_delete=models.CASCADE,
        related_name='latex_codes',
        null=True,
        blank=True,
        help_text="Optional during creation - can be set later",
    )

    # LaTeX content
    latex_code = models.TextField(blank=True, default='')
    edited_code = models.TextField(null=True, blank=True, help_text="User-edited LaTeX code")
    has_edits = models.BooleanField(default=False)

    # Optional type/label
    code_type = models.CharField(max_length=50, default='latex')
    topic = models.CharField(max_length=255, blank=True, default='')

    # Change tracking
    last_modified = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    edit_count = models.IntegerField(default=0, help_text="Number of times edited")

    # Metadata
    custom_metadata = models.JSONField(default=dict, blank=True)

    # Ordering
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['section', 'order']

    def __str__(self):
        preview = (self.edited_code or self.latex_code or '')
        return f"{self.id}: {preview[:50]}..."

    def get_effective_content(self):
        return self.edited_code if self.has_edits else self.latex_code

    def _deep_merge_metadata(self, target, source):
        for key, value in (source or {}).items():
            if isinstance(value, dict) and isinstance(target.get(key), dict):
                self._deep_merge_metadata(target[key], value)
            else:
                target[key] = value

    def render_with_metadata(self, metadata=None, text=None):
        """
        Render LaTeX code by replacing [[field_name]] placeholders with values
        from document metadata — same system used by Paragraph.

        Special handling: metadata values are LaTeX-escaped so that characters
        like &, %, $, #, _, {, }, ~, ^ don't break compilation.
        """
        source_text = text if text is not None else self.get_effective_content() or ''
        if not source_text:
            return source_text

        if metadata is None:
            metadata = {}
            try:
                section = getattr(self, 'section', None)
                document = getattr(section, 'document', None) if section else None
                if document:
                    metadata = (document.document_metadata or {}).copy()
                    custom_meta = document.custom_metadata or {}
                    self._deep_merge_metadata(metadata, custom_meta)
            except Exception:
                metadata = {}

            if not metadata:
                metadata = {}

        metadata = metadata or {}

        def flatten(data, parent_key='', sep='.'):
            items = {}
            for key, value in (data or {}).items():
                new_key = f"{parent_key}{sep}{key}" if parent_key else str(key)
                if isinstance(value, dict):
                    items.update(flatten(value, new_key, sep=sep))
                else:
                    items[new_key] = value
            return items

        def normalize_key(key: str) -> str:
            base = key.split('.')[-1]
            base = re.sub(r'[^A-Za-z0-9]+', '_', base).strip('_')
            return base.lower()

        def normalize_path(key: str) -> str:
            normalized = re.sub(r'[^A-Za-z0-9]+', '_', key).strip('_')
            return normalized.lower()

        def latex_escape(val: str) -> str:
            """Escape special LaTeX characters in a metadata value."""
            replacements = [
                ('\\', r'\textbackslash{}'),
                ('&', r'\&'),
                ('%', r'\%'),
                ('$', r'\$'),
                ('#', r'\#'),
                ('_', r'\_'),
                ('{', r'\{'),
                ('}', r'\}'),
                ('~', r'\textasciitilde{}'),
                ('^', r'\textasciicircum{}'),
            ]
            for char, escaped in replacements:
                val = val.replace(char, escaped)
            return val

        flat_metadata = flatten(metadata)
        rendered = source_text
        normalized_lookup = {}
        for key, value in flat_metadata.items():
            if value is None:
                continue
            key_str = str(key)
            leaf = key_str.split('.')[-1]
            escaped_val = latex_escape(str(value))
            normalized_lookup[normalize_path(key_str)] = escaped_val
            normalized_lookup[normalize_path(leaf)] = escaped_val
            normalized_lookup[normalize_key(key_str)] = escaped_val

        if normalized_lookup:
            pattern = re.compile(r'\[\[([^\]]+)\]\]')

            def replace_placeholder(match):
                token = match.group(1).strip()
                prefix = f"{self.id}."
                if token.startswith(prefix):
                    token = token[len(prefix):]
                normalized_token = normalize_path(token)
                return normalized_lookup.get(normalized_token, match.group(0))

            rendered = pattern.sub(replace_placeholder, rendered)

        return rendered

    def needs_ai_recheck(self, document_version_number: int) -> bool:
        """
        Determine whether this paragraph requires an AI re-check for the given
        document version number.

        Returns True when:
        - there is no existing ParagraphAIResult for this paragraph+version, or
        - the stored result's edit count or last_modified doesn't match the paragraph's current state.

        Returns False when a matching ParagraphAIResult exists and appears fresh.
        """
        try:
            existing_ai = ParagraphAIResult.objects.filter(
                paragraph=self,
                document_version_number=document_version_number,
                is_latest_for_version=True,
            ).order_by('-analysis_timestamp').first()
        except Exception:
            return True

        if not existing_ai:
            return True

        paragraph_edit_count = self.edit_count or 0
        ai_edit_count = existing_ai.paragraph_edit_count or 0
        ai_last_mod = existing_ai.paragraph_last_modified
        para_last_mod = self.last_modified

        # Treat stored result as fresh when counts match and last_modified matches (or AI didn't record a last_modified)
        if paragraph_edit_count == ai_edit_count and (ai_last_mod is None or str(ai_last_mod) == str(para_last_mod)):
            return False

        return True
    
    def reorder(self, new_order, user=None):
        """
        Move paragraph to a new position within its section.
        Automatically adjusts order of other paragraphs.
        
        Args:
            new_order: New position (0-based index)
            user: User performing the action
        
        Returns:
            dict: Summary of reordering with affected paragraphs
        """
        from django.db import transaction
        
        old_order = self.order
        if old_order == new_order:
            return {'moved': False, 'message': 'Already at target position'}
        
        with transaction.atomic():
            # Get all sibling paragraphs in same section
            siblings = Paragraph.objects.filter(
                section=self.section
            ).exclude(id=self.id).order_by('order')
            
            # Move down (increasing order)
            if new_order > old_order:
                # Shift paragraphs between old and new position up
                for sibling in siblings:
                    if old_order < sibling.order <= new_order:
                        sibling.order -= 1
                        sibling.save(update_fields=['order'])
            # Move up (decreasing order)
            else:
                # Shift paragraphs between new and old position down
                for sibling in siblings:
                    if new_order <= sibling.order < old_order:
                        sibling.order += 1
                        sibling.save(update_fields=['order'])
            
            # Update this paragraph's order
            self.order = new_order
            if user:
                self.modified_by = user
            self.edit_count += 1
            self.save()
            
            return {
                'moved': True,
                'old_order': old_order,
                'new_order': new_order,
                'paragraph_id': self.id,
                'siblings_affected': siblings.count()
            }
    
    def move_to_section(self, new_section, new_order=None, user=None):
        """
        Move paragraph to a different section.
        
        Args:
            new_section: Target Section
            new_order: Position in new section (None = append to end)
            user: User performing the action
        
        Returns:
            dict: Summary of move operation
        """
        from django.db import transaction
        
        old_section = self.section
        old_order = self.order
        
        if old_section.id == new_section.id:
            # Moving within same section, just reorder
            return self.reorder(new_order if new_order is not None else old_order, user)
        
        with transaction.atomic():
            # Remove from old section - shift siblings up
            old_siblings = Paragraph.objects.filter(
                section=old_section
            ).exclude(id=self.id).filter(order__gt=old_order)
            
            for sibling in old_siblings:
                sibling.order -= 1
                sibling.save(update_fields=['order'])
            
            # Determine new order
            if new_order is None:
                # Append to end
                max_order = Paragraph.objects.filter(
                    section=new_section
                ).aggregate(models.Max('order'))['order__max']
                new_order = (max_order or -1) + 1
            else:
                # Insert at specific position, shift others down
                new_siblings = Paragraph.objects.filter(
                    section=new_section
                ).filter(order__gte=new_order)
                
                for sibling in new_siblings:
                    sibling.order += 1
                    sibling.save(update_fields=['order'])
            
            # Update this paragraph
            self.section = new_section
            self.order = new_order
            
            if user:
                self.modified_by = user
            
            self.edit_count += 1
            self.save()
            
            return {
                'moved': True,
                'old_section': str(old_section.id),
                'new_section': str(new_section.id),
                'old_order': old_order,
                'new_order': new_order
            }
    
    @classmethod
    def normalize_orders(cls, section):
        """
        Normalize order values for paragraphs (0, 1, 2, 3...).
        Useful after bulk operations or to fix gaps.
        
        Args:
            section: Section to normalize paragraphs for
        """
        paragraphs = cls.objects.filter(
            section=section
        ).order_by('order')
        
        for idx, paragraph in enumerate(paragraphs):
            if paragraph.order != idx:
                paragraph.order = idx
                paragraph.save(update_fields=['order'])
        
        return paragraphs.count()
    
    def save(self, *args, **kwargs):
        """
        Save paragraph.
        """
        # Save the paragraph first
        super().save(*args, **kwargs)


class Table(models.Model):
    """
    A table component within a section, similar to paragraphs.
    Supports structured table data with up to 64 columns.
    Tables can store data in a flexible grid format with headers and rows.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name='tables', null=True, blank=True)
    
    # Table metadata
    title = models.CharField(max_length=500, null=True, blank=True, help_text="Optional table title/caption")
    description = models.TextField(null=True, blank=True, help_text="Description of table purpose")
    
    # Table structure
    num_columns = models.IntegerField(default=2, help_text="Number of columns (max 64)")
    num_rows = models.IntegerField(default=1, help_text="Number of data rows (excluding header)")
    
    # Column definitions
    column_headers = models.JSONField(
        default=list, 
        blank=True,
        help_text="""
        List of column header objects:
        [
            {'id': 'col1', 'label': 'Name', 'width': '200px', 'align': 'left', 'type': 'text'},
            {'id': 'col2', 'label': 'Value', 'width': '150px', 'align': 'right', 'type': 'number'}
        ]
        """
    )
    
    # Table data - stored as array of row objects
    table_data = models.JSONField(
        default=list,
        blank=True,
        help_text="""
        Array of row objects containing cell data:
        [
            {'row_id': 'r1', 'cells': {'col1': 'Value 1', 'col2': '100', ...}},
            {'row_id': 'r2', 'cells': {'col1': 'Value 2', 'col2': '200', ...}}
        ]
        """
    )
    
    # Table styling and configuration
    table_config = models.JSONField(
        default=dict,
        blank=True,
        help_text="""
        Table styling and behavior settings:
        {
            'border_style': 'solid',
            'border_color': '#000000',
            'header_bg_color': '#f0f0f0',
            'striped_rows': true,
            'hover_effect': true,
            'sortable': false,
            'filterable': false,
            'show_footer': false,
            'footer_data': {},
            'cell_padding': '8px',
            'font_size': '14px'
        }
        """
    )
    
    # Table classification
    TABLE_TYPES = [
        ('data', 'Data Table'),
        ('comparison', 'Comparison Table'),
        ('pricing', 'Pricing/Financial Table'),
        ('schedule', 'Schedule/Timeline'),
        ('matrix', 'Decision Matrix'),
        ('specifications', 'Technical Specifications'),
        ('other', 'Other'),
    ]
    table_type = models.CharField(max_length=50, choices=TABLE_TYPES, default='data')
    
    # Edited content tracking
    has_edits = models.BooleanField(default=False)
    original_data_backup = models.JSONField(
        null=True,
        blank=True,
        help_text="Backup of original table data before edits"
    )
    
    # Change tracking
    last_modified = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    edit_count = models.IntegerField(default=0, help_text="Number of times edited")
    
    # Metadata
    custom_metadata = models.JSONField(default=dict, blank=True)
    
    # Ordering
    order = models.IntegerField(default=0)
    
    # Analysis flags
    is_complex = models.BooleanField(default=False, help_text="Flags complex tables for review")
    requires_validation = models.BooleanField(default=False, help_text="Needs data validation")

    # Reverse generic relation to viewer comments
    viewer_comments = GenericRelation('viewer.ViewerComment', content_type_field='content_type', object_id_field='object_id')
    
    class Meta:
        ordering = ['section', 'order']
        verbose_name = "Table"
        verbose_name_plural = "Tables"
    
    def __str__(self):
        title_str = self.title or "Untitled Table"
        return f"{self.id}: {title_str} ({self.num_columns}x{self.num_rows})"
    
    def clean(self):
        """Validate table constraints."""
        from django.core.exceptions import ValidationError
        
        if self.num_columns > 64:
            raise ValidationError("Tables cannot have more than 64 columns")
        if self.num_columns < 1:
            raise ValidationError("Tables must have at least 1 column")
        if self.num_rows < 0:
            raise ValidationError("Number of rows cannot be negative")
    
    def save(self, *args, **kwargs):
        """Save with validation."""
        self.full_clean()
        super().save(*args, **kwargs)
    
    def initialize_table(self, num_columns=2, num_rows=1, column_labels=None):
        """
        Initialize table structure with default columns and empty rows.
        
        Args:
            num_columns: Number of columns (max 64)
            num_rows: Number of data rows
            column_labels: Optional list of column labels
        
        Returns:
            dict: Summary of initialization
        """
        if num_columns > 64:
            raise ValueError("Maximum 64 columns allowed")
        
        self.num_columns = num_columns
        self.num_rows = num_rows
        
        # Create column headers
        self.column_headers = []
        for i in range(num_columns):
            label = column_labels[i] if column_labels and i < len(column_labels) else f"Column {i+1}"
            self.column_headers.append({
                'id': f'col{i+1}',
                'label': label,
                'width': 'auto',
                'align': 'left',
                'type': 'text'
            })
        
        # Create empty rows
        self.table_data = []
        for i in range(num_rows):
            row = {
                'row_id': f'r{i+1}',
                'cells': {f'col{j+1}': '' for j in range(num_columns)}
            }
            self.table_data.append(row)
        
        self.save()
        
        return {
            'initialized': True,
            'columns': num_columns,
            'rows': num_rows,
            'table_id': self.id
        }
    
    def add_row(self, row_data=None, position=None):
        """
        Add a new row to the table.
        
        Args:
            row_data: Dict of cell values {col_id: value}
            position: Insert position (None = append to end)
        
        Returns:
            dict: New row object
        """
        row_id = f'r{len(self.table_data) + 1}'
        
        # Create cells for all columns
        cells = {}
        for col in self.column_headers:
            col_id = col['id']
            cells[col_id] = row_data.get(col_id, '') if row_data else ''
        
        new_row = {
            'row_id': row_id,
            'cells': cells
        }
        
        if position is not None and 0 <= position <= len(self.table_data):
            self.table_data.insert(position, new_row)
        else:
            self.table_data.append(new_row)
        
        self.num_rows = len(self.table_data)
        self.edit_count += 1
        self.has_edits = True
        self.save()
        
        return new_row
    
    def delete_row(self, row_id):
        """
        Delete a row from the table.
        
        Args:
            row_id: ID of row to delete
        
        Returns:
            bool: True if deleted, False if not found
        """
        original_length = len(self.table_data)
        self.table_data = [row for row in self.table_data if row['row_id'] != row_id]
        
        if len(self.table_data) < original_length:
            self.num_rows = len(self.table_data)
            self.edit_count += 1
            self.has_edits = True
            self.save()
            return True
        
        return False
    
    def add_column(self, column_label="New Column", column_config=None, position=None):
        """
        Add a new column to the table.
        
        Args:
            column_label: Label for the new column
            column_config: Optional column configuration dict
            position: Insert position (None = append to end)
        
        Returns:
            dict: New column object
        """
        if self.num_columns >= 64:
            raise ValueError("Maximum 64 columns reached")
        
        col_id = f'col{self.num_columns + 1}'
        
        new_column = {
            'id': col_id,
            'label': column_label,
            'width': 'auto',
            'align': 'left',
            'type': 'text'
        }
        
        if column_config:
            new_column.update(column_config)
        
        # Add column header
        if position is not None and 0 <= position <= len(self.column_headers):
            self.column_headers.insert(position, new_column)
        else:
            self.column_headers.append(new_column)
        
        # Add empty cells to all rows
        for row in self.table_data:
            row['cells'][col_id] = ''
        
        self.num_columns = len(self.column_headers)
        self.edit_count += 1
        self.has_edits = True
        self.save()
        
        return new_column
    
    def delete_column(self, col_id):
        """
        Delete a column from the table.
        
        Args:
            col_id: ID of column to delete
        
        Returns:
            bool: True if deleted, False if not found
        """
        if self.num_columns <= 1:
            raise ValueError("Cannot delete last column")
        
        original_length = len(self.column_headers)
        self.column_headers = [col for col in self.column_headers if col['id'] != col_id]
        
        if len(self.column_headers) < original_length:
            # Remove cells from all rows
            for row in self.table_data:
                row['cells'].pop(col_id, None)
            
            self.num_columns = len(self.column_headers)
            self.edit_count += 1
            self.has_edits = True
            self.save()
            return True
        
        return False
    
    def update_cell(self, row_id, col_id, value):
        """
        Update a specific cell value.
        
        Args:
            row_id: Row identifier
            col_id: Column identifier
            value: New cell value
        
        Returns:
            bool: True if updated, False if cell not found
        """
        for row in self.table_data:
            if row['row_id'] == row_id:
                if col_id in row['cells']:
                    row['cells'][col_id] = value
                    self.edit_count += 1
                    self.has_edits = True
                    self.save()
                    return True
        
        return False
    
    def get_cell(self, row_id, col_id, default=None):
        """
        Get a specific cell value.
        
        Args:
            row_id: Row identifier
            col_id: Column identifier
            default: Default value if cell not found
        
        Returns:
            Cell value or default
        """
        for row in self.table_data:
            if row['row_id'] == row_id:
                return row['cells'].get(col_id, default)
        
        return default
    
    def reorder(self, new_order, user=None):
        """
        Move table to a new position within its section.
        Automatically adjusts order of other tables.
        
        Args:
            new_order: New position (0-based index)
            user: User performing the action
        
        Returns:
            dict: Summary of reordering
        """
        from django.db import transaction
        
        old_order = self.order
        if old_order == new_order:
            return {'moved': False, 'message': 'Already at target position'}
        
        with transaction.atomic():
            # Get all sibling tables in same section
            siblings = Table.objects.filter(
                section=self.section
            ).exclude(id=self.id).order_by('order')
            
            # Move down (increasing order)
            if new_order > old_order:
                for sibling in siblings:
                    if old_order < sibling.order <= new_order:
                        sibling.order -= 1
                        sibling.save(update_fields=['order'])
            # Move up (decreasing order)
            else:
                for sibling in siblings:
                    if new_order <= sibling.order < old_order:
                        sibling.order += 1
                        sibling.save(update_fields=['order'])
            
            # Update this table's order
            self.order = new_order
            if user:
                self.modified_by = user
            self.edit_count += 1
            self.save()
            
            return {
                'moved': True,
                'old_order': old_order,
                'new_order': new_order,
                'table_id': self.id,
                'siblings_affected': siblings.count()
            }
    
    def move_to_section(self, new_section, new_order=None, user=None):
        """
        Move table to a different section.
        
        Args:
            new_section: Target Section
            new_order: Position in new section (None = append to end)
            user: User performing the action
        
        Returns:
            dict: Summary of move operation
        """
        from django.db import transaction
        
        old_section = self.section
        old_order = self.order
        
        # Handle case where table has no section
        if not old_section:
            self.section = new_section
            self.order = new_order if new_order is not None else 0
            if user:
                self.modified_by = user
            self.save()
            return {
                'moved': True,
                'old_section': None,
                'new_section': str(new_section.id),
                'old_order': old_order,
                'new_order': self.order
            }
        
        if old_section.id == new_section.id:
            return self.reorder(new_order if new_order is not None else old_order, user)
        
        with transaction.atomic():
            # Remove from old section - shift siblings up
            old_siblings = Table.objects.filter(
                section=old_section
            ).exclude(id=self.id).filter(order__gt=old_order)
            
            for sibling in old_siblings:
                sibling.order -= 1
                sibling.save(update_fields=['order'])
            
            # Determine new order
            if new_order is None:
                max_order = Table.objects.filter(
                    section=new_section
                ).aggregate(models.Max('order'))['order__max']
                new_order = (max_order or -1) + 1
            else:
                new_siblings = Table.objects.filter(
                    section=new_section
                ).filter(order__gte=new_order)
                
                for sibling in new_siblings:
                    sibling.order += 1
                    sibling.save(update_fields=['order'])
            
            # Update this table
            self.section = new_section
            self.order = new_order
            
            if user:
                self.modified_by = user
            
            self.edit_count += 1
            self.save()
            
            return {
                'moved': True,
                'old_section': str(old_section.id),
                'new_section': str(new_section.id),
                'old_order': old_order,
                'new_order': new_order
            }
    
    def get_formatted_rows(self):
        """
        Get table rows formatted for template rendering.
        Returns a list of cell value lists in the correct column order.
        
        Returns:
            list: List of lists, where each inner list contains cell values in column order
        
        Example:
            [
                ['Value 1', 'Value 2', 'Value 3'],  # Row 1
                ['Value 4', 'Value 5', 'Value 6'],  # Row 2
            ]
        """
        headers = self.column_headers or []
        formatted_rows = []

        def _header_id(header, idx):
            if isinstance(header, dict):
                return header.get('id') or header.get('label') or f'col{idx + 1}'
            if isinstance(header, str):
                return header
            return f'col{idx + 1}'

        for row_data in self.table_data:
            if isinstance(row_data, dict) and 'cells' in row_data:
                row_cells = row_data['cells']
                if isinstance(row_cells, dict):
                    # Extract cell values in column order, skip row_id
                    cells = []
                    for idx, header in enumerate(headers):
                        col_id = _header_id(header, idx)
                        cell_value = row_cells.get(col_id, '')
                        cells.append(str(cell_value) if cell_value is not None else '')
                    formatted_rows.append(cells)
                elif isinstance(row_cells, list):
                    # Already a list
                    formatted_rows.append([str(c) if c is not None else '' for c in row_cells])
            elif isinstance(row_data, list):
                # Legacy list-of-lists row format
                formatted_rows.append([str(c) if c is not None else '' for c in row_data])
        
        return formatted_rows
    
    @classmethod
    def normalize_orders(cls, section):
        """
        Normalize order values for tables (0, 1, 2, 3...).
        
        Args:
            section: Section to normalize tables for
        """
        tables = cls.objects.filter(
            section=section
        ).order_by('order')
        
        for idx, table in enumerate(tables):
            if table.order != idx:
                table.order = idx
                table.save(update_fields=['order'])
        
        return tables.count()


class ImageComponent(models.Model):
    """
    An image component within a section, positioned like paragraphs and tables.
    Images are uploaded to a library and referenced by ID, enabling reuse across documents.
    
    DESIGN PHILOSOPHY:
    - Images are uploaded separately to a library (DocumentImage model)
    - ImageComponent references the uploaded image and positions it in the document
    - Supports drag-and-drop from previously uploaded images
    - Can upload new images or reuse existing ones
    - Ordering system matches paragraphs and tables for consistent document flow
    
    USAGE:
    1. Upload image to library:
        uploaded_img = DocumentImage.objects.create(
            name='Company Logo',
            image=file,
            image_type='logo',
            uploaded_by=user
        )
    
    2. Place image in document:
        img_component = ImageComponent.objects.create(
            section=section,
            image_reference=uploaded_img,
            order=2,  # Position between other components
            caption='Figure 1: Company Logo'
        )
    
    3. Reuse existing image in another location:
        img_component2 = ImageComponent.objects.create(
            section=another_section,
            image_reference=uploaded_img,  # Same image
            order=0
        )
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    section = models.ForeignKey(
        Section,
        on_delete=models.CASCADE,
        related_name='image_components',
        null=True,
        blank=True,
        help_text="Optional during creation - can be set later"
    )
    
    # Image reference - links to uploaded image library
    image_reference = models.ForeignKey(
        'DocumentImage', 
        on_delete=models.CASCADE,
        related_name='component_usages',
        null=True,
        blank=True,
        help_text="Reference to uploaded image in library (optional during creation)"
    )
    
    # Display properties
    caption = models.CharField(max_length=500, null=True, blank=True,
                             help_text="Image caption displayed below image")
    alt_text = models.CharField(max_length=255, null=True, blank=True,
                               help_text="Alternative text for accessibility")
    title = models.CharField(max_length=255, null=True, blank=True,
                            help_text="Optional title for the image")
    figure_number = models.CharField(max_length=50, null=True, blank=True,
                                    help_text="Figure reference (e.g., 'Figure 1', 'Exhibit A')")
    
    # Size and alignment
    # Size and alignment — free-text, no choices constraint.
    # Alignment: left, center, right, justify
    # Size mode: original, small, medium, large, full, custom
    alignment = models.CharField(max_length=20, default='center', blank=True,
                                help_text="Image alignment in document")
    size_mode = models.CharField(max_length=20, default='medium', blank=True,
                                help_text="Image size preset")
    
    # Custom sizing (when size_mode='custom')
    custom_width_percent = models.FloatField(null=True, blank=True,
                                            help_text="Width as percentage (0-100)")
    custom_width_pixels = models.IntegerField(null=True, blank=True,
                                             help_text="Fixed width in pixels")
    custom_height_pixels = models.IntegerField(null=True, blank=True,
                                              help_text="Fixed height in pixels")
    maintain_aspect_ratio = models.BooleanField(default=True,
                                               help_text="Keep original aspect ratio when resizing")
    
    # Spacing
    margin_top = models.IntegerField(default=20, help_text="Top margin in pixels")
    margin_bottom = models.IntegerField(default=20, help_text="Bottom margin in pixels")
    margin_left = models.IntegerField(default=0, help_text="Left margin in pixels")
    margin_right = models.IntegerField(default=0, help_text="Right margin in pixels")
    
    # Border and styling
    show_border = models.BooleanField(default=False)
    border_color = models.CharField(max_length=20, default='#cccccc',
                                   help_text="Hex color code")
    border_width = models.IntegerField(default=1, help_text="Border width in pixels")
    
    # Link (make image clickable)
    link_url = models.URLField(null=True, blank=True,
                              help_text="URL if image should be clickable")
    
    # Classification — free-text, no choices constraint.
    # Common values: figure, picture, diagram, logo, signature, stamp,
    #                exhibit, screenshot, photo, other
    component_type = models.CharField(max_length=50, default='figure', blank=True)
    
    # Visibility and display options
    is_visible = models.BooleanField(default=True,
                                    help_text="Show/hide without deleting")
    show_caption = models.BooleanField(default=True,
                                      help_text="Display caption below image")
    show_figure_number = models.BooleanField(default=True,
                                            help_text="Display figure number")
    
    # Change tracking
    last_modified = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='modified_image_components')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='created_image_components')
    created_at = models.DateTimeField(auto_now_add=True)
    edit_count = models.IntegerField(default=0, help_text="Number of times edited")
    
    # Metadata
    custom_metadata = models.JSONField(default=dict, blank=True,
                                      help_text="Additional custom properties")
    
    # Ordering - positions image among other section components (paragraphs, tables, images)
    order = models.IntegerField(default=0,
                               help_text="Position in section (0-based, works with paragraphs and tables)")

    # Reverse generic relation to viewer comments
    viewer_comments = GenericRelation('viewer.ViewerComment', content_type_field='content_type', object_id_field='object_id')
    
    class Meta:
        ordering = ['section', 'order']
        verbose_name = "Image Component"
        verbose_name_plural = "Image Components"
        indexes = [
            models.Index(fields=['section', 'order']),
            models.Index(fields=['image_reference']),
            models.Index(fields=['created_by']),
        ]
    
    def __str__(self):
        title_str = self.title or self.caption or self.figure_number or "Untitled Image"
        return f"{self.id}: {title_str}"
    
    def __init__(self, *args, **kwargs):
        """Handle extra kwargs that might be passed."""
        # Remove any extra kwargs not in model fields
        extra_kwargs = []  # Add any if needed
        for key in extra_kwargs:
            kwargs.pop(key, None)
        
        super().__init__(*args, **kwargs)
    
    def get_effective_width(self):
        """
        Calculate effective width based on size_mode.
        
        Returns:
            str: CSS width value (e.g., '50%', '800px', 'auto')
        """
        size_map = {
            'original': 'auto',
            'small': '25%',
            'medium': '50%',
            'large': '75%',
            'full': '100%',
        }
        
        if self.size_mode == 'custom':
            if self.custom_width_percent:
                return f'{self.custom_width_percent}%'
            elif self.custom_width_pixels:
                return f'{self.custom_width_pixels}px'
            return 'auto'
        
        return size_map.get(self.size_mode, '50%')
    
    def get_display_style(self):
        """
        Generate CSS style dict for displaying the image.
        
        Returns:
            dict: Style properties for rendering
        """
        style = {
            'width': self.get_effective_width(),
            'text_align': self.alignment,
            'margin_top': f'{self.margin_top}px',
            'margin_bottom': f'{self.margin_bottom}px',
            'margin_left': f'{self.margin_left}px',
            'margin_right': f'{self.margin_right}px',
        }
        
        if self.maintain_aspect_ratio:
            style['height'] = 'auto'
        elif self.custom_height_pixels:
            style['height'] = f'{self.custom_height_pixels}px'
        
        if self.show_border:
            style['border'] = f'{self.border_width}px solid {self.border_color}'
        
        return style
    
    def reorder(self, new_order, user=None):
        """
        Move image component to a new position within its section.
        Automatically adjusts order of other components.
        
        Args:
            new_order: New position (0-based index)
            user: User performing the action
        
        Returns:
            dict: Summary of reordering with affected components
        """
        from django.db import transaction
        
        old_order = self.order
        if old_order == new_order:
            return {'moved': False, 'message': 'Already at target position'}
        
        with transaction.atomic():
            # Get all sibling image components in same section
            siblings = ImageComponent.objects.filter(
                section=self.section
            ).exclude(id=self.id).order_by('order')
            
            # Move down (increasing order)
            if new_order > old_order:
                for sibling in siblings:
                    if old_order < sibling.order <= new_order:
                        sibling.order -= 1
                        sibling.save(update_fields=['order'])
            # Move up (decreasing order)
            else:
                for sibling in siblings:
                    if new_order <= sibling.order < old_order:
                        sibling.order += 1
                        sibling.save(update_fields=['order'])
            
            # Update this image component's order
            self.order = new_order
            if user:
                self.modified_by = user
            self.edit_count += 1
            self.save()
            
            return {
                'moved': True,
                'old_order': old_order,
                'new_order': new_order,
                'component_id': self.id,
                'siblings_affected': siblings.count()
            }
    
    def move_to_section(self, new_section, new_order=None, user=None):
        """
        Move image component to a different section.
        
        Args:
            new_section: Target Section
            new_order: Position in new section (None = append to end)
            user: User performing the action
        
        Returns:
            dict: Summary of move operation
        """
        from django.db import transaction
        
        old_section = self.section
        old_order = self.order
        
        if old_section.id == new_section.id:
            return self.reorder(new_order if new_order is not None else old_order, user)
        
        with transaction.atomic():
            # Remove from old section - shift siblings up
            old_siblings = ImageComponent.objects.filter(
                section=old_section
            ).exclude(id=self.id).filter(order__gt=old_order)
            
            for sibling in old_siblings:
                sibling.order -= 1
                sibling.save(update_fields=['order'])
            
            # Determine new order
            if new_order is None:
                max_order = ImageComponent.objects.filter(
                    section=new_section
                ).aggregate(models.Max('order'))['order__max']
                new_order = (max_order or -1) + 1
            else:
                new_siblings = ImageComponent.objects.filter(
                    section=new_section
                ).filter(order__gte=new_order)
                
                for sibling in new_siblings:
                    sibling.order += 1
                    sibling.save(update_fields=['order'])
            
            # Update this image component
            self.section = new_section
            self.order = new_order
            
            if user:
                self.modified_by = user
            
            self.edit_count += 1
            self.save()
            
            return {
                'moved': True,
                'old_section': str(old_section.id),
                'new_section': str(new_section.id),
                'old_order': old_order,
                'new_order': new_order
            }
    
    @classmethod
    def normalize_orders(cls, section):
        """
        Normalize order values for image components (0, 1, 2, 3...).
        
        Args:
            section: Section to normalize image components for
        """
        components = cls.objects.filter(
            section=section
        ).order_by('order')
        
        for idx, component in enumerate(components):
            if component.order != idx:
                component.order = idx
                component.save(update_fields=['order'])
        
        return components.count()


class Sentence(models.Model):
    """
    Atomic unit of meaning within a paragraph.
    Tracks sentiment, complexity, and legal significance.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paragraph = models.ForeignKey(Paragraph, on_delete=models.CASCADE, related_name='sentences')
    
    # Content span
    content_start = models.IntegerField(default=0, null=True, blank=True)
    content_end = models.IntegerField(default=0, null=True, blank=True)
    content_text = models.TextField(blank=True, default='')
    
    # Linguistic analysis
    word_count = models.IntegerField(default=0)
    readability_score = models.FloatField(null=True, blank=True, help_text="Flesch reading ease or similar")
    contains_legal_term = models.BooleanField(default=False)
    
    # Sentiment and tone
    sentiment_score = models.FloatField(null=True, blank=True, help_text="-1 (negative) to 1 (positive)")
    is_obligation = models.BooleanField(default=False, help_text="Contains 'shall', 'must', etc.")
    is_permission = models.BooleanField(default=False, help_text="Contains 'may', 'can', etc.")
    
    # Metadata
    custom_metadata = models.JSONField(default=dict, blank=True)
    
    # Ordering
    order = models.IntegerField(default=0)
    
    class Meta:
        ordering = ['paragraph', 'order']
    
    def __str__(self):
        return f"Sentence: {self.content_text[:30]}..."
    
    def save(self, *args, **kwargs):
        if not self.word_count:
            self.word_count = len(self.content_text.split())
        super().save(*args, **kwargs)


class Issue(models.Model):
    """
    AI-detected issue with localization, routing to specialist models, and full auditability.
    """
    ISSUE_TYPES = [
        ('LEGAL_RISK', 'Legal Risk'),
        ('OMISSION', 'Omission'),
        ('AMBIGUITY', 'Ambiguity'),
        ('CONFLICT', 'Conflict'),
        ('ERROR', 'Error'),
        ('FORMATTING', 'Formatting'),
        ('COMPLIANCE', 'Compliance'),
        ('INCONSISTENCY', 'Inconsistency'),
        ('UNDEFINED_TERM', 'Undefined Term'),
        ('READABILITY', 'Readability Issue'),
        ('MISSING_CLAUSE', 'Missing Standard Clause'),
        ('UNFAVORABLE_TERM', 'Unfavorable Term'),
        ('REGULATORY', 'Regulatory Concern'),
    ]
    
    SEVERITY_LEVELS = [
        ('critical', 'Critical'),
        ('high', 'High'),
        ('medium', 'Medium'),
        ('low', 'Low'),
        ('info', 'Informational'),
    ]
    
    STATUS_CHOICES = [
        ('pending', 'Pending Review'),
        ('under_review', 'Under Review'),
        ('accept', 'Accepted'),
        ('reject', 'Rejected'),
        ('ignore', 'Ignored'),
        ('resolved', 'Resolved'),
        ('needs_specialist', 'Needs Specialist Review'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='issues')
    
    # Location (can be document-wide, section-specific, or paragraph-specific)
    section = models.ForeignKey(Section, on_delete=models.CASCADE, null=True, blank=True, related_name='issues')
    paragraph = models.ForeignKey(Paragraph, on_delete=models.CASCADE, null=True, blank=True, related_name='issues')
    sentence = models.ForeignKey(Sentence, on_delete=models.CASCADE, null=True, blank=True, related_name='issues')
    
    # Issue details
    issue_type = models.CharField(max_length=50, choices=ISSUE_TYPES)
    severity = models.CharField(max_length=20, choices=SEVERITY_LEVELS)
    title = models.CharField(max_length=500)
    description = models.TextField()
    suggestion = models.TextField()
    
    # Alternative suggestions (from different specialist models)
    alternative_suggestions = models.JSONField(default=list, blank=True, 
                                              help_text="List of alternative fixes from specialist models")
    
    # Specialist model routing
    requires_specialist = models.BooleanField(default=False)
    specialist_model_type = models.CharField(max_length=100, null=True, blank=True,
                                            help_text="e.g., 'payment_clause_expert', 'termination_specialist'")
    specialist_confidence = models.FloatField(null=True, blank=True, help_text="AI confidence score (0-1)")
    specialist_response = models.TextField(null=True, blank=True)
    
    # Detection metadata
    detected_by_model = models.CharField(max_length=100, default='drafter-v1', help_text="AI model that detected this")
    detection_confidence = models.FloatField(default=0.0, help_text="Confidence score (0-1)")
    
    # Optional position in text (character offsets)
    position_start = models.IntegerField(null=True, blank=True)
    position_end = models.IntegerField(null=True, blank=True)
    highlighted_text = models.TextField(null=True, blank=True, help_text="Actual problematic text")
    
    # Status tracking and user intent
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    user_note = models.TextField(null=True, blank=True, help_text="User's reason for accept/reject/ignore")
    actioned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='actioned_issues')
    actioned_at = models.DateTimeField(null=True, blank=True)
    
    # Rewrite tracking (if suggestion was applied)
    was_applied = models.BooleanField(default=False)
    applied_at = models.DateTimeField(null=True, blank=True)
    original_text_backup = models.TextField(null=True, blank=True, help_text="Backup before applying fix")
    
    # Impact analysis
    affects_other_sections = models.BooleanField(default=False)
    related_issues = models.ManyToManyField('self', blank=True, symmetrical=True, 
                                           help_text="Other issues that might be related")
    
    # Priority and urgency
    priority = models.IntegerField(default=3, help_text="1=Highest, 5=Lowest")
    is_blocking = models.BooleanField(default=False, help_text="Blocks document finalization")
    
    # Timestamps
    detected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Custom metadata for extensibility
    custom_metadata = models.JSONField(default=dict, blank=True)
    
    class Meta:
        ordering = ['-severity', '-priority', '-detected_at']
        indexes = [
            models.Index(fields=['document', 'status']),
            models.Index(fields=['issue_type', 'severity']),
            models.Index(fields=['requires_specialist']),
        ]
    
    def __str__(self):
        return f"{self.issue_type}: {self.title}"
    
    def mark_as_applied(self, user=None):
        """Mark this issue's suggestion as applied."""
        self.was_applied = True
        self.applied_at = models.DateTimeField(auto_now_add=True)
        self.status = 'resolved'
        if user:
            self.actioned_by = user
        self.save()


class ChangeLog(models.Model):
    """
    Enhanced audit trail for all document modifications.
    Tracks changes with full context for version management and compliance.
    """
    CHANGE_TYPES = [
        ('import', 'Document Imported'),
        ('edit_section', 'Section Edited'),
        ('edit_paragraph', 'Paragraph Edited'),
        ('edit_full_document', 'Full Document Edited'),
        ('apply_suggestion', 'AI Suggestion Applied'),
        ('manual_edit', 'Manual Edit'),
        ('revert', 'Change Reverted'),
        ('analyze', 'Document Analyzed'),
        ('status_change', 'Status Changed'),
        ('version_created', 'Version Snapshot Created'),
        ('version_restored', 'Version Restored'),
        ('metadata_update', 'Metadata Updated'),
        ('attachment_added', 'Attachment Added'),
        ('attachment_removed', 'Attachment Removed'),
        ('image_updated', 'Image Updated'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='change_logs',
                                 db_index=True)
    
    # What changed
    change_type = models.CharField(max_length=50, choices=CHANGE_TYPES, db_index=True)
    target_section = models.ForeignKey(Section, on_delete=models.SET_NULL, null=True, blank=True)
    target_paragraph = models.ForeignKey(Paragraph, on_delete=models.SET_NULL, null=True, blank=True)
    related_issue = models.ForeignKey(Issue, on_delete=models.SET_NULL, null=True, blank=True)
    
    # Version tracking
    version_at_change = models.CharField(max_length=50, null=True, blank=True,
                                        help_text="Document version when change was made")
    related_version = models.ForeignKey('DocumentVersion', on_delete=models.SET_NULL, 
                                       null=True, blank=True,
                                       help_text="Associated version snapshot")
    
    # Change details
    description = models.TextField(help_text="Human-readable description of change")
    original_content = models.TextField(null=True, blank=True)
    new_content = models.TextField(null=True, blank=True)
    
    # Enhanced field-level tracking
    fields_changed = models.JSONField(default=list, blank=True,
                                     help_text="List of field names that were modified")
    changes_summary = models.JSONField(default=dict, blank=True,
                                      help_text="Detailed field-by-field changes")
    # Example: {"title": {"old": "Contract v1", "new": "Contract v2"}, ...}
    
    # User intent and reasoning
    user_note = models.TextField(null=True, blank=True, 
                                 help_text="User's reason for making this change")
    change_summary = models.CharField(max_length=500, null=True, blank=True,
                                     help_text="Brief summary of changes")
    
    # Who and when (optimized for queries)
    changed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='changes_made', db_index=True)
    changed_by_username = models.CharField(max_length=150, null=True, blank=True, db_index=True,
                                           help_text="Cached username for audit history")
    changed_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Snapshot of document version at time of change
    version_number_at_change = models.IntegerField(null=True, blank=True)
    major_version_at_change = models.IntegerField(null=True, blank=True)
    minor_version_at_change = models.IntegerField(null=True, blank=True)
    patch_version_at_change = models.IntegerField(null=True, blank=True)
    is_draft_at_change = models.BooleanField(null=True, blank=True)
    version_label_at_change = models.CharField(max_length=100, null=True, blank=True)
    
    # IP and session tracking
    ip_address = models.GenericIPAddressField(null=True, blank=True,
                                             help_text="IP address of user who made change")
    user_agent = models.CharField(max_length=500, null=True, blank=True,
                                 help_text="Browser/client user agent")
    
    # Revert capability
    is_reverted = models.BooleanField(default=False, db_index=True)
    reverted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, 
                                   related_name='reverted_changes')
    reverted_at = models.DateTimeField(null=True, blank=True)
    revert_reason = models.TextField(null=True, blank=True)
    
    # Impact assessment
    impact_level = models.CharField(max_length=20, default='minor',
                                   choices=[
                                       ('critical', 'Critical Change'),
                                       ('major', 'Major Change'),
                                       ('minor', 'Minor Change'),
                                       ('trivial', 'Trivial Change'),
                                   ],
                                   help_text="Assessed impact of the change")
    
    # Metadata
    metadata = models.JSONField(default=dict, blank=True)
    
    class Meta:
        ordering = ['-changed_at']
        indexes = [
            models.Index(fields=['document', '-changed_at']),  # Most recent first
            models.Index(fields=['change_type', '-changed_at']),  # By type
            models.Index(fields=['changed_by', '-changed_at']),  # By user
            models.Index(fields=['version_at_change']),  # By version
            models.Index(fields=['is_reverted']),  # Active changes only
            models.Index(fields=['impact_level']),  # Critical changes
        ]
        verbose_name = "Change Log Entry"
        verbose_name_plural = "Change Log Entries"
    
    def __str__(self):
        user_str = f"by {self.changed_by.username}" if self.changed_by else "by unknown"
        return f"{self.change_type} on {self.document.title} {user_str} at {self.changed_at}"
    
    @classmethod
    def log_change(cls, document, change_type, user=None, description=None,
                   old_content=None, new_content=None, fields_changed=None,
                   changes_summary=None, change_summary=None, impact='minor',
                   version=None, **kwargs):
        """
        Convenient method to create a change log entry.
        
        Example:
            ChangeLog.log_change(
                document=doc,
                change_type='edit_full_document',
                user=request.user,
                description='Updated contract terms',
                fields_changed=['title', 'contract_value'],
                changes_summary={'title': {'old': 'v1', 'new': 'v2'}},
                change_summary='Updated title and value',
                impact='major'
            )
        """
        return cls.objects.create(
            document=document,
            change_type=change_type,
            changed_by=user,
            changed_by_username=getattr(user, 'username', None) if user else None,
            description=description or f"{change_type} performed",
            original_content=old_content,
            new_content=new_content,
            fields_changed=fields_changed or [],
            changes_summary=changes_summary or {},
            change_summary=change_summary,
            version_at_change=version or document.version,
            version_number_at_change=document.version_number,
            major_version_at_change=document.major_version,
            minor_version_at_change=document.minor_version,
            patch_version_at_change=document.patch_version,
            is_draft_at_change=document.is_draft,
            version_label_at_change=document.version_label,
            impact_level=impact,
            **kwargs
        )
    
    def revert(self, user=None, reason=None):
        """Mark this change as reverted."""
        from django.utils import timezone
        self.is_reverted = True
        self.reverted_by = user
        self.reverted_at = timezone.now()
        self.revert_reason = reason
        self.save()
    
    def get_changed_fields_display(self):
        """Return comma-separated list of changed fields."""
        return ', '.join(self.fields_changed) if self.fields_changed else 'N/A'
    
    def get_user_display(self):
        """Return user display name or 'System'."""
        return self.changed_by.username if self.changed_by else 'System'


class DefinedTerm(models.Model):
    """
    Tracks defined terms in legal documents for consistency checking.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='defined_terms')
    
    # Term details
    term = models.CharField(max_length=255, help_text="The defined term (e.g., 'Services')")
    definition = models.TextField(help_text="The definition text")
    
    # Location of definition
    defined_in_section = models.ForeignKey(Section, on_delete=models.SET_NULL, null=True, blank=True)
    defined_in_paragraph = models.ForeignKey(Paragraph, on_delete=models.SET_NULL, null=True, blank=True)
    position_start = models.IntegerField(null=True, blank=True)
    position_end = models.IntegerField(null=True, blank=True)
    
    # Usage tracking
    usage_count = models.IntegerField(default=0, help_text="Number of times this term is used")
    is_capitalized = models.BooleanField(default=True)
    
    # Validation
    is_consistent = models.BooleanField(default=True, help_text="Used consistently throughout document")
    inconsistent_usages = models.JSONField(default=list, blank=True, help_text="List of inconsistent uses")
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['term']
        unique_together = ['document', 'term']
        indexes = [
            models.Index(fields=['document', 'term']),
        ]
    
    def __str__(self):
        return f"{self.term} in {self.document.title}"


class DocumentVersion(models.Model):
    """
    Snapshot versioning for complete document history.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='versions')
    
    # Version info
    version_number = models.CharField(max_length=50)
    version_name = models.CharField(max_length=255, null=True, blank=True, help_text="e.g., 'Draft 1', 'Final'")
    
    # Snapshot of content
    content_snapshot = models.TextField(help_text="Complete document text at this version")
    metadata_snapshot = models.JSONField(help_text="All metadata at this version")
    
    # Version details
    is_major_version = models.BooleanField(default=False)
    change_summary = models.TextField(help_text="Summary of changes from previous version")
    
    # Who and when
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Comparison with previous
    diff_from_previous = models.TextField(null=True, blank=True, help_text="Diff in unified format")
    
    class Meta:
        ordering = ['-created_at']
        unique_together = ['document', 'version_number']
        indexes = [
            models.Index(fields=['document', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.document.title} v{self.version_number}"


class DocumentAttachment(models.Model):
    """
    File attachments associated with documents (exhibits, schedules, supporting docs).
    """
    ATTACHMENT_TYPES = [
        ('exhibit', 'Exhibit'),
        ('schedule', 'Schedule'),
        ('appendix', 'Appendix'),
        ('addendum', 'Addendum'),
        ('supporting_doc', 'Supporting Document'),
        ('signature_page', 'Signature Page'),
        ('amendment', 'Amendment'),
        ('other', 'Other'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='file_attachments')
    
    # Attachment details
    attachment_type = models.CharField(max_length=50, choices=ATTACHMENT_TYPES)
    name = models.CharField(max_length=255, help_text="e.g., 'Exhibit A', 'Schedule 1'")
    description = models.TextField(null=True, blank=True)
    
    # File information
    file = models.FileField(upload_to='documents/attachments/%Y/%m/')
    file_name = models.CharField(max_length=255)
    file_type = models.CharField(max_length=100, help_text="MIME type or file extension")
    file_size = models.BigIntegerField(help_text="File size in bytes")
    
    # Metadata
    is_required = models.BooleanField(default=False, help_text="Required for document completion")
    reference_in_document = models.TextField(null=True, blank=True, 
                                            help_text="Where this attachment is referenced in main document")
    
    # Upload tracking
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    
    # Ordering
    order = models.IntegerField(default=0)
    
    class Meta:
        ordering = ['document', 'order', 'name']
        indexes = [
            models.Index(fields=['document', 'attachment_type']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.attachment_type})"
    
    def get_file_size_display(self):
        """Return human-readable file size."""
        size = self.file_size
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} TB"


class DocumentImage(models.Model):
    """
    Enhanced image storage for documents with user upload support.
    Supports specific image types (logo, watermark, background, etc.) for targeted retrieval.
    
    USAGE:
    - Upload images via API with specific types
    - Query images by type: DocumentImage.objects.filter(uploaded_by=user, image_type='logo')
    - Link to documents using ForeignKey references
    - Auto-generates thumbnails for previews
    """
    IMAGE_TYPES = [
        ('logo', 'Company/Organization Logo'),
        ('watermark', 'Watermark Image'),
        ('background', 'Background Image'),
        ('header_icon', 'Header Icon'),
        ('footer_icon', 'Footer Icon'),
        ('signature', 'Signature Image'),
        ('stamp', 'Stamp/Seal'),
        ('diagram', 'Diagram/Chart'),
        ('figure', 'Figure/Illustration'),
        ('chart', 'Chart/Graph'),
        ('screenshot', 'Screenshot'),
        ('photo', 'Photograph'),
        ('scanned_page', 'Scanned Page'),
        ('picture', 'General Picture'),
        ('embedded', 'Embedded Image'),
        ('other', 'Other'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Optional document link (null if user library image)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='images',
                                null=True, blank=True,
                                help_text="Link to document if attached, null for user library")
    
    # Image classification
    image_type = models.CharField(max_length=50, choices=IMAGE_TYPES, db_index=True,
                                  help_text="Type of image for specific retrieval")
    name = models.CharField(max_length=255, help_text="User-friendly name")
    caption = models.CharField(max_length=500, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    
    # File storage
    image = models.ImageField(upload_to='documents/images/%Y/%m/%d/',
                             help_text="Main image file")
    thumbnail = models.ImageField(upload_to='documents/thumbnails/%Y/%m/%d/', 
                                 null=True, blank=True,
                                 help_text="Auto-generated thumbnail")
    
    # Image metadata (auto-populated on upload)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    file_size = models.BigIntegerField(null=True, blank=True, help_text="File size in bytes")
    format = models.CharField(max_length=10, null=True, blank=True, 
                             help_text="Image format: PNG, JPG, GIF, etc.")
    mime_type = models.CharField(max_length=50, null=True, blank=True,
                                help_text="MIME type: image/png, image/jpeg, etc.")
    
    # Position/context in document (optional)
    page_number = models.IntegerField(null=True, blank=True)
    position_x = models.IntegerField(null=True, blank=True)
    position_y = models.IntegerField(null=True, blank=True)
    
    # OCR for scanned images (optional)
    extracted_text = models.TextField(null=True, blank=True, help_text="OCR extracted text")
    ocr_confidence = models.FloatField(null=True, blank=True)
    
    # User ownership and tracking
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   db_index=True, related_name='uploaded_images',
                                   help_text="User who uploaded this image")
    uploaded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # ── Scope / visibility ───────────────────────────────────────────────
    SCOPE_CHOICES = [
        ('user', 'User (private)'),
        ('team', 'Team'),
        ('organization', 'Organization'),
        ('document', 'Document-specific'),
    ]
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default='user',
                             db_index=True,
                             help_text="Visibility scope for this image")
    organization = models.ForeignKey(
        'user_management.Organization', on_delete=models.CASCADE,
        null=True, blank=True, related_name='document_images', db_index=True,
        help_text="Organization that owns this image (auto-set from uploader)",
    )
    team = models.ForeignKey(
        'user_management.Team', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='document_images', db_index=True,
        help_text="Team scope — required when scope='team'",
    )

    # Usage tracking
    is_public = models.BooleanField(default=False, 
                                   help_text="Public images can be used by all users")
    usage_count = models.IntegerField(default=0, 
                                     help_text="Number of documents using this image")
    last_used_at = models.DateTimeField(null=True, blank=True)
    
    # Tags for better organization
    tags = models.JSONField(default=list, blank=True,
                           help_text="Tags for categorization: ['corporate', 'branding', etc.]")
    
    # Additional metadata
    metadata = models.JSONField(default=dict, blank=True,
                               help_text="Additional image metadata")
    
    class Meta:
        ordering = ['-uploaded_at']
        indexes = [
            models.Index(fields=['uploaded_by', '-uploaded_at']),  # User's images
            models.Index(fields=['image_type', '-uploaded_at']),  # By type
            models.Index(fields=['uploaded_by', 'image_type']),  # User + type
            models.Index(fields=['document', 'image_type']),  # Document images
            models.Index(fields=['is_public']),  # Public images
            models.Index(fields=['scope', '-uploaded_at']),  # Scope lookup
            models.Index(fields=['organization', '-uploaded_at']),  # Org lookup
            models.Index(fields=['team', '-uploaded_at']),  # Team lookup
            models.Index(fields=['organization', 'scope']),  # Org + scope
        ]
        verbose_name = "Document Image"
        verbose_name_plural = "Document Images"
    
    def __str__(self):
        return f"{self.get_image_type_display()}: {self.name}"
    
    def save(self, *args, **kwargs):
        """Auto-populate metadata on save."""
        if self.image:
            try:
                from PIL import Image
                import os
                
                # Open image to get dimensions
                img = Image.open(self.image)
                self.width, self.height = img.size
                self.format = img.format
                
                # Get file size
                if hasattr(self.image, 'size'):
                    self.file_size = self.image.size
                elif hasattr(self.image, 'file'):
                    self.image.file.seek(0, os.SEEK_END)
                    self.file_size = self.image.file.tell()
                    self.image.file.seek(0)
                
                # Set MIME type
                format_to_mime = {
                    'PNG': 'image/png',
                    'JPEG': 'image/jpeg',
                    'JPG': 'image/jpeg',
                    'GIF': 'image/gif',
                    'WEBP': 'image/webp',
                    'SVG': 'image/svg+xml',
                }
                self.mime_type = format_to_mime.get(self.format, 'image/unknown')
                
                # Generate thumbnail if needed
                if not self.thumbnail:
                    self.generate_thumbnail()
                    
            except Exception as e:
                print(f"Error processing image metadata: {e}")
        
        super().save(*args, **kwargs)
    
    def generate_thumbnail(self, size=(200, 200)):
        """Generate thumbnail for preview."""
        try:
            from PIL import Image
            from io import BytesIO
            from django.core.files.uploadedfile import InMemoryUploadedFile
            import sys
            
            img = Image.open(self.image)
            img.thumbnail(size, Image.Resampling.LANCZOS)
            
            thumb_io = BytesIO()
            img_format = self.format or 'PNG'
            img.save(thumb_io, format=img_format, quality=85)
            thumb_io.seek(0)
            
            # Create file
            thumb_file = InMemoryUploadedFile(
                thumb_io, None, 
                f"thumb_{self.image.name.split('/')[-1]}", 
                self.mime_type,
                sys.getsizeof(thumb_io), None
            )
            
            self.thumbnail.save(
                f"thumb_{self.image.name.split('/')[-1]}", 
                thumb_file, 
                save=False
            )
            
        except Exception as e:
            print(f"Error generating thumbnail: {e}")
    
    def increment_usage(self):
        """Track when image is used in a document."""
        from django.utils import timezone
        self.usage_count += 1
        self.last_used_at = timezone.now()
        self.save(update_fields=['usage_count', 'last_used_at'])
    
    @classmethod
    def get_user_images_by_type(cls, user, image_type=None):
        """
        Get images uploaded by a specific user, optionally filtered by type.
        
        Example:
            logos = DocumentImage.get_user_images_by_type(user, 'logo')
            all_images = DocumentImage.get_user_images_by_type(user)
        """
        queryset = cls.objects.filter(uploaded_by=user)
        if image_type:
            queryset = queryset.filter(image_type=image_type)
        return queryset.order_by('-uploaded_at')
    
    @classmethod
    def get_public_images_by_type(cls, image_type=None):
        """Get public images available to all users."""
        queryset = cls.objects.filter(is_public=True)
        if image_type:
            queryset = queryset.filter(image_type=image_type)
        return queryset.order_by('-uploaded_at')
    
    @classmethod
    def visible_to_user(cls, user, image_type=None):
        """
        Return all images the user is allowed to see across all scopes:
          1. Their own uploads
          2. Team uploads for teams they belong to
          3. Organization-wide uploads in their org
          4. Public images
          5. Images attached to documents they created
        """
        from django.db.models import Q
        try:
            profile = user.profile
            org = profile.organization
            team_ids = list(profile.teams.values_list('id', flat=True))
        except Exception:
            qs = cls.objects.filter(Q(uploaded_by=user) | Q(is_public=True))
            if image_type:
                qs = qs.filter(image_type=image_type)
            return qs.distinct().order_by('-uploaded_at')

        qs = cls.objects.filter(
            Q(uploaded_by=user) |
            Q(scope='organization', organization=org) |
            Q(scope='team', team_id__in=team_ids) |
            Q(is_public=True) |
            Q(document__created_by=user)
        ).distinct()
        if image_type:
            qs = qs.filter(image_type=image_type)
        return qs.order_by('-uploaded_at')

    def get_url(self):
        """Get image URL."""
        return self.image.url if self.image else None
    
    def get_thumbnail_url(self):
        """Get thumbnail URL."""
        return self.thumbnail.url if self.thumbnail else self.get_url()
    
    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            'id': str(self.id),
            'name': self.name,
            'type': self.image_type,
            'type_display': self.get_image_type_display(),
            'caption': self.caption,
            'description': self.description,
            'url': self.get_url(),
            'thumbnail_url': self.get_thumbnail_url(),
            'width': self.width,
            'height': self.height,
            'file_size': self.file_size,
            'format': self.format,
            'mime_type': self.mime_type,
            'uploaded_by': self.uploaded_by.username if self.uploaded_by else None,
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
            'tags': self.tags,
            'usage_count': self.usage_count,
            'is_public': self.is_public,
        }


class DocumentAccessLog(models.Model):
    """
    Track document access for analytics, security, and compliance.
    Records all access attempts including successful and failed ones.
    """
    ACCESS_TYPE_CHOICES = [
        ('view', 'Viewed'),
        ('edit', 'Edited'),
        ('comment', 'Commented'),
        ('share', 'Shared'),
        ('download', 'Downloaded'),
        ('print', 'Printed'),
        ('export', 'Exported'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name='access_logs',
        help_text="Document that was accessed"
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='document_accesses',
        help_text="User who accessed (null for external/anonymous)"
    )
    
    # For external/anonymous access
    access_token = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        help_text="Token used for external access"
    )
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        help_text="IP address of accessor"
    )
    user_agent = models.TextField(
        blank=True,
        help_text="Browser/client user agent"
    )
    
    # Access details
    access_type = models.CharField(
        max_length=20,
        choices=ACCESS_TYPE_CHOICES,
        default='view',
        help_text="Type of access"
    )
    accessed_at = models.DateTimeField(
        auto_now_add=True,
        help_text="When access occurred"
    )
    
    # Context
    share_id = models.UUIDField(
        null=True,
        blank=True,
        help_text="DocumentShare ID that granted access"
    )
    session_id = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="Session identifier for tracking"
    )
    
    # Additional metadata
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional access metadata (sections viewed, duration, etc.)"
    )
    
    class Meta:
        ordering = ['-accessed_at']
        indexes = [
            models.Index(fields=['document', '-accessed_at']),
            models.Index(fields=['user', '-accessed_at']),
            models.Index(fields=['access_token']),
            models.Index(fields=['ip_address']),
        ]
    
    def __str__(self):
        user_info = self.user.username if self.user else (f"Token: {self.access_token[:8]}..." if self.access_token else "Anonymous")
        return f"{self.access_type} by {user_info} on {self.document.title}"


class DocumentFile(models.Model):
    """
    File upload system for documents (PDFs, Word docs, Excel, etc.) with access control.
    Users can upload files and embed them in legal documents alongside paragraphs, tables, and images.
    
    DESIGN PHILOSOPHY:
    - Centralized file storage with metadata tracking
    - Access control at user, team, and organization levels
    - Reusable across multiple documents and sections
    - Rich metadata for searching and filtering
    - Support for various file types (PDF, DOCX, XLSX, TXT, etc.)
    
    ACCESS CONTROL:
    - user: Private to the uploading user only
    - team: Shared with user's team members
    - organization: Available to entire organization
    
    USAGE:
    1. Upload file:
        doc_file = DocumentFile.objects.create(
            name='Contract Template',
            file=uploaded_file,
            file_type='pdf',
            access_level='team',
            uploaded_by=user
        )
    
    2. Use in document via DocumentFileComponent:
        component = DocumentFileComponent.objects.create(
            section=section,
            file_reference=doc_file,
            order=3,
            display_mode='embed'
        )
    
    3. Reuse in multiple locations:
        - Same file can be referenced in different sections/documents
        - No duplication of actual file storage
        - Consistent metadata across all usages
    """
    
    FILE_TYPE_CHOICES = [
        ('pdf', 'PDF Document'),
        ('docx', 'Word Document'),
        ('doc', 'Word Document (Legacy)'),
        ('xlsx', 'Excel Spreadsheet'),
        ('xls', 'Excel Spreadsheet (Legacy)'),
        ('pptx', 'PowerPoint Presentation'),
        ('ppt', 'PowerPoint Presentation (Legacy)'),
        ('txt', 'Text File'),
        ('csv', 'CSV File'),
        ('json', 'JSON File'),
        ('xml', 'XML File'),
        ('zip', 'ZIP Archive'),
        ('rar', 'RAR Archive'),
        ('md', 'Markdown File'),
        ('rtf', 'Rich Text Format'),
        ('odt', 'OpenDocument Text'),
        ('ods', 'OpenDocument Spreadsheet'),
        ('odp', 'OpenDocument Presentation'),
        ('other', 'Other File Type'),
    ]
    
    ACCESS_LEVEL_CHOICES = [
        ('user', 'Private (User Only)'),
        ('team', 'Team Access'),
        ('organization', 'Organization Wide'),
    ]
    
    CATEGORY_CHOICES = [
        ('reference', 'Reference Document'),
        ('template', 'Template'),
        ('contract', 'Contract'),
        ('agreement', 'Agreement'),
        ('exhibit', 'Exhibit/Attachment'),
        ('appendix', 'Appendix'),
        ('schedule', 'Schedule'),
        ('amendment', 'Amendment'),
        ('addendum', 'Addendum'),
        ('form', 'Form'),
        ('report', 'Report'),
        ('policy', 'Policy Document'),
        ('procedure', 'Procedure'),
        ('guideline', 'Guideline'),
        ('specification', 'Specification'),
        ('datasheet', 'Datasheet'),
        ('spreadsheet', 'Spreadsheet'),
        ('presentation', 'Presentation'),
        ('correspondence', 'Correspondence'),
        ('legal', 'Legal Document'),
        ('financial', 'Financial Document'),
        ('technical', 'Technical Document'),
        ('other', 'Other'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # File storage
    file = models.FileField(
        upload_to='documents/files/%Y/%m/%d/',
        help_text="Uploaded document file"
    )
    
    # Basic information
    name = models.CharField(
        max_length=255,
        help_text="User-friendly name for the file"
    )
    
    description = models.TextField(
        null=True,
        blank=True,
        help_text="Description of the file contents and purpose"
    )
    
    file_type = models.CharField(
        max_length=50,
        choices=FILE_TYPE_CHOICES,
        db_index=True,
        help_text="Type of file"
    )
    
    category = models.CharField(
        max_length=50,
        choices=CATEGORY_CHOICES,
        default='other',
        db_index=True,
        help_text="Category for organization"
    )
    
    # File metadata (auto-populated)
    original_filename = models.CharField(
        max_length=255,
        help_text="Original filename when uploaded"
    )
    
    file_size = models.BigIntegerField(
        null=True,
        blank=True,
        help_text="File size in bytes"
    )
    
    mime_type = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="MIME type of the file"
    )
    
    file_hash = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        db_index=True,
        help_text="SHA-256 hash for duplicate detection"
    )
    
    # Access control
    access_level = models.CharField(
        max_length=20,
        choices=ACCESS_LEVEL_CHOICES,
        default='user',
        db_index=True,
        help_text="Who can access this file"
    )
    
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_index=True,
        related_name='uploaded_files',
        help_text="User who uploaded this file"
    )
    
    # Organization and team references for scoped access
    organization = models.ForeignKey(
        'user_management.Organization', on_delete=models.CASCADE,
        null=True, blank=True, related_name='document_files', db_index=True,
        help_text="Organization that owns this file (auto-set from uploader)",
    )
    team = models.ForeignKey(
        'user_management.Team', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='document_files', db_index=True,
        help_text="Team scope — required when access_level='team'",
    )
    
    # Timestamps
    uploaded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Usage tracking
    download_count = models.IntegerField(
        default=0,
        help_text="Number of times file has been downloaded"
    )
    
    usage_count = models.IntegerField(
        default=0,
        help_text="Number of documents using this file"
    )
    
    last_used_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last time file was referenced in a document"
    )
    
    last_downloaded_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last download timestamp"
    )
    
    # Version tracking
    version = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        help_text="Version of the document (e.g., 'v1.0', 'Draft 2')"
    )
    
    is_latest_version = models.BooleanField(
        default=True,
        help_text="Is this the latest version"
    )
    
    previous_version = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='next_versions',
        help_text="Link to previous version of this file"
    )
    
    # Tags and categorization
    tags = models.JSONField(
        default=list,
        blank=True,
        help_text="Tags for categorization: ['legal', 'confidential', etc.]"
    )
    
    # Extended metadata
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="""
        Extended metadata:
        {
            'author': 'John Doe',
            'created_date': '2026-01-12',
            'page_count': 15,
            'language': 'en',
            'keywords': ['contract', 'NDA'],
            'security': {'encrypted': false, 'confidential': true},
            'related_documents': ['doc-uuid-1', 'doc-uuid-2'],
            'custom': {...}
        }
        """
    )
    
    # Status and flags
    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Active files can be used in documents"
    )
    
    is_confidential = models.BooleanField(
        default=False,
        help_text="Mark as confidential"
    )
    
    requires_signature = models.BooleanField(
        default=False,
        help_text="Indicates if document requires signatures"
    )
    
    is_template = models.BooleanField(
        default=False,
        help_text="Mark as template for reuse"
    )
    
    # Expiration
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="File expiration date (optional)"
    )
    
    class Meta:
        ordering = ['-uploaded_at']
        indexes = [
            models.Index(fields=['uploaded_by', '-uploaded_at']),
            models.Index(fields=['file_type', '-uploaded_at']),
            models.Index(fields=['category', '-uploaded_at']),
            models.Index(fields=['access_level', '-uploaded_at']),
            models.Index(fields=['uploaded_by', 'file_type']),
            models.Index(fields=['uploaded_by', 'category']),
            models.Index(fields=['uploaded_by', 'access_level']),
            models.Index(fields=['is_active', '-uploaded_at']),
            models.Index(fields=['file_hash']),
            models.Index(fields=['organization', '-uploaded_at']),
            models.Index(fields=['team', '-uploaded_at']),
            models.Index(fields=['organization', 'access_level']),
        ]
        verbose_name = "Document File"
        verbose_name_plural = "Document Files"
    
    def __str__(self):
        return f"{self.name} ({self.get_file_type_display()})"
    
    def save(self, *args, **kwargs):
        """Auto-populate metadata on save."""
        if self.file:
            import os
            import hashlib
            import mimetypes
            
            try:
                # Set original filename if not set
                if not self.original_filename:
                    self.original_filename = os.path.basename(self.file.name)
                
                # Auto-generate name from filename if not set
                if not self.name:
                    self.name = os.path.splitext(self.original_filename)[0] or "Untitled Document"
                
                # Auto-detect file_type if not set
                if not self.file_type:
                    ext = os.path.splitext(self.original_filename)[1].lower().lstrip('.')
                    ext_map = {
                        'pdf': 'pdf', 'docx': 'docx', 'doc': 'doc',
                        'xlsx': 'xlsx', 'xls': 'xls', 'pptx': 'pptx', 'ppt': 'ppt',
                        'txt': 'txt', 'csv': 'csv', 'json': 'json', 'xml': 'xml',
                        'zip': 'zip', 'rar': 'rar', 'md': 'md', 'rtf': 'rtf',
                        'odt': 'odt', 'ods': 'ods', 'odp': 'odp'
                    }
                    self.file_type = ext_map.get(ext, 'other')
                
                # Get file size
                if hasattr(self.file, 'size'):
                    self.file_size = self.file.size
                elif hasattr(self.file, 'file'):
                    self.file.file.seek(0, os.SEEK_END)
                    self.file_size = self.file.file.tell()
                    self.file.file.seek(0)
                
                # Determine MIME type
                if not self.mime_type:
                    mime_type, _ = mimetypes.guess_type(self.original_filename)
                    self.mime_type = mime_type or 'application/octet-stream'
                
                # Calculate file hash
                if not self.file_hash:
                    self.file.file.seek(0)
                    file_content = self.file.file.read()
                    self.file_hash = hashlib.sha256(file_content).hexdigest()
                    self.file.file.seek(0)
                
            except Exception as e:
                print(f"Error processing file metadata: {e}")
        
        super().save(*args, **kwargs)
    
    def increment_download_count(self):
        """Track file downloads."""
        from django.utils import timezone
        self.download_count += 1
        self.last_downloaded_at = timezone.now()
        self.save(update_fields=['download_count', 'last_downloaded_at'])
    
    def increment_usage_count(self):
        """Track file usage in documents."""
        from django.utils import timezone
        self.usage_count += 1
        self.last_used_at = timezone.now()
        self.save(update_fields=['usage_count', 'last_used_at'])
    
    def get_file_extension(self):
        """Get file extension."""
        import os
        return os.path.splitext(self.original_filename)[1].lower()
    
    def get_file_size_display(self):
        """Get human-readable file size."""
        if not self.file_size:
            return "Unknown"
        
        size = self.file_size
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} PB"
    
    def can_access(self, user):
        """Check if user can access this file."""
        if not user or not user.is_authenticated:
            return False
        
        # Owner always has access
        if self.uploaded_by == user:
            return True
        
        # Check access level
        if self.access_level == 'user':
            return False
        elif self.access_level == 'team':
            if self.team:
                return user.profile.teams.filter(id=self.team_id).exists()
            return False
        elif self.access_level == 'organization':
            if self.organization:
                try:
                    return user.profile.organization_id == self.organization_id
                except Exception:
                    return False
            return False
        
        return False

    @classmethod
    def visible_to_user(cls, user, file_type=None):
        """
        Return all files the user is allowed to see across all access levels:
          1. Their own uploads
          2. Team uploads for teams they belong to
          3. Organization-wide uploads in their org
        """
        from django.db.models import Q
        try:
            profile = user.profile
            org = profile.organization
            team_ids = list(profile.teams.values_list('id', flat=True))
        except Exception:
            qs = cls.objects.filter(uploaded_by=user, is_active=True)
            if file_type:
                qs = qs.filter(file_type=file_type)
            return qs.order_by('-uploaded_at')

        qs = cls.objects.filter(
            Q(uploaded_by=user) |
            Q(access_level='organization', organization=org) |
            Q(access_level='team', team_id__in=team_ids)
        ).filter(is_active=True).distinct()
        if file_type:
            qs = qs.filter(file_type=file_type)
        return qs.order_by('-uploaded_at')


class DocumentFileComponent(models.Model):
    """
    A document file component within a section, positioned alongside paragraphs, tables, and images.
    References uploaded files from DocumentFile library, enabling reuse across documents.
    
    DESIGN PHILOSOPHY:
    - Files are uploaded separately to DocumentFile library
    - DocumentFileComponent references the file and positions it in the document
    - Multiple components can reference the same file (no duplication)
    - Unified ordering system with other section components
    - Flexible display modes (embed, link, download, reference)
    
    USAGE:
    1. Upload file to library (done separately via DocumentFile)
    
    2. Place file in document:
        file_component = DocumentFileComponent.objects.create(
            section=section,
            file_reference=uploaded_file,
            order=2,
            display_mode='embed',
            label='Exhibit A: Contract Template'
        )
    
    3. Reuse same file in another location:
        file_component2 = DocumentFileComponent.objects.create(
            section=another_section,
            file_reference=uploaded_file,  # Same file
            order=0,
            display_mode='link'
        )
    
    DISPLAY MODES:
    - embed: Embed file viewer (PDF, images)
    - link: Display as clickable link
    - download: Show download button
    - reference: Show as reference with metadata
    - icon: Display as icon with label
    """
    
    DISPLAY_MODE_CHOICES = [
        ('embed', 'Embed Viewer'),
        ('link', 'Clickable Link'),
        ('download', 'Download Button'),
        ('reference', 'Reference Only'),
        ('icon', 'Icon with Label'),
    ]
    
    ALIGNMENT_CHOICES = [
        ('left', 'Align Left'),
        ('center', 'Align Center'),
        ('right', 'Align Right'),
    ]
    
    id = models.CharField(
        max_length=100,
        primary_key=True,
        help_text="Composite ID: section_id + '_file' + timestamp + '_' + order"
    )
    
    section = models.ForeignKey(
        Section,
        on_delete=models.CASCADE,
        related_name='file_components',
        help_text="Section containing this file component"
    )
    
    # File reference - links to uploaded file library
    file_reference = models.ForeignKey(
        DocumentFile,
        on_delete=models.CASCADE,
        related_name='component_usages',
        help_text="Reference to uploaded file in library"
    )
    
    # Display properties
    label = models.CharField(
        max_length=500,
        null=True,
        blank=True,
        help_text="Display label (e.g., 'Exhibit A', 'Appendix 1')"
    )
    
    description = models.TextField(
        null=True,
        blank=True,
        help_text="Description of the file in context"
    )
    
    reference_number = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="Reference number (e.g., 'Exhibit A', 'Schedule 1')"
    )
    
    display_mode = models.CharField(
        max_length=20,
        choices=DISPLAY_MODE_CHOICES,
        default='link',
        help_text="How to display the file"
    )
    
    alignment = models.CharField(
        max_length=20,
        choices=ALIGNMENT_CHOICES,
        default='left',
        help_text="Alignment in document"
    )
    
    # Sizing (for embed mode)
    width_percent = models.FloatField(
        null=True,
        blank=True,
        help_text="Width as percentage (0-100) for embed mode"
    )
    
    height_pixels = models.IntegerField(
        null=True,
        blank=True,
        help_text="Height in pixels for embed mode"
    )
    
    # Spacing
    margin_top = models.IntegerField(
        default=20,
        help_text="Top margin in pixels"
    )
    
    margin_bottom = models.IntegerField(
        default=20,
        help_text="Bottom margin in pixels"
    )
    
    # Display options
    show_filename = models.BooleanField(
        default=True,
        help_text="Display filename"
    )

    # PDF page range selection (for PDF files)
    page_range = models.CharField(
        max_length=200,
        null=True,
        blank=True,
        help_text="Optional page range for PDFs (e.g., '1-3,5,7-9')"
    )
    
    show_file_size = models.BooleanField(
        default=True,
        help_text="Display file size"
    )
    
    show_file_type = models.BooleanField(
        default=True,
        help_text="Display file type icon/label"
    )
    
    show_download_button = models.BooleanField(
        default=True,
        help_text="Show download button"
    )
    
    show_preview = models.BooleanField(
        default=True,
        help_text="Show preview if available"
    )
    
    # Link behavior
    open_in_new_tab = models.BooleanField(
        default=True,
        help_text="Open file in new tab when clicked"
    )
    
    # Visibility
    is_visible = models.BooleanField(
        default=True,
        help_text="Show/hide without deleting"
    )
    
    # Change tracking
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_file_components'
    )
    
    last_modified = models.DateTimeField(auto_now=True)
    modified_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='modified_file_components'
    )
    
    edit_count = models.IntegerField(
        default=0,
        help_text="Number of times edited"
    )
    
    # Metadata
    custom_metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Additional custom properties"
    )
    
    # Ordering - positions file among other section components
    order = models.IntegerField(
        default=0,
        help_text="Position in section (0-based, unified with paragraphs, tables, images)"
    )
    
    class Meta:
        ordering = ['section', 'order']
        indexes = [
            models.Index(fields=['section', 'order']),
            models.Index(fields=['file_reference']),
            models.Index(fields=['created_by']),
            models.Index(fields=['-created_at']),
        ]
        verbose_name = "Document File Component"
        verbose_name_plural = "Document File Components"
    
    def __str__(self):
        label = self.label or self.file_reference.name
        return f"{label} in {self.section.title}"
    
    def save(self, *args, **kwargs):
        """Generate ID if not set, auto-generate label, and track usage."""
        # Auto-generate label from filename if not set
        if not self.label and self.file_reference:
            self.label = self.file_reference.name
        
        if not self.id:
            import time
            timestamp = int(time.time())
            self.id = f"{self.section.id}_file{timestamp}_{self.order}"
        
        # Increment usage count on first save
        if not self.pk:
            self.file_reference.increment_usage_count()
        
        super().save(*args, **kwargs)
    
    def get_display_style(self):
        """Get CSS/style properties for rendering."""
        style = {
            'text_align': self.alignment,
            'margin_top': f'{self.margin_top}px',
            'margin_bottom': f'{self.margin_bottom}px',
        }
        
        if self.display_mode == 'embed' and self.width_percent:
            style['width'] = f'{self.width_percent}%'
        
        if self.display_mode == 'embed' and self.height_pixels:
            style['height'] = f'{self.height_pixels}px'
        
        return style


# ============================================================================
# WORKFLOW & TASK ASSIGNMENT SYSTEM
# ============================================================================

class DocumentWorkflow(models.Model):
    """
    Manages document workflow and task assignments.
    Replaces the workflow metadata with a proper relational model.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='workflows')
    
    # Workflow Status
    WORKFLOW_STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('review', 'Under Review'),
        ('approved', 'Approved'),
        ('revision_required', 'Revision Required'),
        ('executed', 'Executed'),
        ('archived', 'Archived'),
        ('cancelled', 'Cancelled'),
    ]
    current_status = models.CharField(max_length=30, choices=WORKFLOW_STATUS_CHOICES, default='draft', db_index=True)
    
    # Assignment
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, 
                                   related_name='assigned_workflows',
                                   help_text="Current user responsible for this workflow")
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='workflows_assigned',
                                   help_text="User who made the assignment")
    
    # Priority & Deadlines
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='medium')
    due_date = models.DateTimeField(null=True, blank=True, db_index=True)
    
    # Organization/Team context
    organization = models.CharField(max_length=255, null=True, blank=True, db_index=True,
                                   help_text="Organization name for filtering")
    team = models.CharField(max_length=255, null=True, blank=True, db_index=True,
                           help_text="Team name for filtering")
    
    # Messages & Notes
    message = models.TextField(blank=True, help_text="Message/instructions for the assignee")
    notes = models.TextField(blank=True, help_text="Additional notes about the workflow")
    
    # Version Control
    version = models.CharField(max_length=50, blank=True, help_text="Document version (e.g., '1.0', '2.3')")
    
    # Tracking
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    # Flags
    is_active = models.BooleanField(default=True, db_index=True)
    is_completed = models.BooleanField(default=False, db_index=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['document', 'is_active']),
            models.Index(fields=['assigned_to', 'is_active']),
            models.Index(fields=['current_status', 'is_active']),
            models.Index(fields=['due_date', 'is_active']),
            models.Index(fields=['organization', 'team']),
        ]
    
    def __str__(self):
        return f"Workflow {self.current_status} - {self.document.title} (assigned to {self.assigned_to})"

    def save(self, *args, **kwargs):
        """
        Override save to ensure that when a workflow is assigned (or reassigned)
        to a user, the document is automatically shared with that user.
        Uses the main sharing.Share model (not legacy DocumentShare).
        This uses get_or_create so existing shares are preserved.
        """
        try:
            old_assigned = None
            if self.pk:
                old = DocumentWorkflow.objects.filter(pk=self.pk).first()
                if old:
                    old_assigned = old.assigned_to
        except Exception:
            old_assigned = None

        # First save the workflow (so document and assigned_to are available)
        super().save(*args, **kwargs)

        # If assignment changed (or newly assigned), create a share for the assignee
        try:
            if self.assigned_to and self.assigned_to != old_assigned:
                # Use the main sharing.Share model instead of legacy DocumentShare
                from sharing.models import Share
                from django.contrib.contenttypes.models import ContentType
                
                content_type = ContentType.objects.get_for_model(Document)
                
                # Create a user-level share for the assignee if not already present
                Share.objects.get_or_create(
                    content_type=content_type,
                    object_id=str(self.document.id),
                    shared_with_user=self.assigned_to,
                    defaults={
                        'shared_by': self.assigned_by,
                        'role': 'editor',
                        'share_type': 'user',
                        'is_active': True,
                    }
                )
        except Exception:
            # Defensive: do not raise from save if share creation fails
            pass
    
    def mark_completed(self):
        """Mark workflow as completed."""
        self.is_completed = True
        self.is_active = False
        self.completed_at = timezone.now()
        self.save(update_fields=['is_completed', 'is_active', 'completed_at', 'updated_at'])
    
    def reassign(self, new_assignee, assigned_by, message=''):
        """Reassign workflow to a different user."""
        self.assigned_to = new_assignee
        self.assigned_by = assigned_by
        if message:
            self.message = message
        self.save(update_fields=['assigned_to', 'assigned_by', 'message', 'updated_at'])


class WorkflowApproval(models.Model):
    """
    Tracks approval chain for document workflows.
    Each workflow can have multiple approvers in sequence or parallel.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(DocumentWorkflow, on_delete=models.CASCADE, related_name='approvals')
    
    # Approver Information
    approver = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workflow_approvals')
    role = models.CharField(max_length=100, blank=True, help_text="Approver's role (e.g., 'Legal Counsel', 'Manager')")
    order = models.PositiveIntegerField(default=1, help_text="Order in approval chain (1 = first approver)")
    
    # Approval Status
    APPROVAL_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('skipped', 'Skipped'),
    ]
    status = models.CharField(max_length=20, choices=APPROVAL_STATUS_CHOICES, default='pending', db_index=True)
    
    # Approval Details
    approved_at = models.DateTimeField(null=True, blank=True)
    comments = models.TextField(blank=True, help_text="Approver's comments or feedback")
    
    # Conditional Approval
    is_required = models.BooleanField(default=True, help_text="Whether this approval is mandatory")
    
    # Tracking
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['workflow', 'order']
        unique_together = [['workflow', 'approver']]
        indexes = [
            models.Index(fields=['workflow', 'status']),
            models.Index(fields=['approver', 'status']),
        ]
    
    def __str__(self):
        return f"{self.approver} - {self.status} ({self.workflow.document.title})"
    
    def approve(self, comments=''):
        """Mark this approval as approved."""
        self.status = 'approved'
        self.approved_at = timezone.now()
        if comments:
            self.comments = comments
        self.save(update_fields=['status', 'approved_at', 'comments', 'updated_at'])
    
    def reject(self, comments=''):
        """Mark this approval as rejected."""
        self.status = 'rejected'
        self.approved_at = timezone.now()
        if comments:
            self.comments = comments
        self.save(update_fields=['status', 'approved_at', 'comments', 'updated_at'])


class WorkflowComment(models.Model):
    """
    Comments and discussions on workflow tasks.
    Allows team collaboration on assigned work.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(DocumentWorkflow, on_delete=models.CASCADE, related_name='comments')
    
    # Comment Details
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workflow_comments')
    comment = models.TextField()
    
    # Comment Type
    COMMENT_TYPE_CHOICES = [
        ('general', 'General Comment'),
        ('question', 'Question'),
        ('clarification', 'Clarification Needed'),
        ('update', 'Status Update'),
        ('issue', 'Issue/Problem'),
    ]
    comment_type = models.CharField(max_length=20, choices=COMMENT_TYPE_CHOICES, default='general')
    
    # Mention System
    mentions = models.ManyToManyField(User, related_name='workflow_mentions', blank=True,
                                     help_text="Users mentioned in this comment")
    
    # Tracking
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Flags
    is_resolved = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'created_at']),
            models.Index(fields=['user', 'created_at']),
        ]
    
    def __str__(self):
        return f"Comment by {self.user} on {self.workflow.document.title}"


class WorkflowNotification(models.Model):
    """
    Notifications for workflow assignments and updates.
    Users can check if any work is assigned to them.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(DocumentWorkflow, on_delete=models.CASCADE, related_name='notifications')
    
    # Recipient
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workflow_notifications', db_index=True)
    
    # Notification Type
    NOTIFICATION_TYPE_CHOICES = [
        ('assignment', 'New Assignment'),
        ('reassignment', 'Reassignment'),
        ('approval_request', 'Approval Request'),
        ('approval_approved', 'Approval Approved'),
        ('approval_rejected', 'Approval Rejected'),
        ('comment', 'New Comment'),
        ('mention', 'You Were Mentioned'),
        ('due_date_reminder', 'Due Date Reminder'),
        ('status_change', 'Status Changed'),
    ]
    notification_type = models.CharField(max_length=30, choices=NOTIFICATION_TYPE_CHOICES, db_index=True)
    
    # Notification Content
    title = models.CharField(max_length=255)
    message = models.TextField()
    
    # Link to specific approval or comment (optional)
    approval = models.ForeignKey(WorkflowApproval, on_delete=models.SET_NULL, null=True, blank=True)
    comment = models.ForeignKey(WorkflowComment, on_delete=models.SET_NULL, null=True, blank=True)
    
    # Tracking
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    
    # Status
    is_read = models.BooleanField(default=False, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', 'created_at']),
            models.Index(fields=['workflow', 'recipient']),
        ]
    
    def __str__(self):
        return f"{self.notification_type} for {self.recipient} - {self.title}"
    
    def mark_as_read(self):
        """Mark notification as read."""
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=['is_read', 'read_at'])


class WorkflowDecisionStep(models.Model):
    """
    A yes/no decision gate within a document workflow.

    Each step targets a specific audience (team, internal user, or external
    email) and waits for a decision.  When the decision is made the outcome
    drives the workflow forward:
      • approved  → move to the next step (or mark workflow approved)
      • rejected  → optionally route to a fallback step or set workflow
                     to revision_required

    Targeting:
      target_type  |  target_user  | target_team | target_email
      ─────────────┼───────────────┼─────────────┼──────────────
      user         |  FK set       |   –         |  –
      team         |   –           |  FK set     |  –
      email        |   –           |   –         |  email set

    When target_type='email', the system auto-creates a ViewerToken with
    the commentator role so the external person can review + decide.
    """

    TARGET_TYPE_CHOICES = [
        ('user', 'Internal User'),
        ('team', 'Team'),
        ('email', 'External Email'),
    ]

    DECISION_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        DocumentWorkflow, on_delete=models.CASCADE, related_name='decision_steps',
    )

    # ── Ordering ─────────────────────────────────────────────────
    order = models.PositiveIntegerField(
        default=1,
        help_text="1-based step order. Steps run sequentially.",
    )

    # ── Target audience ──────────────────────────────────────────
    target_type = models.CharField(max_length=10, choices=TARGET_TYPE_CHOICES)
    target_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='workflow_decision_steps',
    )
    target_team = models.ForeignKey(
        'user_management.Team', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='workflow_decision_steps',
    )
    target_email = models.EmailField(
        blank=True, default='',
        help_text="For external email targets — auto-provisions ViewerToken",
    )

    # ── Prompt / instruction shown to the reviewer ───────────────
    title = models.CharField(
        max_length=255, blank=True, default='',
        help_text="Short title, e.g. 'Legal Review'",
    )
    description = models.TextField(
        blank=True, default='',
        help_text="Instructions or context for the reviewer",
    )

    # ── Decision state ───────────────────────────────────────────
    decision_status = models.CharField(
        max_length=20, choices=DECISION_STATUS_CHOICES, default='pending', db_index=True,
    )
    decided_by_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='workflow_decisions_made',
    )
    decided_by_email = models.EmailField(blank=True, default='')
    decision_comment = models.TextField(blank=True, default='')
    decided_at = models.DateTimeField(null=True, blank=True)

    # ── Branching ────────────────────────────────────────────────
    on_reject_action = models.CharField(
        max_length=30, default='revision_required',
        help_text="What happens on reject: 'revision_required', 'stop', 'goto:<order>'",
    )

    # ── Auto-created viewer token (for email targets) ────────────
    viewer_token = models.ForeignKey(
        'viewer.ViewerToken', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='decision_steps',
    )

    # ── Timestamps ───────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['workflow', 'order']
        unique_together = [['workflow', 'order']]
        indexes = [
            models.Index(fields=['workflow', 'decision_status']),
            models.Index(fields=['target_user', 'decision_status']),
            models.Index(fields=['target_email', 'decision_status']),
        ]

    def __str__(self):
        target = self.target_email or (
            self.target_user.username if self.target_user else
            (self.target_team.name if self.target_team else '?')
        )
        return f"Step {self.order}: {self.title or 'Decision'} → {target} ({self.decision_status})"

    # ── Convenience helpers ──────────────────────────────────────

    def approve(self, user=None, email='', comment=''):
        """Record an approve decision and advance the workflow."""
        self.decision_status = 'approved'
        self.decided_by_user = user
        self.decided_by_email = email or (user.email if user else '')
        self.decision_comment = comment
        self.decided_at = timezone.now()
        self.save(update_fields=[
            'decision_status', 'decided_by_user', 'decided_by_email',
            'decision_comment', 'decided_at', 'updated_at',
        ])
        self._advance_workflow()

    def reject(self, user=None, email='', comment=''):
        """Record a reject decision and handle the branch."""
        self.decision_status = 'rejected'
        self.decided_by_user = user
        self.decided_by_email = email or (user.email if user else '')
        self.decision_comment = comment
        self.decided_at = timezone.now()
        self.save(update_fields=[
            'decision_status', 'decided_by_user', 'decided_by_email',
            'decision_comment', 'decided_at', 'updated_at',
        ])
        self._handle_rejection()

    def _advance_workflow(self):
        """Move workflow to the next pending step or mark approved."""
        next_step = (
            WorkflowDecisionStep.objects
            .filter(workflow=self.workflow, decision_status='pending', order__gt=self.order)
            .order_by('order')
            .first()
        )
        if next_step is None:
            # All steps done — mark workflow approved
            self.workflow.current_status = 'approved'
            self.workflow.save(update_fields=['current_status', 'updated_at'])
        else:
            self.workflow.current_status = 'review'
            self.workflow.save(update_fields=['current_status', 'updated_at'])

    def _handle_rejection(self):
        """Route the workflow based on on_reject_action."""
        action = self.on_reject_action
        if action == 'stop':
            self.workflow.current_status = 'cancelled'
            self.workflow.is_active = False
            self.workflow.save(update_fields=['current_status', 'is_active', 'updated_at'])
        elif action.startswith('goto:'):
            # Jump to a specific step order
            try:
                target_order = int(action.split(':')[1])
                WorkflowDecisionStep.objects.filter(
                    workflow=self.workflow, order=target_order,
                ).update(decision_status='pending')
            except (ValueError, IndexError):
                pass
            self.workflow.current_status = 'review'
            self.workflow.save(update_fields=['current_status', 'updated_at'])
        else:
            # Default: revision_required
            self.workflow.current_status = 'revision_required'
            self.workflow.save(update_fields=['current_status', 'updated_at'])


class DocumentScore(models.Model):
    """Stores scoring / evaluation outputs for a Document.

    The model stores both parsed structured scoring fields (for quick queries)
    and the full LLM payload so we can audit or re-surface the original model
    output on demand.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='scores')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='created_document_scores')

    # Top-level / quick fields
    final_aggregated_score = models.FloatField(default=0.0)
    overall_risk_category = models.CharField(max_length=50, null=True, blank=True)
    human_review_required = models.BooleanField(default=False)
    review_trigger_reason = models.TextField(null=True, blank=True)
    review_priority = models.CharField(max_length=10, null=True, blank=True)

    # Core dimensions and other structured sections stored as JSON for flexibility
    core_score_dimensions = models.JSONField(default=dict, blank=True)
    operational_commercial_intelligence = models.JSONField(default=dict, blank=True)
    clause_level_review = models.JSONField(default=list, blank=True)
    ai_governance_trust_metrics = models.JSONField(default=dict, blank=True)

    # Optional rationale / evidence per score
    score_rationale = models.JSONField(default=dict, blank=True)

    # Raw LLM output (parsed JSON if possible) and raw text for audit
    raw_llm_output = models.JSONField(null=True, blank=True)
    raw_llm_text = models.TextField(null=True, blank=True)

    model_name = models.CharField(max_length=200, null=True, blank=True)
    analysis_timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    # Optional tag to indicate automated vs. manual scoring
    automated = models.BooleanField(default=True)

    class Meta:
        ordering = ['-analysis_timestamp']
        indexes = [
            models.Index(fields=['document', '-analysis_timestamp']),
            models.Index(fields=['overall_risk_category']),
        ]

    def __str__(self):
        return f"Score for {self.document.id} @ {self.analysis_timestamp.isoformat()} ({self.final_aggregated_score})"

    def as_summary(self):
        return {
            'id': str(self.id),
            'document': str(self.document.id),
            'final_aggregated_score': self.final_aggregated_score,
            'overall_risk_category': self.overall_risk_category,
            'human_review_required': self.human_review_required,
            'review_priority': self.review_priority,
            'analysis_timestamp': self.analysis_timestamp.isoformat(),
        }


class ParagraphAIResult(models.Model):
    """Persisted AI review output for a paragraph, versioned by document version."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='paragraph_ai_results')
    paragraph = models.ForeignKey(Paragraph, on_delete=models.CASCADE, related_name='ai_results')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='created_paragraph_ai_results')

    document_version_number = models.IntegerField(default=1, db_index=True)
    document_version = models.CharField(max_length=50, null=True, blank=True)
    document_version_label = models.CharField(max_length=100, null=True, blank=True)
    paragraph_edit_count = models.IntegerField(default=0)
    paragraph_last_modified = models.DateTimeField(null=True, blank=True)

    paragraph_type_detected = models.CharField(max_length=50, null=True, blank=True)
    grammar_status = models.CharField(max_length=50, null=True, blank=True)
    already_correct = models.BooleanField(default=False)

    processed_text = models.TextField(null=True, blank=True)
    rendered_text = models.TextField(null=True, blank=True)
    metadata_detected = models.JSONField(default=dict, blank=True)
    placeholders_detected = models.JSONField(default=list, blank=True)
    scores = models.JSONField(default=dict, blank=True)
    suggestions = models.JSONField(default=list, blank=True)

    raw_llm_output = models.JSONField(null=True, blank=True)
    raw_llm_text = models.TextField(null=True, blank=True)
    model_name = models.CharField(max_length=200, null=True, blank=True)

    analysis_timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    is_latest_for_version = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['-analysis_timestamp']
        indexes = [
            models.Index(fields=['document', 'paragraph', 'document_version_number']),
            models.Index(fields=['paragraph', 'document_version_number', 'is_latest_for_version']),
        ]

    def save(self, *args, **kwargs):
        if self.is_latest_for_version:
            ParagraphAIResult.objects.filter(
                paragraph=self.paragraph,
                document_version_number=self.document_version_number,
                is_latest_for_version=True,
            ).exclude(id=self.id).update(is_latest_for_version=False)
        super().save(*args, **kwargs)

    def __str__(self):
        paragraph_id = getattr(self.paragraph, 'id', None)
        return f"AI result for {paragraph_id} (v{self.document_version_number})"


class HeaderFooterPDF(models.Model):
    """
    Stores a cropped header or footer PDF region that can be applied to documents.

    Workflow
    --------
    1. User uploads a full-page PDF (letterhead / template).
    2. The system renders a preview of the chosen page.
    3. User visually selects the header and/or footer region by specifying
       the crop coordinates (top offset + height for header, bottom offset +
       height for footer) — OR lets auto-detection provide a starting point.
    4. The server crops the selected region from the source PDF and saves it
       as a standalone single-page PDF (``cropped_file``).
    5. The ``HeaderFooterPDF`` record is then referenced by the document's
       ``processing_settings.header_pdf.file_id`` or ``.footer_pdf.file_id``.
    6. At PDF render time, the cropped region is overlaid onto each page as
       a background layer (pypdf merge), preserving text selectability.

    Why manual selection is better than pure auto-detection
    -------------------------------------------------------
    • Auto-detection is heuristic — it can mistake body text for header content
      when the gap between header and body is small, or fail on coloured/gradient
      letterheads.
    • Manual selection gives pixel-perfect control.
    • Auto-detection is still available as a "quick-start suggestion" that pre-
      fills the crop coordinates, but the user can adjust them before saving.
    """

    REGION_CHOICES = [
        ('header', 'Header Region'),
        ('footer', 'Footer Region'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # What kind of region this is
    region_type = models.CharField(
        max_length=10,
        choices=REGION_CHOICES,
        db_index=True,
        help_text="Whether this is a header or footer region",
    )

    # Human-readable label (e.g. "Corporate Letterhead Header")
    name = models.CharField(
        max_length=255,
        help_text="User-friendly name for this header/footer",
    )

    description = models.TextField(
        null=True,
        blank=True,
        help_text="Optional notes about this header/footer",
    )

    # ── Source PDF (the full-page letterhead the user uploaded) ──
    source_file = models.ForeignKey(
        DocumentFile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='header_footer_crops',
        help_text="The original full-page PDF this region was cropped from",
    )

    source_page = models.PositiveIntegerField(
        default=1,
        help_text="1-based page number in the source PDF used for cropping",
    )

    # ── Cropped region file (the actual PDF applied at render time) ──
    cropped_file = models.FileField(
        upload_to='documents/header_footer_pdfs/%Y/%m/%d/',
        help_text="The cropped single-page PDF containing just the header/footer region",
    )

    # ── Crop coordinates (in points, 1pt = 1/72 inch) ──
    # These describe the rectangle within the source page.
    crop_top_offset = models.FloatField(
        default=0.0,
        help_text="Distance in points from the TOP of the source page to the top of the crop rectangle",
    )

    crop_height = models.FloatField(
        default=0.0,
        help_text="Height of the crop rectangle in points",
    )

    # ── Resolved region height (used for margin calculation at render time) ──
    region_height = models.FloatField(
        default=0.0,
        help_text="Final region height in points (may differ from crop_height after scaling)",
    )

    # ── Source page dimensions (for UI coordinate mapping) ──
    source_page_width = models.FloatField(default=595.28, help_text="Source page width in points")
    source_page_height = models.FloatField(default=841.89, help_text="Source page height in points")

    # ── Detection metadata (if auto-detect was used as a starting point) ──
    auto_detected = models.BooleanField(
        default=False,
        help_text="True if the crop coordinates came from auto-detection (user may have adjusted)",
    )

    detection_metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text="Raw auto-detection output for debugging: {header_height, footer_height, ...}",
    )

    # ── Access control ──
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='header_footer_pdfs',
        help_text="User who created this header/footer",
    )

    ACCESS_LEVEL_CHOICES = [
        ('user', 'Private'),
        ('team', 'Team'),
        ('organization', 'Organization'),
    ]

    access_level = models.CharField(
        max_length=20,
        choices=ACCESS_LEVEL_CHOICES,
        default='user',
        db_index=True,
    )

    # ── Timestamps ──
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Flags ──
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['created_by', 'region_type', '-created_at']),
            models.Index(fields=['region_type', 'access_level', '-created_at']),
        ]
        verbose_name = "Header/Footer PDF"
        verbose_name_plural = "Header/Footer PDFs"

    def __str__(self):
        return f"{self.get_region_type_display()}: {self.name}"

    def can_access(self, user):
        """Check if user can access this header/footer PDF."""
        if not user or not user.is_authenticated:
            return False
        if self.created_by == user:
            return True
        if self.access_level == 'user':
            return False
        # team / organization — permissive for now
        return True

    @property
    def file_path(self):
        """Absolute filesystem path to the cropped PDF."""
        if self.cropped_file:
            try:
                return self.cropped_file.path
            except Exception:
                return None
        return None


class ParagraphHistory(models.Model):
    """
    Immutable audit log for paragraph edits.
    Every create / update / restore / delete of a Paragraph records a snapshot
    here so users can browse, compare, and restore previous states.

    Access pattern:
        ParagraphHistory.objects.filter(paragraph=para).order_by('-created_at')
    """
    CHANGE_TYPES = [
        ('created', 'Created'),
        ('edited', 'Edited'),
        ('restored', 'Restored'),
        ('ai_update', 'AI Update'),
        ('reorder', 'Reordered'),
        ('deleted', 'Deleted'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paragraph = models.ForeignKey(
        Paragraph,
        on_delete=models.CASCADE,
        related_name='history',
    )
    # Full content snapshot at the time of the change
    content_snapshot = models.TextField(
        blank=True,
        default='',
        help_text="The effective paragraph content at the time of this change",
    )
    # What the content was *before* this change (enables diff on the frontend)
    previous_content = models.TextField(
        blank=True,
        default='',
        help_text="Content before this change (empty for 'created')",
    )
    change_type = models.CharField(max_length=20, choices=CHANGE_TYPES, default='edited')
    change_summary = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text="Optional human-readable summary, e.g. 'Restored to version from Jan 5'",
    )
    # Who made the change
    changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='paragraph_edits',
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    # Snapshot of paragraph metadata at the time (topic, type, order)
    metadata_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text="Paragraph-level metadata at time of change (topic, paragraph_type, order)",
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['paragraph', '-created_at']),
        ]
        verbose_name = 'Paragraph History'
        verbose_name_plural = 'Paragraph Histories'

    def __str__(self):
        user = self.changed_by.username if self.changed_by else 'system'
        return f"{self.paragraph_id} — {self.change_type} by {user} at {self.created_at}"

    @classmethod
    def record(cls, paragraph, change_type, user=None, previous_content='', summary=''):
        """
        Convenience factory.  Call from views after a save:
            ParagraphHistory.record(paragraph, 'edited', request.user, old_content)
        """
        return cls.objects.create(
            paragraph=paragraph,
            content_snapshot=paragraph.get_effective_content() or '',
            previous_content=previous_content,
            change_type=change_type,
            change_summary=summary,
            changed_by=user,
            metadata_snapshot={
                'topic': paragraph.topic or '',
                'paragraph_type': paragraph.paragraph_type or 'standard',
                'order': paragraph.order,
            },
        )


# =============================================================================
# MASTER DOCUMENT & BRANCHING SYSTEM
# =============================================================================


class MasterDocument(models.Model):
    """
    A reusable master template document that serves as the source of truth
    for quickly producing new documents via branching/duplication.

    Master documents store:
    - A canonical template document (the "golden copy")
    - Default metadata, style presets, and processing settings
    - Tags/categories for search & organization
    - AI generation prompts for rapid document creation

    Workflow:
    1. Create a MasterDocument and attach/create its template Document.
    2. Create branches (DocumentBranch) from the master – each branch
       is a full Document that inherits content & metadata from the master
       but can diverge freely.
    3. Use AI-assist to generate content for the master or branches.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Core identity ────────────────────────────────────────────────────
    name = models.CharField(max_length=255, db_index=True,
                            help_text="Human-readable master document name")
    description = models.TextField(null=True, blank=True,
                                   help_text="Purpose / usage notes for this master")
    
    # The canonical template document
    template_document = models.OneToOneField(
        Document, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='master_document_ref',
        help_text="The golden-copy Document used as the branching source"
    )

    # ── Classification & search ──────────────────────────────────────────
    MASTER_CATEGORIES = [
        ('contract', 'Contract / Agreement'),
        ('policy', 'Policy Document'),
        ('nda', 'Non-Disclosure Agreement'),
        ('employment', 'Employment Document'),
        ('compliance', 'Compliance / Regulation'),
        ('terms', 'Terms & Conditions'),
        ('memo', 'Memorandum'),
        ('letter', 'Formal Letter'),
        ('custom', 'Custom'),
    ]
    category = models.CharField(max_length=50, choices=MASTER_CATEGORIES,
                                default='contract', db_index=True)
    tags = models.JSONField(default=list, blank=True,
                            help_text="Searchable tags, e.g. ['real-estate', 'saas', 'vendor']")
    document_type = models.CharField(max_length=100, default='contract', db_index=True,
                                     help_text="Maps to Document.document_type on branches")

    # ── Default metadata pushed to every new branch ──────────────────────
    default_metadata = models.JSONField(default=dict, blank=True, help_text="""
        Default document_metadata merged into every new branch:
        {
            'legal': {'governing_law': 'Delaware'},
            'dates': {'term_length': '12 months'},
            'financial': {'currency': 'USD'}
        }
    """)
    default_custom_metadata = models.JSONField(default=dict, blank=True,
                                               help_text="Default custom_metadata for branches")
    default_parties = models.JSONField(default=list, blank=True,
                                       help_text="Default parties list for branches")

    # ── Style / processing presets ───────────────────────────────────────
    style_preset = models.JSONField(default=dict, blank=True, help_text="""
        Processing / style defaults pushed to branch.custom_metadata.processing_settings:
        {
            'page_size': 'A4',
            'margin_top': 72,
            'font_family': 'Times New Roman',
            'font_size': 12,
            'line_spacing': 1.15
        }
    """)

    # ── AI generation helpers ────────────────────────────────────────────
    ai_system_prompt = models.TextField(null=True, blank=True, help_text="""
        Custom system prompt sent to Gemini when generating content
        for this master or its branches.
    """)
    ai_generation_notes = models.TextField(null=True, blank=True,
                                           help_text="Free-form notes the AI can reference")

    # ── Default AI service config for branches ───────────────────────────
    default_ai_service_config = models.JSONField(default=dict, blank=True, help_text="""
        Default AI service configuration pushed to every branch's
        DocumentAIConfig.services_config.  Same schema as
        DocumentTypeAIPreset.services_config.  Allows master documents
        to pre-configure which AI services are enabled/disabled and
        how they behave for all derived branches.
        {
            "document_scoring": {"enabled": true, "mode": "legal"},
            "paragraph_scoring": {"enabled": false},
            "data_validation": {"enabled": true, "mode": "financial"}
        }
    """)
    default_ai_system_prompt = models.TextField(blank=True, default='', help_text="""
        Default per-document system prompt pushed to every branch's
        DocumentAIConfig.system_prompt.
    """)
    default_ai_service_prompts = models.JSONField(default=dict, blank=True, help_text="""
        Default per-service system prompts pushed to every branch's
        DocumentAIConfig.service_prompts.  Same schema as
        DocumentTypeAIPreset.service_prompts.
    """)
    default_ai_focus = models.TextField(blank=True, default='', help_text="""
        Default AI focus pushed to every branch's DocumentAIConfig.ai_focus.
    """)

    # ── Ownership & access ───────────────────────────────────────────────
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='master_documents')
    is_public = models.BooleanField(default=False,
                                    help_text="Visible to all org members")
    is_system = models.BooleanField(default=False,
                                    help_text="System-provided master (cannot be deleted by users)")

    # ── Stats (denormalized for dashboard) ───────────────────────────────
    branch_count = models.IntegerField(default=0,
                                       help_text="Number of branches created from this master")
    duplicate_count = models.IntegerField(default=0,
                                          help_text="Number of direct duplicates created")
    last_branched_at = models.DateTimeField(null=True, blank=True)

    # ── Timestamps ───────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['category', '-updated_at']),
            models.Index(fields=['created_by', '-updated_at']),
            models.Index(fields=['document_type']),
        ]
        verbose_name = 'Master Document'
        verbose_name_plural = 'Master Documents'

    def __str__(self):
        return f"[Master] {self.name}"

    # ── Helpers ──────────────────────────────────────────────────────────

    def increment_branch_count(self):
        self.branch_count += 1
        self.last_branched_at = timezone.now()
        self.save(update_fields=['branch_count', 'last_branched_at', 'updated_at'])

    def increment_duplicate_count(self):
        self.duplicate_count += 1
        self.save(update_fields=['duplicate_count', 'updated_at'])

    def get_merged_metadata(self, overrides: dict | None = None) -> dict:
        """Deep-merge default_metadata with optional overrides."""
        import copy
        base = copy.deepcopy(self.default_metadata or {})
        if overrides:
            for key, value in overrides.items():
                if isinstance(value, dict) and isinstance(base.get(key), dict):
                    base[key].update(value)
                else:
                    base[key] = value
        return base


class DocumentBranch(models.Model):
    """
    Tracks the relationship between a master document and a branched
    (derived) document.  Each branch is a fully independent Document that
    was initially cloned from the master's template_document.

    Branches can:
    - Override metadata while inheriting defaults from the master
    - Track their lineage (master → branch)
    - Be further duplicated
    - Be merged back (future)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Lineage ──────────────────────────────────────────────────────────
    master = models.ForeignKey(MasterDocument, on_delete=models.SET_NULL,
                               null=True, blank=True,
                               related_name='branches',
                               help_text="The master this was branched from")
    source_document = models.ForeignKey(Document, on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='derived_branches',
                                        help_text="The specific Document snapshot that was cloned")
    document = models.OneToOneField(Document, on_delete=models.CASCADE,
                                    related_name='branch_info',
                                    help_text="The resulting branched Document")

    # ── Branch metadata ──────────────────────────────────────────────────
    branch_name = models.CharField(max_length=255, db_index=True,
                                   help_text="Display name for this branch")
    branch_notes = models.TextField(null=True, blank=True,
                                    help_text="Why this branch was created / what it's for")

    BRANCH_TYPES = [
        ('branch', 'Branch from Master'),
        ('duplicate', 'Duplicate of Document'),
        ('variant', 'Style / Metadata Variant'),
        ('version', 'Versioned Copy'),
    ]
    branch_type = models.CharField(max_length=20, choices=BRANCH_TYPES, default='branch')

    BRANCH_STATUSES = [
        ('active', 'Active'),
        ('archived', 'Archived'),
        ('merged', 'Merged Back'),
        ('superseded', 'Superseded'),
    ]
    status = models.CharField(max_length=20, choices=BRANCH_STATUSES, default='active', db_index=True)

    # ── Metadata overrides applied at branch creation ────────────────────
    metadata_overrides = models.JSONField(default=dict, blank=True,
                                          help_text="Metadata overrides applied on top of master defaults")
    style_overrides = models.JSONField(default=dict, blank=True,
                                       help_text="Style/processing overrides applied on the branch")

    # ── Ownership ────────────────────────────────────────────────────────
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='created_branches')

    # ── Timestamps ───────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['master', '-created_at']),
            models.Index(fields=['source_document']),
            models.Index(fields=['branch_type', 'status']),
            models.Index(fields=['created_by', '-created_at']),
        ]
        verbose_name = 'Document Branch'
        verbose_name_plural = 'Document Branches'

    def __str__(self):
        return f"[Branch] {self.branch_name} ← {self.master}"






