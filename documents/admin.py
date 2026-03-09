from django.contrib import admin
from django.utils.html import format_html
from .models import (
    Document, Section, Paragraph, Sentence, Issue,
    ChangeLog, DefinedTerm, DocumentVersion,
    DocumentAttachment, DocumentImage, DocumentAccessLog, Table, ImageComponent,
    SectionReference, HeaderFooterPDF, ParagraphHistory,
    MasterDocument, DocumentBranch,
)


class SectionInline(admin.TabularInline):
    model = Section
    extra = 0
    fields = ('id', 'title', 'section_type', 'order', 'depth_level', 'has_edits')
    readonly_fields = ('id',)
    show_change_link = True


class IssueInline(admin.TabularInline):
    model = Issue
    extra = 0
    fields = ('issue_type', 'severity', 'title', 'status', 'detected_at')
    readonly_fields = ('detected_at',)
    show_change_link = True


class DefinedTermInline(admin.TabularInline):
    model = DefinedTerm
    extra = 0
    fields = ('term', 'definition', 'usage_count', 'is_consistent')
    readonly_fields = ('usage_count',)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = (
        'title', 'document_type', 'category', 'status', 
        'author', 'created_at', 'issue_count_display'
    )
    list_filter = (
        'status', 'document_type', 'category', 
        'created_at', 'is_scanned', 'is_draft'
    )
    search_fields = ('title', 'raw_text', 'author', 'reference_number')
    readonly_fields = (
        'id', 'created_at', 'updated_at', 'content_hash',
        'last_analyzed_at', 'total_issues_count', 'critical_issues_count'
    )
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'title', 'author', 'document_type', 'category',
                'status', 'version', 'reference_number'
            )
        }),
        ('Content', {
            'fields': ('raw_text', 'current_text', 'content_hash'),
            'classes': ('collapse',)
        }),
        ('Version Management', {
            'fields': (
                'version_number', 'major_version', 'minor_version', 'patch_version',
                'is_draft', 'is_latest_version', 'version_label', 'version_notes',
                'previous_version', 'original_document'
            ),
            'classes': ('collapse',)
        }),
        ('Parties & Dates', {
            'fields': (
                'parties', 'signatories', 'effective_date', 
                'expiration_date', 'execution_date'
            ),
            'classes': ('collapse',)
        }),
        ('Terms & Legal', {
            'fields': (
                'term_length', 'auto_renewal', 'renewal_terms',
                'governing_law', 'jurisdiction'
            ),
            'classes': ('collapse',)
        }),
        ('Related Documents', {
            'fields': ('related_documents', 'project_name', 'parent_document'),
            'classes': ('collapse',)
        }),
        ('File Information', {
            'fields': (
                'source_file', 'source_file_name', 'source_file_type',
                'source_file_size', 'is_scanned', 'ocr_confidence', 'page_count',
                'attachments'
            ),
            'classes': ('collapse',)
        }),
        ('Images', {
            'fields': (
                'logo_image', 'watermark_image', 'background_image'
            ),
            'classes': ('collapse',)
        }),
        ('Analysis', {
            'fields': (
                'last_analyzed_at', 'analysis_version',
                'total_issues_count', 'critical_issues_count'
            ),
            'classes': ('collapse',)
        }),
        ('Tracking', {
            'fields': (
                'created_by', 'last_modified_by', 'created_at', 'updated_at',
                'auto_save_enabled', 'last_auto_saved_at', 'changes_from_previous'
            )
        }),
        ('Metadata (JSON)', {
            'fields': ('document_metadata', 'custom_metadata'),
            'classes': ('collapse',),
            'description': 'Flexible metadata storage. Use document_metadata for structured data (financial, legal, dates, terms, etc.) and custom_metadata for completely custom fields.'
        }),
    )
    
    inlines = [SectionInline, IssueInline, DefinedTermInline]
    
    def issue_count_display(self, obj):
        count = obj.issues.count()
        critical = obj.issues.filter(severity='critical').count()
        if critical > 0:
            return format_html(
                '<span style="color: red; font-weight: bold;">{} ({} critical)</span>',
                count, critical
            )
        return count
    issue_count_display.short_description = 'Issues'


