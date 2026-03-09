"""
CLM Models — Simplified Workflow System
========================================
Three-node workflow: Input → Rule(s) → Output

- Workflow: a reusable pipeline definition
- WorkflowNode: input | rule | output
- NodeConnection: directed edge between nodes
- WorkflowDocument: a document uploaded to a workflow's input node
- ExtractedField: individual extracted field rows (central table for queries/dropdowns)
"""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from user_management.models import Organization


# ---------------------------------------------------------------------------
# Workflow — the pipeline definition
# ---------------------------------------------------------------------------

class Workflow(models.Model):
    """
    A visual workflow pipeline.  Users create these, add nodes,
    connect them, then upload documents through the input node.
    When created/saved, all field names from rule nodes are collected
    and used as the NuExtract template automatically.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_workflows',
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)

    # Auto-generated NuExtract template from rule node field names
    extraction_template = models.JSONField(
        default=dict, blank=True,
        help_text='Auto-built from rule nodes: {"field_name": "", ...}',
    )

    # Canvas viewport state (restoring zoom/pan)
    canvas_state = models.JSONField(
        default=dict, blank=True,
        help_text='{"zoom": 1, "panX": 0, "panY": 0}',
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    last_executed_at = models.DateTimeField(null=True, blank=True)

    # Auto-execution: run workflow automatically when documents are uploaded
    auto_execute_on_upload = models.BooleanField(
        default=False,
        help_text='Automatically execute the workflow when new documents are uploaded',
    )

    # Smart execution: hash of all node configs + connections
    # When this changes, all documents need re-execution.
    nodes_config_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='SHA-256 of all node configs + connections. Changes = re-execute all.',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['organization', 'is_active']),
        ]

    def __str__(self):
        return self.name

    def rebuild_extraction_template(self):
        """
        Collect every unique field name from all rule nodes, all AI
        node json_fields, AND all DerivedField definitions in this
        workflow, then build the NuExtract JSON template.  Derived
        fields are included so downstream Rule nodes can reference
        them in conditions.

        Returns: (new_template, changed_fields) where changed_fields
        is the set of NEW field names not present in the old template.
        If changed_fields is non-empty, documents may need re-extraction.
        """
        old_template = dict(self.extraction_template or {})
        fields = set()

        # Collect from rule node conditions
        for node in self.nodes.filter(node_type='rule'):
            for condition in (node.config or {}).get('conditions', []):
                field = condition.get('field', '').strip()
                if field:
                    fields.add(field)

        # Collect from AI node json_fields (json_extract output fields)
        for node in self.nodes.filter(node_type='ai'):
            config = node.config or {}
            if config.get('output_format') == 'json_extract':
                for jf in config.get('json_fields', []):
                    name = jf.get('name', '').strip()
                    if name:
                        fields.add(name)
            # Also include the output_key itself
            output_key = config.get('output_key', '').strip()
            if output_key:
                fields.add(output_key)

        # Collect from doc_create node field_mappings (source metadata keys)
        for node in self.nodes.filter(node_type='doc_create'):
            config = node.config or {}
            for mapping in config.get('field_mappings', []):
                source = mapping.get('source_field', '').strip()
                if source:
                    fields.add(source)

        # Collect from DerivedField definitions
        for df in self.derived_fields.all():
            fields.add(df.name)

        new_template = {f: '' for f in sorted(fields)}
        changed_fields = set(new_template.keys()) - set(old_template.keys())

        self.extraction_template = new_template
        self.save(update_fields=['extraction_template', 'updated_at'])
        return new_template, changed_fields

    @property
    def document_type(self) -> str:
        """
        Return the document_type set on this workflow's first input node config.
        For workflows with a single input node.
        Returns empty string if not set.
        """
        input_node = self.nodes.filter(node_type='input').first()
        if input_node:
            return (input_node.config or {}).get('document_type', '')
        return ''

    @property
    def document_types(self) -> dict:
        """
        Return a {node_id: document_type} mapping for ALL input nodes.
        Supports workflows with multiple input nodes, each handling a
        different document type (e.g., one for invoices, one for contracts).
        """
        result = {}
        for node in self.nodes.filter(node_type='input'):
            doc_type = (node.config or {}).get('document_type', '')
            if doc_type:
                result[str(node.id)] = doc_type
        return result

    def compute_nodes_config_hash(self, save=False):
        """
        Compute a SHA-256 hash of all node configs + connections.
        This uniquely identifies the "shape" and configuration of the
        workflow DAG. If any node config, label, type, or connection
        changes, the hash will change — signalling that all documents
        need re-execution.

        Returns the hex digest string.
        """
        import hashlib, json

        # Deterministic serialisation of all nodes
        node_data = []
        for n in self.nodes.all().order_by('id'):
            node_data.append({
                'id': str(n.id),
                'type': n.node_type,
                'config': n.config or {},
            })

        # Deterministic serialisation of all connections
        conn_data = []
        for c in self.connections.all().order_by('id'):
            conn_data.append({
                'src': str(c.source_node_id),
                'tgt': str(c.target_node_id),
                'handle': c.source_handle or '',
            })

        payload = json.dumps(
            {'nodes': node_data, 'connections': conn_data},
            sort_keys=True, default=str,
        )
        digest = hashlib.sha256(payload.encode()).hexdigest()

        if save and digest != self.nodes_config_hash:
            self.nodes_config_hash = digest
            self.save(update_fields=['nodes_config_hash'])

        return digest


# ---------------------------------------------------------------------------
# WorkflowNode — only 3 types
# ---------------------------------------------------------------------------

class WorkflowNode(models.Model):
    """
    A node in the workflow graph.  Ten types exist:

    - input:       Starting point — documents are uploaded here
    - rule:        Metadata filter node with conditions
    - listener:    Watches inboxes/folders, triggers workflow for single documents
    - validator:   Multi-level approval gate — assigned users approve/reject documents
    - action:      Executes a plugin (email, WhatsApp, SMS, etc.) for each document
    - ai:          AI model processing (Gemini/ChatGPT) for each document
    - and_gate:    Logic gate — passes docs only when ALL upstream paths deliver them (intersection)
    - scraper:     Scrapes allowed websites for keywords, enriches doc metadata
    - doc_create:  Creates / duplicates editor documents from CLM metadata
    - output:      Terminal — shows the filtered document list

    Note: Regular nodes with multiple inputs already do a union (OR) of upstream
    docs automatically, so a separate OR gate is unnecessary. The AND gate is the
    only gate type needed — it does set intersection.
    """

    class NodeType(models.TextChoices):
        INPUT = 'input', 'Input'
        RULE = 'rule', 'Rule'
        LISTENER = 'listener', 'Listener'
        VALIDATOR = 'validator', 'Validator'
        ACTION = 'action', 'Action'
        AI = 'ai', 'AI'
        AND_GATE = 'and_gate', 'AND Gate'
        SCRAPER = 'scraper', 'Scraper'
        DOC_CREATE = 'doc_create', 'Document Creator'
        INFERENCE = 'inference', 'Inference'
        OUTPUT = 'output', 'Output'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='nodes',
    )
    node_type = models.CharField(max_length=10, choices=NodeType.choices)
    label = models.CharField(max_length=255, blank=True, default='')

    # Canvas position
    position_x = models.FloatField(default=100)
    position_y = models.FloatField(default=200)

    # Node configuration (only used by 'rule' nodes)
    # {
    #   "boolean_operator": "AND" | "OR",
    #   "conditions": [
    #     {"field": "contract_value", "operator": "gt", "value": "50000"},
    #     {"field": "jurisdiction",   "operator": "contains", "value": "US"},
    #     ...
    #   ]
    # }
    config = models.JSONField(default=dict, blank=True)

    # Execution cache: {"count": N, "document_ids": ["uuid", ...]}
    last_result = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position_x', 'created_at']

    def __str__(self):
        return f"{self.label or self.get_node_type_display()} ({self.workflow.name})"


# ---------------------------------------------------------------------------
# NodeConnection — directed edge
# ---------------------------------------------------------------------------

class NodeConnection(models.Model):
    """Directed edge: source_node → target_node.
    
    source_handle — optional handle identifier for branching nodes.
    Validator nodes use 'approved' / 'rejected' to split output.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='connections',
    )
    source_node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='outgoing',
    )
    target_node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='incoming',
    )
    source_handle = models.CharField(
        max_length=50, blank=True, default='',
        help_text='Handle id on the source node (e.g. "approved", "rejected").',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('source_node', 'target_node')]

    def __str__(self):
        handle = f" [{self.source_handle}]" if self.source_handle else ""
        return f"{self.source_node} → {self.target_node}{handle}"