class ParagraphInline(admin.TabularInline):
    model = Paragraph
    extra = 0
    fields = ('id', 'content_text', 'paragraph_type', 'order', 'has_edits')
    readonly_fields = ('id',)
    show_change_link = True


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'title', 'document', 'section_type', 
        'order', 'depth_level', 'has_edits', 'last_modified'
    )
    list_filter = (
        'section_type', 'has_edits', 'is_boilerplate',
        'requires_specialist_review', 'specialist_review_status'
    )
    search_fields = ('id', 'title', 'content_text', 'edited_text')
    readonly_fields = ('last_modified',)
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'document', 'parent', 'title', 'section_type')
        }),
        ('Content', {
            'fields': (
                'content_start', 'content_end', 'content_text',
                'edited_text', 'has_edits'
            )
        }),
        ('Hierarchy', {
            'fields': ('order', 'depth_level')
        }),
        ('Analysis', {
            'fields': (
                'importance_level', 'is_boilerplate',
                'requires_specialist_review', 'specialist_model_type',
                'specialist_review_status'
            ),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('tags', 'custom_metadata', 'modified_by', 'last_modified'),
            'classes': ('collapse',)
        }),
    )
    
    inlines = [ParagraphInline]


class SentenceInline(admin.TabularInline):
    model = Sentence
    extra = 0
    fields = ('content_text', 'order', 'word_count', 'is_obligation', 'is_permission')
    readonly_fields = ('word_count',)


@admin.register(Paragraph)
class ParagraphAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'section', 'paragraph_type', 'order',
        'has_edits', 'is_ambiguous', 'complexity_score'
    )
    list_filter = (
        'paragraph_type', 'has_edits', 'is_ambiguous',
        'is_conflicting'
    )
    search_fields = ('id', 'content_text', 'edited_text')
    readonly_fields = ('last_modified', 'edit_count')
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'section', 'paragraph_type', 'order')
        }),
        ('Content', {
            'fields': (
                'content_start', 'content_end', 'content_text',
                'edited_text', 'has_edits'
            )
        }),
        ('Analysis', {
            'fields': (
                'is_ambiguous', 'is_conflicting', 'complexity_score'
            )
        }),
        ('Tracking', {
            'fields': ('modified_by', 'last_modified', 'edit_count'),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('custom_metadata',),
            'classes': ('collapse',)
        }),
    )
    
    inlines = [SentenceInline]


@admin.register(Table)
class TableAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'section', 'title', 'table_type', 'num_columns',
        'num_rows', 'order', 'has_edits', 'is_complex'
    )
    list_filter = (
        'table_type', 'has_edits', 'is_complex', 'requires_validation'
    )
    search_fields = ('id', 'title', 'description')
    readonly_fields = ('last_modified', 'edit_count')
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'section', 'title', 'description', 'table_type', 'order')
        }),
        ('Structure', {
            'fields': (
                'num_columns', 'num_rows', 'column_headers', 'table_data'
            )
        }),
        ('Configuration', {
            'fields': ('table_config',),
            'classes': ('collapse',)
        }),
        ('Edit Tracking', {
            'fields': (
                'has_edits', 'original_data_backup', 'modified_by',
                'last_modified', 'edit_count'
            ),
            'classes': ('collapse',)
        }),
        ('Analysis Flags', {
            'fields': ('is_complex', 'requires_validation'),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('custom_metadata',),
            'classes': ('collapse',)
        }),
    )
    
    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj:  # Editing existing table
            readonly.extend(['id'])
        return readonly