# ---------------------------------------------------------------------------
# WorkflowDocument — a document uploaded to a workflow
# ---------------------------------------------------------------------------

class WorkflowDocument(models.Model):
    """
    A document uploaded through a workflow's input node.
    Stores the original file, extracted text, and the AI-extracted metadata.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='documents',
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_documents',
    )

    # Which input node this document belongs to (supports multiple input nodes)
    input_node = models.ForeignKey(
        'WorkflowNode', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='input_documents',
        help_text='The input node this document was uploaded/ingested through',
    )

    # File
    title = models.CharField(max_length=500)
    file = models.FileField(upload_to='clm/documents/%Y/%m/')
    file_type = models.CharField(
        max_length=20,
        choices=[
            ('pdf', 'PDF'),
            ('docx', 'Word'),
            ('doc', 'Word (legacy)'),
            ('txt', 'Text'),
            ('csv', 'CSV'),
            ('json', 'JSON'),
            ('xml', 'XML'),
            ('html', 'HTML'),
            ('md', 'Markdown'),
            ('xlsx', 'Excel'),
            ('xls', 'Excel (legacy)'),
            ('pptx', 'PowerPoint'),
            ('ppt', 'PowerPoint (legacy)'),
            ('png', 'PNG Image'),
            ('jpg', 'JPEG Image'),
            ('jpeg', 'JPEG Image'),
            ('gif', 'GIF Image'),
            ('bmp', 'BMP Image'),
            ('tiff', 'TIFF Image'),
            ('tif', 'TIFF Image'),
            ('webp', 'WebP Image'),
            ('svg', 'SVG Image'),
            ('rtf', 'Rich Text'),
            ('odt', 'OpenDocument'),
            ('other', 'Other'),
        ],
        default='pdf',
    )
    file_size = models.PositiveIntegerField(default=0)

    # Dual text extraction — both saved, best one used for AI extraction
    direct_text = models.TextField(
        blank=True, default='',
        help_text='Text extracted directly from file (PyMuPDF, python-docx, etc.)',
    )
    ocr_text = models.TextField(
        blank=True, default='',
        help_text='Text extracted via OCR (tesseract) for scanned/image PDFs',
    )
    original_text = models.TextField(
        blank=True, default='',
        help_text='The text actually used for AI extraction (best of direct/ocr)',
    )
    text_source = models.CharField(
        max_length=10,
        choices=[('direct', 'Direct'), ('ocr', 'OCR'), ('none', 'None')],
        default='none',
        help_text='Which text source was used for extraction',
    )

    # OCR / file-level metadata (page count, dimensions, language, etc.)
    ocr_metadata = models.JSONField(
        default=dict, blank=True,
        help_text='File-level metadata: page_count, word_count, language, dimensions, '
                  'ocr_confidence, is_scanned, has_images, has_tables, author, etc.',
    )

    # AI Extraction — Global (standard CLM fields extracted for every document)
    global_metadata = models.JSONField(
        default=dict, blank=True,
        help_text='Standard CLM fields (party names, dates, values, etc.) from GLOBAL_CLM_TEMPLATE',
    )
    global_confidence = models.JSONField(
        default=dict, blank=True,
        help_text='Per-field confidence scores for global_metadata',
    )

    # AI Extraction — Workflow-specific (fields from rule-node conditions)
    extracted_metadata = models.JSONField(
        default=dict, blank=True,
        help_text='Workflow-specific fields from rule-node conditions, used by filters',
    )
    extraction_confidence = models.JSONField(default=dict, blank=True)
    overall_confidence = models.FloatField(null=True, blank=True)

    # Track the template used for the last extraction — enables smart
    # re-extraction (only re-extract when new fields are added).
    last_extracted_template = models.JSONField(
        default=dict, blank=True,
        help_text='The extraction template used during the last extraction run',
    )

    extraction_status = models.CharField(
        max_length=20,
        choices=[
            ('pending', 'Pending'),
            ('processing', 'Processing'),
            ('completed', 'Completed'),
            ('failed', 'Failed'),
            ('archived', 'Archived'),
        ],
        default='pending',
    )

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )

    # Content-hash deduplication — SHA-256 of file bytes
    file_hash = models.CharField(
        max_length=64, blank=True, default='',
        db_index=True,
        help_text='SHA-256 hex digest of the uploaded file content for dedup',
    )

    # Email deduplication — RFC Message-ID header (globally unique per email)
    email_message_id = models.CharField(
        max_length=500, blank=True, default='',
        help_text='RFC Message-ID header for email dedup (e.g. <abc@mail.gmail.com>)',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'extraction_status']),
            models.Index(fields=['workflow', 'email_message_id']),
            models.Index(fields=['workflow', 'file_hash']),
        ]

    def __str__(self):
        return f"{self.title} ({self.workflow.name})"


# ---------------------------------------------------------------------------
# ExtractedField — central table for per-field metadata rows
# ---------------------------------------------------------------------------

class ExtractedField(models.Model):
    """
    Individual extracted metadata field stored as a row.
    Central table for efficient queries, dropdown options, and filtering.

    Each row = one field extracted from one document.
    Both global (standard CLM) and workflow-specific fields live here,
    distinguished by `source`.
    """

    class FieldSource(models.TextChoices):
        GLOBAL = 'global', 'Global (Standard CLM)'
        WORKFLOW = 'workflow', 'Workflow-specific'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        WorkflowDocument, on_delete=models.CASCADE, related_name='extracted_fields',
    )
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='extracted_fields',
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_extracted_fields',
    )

    # Field identity
    field_name = models.CharField(
        max_length=255, db_index=True,
        help_text='Snake_case field name (e.g., party_1_name, contract_value)',
    )
    source = models.CharField(
        max_length=10, choices=FieldSource.choices, default=FieldSource.GLOBAL,
    )

    # Values
    raw_value = models.TextField(
        blank=True, default='',
        help_text='Original value as returned by NuExtract model',
    )
    standardized_value = models.TextField(
        blank=True, default='',
        help_text='Standardized value (dates→YYYY-MM-DD, currency→decimal, etc.)',
    )
    display_value = models.TextField(
        blank=True, default='',
        help_text='Human-friendly display value',
    )

    # Confidence
    confidence = models.FloatField(default=0.0)
    needs_review = models.BooleanField(default=False)

    # Manual override
    is_manually_edited = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['field_name']
        unique_together = [('document', 'field_name', 'source')]
        indexes = [
            models.Index(fields=['workflow', 'field_name']),
            models.Index(fields=['organization', 'field_name']),
            models.Index(fields=['field_name', 'standardized_value']),
        ]

    def __str__(self):
        return f"{self.field_name}={self.standardized_value} ({self.document.title})"


# ---------------------------------------------------------------------------
# ActionPlugin — registry of available action plugins
# ---------------------------------------------------------------------------

class ActionPlugin(models.Model):
    """
    Registry of available action plugins that can be attached to action nodes.
    Each plugin defines a Python function that runs per-document in a for-loop.
    Plugins declare which fields they require from document metadata.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(
        max_length=100, unique=True,
        help_text='Machine-readable name: send_email, send_whatsapp, send_sms, etc.',
    )
    display_name = models.CharField(
        max_length=200,
        help_text='Human-friendly label: "Send Email", "Send WhatsApp Message"',
    )
    description = models.TextField(blank=True, default='')
    icon = models.CharField(
        max_length=10, default='⚡',
        help_text='Emoji or short icon identifier for frontend display',
    )
    category = models.CharField(
        max_length=50, default='communication',
        choices=[
            ('communication', 'Communication'),
            ('notification', 'Notification'),
            ('integration', 'Integration'),
            ('export', 'Export'),
            ('custom', 'Custom'),
        ],
    )

    # Which fields the plugin needs from the document metadata
    # e.g., ["email", "party_1_name", "contract_value"]
    required_fields = models.JSONField(
        default=list, blank=True,
        help_text='List of metadata field names this plugin needs to run',
    )
    # Optional fields the plugin can use but won't fail without
    optional_fields = models.JSONField(
        default=list, blank=True,
        help_text='Optional metadata fields the plugin can use',
    )

    # Plugin settings schema — defines configurable parameters
    # e.g., {"subject_template": {"type": "string", "default": "RE: {document_title}"}}
    settings_schema = models.JSONField(
        default=dict, blank=True,
        help_text='JSON schema for plugin-specific settings (subject template, message body, etc.)',
    )

    # Whether this plugin is active and available for use
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['display_name']

    def __str__(self):
        return self.display_name


# ---------------------------------------------------------------------------
# ActionExecution — tracks a batch of action executions on a node
# ---------------------------------------------------------------------------

class ActionExecution(models.Model):
    """
    Tracks one execution run of an action node.
    When an action node is executed, it loops over all incoming documents
    and runs the plugin for each one, creating ActionExecutionResult rows.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        COMPLETED = 'completed', 'Completed'
        PARTIAL = 'partial', 'Partial (some failed)'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='action_executions',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='action_executions',
    )
    plugin = models.ForeignKey(
        ActionPlugin, on_delete=models.CASCADE, related_name='executions',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING,
    )

    # Summary stats
    total_documents = models.PositiveIntegerField(default=0)
    sent_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)

    # Plugin settings used for this execution
    settings_used = models.JSONField(
        default=dict, blank=True,
        help_text='The plugin settings that were used for this execution run',
    )

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'node']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"{self.plugin.display_name} on {self.node.label} ({self.status})"


# ---------------------------------------------------------------------------
# ActionExecutionResult — per-document result of an action execution
# ---------------------------------------------------------------------------

class ActionExecutionResult(models.Model):
    """
    Result of running a plugin on a single document.
    status: sent | skipped | failed
    If 'skipped', missing_fields lists the required fields that were null/empty.
    If 'failed', error_message has the reason.
    Users can update missing data and retry individual results.
    """

    class Status(models.TextChoices):
        SENT = 'sent', 'Sent'
        SKIPPED = 'skipped', 'Skipped (missing data)'
        FAILED = 'failed', 'Failed'
        RETRIED = 'retried', 'Retried'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    execution = models.ForeignKey(
        ActionExecution, on_delete=models.CASCADE, related_name='results',
    )
    document = models.ForeignKey(
        WorkflowDocument, on_delete=models.CASCADE, related_name='action_results',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SKIPPED,
    )

    # Data extracted from document for the plugin
    extracted_data = models.JSONField(
        default=dict, blank=True,
        help_text='The data extracted from this document that was sent to the plugin',
    )

    # Missing fields — for skipped items, so user knows what to fill in
    missing_fields = models.JSONField(
        default=list, blank=True,
        help_text='List of required field names that were null/empty',
    )

    # Response/error
    plugin_response = models.JSONField(
        default=dict, blank=True,
        help_text='Response data from the plugin (message ID, delivery status, etc.)',
    )
    error_message = models.TextField(blank=True, default='')

    # Manual overrides — user can fill missing data and retry
    override_data = models.JSONField(
        default=dict, blank=True,
        help_text='User-provided data to override missing/incorrect extracted values',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'created_at']
        indexes = [
            models.Index(fields=['execution', 'status']),
        ]

    def __str__(self):
        return f"{self.document.title} → {self.status}"


# ---------------------------------------------------------------------------
# ListenerEvent — tracks events fired by listener nodes
# ---------------------------------------------------------------------------

class ListenerEvent(models.Model):
    """
    Records an event detected or created by a listener node.

    Listener nodes watch for triggers (document uploaded, field changed,
    approval requested, etc.) and either:
      - Auto-fire downstream nodes when conditions are met
      - Gate the workflow until a user approves/rejects
      - Log the event for audit

    trigger_type values (stored in node.config):
      - document_uploaded:     Fires when new docs are uploaded to the workflow
      - approval_required:     Pauses — waits for a user to approve/reject
      - field_changed:         Fires when a specific metadata field changes
      - all_documents_ready:   Fires when all docs have extraction_status=completed
      - document_count:        Fires when doc count reaches a threshold
      - manual:                Only fires when user clicks "Trigger" button
      - schedule:              Placeholder for future cron-like triggers
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending (awaiting action)'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        AUTO_FIRED = 'auto_fired', 'Auto-Fired (conditions met)'
        EXPIRED = 'expired', 'Expired'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='listener_events',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='listener_events',
    )

    # What triggered this event
    trigger_type = models.CharField(
        max_length=30,
        choices=[
            ('document_uploaded', 'Document Uploaded'),
            ('approval_required', 'Approval Required'),
            ('field_changed', 'Field Changed'),
            ('all_documents_ready', 'All Documents Ready'),
            ('document_count', 'Document Count Threshold'),
            ('manual', 'Manual Trigger'),
            ('schedule', 'Scheduled'),
        ],
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING,
    )

    # Which documents are involved in this event
    document_ids = models.JSONField(
        default=list, blank=True,
        help_text='List of document UUIDs involved in this event',
    )
    document_count = models.PositiveIntegerField(default=0)

    # Event details & context
    event_data = models.JSONField(
        default=dict, blank=True,
        help_text='Additional context: {field_name, old_value, new_value, trigger_detail, ...}',
    )
    message = models.TextField(
        blank=True, default='',
        help_text='Human-readable description of the event',
    )

    # Approval tracking
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_listener_events',
        help_text='User who approved/rejected this event',
    )
    resolution_note = models.TextField(
        blank=True, default='',
        help_text='Optional note when approving/rejecting',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    # Did this event trigger downstream execution?
    downstream_executed = models.BooleanField(
        default=False,
        help_text='Whether downstream nodes were executed as a result',
    )
    execution_result = models.JSONField(
        default=dict, blank=True,
        help_text='Result from downstream execution, if any',
    )

    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='triggered_listener_events',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'status']),
            models.Index(fields=['node', 'status']),
            models.Index(fields=['trigger_type', 'status']),
        ]

    def __str__(self):
        return f"{self.trigger_type} on {self.node.label} — {self.status}"