@admin.register(ImageComponent)
class ImageComponentAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'section', 'image_name_display', 'caption', 'component_type',
        'alignment', 'size_mode', 'order', 'is_visible', 'created_at'
    )
    list_filter = (
        'component_type', 'alignment', 'size_mode', 'is_visible', 'created_at'
    )
    search_fields = ('id', 'caption', 'alt_text', 'title', 'figure_number')
    readonly_fields = (
        'id', 'created_at', 'last_modified', 'edit_count', 
        'image_preview_display', 'image_details_display'
    )
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'section', 'image_reference', 'image_preview_display',
                'order', 'component_type', 'is_visible'
            )
        }),
        ('Image Details', {
            'fields': ('image_details_display',),
            'classes': ('collapse',)
        }),
        ('Caption & Labels', {
            'fields': (
                'title', 'caption', 'alt_text', 'figure_number',
                'show_caption', 'show_figure_number'
            )
        }),
        ('Display Properties', {
            'fields': (
                'alignment', 'size_mode', 'custom_width_percent',
                'custom_width_pixels', 'custom_height_pixels',
                'maintain_aspect_ratio'
            )
        }),
        ('Spacing', {
            'fields': (
                'margin_top', 'margin_bottom', 'margin_left', 'margin_right'
            ),
            'classes': ('collapse',)
        }),
        ('Border & Styling', {
            'fields': ('show_border', 'border_color', 'border_width'),
            'classes': ('collapse',)
        }),
        ('Link', {
            'fields': ('link_url',),
            'classes': ('collapse',)
        }),
        ('Tracking', {
            'fields': (
                'created_by', 'created_at', 'modified_by',
                'last_modified', 'edit_count'
            ),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('custom_metadata',),
            'classes': ('collapse',)
        }),
    )
    
    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj:  # Editing existing component
            readonly.extend(['id'])
        return readonly
    
    def image_name_display(self, obj):
        """Display the name of the referenced image."""
        if obj.image_reference:
            return obj.image_reference.name
        return "-"
    image_name_display.short_description = "Image Name"
    
    def image_preview_display(self, obj):
        """Display a preview of the image."""
        if obj.image_reference and obj.image_reference.thumbnail:
            return format_html(
                '<img src="{}" style="max-width: 200px; max-height: 200px;" />',
                obj.image_reference.thumbnail.url
            )
        elif obj.image_reference and obj.image_reference.image:
            return format_html(
                '<img src="{}" style="max-width: 200px; max-height: 200px;" />',
                obj.image_reference.image.url
            )
        return "-"
    image_preview_display.short_description = "Image Preview"
    
    def image_details_display(self, obj):
        """Display details about the referenced image."""
        if obj.image_reference:
            img = obj.image_reference
            details = []
            details.append(f"<strong>Name:</strong> {img.name}")
            details.append(f"<strong>Type:</strong> {img.get_image_type_display()}")
            if img.width and img.height:
                details.append(f"<strong>Dimensions:</strong> {img.width} × {img.height} px")
            if img.file_size:
                size_kb = img.file_size / 1024
                details.append(f"<strong>File Size:</strong> {size_kb:.1f} KB")
            if img.format:
                details.append(f"<strong>Format:</strong> {img.format}")
            if img.uploaded_by:
                details.append(f"<strong>Uploaded By:</strong> {img.uploaded_by.username}")
            details.append(f"<strong>Uploaded:</strong> {img.uploaded_at.strftime('%Y-%m-%d %H:%M')}")
            
            return format_html("<br>".join(details))
        return "-"
    image_details_display.short_description = "Image Details"