# ---------------------------------------------------------------------------
# ValidatorUser — assigns a user to a validator node
# ---------------------------------------------------------------------------

class ValidatorUser(models.Model):
    """
    Maps a user to a validator node so they can approve/reject documents.
    The validator node config stores name + description.
    Approval rule: if ANY one assigned user approves → document approved.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='validator_users',
    )
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='validator_users',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='clm_validator_assignments',
    )
    role_label = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Display label: "Legal Counsel", "VP Operations"',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('node', 'user')]
        ordering = ['created_at']

    def __str__(self):
        name = self.user.get_full_name() or self.user.username
        return f"{name} → {self.node.label}"


# ---------------------------------------------------------------------------
# ValidationDecision — per-document per-user approval record
# ---------------------------------------------------------------------------

class ValidationDecision(models.Model):
    """
    Tracks one validator's decision on one document.
    When a validator node is reached during execution, a pending
    decision row is created for every (document × assigned user).
    If ANY assigned user approves → document is approved and flows
    downstream.  If ALL reject → document is rejected.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        SKIPPED = 'skipped', 'Skipped'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='validation_decisions',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='validation_decisions',
    )
    document = models.ForeignKey(
        WorkflowDocument, on_delete=models.CASCADE, related_name='validation_decisions',
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='clm_pending_validations',
        help_text='The user who needs to make this decision',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING,
    )
    note = models.TextField(
        blank=True, default='',
        help_text='Validator comment / reason',
    )

    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        unique_together = [('node', 'document', 'assigned_to')]
        indexes = [
            models.Index(fields=['assigned_to', 'status']),
            models.Index(fields=['workflow', 'status']),
            models.Index(fields=['node', 'document', 'status']),
        ]

    def __str__(self):
        name = self.assigned_to.get_full_name() or self.assigned_to.username
        return f"{name} → {self.document.title} [{self.status}]"