@admin.register(Sentence)
class SentenceAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'paragraph', 'content_preview', 'word_count',
        'is_obligation', 'is_permission', 'sentiment_score'
    )
    list_filter = (
        'contains_legal_term', 'is_obligation', 'is_permission'
    )
    search_fields = ('content_text',)
    readonly_fields = ('id', 'word_count')
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'paragraph', 'order')
        }),
        ('Content', {
            'fields': ('content_start', 'content_end', 'content_text')
        }),
        ('Analysis', {
            'fields': (
                'word_count', 'readability_score', 'contains_legal_term',
                'sentiment_score', 'is_obligation', 'is_permission'
            )
        }),
        ('Metadata', {
            'fields': ('custom_metadata',),
            'classes': ('collapse',)
        }),
    )
    
    def content_preview(self, obj):
        return obj.content_text[:50] + '...' if len(obj.content_text) > 50 else obj.content_text
    content_preview.short_description = 'Content'


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'document', 'issue_type', 'severity', 'title',
        'status', 'requires_specialist', 'detected_at'
    )
    list_filter = (
        'issue_type', 'severity', 'status', 'requires_specialist',
        'is_blocking', 'was_applied', 'detected_at'
    )
    search_fields = (
        'title', 'description', 'suggestion', 'highlighted_text'
    )
    readonly_fields = (
        'id', 'detected_at', 'updated_at', 'applied_at',
        'detection_confidence', 'specialist_confidence'
    )
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'document', 'issue_type', 'severity', 'status'
            )
        }),
        ('Location', {
            'fields': (
                'section', 'paragraph', 'sentence',
                'position_start', 'position_end', 'highlighted_text'
            )
        }),
        ('Issue Details', {
            'fields': ('title', 'description', 'suggestion', 'alternative_suggestions')
        }),
        ('Specialist Review', {
            'fields': (
                'requires_specialist', 'specialist_model_type',
                'specialist_confidence', 'specialist_response'
            ),
            'classes': ('collapse',)
        }),
        ('Detection', {
            'fields': (
                'detected_by_model', 'detection_confidence', 'detected_at'
            ),
            'classes': ('collapse',)
        }),
        ('User Action', {
            'fields': (
                'user_note', 'actioned_by', 'actioned_at',
                'was_applied', 'applied_at', 'original_text_backup'
            ),
            'classes': ('collapse',)
        }),
        ('Impact & Priority', {
            'fields': (
                'priority', 'is_blocking', 'affects_other_sections',
                'related_issues'
            ),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('custom_metadata', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    filter_horizontal = ('related_issues',)


@admin.register(ChangeLog)
class ChangeLogAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'document', 'change_type', 'changed_by',
        'changed_at', 'is_reverted'
    )
    list_filter = ('change_type', 'is_reverted', 'changed_at')
    search_fields = ('description', 'user_note')
    readonly_fields = ('id', 'changed_at', 'reverted_at')
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'document', 'change_type', 'description'
            )
        }),
        ('Targets', {
            'fields': ('target_section', 'target_paragraph', 'related_issue')
        }),
        ('Changes', {
            'fields': ('original_content', 'new_content', 'user_note')
        }),
        ('Tracking', {
            'fields': ('changed_by', 'changed_at')
        }),
        ('Revert', {
            'fields': ('is_reverted', 'reverted_by', 'reverted_at'),
            'classes': ('collapse',)
        }),
        ('Metadata', {
            'fields': ('metadata',),
            'classes': ('collapse',)
        }),
    )


@admin.register(DefinedTerm)
class DefinedTermAdmin(admin.ModelAdmin):
    list_display = (
        'term', 'document', 'usage_count', 'is_consistent',
        'is_capitalized', 'created_at'
    )
    list_filter = ('is_consistent', 'is_capitalized', 'created_at')
    search_fields = ('term', 'definition')
    readonly_fields = ('id', 'created_at', 'usage_count')
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'document', 'term', 'definition')
        }),
        ('Location', {
            'fields': (
                'defined_in_section', 'defined_in_paragraph',
                'position_start', 'position_end'
            ),
            'classes': ('collapse',)
        }),
        ('Usage', {
            'fields': (
                'usage_count', 'is_capitalized', 'is_consistent',
                'inconsistent_usages'
            )
        }),
        ('Tracking', {
            'fields': ('created_at',),
            'classes': ('collapse',)
        }),
    )


@admin.register(DocumentVersion)
class DocumentVersionAdmin(admin.ModelAdmin):
    list_display = (
        'document', 'version_number', 'version_name',
        'is_major_version', 'created_by', 'created_at'
    )
    list_filter = ('is_major_version', 'created_at')
    search_fields = ('version_number', 'version_name', 'change_summary')
    readonly_fields = ('id', 'created_at')
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'document', 'version_number', 'version_name',
                'is_major_version'
            )
        }),
        ('Content', {
            'fields': ('content_snapshot', 'metadata_snapshot'),
            'classes': ('collapse',)
        }),
        ('Changes', {
            'fields': ('change_summary', 'diff_from_previous')
        }),
        ('Tracking', {
            'fields': ('created_by', 'created_at')
        }),
    )


@admin.register(DocumentAttachment)
class DocumentAttachmentAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'document', 'attachment_type', 'file_size_display',
        'is_required', 'uploaded_by', 'uploaded_at'
    )
    list_filter = ('attachment_type', 'is_required', 'uploaded_at')
    search_fields = ('name', 'description', 'file_name')
    readonly_fields = ('id', 'uploaded_at', 'file_size')
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'document', 'attachment_type', 'name',
                'description', 'order'
            )
        }),
        ('File', {
            'fields': ('file', 'file_name', 'file_type', 'file_size')
        }),
        ('Metadata', {
            'fields': ('is_required', 'reference_in_document'),
            'classes': ('collapse',)
        }),
        ('Tracking', {
            'fields': ('uploaded_by', 'uploaded_at')
        }),
    )
    
    def file_size_display(self, obj):
        return obj.get_file_size_display()
    file_size_display.short_description = 'File Size'




@admin.register(DocumentAccessLog)
class DocumentAccessLogAdmin(admin.ModelAdmin):
    list_display = (
        'document_title', 'user_display', 'access_type', 
        'accessed_at', 'ip_address'
    )
    list_filter = ('access_type', 'accessed_at')
    search_fields = (
        'document__title', 'user__username', 'user__email',
        'ip_address', 'access_token'
    )
    readonly_fields = (
        'id', 'document', 'user', 'access_type', 'accessed_at',
        'access_token', 'ip_address', 'user_agent', 'share_id',
        'session_id', 'metadata'
    )
    
    fieldsets = (
        ('Access Details', {
            'fields': ('document', 'user', 'access_type', 'accessed_at')
        }),
        ('External Access', {
            'fields': ('access_token', 'ip_address', 'user_agent', 'share_id'),
            'classes': ('collapse',)
        }),
        ('Session', {
            'fields': ('session_id', 'metadata'),
            'classes': ('collapse',)
        }),
    )
    
    def document_title(self, obj):
        return obj.document.title
    document_title.short_description = 'Document'
    
    def user_display(self, obj):
        if obj.user:
            return format_html(
                '<strong>{}</strong>',
                obj.user.username
            )
        elif obj.access_token:
            return format_html(
                '🔑 Token: {}...',
                obj.access_token[:8]
            )
        return 'Anonymous'
    user_display.short_description = 'User'
    
    def has_add_permission(self, request):
        # Access logs should not be manually created
        return False
    
    def has_change_permission(self, request, obj=None):
        # Access logs should be read-only
        return False

@admin.register(DocumentImage)
class DocumentImageAdmin(admin.ModelAdmin):
    list_display = (
        'caption_display', 'document', 'image_type',
        'dimensions_display', 'file_size_display', 'uploaded_at'
    )
    list_filter = ('image_type', 'format', 'uploaded_at')
    search_fields = ('caption', 'description', 'extracted_text')
    readonly_fields = (
        'id', 'uploaded_at', 'width', 'height',
        'file_size', 'ocr_confidence'
    )
    
    fieldsets = (
        ('Basic Information', {
            'fields': (
                'id', 'document', 'image_type', 'caption', 'description'
            )
        }),
        ('Image File', {
            'fields': ('image', 'thumbnail', 'format', 'width', 'height', 'file_size')
        }),
        ('Position', {
            'fields': ('page_number', 'position_x', 'position_y'),
            'classes': ('collapse',)
        }),
        ('OCR', {
            'fields': ('extracted_text', 'ocr_confidence'),
            'classes': ('collapse',)
        }),
        ('Tracking', {
            'fields': ('uploaded_by', 'uploaded_at')
        }),
    )
    
    def caption_display(self, obj):
        return obj.caption or 'Untitled'
    caption_display.short_description = 'Caption'
    
    def dimensions_display(self, obj):
        if obj.width and obj.height:
            return f'{obj.width} × {obj.height}'
        return '-'
    dimensions_display.short_description = 'Dimensions'
    
    def file_size_display(self, obj):
        size = obj.file_size
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} TB"
    file_size_display.short_description = 'File Size'


# ============================================================================
# WORKFLOW & TASK ASSIGNMENT ADMIN
# ============================================================================

from documents.models import DocumentWorkflow, WorkflowApproval, WorkflowComment, WorkflowNotification


class WorkflowApprovalInline(admin.TabularInline):
    """Inline approvals for workflow"""
    model = WorkflowApproval
    extra = 0
    fields = ('approver', 'role', 'order', 'status', 'approved_at', 'is_required')
    readonly_fields = ('approved_at',)
    ordering = ('order',)