# ---------------------------------------------------------------------------
# WorkflowExecution — persisted execution history
# ---------------------------------------------------------------------------

class WorkflowExecution(models.Model):
    """
    Persisted record of every workflow execution.
    Stores the full results so users can review history, compare runs,
    and track what happened in each execution.
    """

    class Status(models.TextChoices):
        RUNNING = 'running', 'Running'
        COMPLETED = 'completed', 'Completed'
        PARTIAL = 'partial', 'Partial'
        FAILED = 'failed', 'Failed'

    class Mode(models.TextChoices):
        FULL = 'full', 'Full (all documents)'
        BATCH = 'batch', 'Batch (selected documents)'
        SINGLE = 'single', 'Single document'
        AUTO = 'auto', 'Auto (on upload)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='executions',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.RUNNING,
    )
    mode = models.CharField(
        max_length=10, choices=Mode.choices, default=Mode.FULL,
    )

    # What documents were included/excluded
    total_documents = models.PositiveIntegerField(default=0)
    included_document_ids = models.JSONField(
        default=list, blank=True,
        help_text='Document UUIDs that were included in this execution',
    )
    excluded_document_ids = models.JSONField(
        default=list, blank=True,
        help_text='Document UUIDs that were explicitly excluded',
    )
    output_document_ids = models.JSONField(
        default=list, blank=True,
        help_text='Final output document UUIDs after all filtering',
    )

    # Full execution result (the entire dict from execute_workflow)
    result_data = models.JSONField(
        default=dict, blank=True,
        help_text='Full execution result: node_results, action_results, etc.',
    )

    # Per-node summary for quick display
    node_summary = models.JSONField(
        default=list, blank=True,
        help_text='[{node_id, node_type, label, count, status}, ...]',
    )

    # Timing
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )

    class Meta:
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['workflow', 'status']),
            models.Index(fields=['mode']),
        ]

    def __str__(self):
        return f"{self.workflow.name} — {self.mode} ({self.status}) @ {self.started_at}"


# ---------------------------------------------------------------------------
# DocumentExecutionRecord — per-document execution tracking for smart mode
# ---------------------------------------------------------------------------

class DocumentExecutionRecord(models.Model):
    """
    Tracks whether a specific document has already been executed under
    a specific workflow configuration (nodes_config_hash).

    Smart execution uses this to skip documents that haven't changed
    and whose workflow config hasn't changed since the last run.
    When nodes change (new hash), all records become stale and docs
    are re-executed.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='execution_records',
    )
    document = models.ForeignKey(
        WorkflowDocument, on_delete=models.CASCADE, related_name='execution_records',
    )

    # The file content hash at time of execution
    file_hash = models.CharField(
        max_length=64,
        help_text='SHA-256 of the document file content when executed',
    )

    # The workflow config hash at time of execution
    nodes_config_hash = models.CharField(
        max_length=64,
        help_text='Workflow nodes_config_hash when this doc was executed',
    )

    # Link to the full execution record
    execution = models.ForeignKey(
        WorkflowExecution, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='document_records',
    )

    status = models.CharField(
        max_length=20,
        choices=[
            ('completed', 'Completed'),
            ('failed', 'Failed'),
            ('skipped', 'Skipped'),
        ],
        default='completed',
    )

    # Snapshot of this doc's per-node results (lightweight)
    result_snapshot = models.JSONField(
        default=dict, blank=True,
        help_text='Per-node output summary for this document in this execution',
    )

    executed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-executed_at']
        indexes = [
            models.Index(fields=['workflow', 'file_hash']),
            models.Index(fields=['workflow', 'nodes_config_hash']),
            models.Index(fields=['workflow', 'document']),
        ]
        # One record per doc per config hash per workflow
        unique_together = [('workflow', 'document', 'nodes_config_hash')]

    def __str__(self):
        return f"ExecRecord {self.document_id} @ {self.nodes_config_hash[:12]}…"


# ---------------------------------------------------------------------------
# AI Prompt Cache — avoid duplicate LLM calls for identical prompts
# ---------------------------------------------------------------------------

class AIPromptCache(models.Model):
    """
    Caches AI model responses keyed by a SHA-256 hash of
    (model_id + system_prompt + document_context).

    When the same prompt+document combination is sent to the same model,
    the cached response is returned instantly — saving API costs and time.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    prompt_hash = models.CharField(
        max_length=64, unique=True, db_index=True,
        help_text='SHA-256 hex digest of model_id + full_system_prompt + document_context',
    )
    model_id = models.CharField(max_length=100)
    output_format = models.CharField(
        max_length=20, default='text',
        help_text='json_extract | yes_no | text',
    )

    # The raw LLM response text
    response_text = models.TextField()

    # Parsed result (for quick lookup without re-parsing)
    parsed_result = models.JSONField(
        default=dict, blank=True,
        help_text='Pre-parsed result: {answer, parsed_fields, response, ...}',
    )

    # Stats
    hit_count = models.PositiveIntegerField(default=0)
    last_hit_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['model_id']),
        ]
        verbose_name = 'AI Prompt Cache'
        verbose_name_plural = 'AI Prompt Cache Entries'

    def __str__(self):
        return f"Cache {self.prompt_hash[:12]}… ({self.model_id}) hits={self.hit_count}"