@admin.register(DocumentWorkflow)
class DocumentWorkflowAdmin(admin.ModelAdmin):
    """Admin for document workflows and task assignments"""
    list_display = ('id', 'document_title', 'current_status', 'assigned_to', 'priority', 
                   'due_date', 'organization', 'team', 'is_active', 'is_completed', 'created_at')
    list_filter = ('current_status', 'priority', 'is_active', 'is_completed', 
                  'organization', 'team', 'created_at')
    search_fields = ('document__title', 'assigned_to__username', 'organization', 'team', 'message')
    readonly_fields = ('id', 'created_at', 'updated_at', 'completed_at')
    date_hierarchy = 'created_at'
    
    fieldsets = (
        ('Workflow Info', {
            'fields': ('id', 'document', 'current_status')
        }),
        ('Assignment', {
            'fields': ('assigned_to', 'assigned_by', 'organization', 'team', 'message')
        }),
        ('Priority & Deadlines', {
            'fields': ('priority', 'due_date')
        }),
        ('Details', {
            'fields': ('notes', 'version')
        }),
        ('Status', {
            'fields': ('is_active', 'is_completed', 'created_at', 'updated_at', 'completed_at')
        }),
    )
    
    inlines = [WorkflowApprovalInline]
    
    def document_title(self, obj):
        return obj.document.title
    document_title.short_description = 'Document'
    document_title.admin_order_field = 'document__title'