# ---------------------------------------------------------------------------
# DerivedField — AI-computed metadata that NuExtract cannot extract
# ---------------------------------------------------------------------------

class DerivedField(models.Model):
    """
    A derived / computed metadata field that cannot be directly extracted
    by NuExtract (NER-based extraction).

    Examples:
      - Resume: "total_experience" computed by summing all work durations
      - Contract: "risk_score" computed by analysing clause language
      - Invoice: "days_until_due" computed from invoice_date and due_date
      - Any doc: "document_quality_score" from formatting/completeness analysis

    DerivedFields are defined per-workflow. When the AI node runs in
    'derived' output_format mode, it auto-generates a system prompt that
    instructs the LLM to compute these fields from the already-extracted
    metadata + document text.

    The 'computation_hint' tells the LLM *how* to compute the value:
      - "Sum all work experience durations to get total years"
      - "Calculate the difference between due_date and invoice_date in days"
      - "Score from 1-10 based on clause protectiveness for the buyer"
      - "Categorise the candidate's seniority: junior/mid/senior/lead/executive"

    The 'depends_on' list references other metadata fields (from NuExtract
    or previous AI nodes) that this field needs as input.  The executor
    includes those values in the AI prompt automatically.

    Results are merged into the document's extracted_metadata, just like
    json_extract fields — so downstream Rule nodes can filter on them.
    """

    class FieldType(models.TextChoices):
        STRING = 'string', 'String'
        NUMBER = 'number', 'Number'
        BOOLEAN = 'boolean', 'Boolean'
        DATE = 'date', 'Date'
        LIST = 'list', 'List'
        CATEGORY = 'category', 'Category'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='derived_fields',
    )
    name = models.CharField(
        max_length=255,
        help_text='Snake_case field name (e.g., total_experience, risk_score)',
    )
    display_name = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Human-friendly label (e.g., "Total Experience (Years)")',
    )
    field_type = models.CharField(
        max_length=20, choices=FieldType.choices, default=FieldType.STRING,
    )
    description = models.TextField(
        blank=True, default='',
        help_text='What this derived field represents',
    )
    computation_hint = models.TextField(
        help_text='Instructions for the AI on HOW to compute this field. '
                  'E.g. "Sum all work experience durations to get total years of experience"',
    )
    depends_on = models.JSONField(
        default=list, blank=True,
        help_text='List of metadata field names this derived field needs as input. '
                  'E.g. ["work_experience_1_duration", "work_experience_2_duration"]',
    )
    # Optional: allowed values for 'category' type
    allowed_values = models.JSONField(
        default=list, blank=True,
        help_text='For category type: list of allowed values. '
                  'E.g. ["junior", "mid", "senior", "lead", "executive"]',
    )
    # Whether to include the full document text or just metadata in the AI prompt
    include_document_text = models.BooleanField(
        default=False,
        help_text='If True, includes the full document text in the AI prompt. '
                  'Useful for fields that need deeper analysis beyond extracted metadata.',
    )
    # Ordering for deterministic processing
    order = models.PositiveIntegerField(
        default=0,
        help_text='Processing order — fields are computed sequentially so '
                  'later fields can depend on earlier derived fields.',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'created_at']
        unique_together = [('workflow', 'name')]
        indexes = [
            models.Index(fields=['workflow', 'order']),
        ]

    def __str__(self):
        return f"{self.display_name or self.name} ({self.workflow.name})"


# ---------------------------------------------------------------------------
# WorkflowChatMessage — AI assistant conversation for workflow editing
# ---------------------------------------------------------------------------

class WorkflowChatMessage(models.Model):
    """
    Persists conversation history between the user and the AI workflow
    assistant.  The assistant can read the workflow's current state
    (nodes, connections, derived fields, config) and return structured
    actions that mutate the workflow — e.g. adding nodes, setting
    conditions, creating connections, configuring AI nodes.

    Each message is either from the 'user' or the 'assistant'.
    Assistant messages store the structured actions that were applied
    so the conversation doubles as an audit log of AI-driven changes.
    """

    class Role(models.TextChoices):
        USER = 'user', 'User'
        ASSISTANT = 'assistant', 'Assistant'
        SYSTEM = 'system', 'System'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='chat_messages',
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField(
        help_text='The user message or the assistant reply text',
    )

    # For assistant messages: the structured actions that were proposed/applied
    actions = models.JSONField(
        default=list, blank=True,
        help_text='List of structured actions: [{action, params, result}, ...]',
    )
    actions_applied = models.BooleanField(
        default=False,
        help_text='Whether the proposed actions were actually applied to the workflow',
    )

    # AI metadata
    model_used = models.CharField(max_length=100, blank=True, default='')
    token_usage = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['workflow', 'created_at']),
        ]

    def __str__(self):
        preview = self.content[:60] + '…' if len(self.content) > 60 else self.content
        return f"[{self.role}] {preview}"


# ---------------------------------------------------------------------------
# WorkflowUploadLink — Shareable public upload page
# ---------------------------------------------------------------------------