@admin.register(WorkflowApproval)
class WorkflowApprovalAdmin(admin.ModelAdmin):
    """Admin for workflow approvals"""
    list_display = ('id', 'workflow_document', 'approver', 'role', 'order', 'status', 
                   'approved_at', 'is_required')
    list_filter = ('status', 'is_required', 'approved_at')
    search_fields = ('workflow__document__title', 'approver__username', 'role', 'comments')
    readonly_fields = ('id', 'approved_at', 'created_at', 'updated_at')
    
    fieldsets = (
        ('Approval Info', {
            'fields': ('id', 'workflow', 'approver', 'role', 'order')
        }),
        ('Status', {
            'fields': ('status', 'approved_at', 'comments', 'is_required')
        }),
        ('Tracking', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
    def workflow_document(self, obj):
        return obj.workflow.document.title
    workflow_document.short_description = 'Document'


@admin.register(WorkflowComment)
class WorkflowCommentAdmin(admin.ModelAdmin):
    """Admin for workflow comments"""
    list_display = ('id', 'workflow_document', 'user', 'comment_type', 'is_resolved', 'created_at')
    list_filter = ('comment_type', 'is_resolved', 'created_at')
    search_fields = ('workflow__document__title', 'user__username', 'comment')
    readonly_fields = ('id', 'created_at', 'updated_at')
    filter_horizontal = ('mentions',)
    
    fieldsets = (
        ('Comment Info', {
            'fields': ('id', 'workflow', 'user', 'comment_type', 'comment')
        }),
        ('Mentions & Resolution', {
            'fields': ('mentions', 'is_resolved')
        }),
        ('Tracking', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
    def workflow_document(self, obj):
        return obj.workflow.document.title
    workflow_document.short_description = 'Document'


@admin.register(WorkflowNotification)
class WorkflowNotificationAdmin(admin.ModelAdmin):
    """Admin for workflow notifications"""
    list_display = ('id', 'workflow_document', 'recipient', 'notification_type', 
                   'title', 'is_read', 'created_at')
    list_filter = ('notification_type', 'is_read', 'created_at')
    search_fields = ('workflow__document__title', 'recipient__username', 'title', 'message')
    readonly_fields = ('id', 'created_at', 'read_at')
    
    fieldsets = (
        ('Notification Info', {
            'fields': ('id', 'workflow', 'recipient', 'notification_type')
        }),
        ('Content', {
            'fields': ('title', 'message')
        }),
        ('Related', {
            'fields': ('approval', 'comment')
        }),
        ('Status', {
            'fields': ('is_read', 'created_at', 'read_at')
        }),
    )
    
    def workflow_document(self, obj):
        return obj.workflow.document.title
    workflow_document.short_description = 'Document'


@admin.register(SectionReference)
class SectionReferenceAdmin(admin.ModelAdmin):
    """
    Admin interface for Section References.
    Allows viewing and managing references to sections from other documents.
    """
    list_display = (
        'id', 'source_doc_title', 'referenced_section_info', 'referenced_doc_title',
        'order', 'created_by', 'created_at'
    )
    list_filter = ('created_at', 'modified_at', 'include_full_content')
    search_fields = (
        'source_document__title',
        'referenced_section__title',
        'referenced_section__document__title',
        'note',
        'created_by__username'
    )
    readonly_fields = ('id', 'created_at', 'modified_at')
    
    fieldsets = (
        ('Reference Info', {
            'fields': ('id', 'source_document', 'referenced_section')
        }),
        ('Position & Ordering', {
            'fields': ('order', 'position_description')
        }),
        ('Display Options', {
            'fields': ('include_full_content', 'note')
        }),
        ('Metadata', {
            'fields': ('created_by', 'created_at', 'modified_at')
        }),
    )
    
    def source_doc_title(self, obj):
        """Display source document title with link"""
        return format_html(
            '<a href="/admin/documents/document/{}/change/">{}</a>',
            obj.source_document.id,
            obj.source_document.title
        )
    source_doc_title.short_description = 'Source Document'
    
    def referenced_section_info(self, obj):
        """Display referenced section info"""
        section = obj.referenced_section
        return f"{section.id}: {section.title or 'Untitled'}"
    referenced_section_info.short_description = 'Referenced Section'
    
    def referenced_doc_title(self, obj):
        """Display referenced document title with link"""
        doc = obj.get_referenced_document()
        return format_html(
            '<a href="/admin/documents/document/{}/change/">{}</a>',
            doc.id,
            doc.title
        )
    referenced_doc_title.short_description = 'Referenced Document'
    
    def get_queryset(self, request):
        """Optimize queries with select_related"""
        qs = super().get_queryset(request)
        return qs.select_related(
            'source_document',
            'referenced_section',
            'referenced_section__document',
            'created_by'
        )


@admin.register(HeaderFooterPDF)
class HeaderFooterPDFAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'region_type', 'region_height', 'auto_detected',
        'access_level', 'created_by', 'created_at', 'is_active',
    )
    list_filter = ('region_type', 'auto_detected', 'access_level', 'is_active')
    search_fields = ('name', 'description')
    readonly_fields = (
        'id', 'created_at', 'updated_at',
        'source_page_width', 'source_page_height',
        'detection_metadata',
    )
    raw_id_fields = ('source_file', 'created_by')


@admin.register(ParagraphHistory)
class ParagraphHistoryAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'paragraph', 'change_type', 'changed_by', 'created_at',
        'short_summary',
    )
    list_filter = ('change_type', 'created_at')
    search_fields = ('paragraph__id', 'change_summary', 'content_snapshot')
    readonly_fields = (
        'id', 'paragraph', 'content_snapshot', 'previous_content',
        'change_type', 'change_summary', 'changed_by', 'created_at',
        'metadata_snapshot',
    )
    raw_id_fields = ()
    ordering = ('-created_at',)

    @admin.display(description='Summary')
    def short_summary(self, obj):
        return obj.change_summary[:80] if obj.change_summary else '—'


# ─────────────────────────────────────────────────────────────────────────────
# Master Documents & Branching
# ─────────────────────────────────────────────────────────────────────────────

class DocumentBranchInline(admin.TabularInline):
    model = DocumentBranch
    fk_name = 'master'
    extra = 0
    fields = ('branch_name', 'branch_type', 'status', 'document', 'created_by', 'created_at')
    readonly_fields = ('created_at',)
    show_change_link = True


@admin.register(MasterDocument)
class MasterDocumentAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'document_type', 'branch_count',
                    'duplicate_count', 'is_public', 'created_by', 'updated_at')
    list_filter = ('category', 'document_type', 'is_public', 'is_system')
    search_fields = ('name', 'description', 'tags')
    readonly_fields = ('id', 'branch_count', 'duplicate_count', 'last_branched_at',
                       'created_at', 'updated_at')
    raw_id_fields = ('template_document', 'created_by')
    inlines = [DocumentBranchInline]
    ordering = ('-updated_at',)


@admin.register(DocumentBranch)
class DocumentBranchAdmin(admin.ModelAdmin):
    list_display = ('branch_name', 'branch_type', 'status', 'master',
                    'document', 'created_by', 'created_at')
    list_filter = ('branch_type', 'status')
    search_fields = ('branch_name', 'branch_notes')
    readonly_fields = ('id', 'created_at', 'updated_at')
    raw_id_fields = ('master', 'source_document', 'document', 'created_by')
    ordering = ('-created_at',)