class WorkflowUploadLink(models.Model):
    """
    A shareable link that allows anyone (no auth) to upload documents
    to a specific workflow.  Each link has a unique UUID token used in
    the public URL:  /upload/<token>
    """

    class LoginRequired(models.TextChoices):
        NONE      = 'none', 'No login required'
        EMAIL_OTP = 'email_otp', 'Email OTP verification'
        PHONE_OTP = 'phone_otp', 'Phone OTP verification'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='upload_links',
    )
    label = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Optional label, e.g. "Vendor portal" or "Client intake"',
    )
    is_active = models.BooleanField(default=True)

    # Authentication / verification
    require_login = models.CharField(
        max_length=20, choices=LoginRequired.choices,
        default=LoginRequired.NONE,
        help_text='Whether uploaders must verify identity via OTP before uploading.',
    )

    # Optional constraints
    password = models.CharField(
        max_length=128, blank=True, default='',
        help_text='If set, uploaders must enter this password before uploading.',
    )
    expires_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Link expires after this datetime. Null = never expires.',
    )
    max_uploads = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Max number of upload sessions. Null = unlimited.',
    )
    upload_count = models.PositiveIntegerField(default=0)

    # Restrict to specific input node (optional)
    input_node = models.ForeignKey(
        WorkflowNode, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='upload_links',
        help_text='If set, uploads go to this specific input node.',
    )

    # Tracking
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"UploadLink({self.token}) → {self.workflow.name}"

    @property
    def is_expired(self):
        if self.expires_at and timezone.now() > self.expires_at:
            return True
        return False

    @property
    def is_at_limit(self):
        if self.max_uploads and self.upload_count >= self.max_uploads:
            return True
        return False

    @property
    def is_usable(self):
        return self.is_active and not self.is_expired and not self.is_at_limit


# ---------------------------------------------------------------------------
# UploadLinkOTP — One-time-password for public upload verification
# ---------------------------------------------------------------------------

class UploadLinkOTP(models.Model):
    """
    Stores OTP codes sent to uploaders for email/phone verification.
    Each OTP is valid for 10 minutes and can be attempted up to 5 times.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    upload_link = models.ForeignKey(
        WorkflowUploadLink, on_delete=models.CASCADE, related_name='otps',
    )
    identifier = models.CharField(
        max_length=255,
        help_text='Email address or phone number the OTP was sent to.',
    )
    code = models.CharField(max_length=6)
    is_verified = models.BooleanField(default=False)
    attempts = models.PositiveIntegerField(default=0)
    session_token = models.UUIDField(
        default=uuid.uuid4, unique=True,
        help_text='Returned after verification — used as bearer for upload.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"OTP({self.identifier}) → {self.upload_link.token}"

    @property
    def is_expired_otp(self):
        from datetime import timedelta
        return timezone.now() > self.created_at + timedelta(minutes=10)

    @property
    def is_max_attempts(self):
        return self.attempts >= 5


# ---------------------------------------------------------------------------
# DocumentCreationResult — tracks documents created by doc_create nodes
# ---------------------------------------------------------------------------

class DocumentCreationResult(models.Model):
    """
    Per-CLM-document result of running a doc_create node.

    When a doc_create node executes it loops over every incoming
    WorkflowDocument and creates (or duplicates) an editor Document
    from the extracted metadata.  This model records each result
    so the frontend can show status, link to the created document,
    and allow retries for failed items.

    creation_mode values (from node.config):
      • template       — create from DocumentTemplate (service_agreement, nda, etc.)
      • duplicate      — deep-clone an existing editor Document with metadata overrides
      • quick_latex    — create a Quick LaTeX document with metadata placeholders
      • structured     — create a structured document from section definitions
    """

    class Status(models.TextChoices):
        CREATED = 'created', 'Created'
        SKIPPED = 'skipped', 'Skipped (missing data)'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='doc_creation_results',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='doc_creation_results',
    )

    # Source CLM document whose metadata drove the creation
    source_clm_document = models.ForeignKey(
        WorkflowDocument, on_delete=models.CASCADE,
        related_name='created_editor_documents',
    )

    # The editor Document that was created (null if skipped/failed)
    created_document = models.ForeignKey(
        'documents.Document', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='clm_creation_records',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.CREATED,
    )
    creation_mode = models.CharField(
        max_length=20, default='template',
        choices=[
            ('template', 'From Template'),
            ('duplicate', 'Duplicate Existing'),
            ('quick_latex', 'Quick LaTeX'),
            ('structured', 'Structured'),
        ],
    )

    # The metadata that was used to create the document
    metadata_used = models.JSONField(
        default=dict, blank=True,
        help_text='Extracted metadata that was mapped into the editor document',
    )
    # For skipped items — which required fields were missing
    missing_fields = models.JSONField(
        default=list, blank=True,
    )
    error_message = models.TextField(blank=True, default='')

    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'node']),
            models.Index(fields=['source_clm_document']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        doc_title = self.created_document.title if self.created_document else '(none)'
        return f"{self.source_clm_document.title} → {doc_title} [{self.status}]"
