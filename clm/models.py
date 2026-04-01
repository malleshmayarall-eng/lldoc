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
    When created/saved, all field names from rule/AI/doc_create nodes
    are collected and used as the extraction template automatically.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_workflows',
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)

    # Auto-generated extraction template from rule/AI/doc_create node field names
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
    team = models.ForeignKey(
        'user_management.Team', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='clm_workflows',
        help_text='Optional team that manages this workflow',
    )
    last_executed_at = models.DateTimeField(null=True, blank=True)

    # Auto-execution: run workflow automatically when documents are uploaded
    auto_execute_on_upload = models.BooleanField(
        default=False,
        help_text='Automatically execute the workflow when new documents are uploaded',
    )

    # Live mode: when True, a periodic Celery Beat task continuously
    # re-executes this workflow asynchronously (every 60 s by default).
    # Each execution runs as an independent Celery task (function).
    is_live = models.BooleanField(
        default=False,
        help_text='When True, the workflow auto-executes periodically via Celery Beat',
    )
    live_interval = models.PositiveIntegerField(
        default=60,
        help_text='Live execution interval in seconds (default 60)',
    )

    # Compilation status — set by compile_workflow()
    compilation_status = models.CharField(
        max_length=20,
        choices=[
            ('not_compiled', 'Not Compiled'),
            ('compiled', 'Compiled'),
            ('stale', 'Stale (nodes changed since last compile)'),
            ('failed', 'Compilation Failed'),
        ],
        default='not_compiled',
        help_text='Whether this workflow has been successfully compiled for live execution',
    )
    compiled_at = models.DateTimeField(
        null=True, blank=True,
        help_text='When the workflow was last successfully compiled',
    )
    compilation_errors = models.JSONField(
        default=list, blank=True,
        help_text='Errors from the last compilation attempt',
    )

    # Smart execution: hash of all node configs + connections
    # When this changes, all documents need re-execution.
    nodes_config_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='SHA-256 of all node configs + connections. Changes = re-execute all.',
    )

    # ── Persistent execution state (server-maintained for frontend) ────
    class ExecutionState(models.TextChoices):
        IDLE = 'idle', 'Idle'
        COMPILING = 'compiling', 'Compiling DAG'
        EXECUTING = 'executing', 'Executing nodes'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'

    execution_state = models.CharField(
        max_length=20, choices=ExecutionState.choices, default=ExecutionState.IDLE,
        help_text='Current execution lifecycle state — maintained by executor, read by frontend.',
    )
    current_execution_id = models.UUIDField(
        null=True, blank=True,
        help_text='ID of the currently active WorkflowExecution (null when idle).',
    )

    # ── Workflow-level settings (adjustable from frontend Settings panel) ──
    workflow_settings = models.JSONField(
        default=dict, blank=True,
        help_text='''Workflow-level configuration. Schema:
        {
          "validation": {
            "approval_rule": "any"|"all"|"majority",   // any=first approve wins, all=unanimous, majority=50%+1
            "require_note": false,                      // force validators to add a note
            "auto_approve_timeout_hours": null,          // auto-approve after N hours (null=disabled)
            "notification_channels": ["in_app", "email"] // where to notify validators
          },
          "execution": {
            "retry_on_failure": false,
            "max_retries": 3,
            "retry_delay_seconds": 60,
            "notify_on_complete": true,
            "notify_on_failure": true,
            "timeout_minutes": null,                     // max execution time (null=unlimited)
            "parallel_nodes": true                       // execute independent nodes in parallel
          },
          "general": {
            "description_long": "",
            "tags": [],
            "color": "",                                 // workflow accent color
            "icon": ""                                   // workflow icon
          }
        }''',
    )

    # ── Event-driven mode ──────────────────────────────────────────────
    class TriggerMode(models.TextChoices):
        MANUAL = 'manual', 'Manual Only'
        EVENT = 'event', 'Event-Driven'
        SCHEDULED = 'scheduled', 'Scheduled'
        HYBRID = 'hybrid', 'Hybrid (Manual + Events)'

    trigger_mode = models.CharField(
        max_length=20, choices=TriggerMode.choices, default=TriggerMode.MANUAL,
        help_text='How this workflow is triggered: manual, event-driven, scheduled, or hybrid',
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
        workflow, then build the extraction JSON template.  Derived
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
        DEPRECATED — document_type on input nodes is no longer used.
        Extraction is handled by dedicated AI extract nodes.
        Kept for backwards compatibility; always returns empty string.
        """
        return ''

    @property
    def document_types(self) -> dict:
        """
        DEPRECATED — document_type on input nodes is no longer used.
        Extraction is handled by dedicated AI extract nodes.
        Kept for backwards compatibility; always returns empty dict.
        """
        return {}

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

    def on_canvas_changed(self, rebuild_template=True, clear_stale_results=True):
        """
        Call this whenever the DAG changes — node created, updated,
        deleted, or connection added/removed.

        1. Rebuilds extraction_template from current canvas nodes
           (rule + AI + doc_create + derived fields).
        2. Recomputes nodes_config_hash so smart execution knows
           the config has changed and docs need re-processing.
        3. Optionally clears stale last_result on all nodes so
           the frontend doesn't show outdated execution data.
        4. Marks compilation_status as 'stale' if it was 'compiled'.

        This ensures the workflow always reflects the CANVAS state,
        not cached/stale processing data.
        """
        if rebuild_template:
            self.rebuild_extraction_template()

        old_hash = self.nodes_config_hash
        new_hash = self.compute_nodes_config_hash(save=True)

        config_changed = old_hash and old_hash != new_hash

        if config_changed and clear_stale_results:
            # Clear stale per-node execution caches so the next
            # execution starts fresh.  The execution itself will
            # repopulate last_result on each node.
            self.nodes.all().update(last_result={})

        # Mark compilation stale so live mode re-compiles
        if config_changed and self.compilation_status == 'compiled':
            self.compilation_status = 'stale'
            self.save(update_fields=['compilation_status', 'updated_at'])


# ---------------------------------------------------------------------------
# WorkflowNode — only 3 types
# ---------------------------------------------------------------------------

class WorkflowNode(models.Model):
    """
    A node in the workflow graph.  Eleven types exist:

    - input:       Starting point — documents are uploaded here
    - rule:        Metadata filter node with conditions
    - listener:    Watches inboxes/folders, triggers workflow for single documents
    - validator:   Multi-level approval gate — assigned users approve/reject documents
    - action:      Executes a plugin (email, WhatsApp, SMS, etc.) for each document
    - ai:          AI model processing (Gemini/ChatGPT) for each document
    - and_gate:    Logic gate — passes docs only when ALL upstream paths deliver them (intersection)
    - scraper:     Scrapes allowed websites for keywords, enriches doc metadata
    - doc_create:  Creates / duplicates editor documents from CLM metadata
    - sheet:       Reads from or writes to a linked Sheet (input/storage mode)
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
        SHEET = 'sheet', 'Sheet'
        EXTRACT = 'extract', 'Extractor'
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

    # Per-node document state (primarily for input nodes).
    # Tracks which documents belong to this node, their status, and
    # readiness so the executor can read directly from node state
    # rather than querying by source tags.
    #
    # Schema for input nodes:
    # {
    #   "document_ids": ["uuid", ...],         // all doc IDs owned by this node
    #   "ready_ids":    ["uuid", ...],         // docs ready for execution (completed extraction)
    #   "pending_ids":  ["uuid", ...],         // docs still extracting / pending
    #   "failed_ids":   ["uuid", ...],         // docs that failed extraction
    #   "total_count":  N,
    #   "ready_count":  N,
    #   "pending_count": N,
    #   "failed_count": N,
    #   "last_upload_at": "ISO datetime",
    #   "last_refresh_at": "ISO datetime",
    # }
    document_state = models.JSONField(
        default=dict, blank=True,
        help_text='Per-node document ownership & readiness state',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position_x', 'created_at']

    def __str__(self):
        return f"{self.label or self.get_node_type_display()} ({self.workflow.name})"

    def sync_document_state(self):
        """
        Rebuild document_state from the actual WorkflowDocument rows
        that reference this node via input_node FK.  Call this after
        uploads, deletes, or re-extractions to keep the JSON in sync.

        For email_inbox nodes, also rebuilds the ``email_state`` sub-dict
        which caches every seen RFC Message-ID so that subsequent IMAP
        polls can skip already-processed emails without a DB query.

        Uses ``refresh_from_db`` to get the latest persisted state before
        merging, and wraps the write in ``transaction.atomic`` to prevent
        concurrent callers from overwriting each other's email_state or
        cumulative counters.
        """
        from django.db import transaction
        from django.utils import timezone as _tz

        is_email = (
            self.node_type == 'input'
            and (self.config or {}).get('source_type') == 'email_inbox'
        )

        if is_email:
            docs = WorkflowDocument.objects.filter(
                input_node=self,
            ).values_list('id', 'extraction_status', 'email_message_id')
        else:
            docs = WorkflowDocument.objects.filter(
                input_node=self,
            ).values_list('id', 'extraction_status')

        all_ids, ready, pending, failed = [], [], [], []
        seen_message_ids = set()

        for row in docs:
            doc_id, ext_status = row[0], row[1]
            sid = str(doc_id)
            all_ids.append(sid)
            if ext_status == 'completed':
                ready.append(sid)
            elif ext_status in ('pending', 'processing'):
                pending.append(sid)
            elif ext_status == 'failed':
                failed.append(sid)
            if is_email and len(row) > 2 and row[2]:
                seen_message_ids.add(row[2])

        with transaction.atomic():
            # Re-read the latest persisted state inside the atomic block
            # so we don't clobber concurrent writes (email polls, uploads).
            self.refresh_from_db(fields=['document_state'])
            prev = self.document_state or {}

            self.document_state = {
                'document_ids': all_ids,
                'ready_ids': ready,
                'pending_ids': pending,
                'failed_ids': failed,
                'total_count': len(all_ids),
                'ready_count': len(ready),
                'pending_count': len(pending),
                'failed_count': len(failed),
                'last_upload_at': prev.get('last_upload_at', ''),
                'last_refresh_at': prev.get('last_refresh_at', ''),
            }

            if is_email:
                prev_email = prev.get('email_state', {})
                self.document_state['email_state'] = {
                    'seen_message_ids': sorted(seen_message_ids),
                    'seen_count': len(seen_message_ids),
                    'total_emails_ingested': len(all_ids),
                    'last_checked_at': prev_email.get('last_checked_at', ''),
                    'last_found': prev_email.get('last_found', 0),
                    'last_skipped': prev_email.get('last_skipped', 0),
                    'cumulative_found': prev_email.get('cumulative_found', 0),
                    'cumulative_skipped': prev_email.get('cumulative_skipped', 0),
                }

            self.save(update_fields=['document_state'])


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
        help_text='Original value as returned by AI extraction',
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
        QUEUED = 'queued', 'Queued'
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

    # Trigger context — event payload that initiated this execution.
    # For sheet-triggered executions this contains changed_row_ids,
    # changed_row_orders, etc. so the executor can process only the
    # rows that actually changed instead of re-reading every row.
    trigger_context = models.JSONField(
        default=dict, blank=True,
        help_text='Event payload that triggered this execution (changed rows, source info, etc.)',
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

    # Snapshot of the workflow configuration at execution time.
    # Captures the DAG shape, node configs, extraction template, and
    # nodes_config_hash so that past runs are fully reproducible even
    # after the canvas is later modified.
    config_snapshot = models.JSONField(
        default=dict, blank=True,
        help_text='Frozen copy of workflow config at execution time: '
                  'nodes, connections, extraction_template, nodes_config_hash',
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
# DerivedField — AI-computed metadata beyond basic extraction
# ---------------------------------------------------------------------------

class DerivedField(models.Model):
    """
    A derived / computed metadata field that cannot be directly extracted
    by simple AI extraction (label-based extraction).

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

    The 'depends_on' list references other metadata fields (from AI extraction
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


# ---------------------------------------------------------------------------
# InputNodeHistory — tracks every input operation on an input node
# ---------------------------------------------------------------------------

class InputNodeHistory(models.Model):
    """
    Records each input operation (upload batch, folder import, sheet import,
    bulk upload, DMS import, OCR re-run, etc.) performed on an input node.

    The frontend uses this to:
      - Show "Previous Inputs" panel on input nodes
      - Allow re-running / refreshing specific input batches
      - Track which documents came from which operation

    source_type values:
      • upload          — manual file upload (one or more files / ZIP)
      • folder_upload   — import from DriveFolder (fileshare app)
      • dms_import      — import from DMS documents
      • bulk_upload     — bulk file upload (large batch)
      • sheets          — import from a Sheet (sheets app)
      • email_inbox     — auto-ingested from email
      • google_drive    — fetched from Google Drive
      • dropbox         — fetched from Dropbox
      • onedrive        — fetched from OneDrive
      • s3              — fetched from S3
      • ftp             — fetched from FTP/SFTP
      • url_scrape      — fetched from URLs
      • table           — table/spreadsheet file parsed into row-documents

    Only 'upload' and 'bulk_upload' types support "Manage Already Uploaded"
    (re-OCR, re-extract). Folder/sheets/cloud sources support "Refresh"
    (re-fetch from source).
    """

    class SourceType(models.TextChoices):
        UPLOAD = 'upload', 'Upload'
        FOLDER_UPLOAD = 'folder_upload', 'Folder Upload'
        DMS_IMPORT = 'dms_import', 'DMS Import'
        BULK_UPLOAD = 'bulk_upload', 'Bulk Upload'
        SHEETS = 'sheets', 'Sheets Import'
        DOCUMENT = 'document', 'Document Update'
        EMAIL_INBOX = 'email_inbox', 'Email Inbox'
        GOOGLE_DRIVE = 'google_drive', 'Google Drive'
        DROPBOX = 'dropbox', 'Dropbox'
        ONEDRIVE = 'onedrive', 'OneDrive'
        S3 = 's3', 'S3'
        FTP = 'ftp', 'FTP'
        URL_SCRAPE = 'url_scrape', 'URL Scrape'
        TABLE = 'table', 'Table/Spreadsheet'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        COMPLETED = 'completed', 'Completed'
        PARTIAL = 'partial', 'Partial (some failed)'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='input_histories',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='input_histories',
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_input_histories',
    )

    source_type = models.CharField(
        max_length=20, choices=SourceType.choices, default=SourceType.UPLOAD,
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.COMPLETED,
    )

    # Summary stats
    document_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)

    # Documents created/imported in this operation
    document_ids = models.JSONField(
        default=list, blank=True,
        help_text='List of WorkflowDocument UUIDs created in this input operation',
    )

    # Source reference — what was the source of this import?
    source_reference = models.JSONField(
        default=dict, blank=True,
        help_text='Source details: folder_id, sheet_id, file_names, email_subject, etc.',
    )

    # Extra metadata about the operation
    details = models.JSONField(
        default=dict, blank=True,
        help_text='Extra details: duplicates_skipped, zip_expanded, errors, etc.',
    )

    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'node']),
            models.Index(fields=['node', 'source_type']),
            models.Index(fields=['organization', '-created_at']),
        ]

    def __str__(self):
        return (
            f"{self.get_source_type_display()} → {self.node.label or 'Input'} "
            f"({self.document_count} docs, {self.status})"
        )

    @property
    def supports_refresh(self):
        """Whether this source type supports re-fetching from source."""
        return self.source_type in (
            'folder_upload', 'dms_import', 'sheets', 'email_inbox',
            'google_drive', 'dropbox', 'onedrive', 's3', 'ftp',
            'url_scrape', 'table',
        )

    @property
    def supports_manage_uploaded(self):
        """Whether this source type supports re-OCR / re-extract on existing docs."""
        return self.source_type in ('upload', 'bulk_upload')


# ---------------------------------------------------------------------------
# SheetNodeQuery — tracks row-level queries for sheet nodes (with cache)
# ---------------------------------------------------------------------------

class SheetNodeQuery(models.Model):
    """
    Tracks every row read/written by a sheet workflow node.

    Each workflow execution that touches a sheet node records a query
    per row processed.  This enables:
      - Usage metering: row operations ≈ "queries"
      - Cache-based dedup: if the same data is written to the same row
        with matching content_hash, the write is skipped (cache hit).
      - Audit trail: who wrote what, when, from which execution.

    Cache system mirrors AIPromptCache:
      - content_hash = SHA-256 of the row payload being written
      - If a query with the same (node, sheet, row_order, content_hash)
        exists and status=completed, the write is skipped → cache hit.
    """

    class Operation(models.TextChoices):
        READ = 'read', 'Read'
        WRITE = 'write', 'Write'
        APPEND = 'append', 'Append'
        UPSERT = 'upsert', 'Upsert (unique-key match)'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        COMPLETED = 'completed', 'Completed'
        CACHED = 'cached', 'Cached (skipped — duplicate)'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='sheet_queries',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='sheet_queries',
    )
    execution = models.ForeignKey(
        WorkflowExecution, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='sheet_queries',
    )
    sheet = models.ForeignKey(
        'sheets.Sheet', on_delete=models.CASCADE, related_name='node_queries',
    )

    operation = models.CharField(
        max_length=10, choices=Operation.choices, default=Operation.WRITE,
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING,
    )

    # Which row was touched (null for append — new row created)
    row_order = models.IntegerField(
        null=True, blank=True,
        help_text='Row order in the sheet (null for newly appended rows)',
    )
    row_id = models.UUIDField(
        null=True, blank=True,
        help_text='SheetRow UUID that was read/written',
    )

    # Source document (if write originated from a workflow document)
    source_document = models.ForeignKey(
        WorkflowDocument, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='sheet_queries',
    )

    # Content hash for cache dedup
    content_hash = models.CharField(
        max_length=64, blank=True, default='',
        db_index=True,
        help_text='SHA-256 of the row payload — used for write dedup cache',
    )

    # The actual data read or written
    row_data = models.JSONField(
        default=dict, blank=True,
        help_text='Cell values: {"col_key": "value", ...}',
    )

    # Cache stats
    hit_count = models.PositiveIntegerField(
        default=0,
        help_text='Number of times this exact write was deduplicated',
    )
    last_hit_at = models.DateTimeField(null=True, blank=True)

    error_message = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['node', 'sheet', 'content_hash']),
            models.Index(fields=['workflow', 'execution']),
            models.Index(fields=['sheet', 'operation']),
        ]

    def __str__(self):
        return (
            f"SheetQuery({self.operation}) row={self.row_order} "
            f"sheet={self.sheet.id} [{self.status}]"
        )


# ---------------------------------------------------------------------------
# InputNodeRow — persistent per-input-node row tracking with hashes
# ---------------------------------------------------------------------------

class InputNodeRow(models.Model):
    """
    Tracks every row that an input node (or sheet-input node) has ingested
    into the workflow, along with the content hash at the time of ingestion.

    This is the **master dedup table** for input nodes with sheet/table
    sources.  Instead of loading ALL rows from a sheet and comparing
    hashes in Python on every execution, the executor can:

      1. Query ``InputNodeRow`` for the node's known rows + hashes
      2. Compare with the current ``SheetRow.row_hash`` values at the
         SQL/Python level to find only NEW or CHANGED rows
      3. Skip unchanged rows entirely — they never hit Python

    Decision matrix per row:

      | InputNodeRow exists? | Hash matches? | Action            |
      |:--------------------:|:------------:|:------------------|
      | ✗                    | —            | INSERT + create doc |
      | ✓                    | ✓            | **SKIP** (unchanged) |
      | ✓                    | ✗            | UPDATE hash + update doc |

    The ``document`` FK points to the ``WorkflowDocument`` created for
    this row so that on content change we update the existing doc rather
    than creating a new one (no orphans).

    This model is source-agnostic — it works for ``source_type='sheets'``
    on input nodes AND ``node_type='sheet', mode='input'`` sheet nodes.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='input_node_rows',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='input_node_rows',
    )

    # Row identity — stable SheetRow UUID (survives reorders)
    row_id = models.CharField(
        max_length=255,
        help_text='Stable row identity (SheetRow UUID)',
    )

    # SHA-256 of the row data at the time it was last ingested.
    # Compared against SheetRow.row_hash or computed hash to detect changes.
    content_hash = models.CharField(
        max_length=64,
        help_text='SHA-256 of row data when last ingested',
    )

    # The WorkflowDocument that was created/updated for this row.
    # Allows update-in-place on content change without creating orphans.
    document = models.ForeignKey(
        WorkflowDocument, on_delete=models.CASCADE,
        related_name='input_node_rows',
        help_text='The WorkflowDocument created for this row',
    )

    # Source metadata for filtering/debugging
    source_type = models.CharField(
        max_length=30, default='sheets',
        help_text='sheets | sheet_node | table',
    )
    sheet_id = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Sheet UUID (for sheet sources)',
    )
    row_order = models.IntegerField(
        null=True, blank=True,
        help_text='Row order at time of ingestion',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            # Primary lookup: what rows does this node know about?
            models.Index(
                fields=['node', 'row_id'],
                name='inputnoderow_node_rowid_idx',
            ),
            # Batch load for a node: all rows + hashes
            models.Index(
                fields=['node', 'content_hash'],
                name='inputnoderow_node_hash_idx',
            ),
            # Workflow-level queries
            models.Index(
                fields=['workflow', 'node'],
                name='inputnoderow_wf_node_idx',
            ),
        ]
        # One row_id per node — prevents duplicates
        unique_together = [('node', 'row_id')]

    def __str__(self):
        return (
            f"InputNodeRow(node={self.node_id}, row={self.row_id}, "
            f"hash={self.content_hash[:8]}…)"
        )

    @classmethod
    def load_hash_map(cls, node) -> dict:
        """
        Load {row_id: (content_hash, document_id)} for all rows tracked
        by this node.  Used at the start of execution for fast lookups.
        """
        return {
            str(rid): (chash, str(doc_id))
            for rid, chash, doc_id in cls.objects.filter(
                node=node,
            ).values_list('row_id', 'content_hash', 'document_id')
        }

    @classmethod
    def upsert(cls, node, workflow, row_id, content_hash, document, source_type='sheets', sheet_id='', row_order=None):
        """
        Insert or update a tracked row.  On content change, updates the
        hash.  Returns (obj, created).
        """
        obj, created = cls.objects.update_or_create(
            node=node,
            row_id=str(row_id),
            defaults={
                'workflow': workflow,
                'content_hash': content_hash,
                'document': document,
                'source_type': source_type,
                'sheet_id': str(sheet_id),
                'row_order': row_order,
            },
        )
        return obj, created


# ---------------------------------------------------------------------------
# EventSubscription — links input nodes to event sources for live workflows
# ---------------------------------------------------------------------------

class EventSubscription(models.Model):
    """
    An event subscription links a workflow's input node to an external
    event source (sheet update, email, webhook, file upload, cloud sync).

    When a workflow is compiled/goes live, the compiler scans all input
    nodes and creates EventSubscription rows.  The event dispatcher
    (Celery task) uses these subscriptions to route incoming events to
    the correct workflow(s) for execution.

    For time-based sources (email, cloud), the subscription also stores
    the polling interval and last poll time.
    """

    class SourceType(models.TextChoices):
        SHEET = 'sheet', 'Sheet Update'
        DOCUMENT = 'document', 'Document Update'
        EMAIL = 'email', 'Email Inbox'
        WEBHOOK = 'webhook', 'Webhook'
        UPLOAD = 'upload', 'File Upload'
        GOOGLE_DRIVE = 'google_drive', 'Google Drive'
        DROPBOX = 'dropbox', 'Dropbox'
        ONEDRIVE = 'onedrive', 'OneDrive'
        S3 = 's3', 'AWS S3'
        FTP = 'ftp', 'FTP/SFTP'
        URL_SCRAPE = 'url_scrape', 'URL Scrape'
        FOLDER = 'folder', 'Folder Watch'
        DMS = 'dms', 'DMS Import'

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        PAUSED = 'paused', 'Paused'
        ERROR = 'error', 'Error'
        DISABLED = 'disabled', 'Disabled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='event_subscriptions',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='event_subscriptions',
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_event_subscriptions',
    )

    source_type = models.CharField(
        max_length=20, choices=SourceType.choices,
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE,
    )

    # Reference to the source object (sheet_id, folder_id, etc.)
    source_id = models.CharField(
        max_length=255, blank=True, default='',
        db_index=True,
        help_text='UUID or identifier of the source (sheet_id, folder_id, etc.)',
    )

    # Webhook-specific: unique token for inbound webhook URL
    webhook_token = models.UUIDField(
        null=True, blank=True, unique=True,
        help_text='Unique token for webhook URL: /api/clm/webhooks/<token>/',
    )
    webhook_secret = models.CharField(
        max_length=255, blank=True, default='',
        help_text='HMAC secret for verifying webhook payloads',
    )

    # Polling configuration (for time-based sources)
    poll_interval = models.PositiveIntegerField(
        default=60,
        help_text='Polling interval in seconds (for email, cloud, etc.)',
    )
    last_polled_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Last time this subscription was polled/checked',
    )
    next_poll_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Scheduled next poll time (for dispatcher efficiency)',
    )

    # Error tracking
    consecutive_errors = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default='')
    last_error_at = models.DateTimeField(null=True, blank=True)

    # Stats
    total_events_received = models.PositiveIntegerField(default=0)
    total_executions_triggered = models.PositiveIntegerField(default=0)

    # Source configuration snapshot (from node.config at compile time)
    config_snapshot = models.JSONField(
        default=dict, blank=True,
        help_text='Snapshot of relevant node.config at compilation time',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['source_type', 'source_id', 'status']),
            models.Index(fields=['workflow', 'status']),
            models.Index(fields=['webhook_token']),
            models.Index(fields=['status', 'next_poll_at']),
        ]
        unique_together = [('workflow', 'node', 'source_type')]

    def __str__(self):
        return (
            f"EventSub({self.source_type}) node={self.node.label or str(self.node.pk)} "
            f"→ {self.workflow.name} [{self.status}]"
        )


# ---------------------------------------------------------------------------
# WebhookEvent — records every inbound webhook/event received
# ---------------------------------------------------------------------------

class WebhookEvent(models.Model):
    """
    Records every inbound event (webhook call, sheet update, email arrival,
    scheduled poll result, etc.).  Provides a complete audit trail and
    enables replay/retry of events.
    """

    class Status(models.TextChoices):
        RECEIVED = 'received', 'Received'
        PROCESSING = 'processing', 'Processing'
        PROCESSED = 'processed', 'Processed'
        FAILED = 'failed', 'Failed'
        IGNORED = 'ignored', 'Ignored'
        RETRYING = 'retrying', 'Retrying'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscription = models.ForeignKey(
        EventSubscription, on_delete=models.CASCADE, related_name='events',
        null=True, blank=True,
        help_text='The subscription that received this event (null for unmatched webhooks)',
    )
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='webhook_events',
        null=True, blank=True,
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='clm_webhook_events',
        null=True, blank=True,
    )

    event_type = models.CharField(
        max_length=50,
        help_text='Event type: sheet_updated, email_received, webhook_call, poll_result, etc.',
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.RECEIVED,
    )

    # Payload
    payload = models.JSONField(
        default=dict, blank=True,
        help_text='Raw event payload (webhook body, sheet changes, email metadata)',
    )
    headers = models.JSONField(
        default=dict, blank=True,
        help_text='HTTP headers (for webhooks)',
    )
    source_ip = models.GenericIPAddressField(null=True, blank=True)

    # Processing result
    result = models.JSONField(
        default=dict, blank=True,
        help_text='Processing result: execution_id, documents_created, etc.',
    )
    error_message = models.TextField(blank=True, default='')

    # Execution link
    execution = models.ForeignKey(
        'WorkflowExecution', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='source_events',
    )

    # Retry tracking
    retry_count = models.PositiveIntegerField(default=0)
    max_retries = models.PositiveIntegerField(default=3)

    # Dedup
    idempotency_key = models.CharField(
        max_length=255, blank=True, default='', db_index=True,
        help_text='For dedup — e.g. Message-ID for emails, delivery_id for webhooks',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['event_type', 'status']),
            models.Index(fields=['workflow', 'status']),
            models.Index(fields=['subscription', '-created_at']),
            models.Index(fields=['idempotency_key']),
        ]

    def __str__(self):
        return f"Event({self.event_type}) [{self.status}] @ {self.created_at}"


# ---------------------------------------------------------------------------
# NodeExecutionLog — per-node per-execution detailed log
# ---------------------------------------------------------------------------

class NodeExecutionLog(models.Model):
    """
    Tracks every execution of every node with full input/output data,
    timing, errors, and status.  One row per (execution, node).

    This is more granular than WorkflowExecution.node_summary — it stores
    the actual document IDs flowing in/out, execution duration, error
    traces, and retry state.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        COMPLETED = 'completed', 'Completed'
        FAILED = 'failed', 'Failed'
        SKIPPED = 'skipped', 'Skipped'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    execution = models.ForeignKey(
        'WorkflowExecution', on_delete=models.CASCADE, related_name='node_logs',
    )
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='node_execution_logs',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='execution_logs',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING,
    )

    # Input/output
    input_document_ids = models.JSONField(
        default=list, blank=True,
        help_text='Document IDs that flowed into this node',
    )
    output_document_ids = models.JSONField(
        default=list, blank=True,
        help_text='Document IDs that flowed out of this node',
    )
    input_count = models.PositiveIntegerField(default=0)
    output_count = models.PositiveIntegerField(default=0)

    # Execution details
    result_data = models.JSONField(
        default=dict, blank=True,
        help_text='Full node execution result (type-specific: action, AI, etc.)',
    )
    error_message = models.TextField(blank=True, default='')
    error_traceback = models.TextField(blank=True, default='')

    # Timing
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    # Level in the DAG (for ordering in UI)
    dag_level = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['dag_level', 'started_at']
        indexes = [
            models.Index(fields=['execution', 'node']),
            models.Index(fields=['workflow', 'node']),
            models.Index(fields=['execution', 'dag_level']),
            models.Index(fields=['status']),
        ]
        unique_together = [('execution', 'node')]

    def __str__(self):
        return (
            f"NodeLog({self.node.label or self.node.node_type}) "
            f"[{self.status}] exec={str(self.execution.pk)}"
        )


# ---------------------------------------------------------------------------
# WorkflowCompilation — tracks DAG compilation / go-live results
# ---------------------------------------------------------------------------

class WorkflowCompilation(models.Model):
    """
    Records every compilation attempt of a workflow.

    Compilation validates the DAG, checks input node configurations,
    creates EventSubscriptions, and marks the workflow as live-ready.
    Stores errors/warnings so the frontend can display them.
    """

    class Status(models.TextChoices):
        SUCCESS = 'success', 'Success'
        WARNING = 'warning', 'Success with Warnings'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='compilations',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices,
    )

    # DAG validation
    node_count = models.PositiveIntegerField(default=0)
    connection_count = models.PositiveIntegerField(default=0)
    has_cycle = models.BooleanField(default=False)
    has_input_node = models.BooleanField(default=True)
    has_output_node = models.BooleanField(default=True)

    # Subscriptions created
    subscriptions_created = models.PositiveIntegerField(default=0)
    subscription_details = models.JSONField(
        default=list, blank=True,
        help_text='[{node_id, source_type, source_id, poll_interval}, ...]',
    )

    # Errors & warnings
    errors = models.JSONField(
        default=list, blank=True,
        help_text='[{node_id, message, severity}, ...]',
    )
    warnings = models.JSONField(
        default=list, blank=True,
        help_text='[{node_id, message}, ...]',
    )

    # Config hash at compile time
    config_hash = models.CharField(max_length=64, blank=True, default='')

    compiled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', '-created_at']),
        ]

    def __str__(self):
        return f"Compilation({self.workflow.name}) [{self.status}] @ {self.created_at}"


# ---------------------------------------------------------------------------
# WorkflowLiveEvent — persisted real-time execution events for dashboard
# ---------------------------------------------------------------------------

class WorkflowLiveEvent(models.Model):
    """
    Persists real-time execution events emitted during workflow runs.

    While the in-memory ``live_events.event_bus`` handles instant SSE
    streaming, this model provides:
      - Historical timeline replay (what happened in past executions)
      - Dashboard aggregation (throughput, error rates, node latency)
      - Audit trail (which nodes ran, when, how many docs, failures)

    Events are written in bulk after each node completes (batch insert)
    and optionally during long-running nodes (progress events).

    Automatic cleanup: events older than 30 days can be purged via
    management command or Celery Beat task.
    """

    class EventType(models.TextChoices):
        EXECUTION_STARTED = 'execution_started', 'Execution Started'
        EXECUTION_COMPLETED = 'execution_completed', 'Execution Completed'
        NODE_STARTED = 'node_started', 'Node Started'
        NODE_COMPLETED = 'node_completed', 'Node Completed'
        NODE_FAILED = 'node_failed', 'Node Failed'
        NODE_PROGRESS = 'node_progress', 'Node Progress'
        DOCUMENT_PROCESSED = 'document_processed', 'Document Processed'
        COMPILATION_STARTED = 'compilation_started', 'Compilation Started'
        COMPILATION_DONE = 'compilation_done', 'Compilation Done'
        LIVE_TICK = 'live_tick', 'Live Tick'
        METRIC_UPDATE = 'metric_update', 'Metric Update'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='live_events',
    )
    execution = models.ForeignKey(
        'WorkflowExecution', on_delete=models.CASCADE,
        null=True, blank=True, related_name='live_events',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='live_events',
    )

    event_type = models.CharField(
        max_length=30, choices=EventType.choices,
    )
    node_type = models.CharField(max_length=20, blank=True, default='')
    node_label = models.CharField(max_length=255, blank=True, default='')

    # Numeric metrics for fast aggregation
    input_count = models.PositiveIntegerField(default=0)
    output_count = models.PositiveIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    progress_pct = models.FloatField(null=True, blank=True)

    # Flexible data payload
    data = models.JSONField(
        default=dict, blank=True,
        help_text='Event-specific data: errors, document_ids, metrics, etc.',
    )

    # Status for quick filtering
    status = models.CharField(
        max_length=20, blank=True, default='',
        help_text='Node/execution status at time of event: running, completed, failed',
    )

    dag_level = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', '-created_at']),
            models.Index(fields=['workflow', 'execution', 'event_type']),
            models.Index(fields=['workflow', 'event_type', '-created_at']),
            models.Index(fields=['execution', 'dag_level', 'created_at']),
            models.Index(fields=['node', '-created_at']),
        ]

    def __str__(self):
        return (
            f"LiveEvent({self.event_type}) "
            f"node={self.node_label or '-'} "
            f"[{self.status}] @ {self.created_at}"
        )

    @classmethod
    def record_from_live_event(cls, live_event, workflow_id=None, execution_id=None, node_id=None):
        """
        Create a persisted record from an in-memory LiveEvent.
        Used by the executor to batch-persist events.
        """
        return cls(
            workflow_id=workflow_id or live_event.workflow_id,
            execution_id=execution_id or live_event.execution_id or None,
            node_id=node_id or live_event.node_id or None,
            event_type=live_event.event_type,
            node_type=live_event.node_type,
            node_label=live_event.node_label,
            input_count=live_event.data.get('input_count', 0),
            output_count=live_event.data.get('output_count', 0),
            duration_ms=live_event.data.get('duration_ms'),
            progress_pct=live_event.data.get('progress_pct'),
            data=live_event.data,
            status=live_event.data.get('status', ''),
            dag_level=live_event.data.get('dag_level', 0),
        )

    @classmethod
    def cleanup_old_events(cls, days=30):
        """Delete events older than N days. Call from Celery Beat or management command."""
        cutoff = timezone.now() - timezone.timedelta(days=days)
        deleted, _ = cls.objects.filter(created_at__lt=cutoff).delete()
        return deleted


# ---------------------------------------------------------------------------
# RowActionLog — idempotency guard for side-effect nodes (action, doc_create)
# ---------------------------------------------------------------------------

class RowActionLog(models.Model):
    """
    Prevents duplicate side-effects in live workflows that process sheet rows.

    When an action node (email, webhook, etc.) or doc_create node fires for
    a specific row, a RowActionLog entry is created with the row's identity
    (``row_id``) and content hash (``content_hash``).  On subsequent
    executions, the node checks this table first:

      • Same row_id + same content_hash → **skip** (already processed,
        nothing changed)
      • Same row_id + different content_hash → **re-execute** (row data
        changed since last action)
      • New row_id → **execute** (never seen before)

    This ensures that live workflows with repeated triggers (e.g. a sheet
    saved every 30 seconds) don't send duplicate emails or create duplicate
    documents for rows whose data hasn't changed.

    The ``row_id`` is the SheetRow UUID — a stable identity that survives
    row reorders, insertions and deletions.  For non-sheet documents, the
    ``row_id`` stores the WorkflowDocument UUID.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='row_action_logs',
    )
    node = models.ForeignKey(
        WorkflowNode, on_delete=models.CASCADE, related_name='row_action_logs',
    )
    execution = models.ForeignKey(
        'WorkflowExecution', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='row_action_logs',
        help_text='The execution that created this log entry',
    )

    # Row identity — the SheetRow UUID (or WorkflowDocument UUID for non-sheet)
    row_id = models.CharField(
        max_length=255, db_index=True,
        help_text='Stable row identity (SheetRow UUID or WorkflowDocument UUID)',
    )

    # SHA-256 of the row data at the time the action was executed.
    # If the row changes, the hash changes and the action can re-fire.
    content_hash = models.CharField(
        max_length=64,
        help_text='SHA-256 of row data when action was executed',
    )

    # What happened
    action_type = models.CharField(
        max_length=50, blank=True, default='',
        help_text='Plugin name or action type (e.g. send_email, create_document)',
    )
    status = models.CharField(
        max_length=20, default='executed',
        help_text='executed | skipped | failed',
    )
    result_summary = models.JSONField(
        default=dict, blank=True,
        help_text='Brief result data (plugin response, created doc id, etc.)',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # Primary lookup: has this node already processed this row with this data?
            models.Index(
                fields=['node', 'row_id', 'content_hash'],
                name='rowactionlog_node_row_hash_idx',
            ),
            # Workflow-level queries
            models.Index(fields=['workflow', 'node', '-created_at']),
            # Cleanup queries
            models.Index(fields=['created_at']),
        ]
        # Allow re-execution when content changes — unique on (node, row_id, content_hash)
        unique_together = [('node', 'row_id', 'content_hash')]

    def __str__(self):
        return (
            f"RowActionLog(node={self.node_id}, row={self.row_id}, "
            f"hash={self.content_hash[:8]}..., status={self.status})"
        )

    @classmethod
    def has_been_executed(cls, node, row_id: str, content_hash: str) -> bool:
        """
        Check if this (node, row_id, content_hash) combination has already
        been successfully executed.  Returns True if a log entry exists
        with status='executed'.
        """
        return cls.objects.filter(
            node=node,
            row_id=str(row_id),
            content_hash=content_hash,
            status='executed',
        ).exists()

    @classmethod
    def record_execution(
        cls, workflow, node, execution, row_id: str,
        content_hash: str, action_type: str = '',
        status: str = 'executed', result_summary: dict = None,
    ):
        """
        Record that this node processed this row.
        Uses update_or_create so that failed→executed transitions are captured.
        """
        obj, created = cls.objects.update_or_create(
            node=node,
            row_id=str(row_id),
            content_hash=content_hash,
            defaults={
                'workflow': workflow,
                'execution': execution,
                'action_type': action_type,
                'status': status,
                'result_summary': result_summary or {},
            },
        )
        return obj, created

    @classmethod
    def cleanup_old_logs(cls, days=90):
        """Delete log entries older than N days."""
        cutoff = timezone.now() - timezone.timedelta(days=days)
        deleted, _ = cls.objects.filter(created_at__lt=cutoff).delete()
        return deleted


# ---------------------------------------------------------------------------
# WorkflowEventTrigger — configurable event triggers for workflows
# ---------------------------------------------------------------------------

class WorkflowEventTrigger(models.Model):
    """
    Defines an event-based trigger for a workflow.

    Each trigger represents a single event source that can automatically
    start workflow execution when conditions are met.  Multiple triggers
    can be attached to a workflow (OR semantics — any trigger fires the
    workflow).

    Trigger types:
      - webhook:       External HTTP POST to a unique URL
      - schedule:      Cron-like schedule (e.g. every hour, daily at 9am)
      - file_upload:   When a file is uploaded to the workflow
      - email:         When an email arrives at a configured inbox
      - sheet_update:  When a linked Sheet row is created/updated
      - field_change:  When a specific extracted field value changes
      - document_status: When doc extraction completes / status changes
      - manual:        Button-click only (default, no auto-trigger)
      - api_call:      Triggered via API call with custom payload

    Config schema per trigger_type:
      webhook:
        { "secret": "...", "headers_filter": {"X-Event": "push"} }
      schedule:
        { "cron": "0 9 * * *", "timezone": "UTC", "enabled_days": [1,2,3,4,5] }
      file_upload:
        { "file_types": ["pdf","docx"], "min_files": 1 }
      email:
        { "inbox": "contracts@company.com", "subject_filter": "Invoice*" }
      sheet_update:
        { "sheet_id": "uuid", "trigger_on": "row_created"|"row_updated"|"any" }
      field_change:
        { "field_name": "contract_value", "condition": "changed"|"gt"|"lt", "threshold": 50000 }
      document_status:
        { "status": "completed"|"failed", "node_id": "uuid" }
      api_call:
        { "expected_payload_keys": ["document_id", "action"] }
    """

    class TriggerType(models.TextChoices):
        WEBHOOK = 'webhook', 'Webhook'
        SCHEDULE = 'schedule', 'Scheduled'
        FILE_UPLOAD = 'file_upload', 'File Upload'
        EMAIL = 'email', 'Email Arrival'
        SHEET_UPDATE = 'sheet_update', 'Sheet Update'
        FIELD_CHANGE = 'field_change', 'Field Value Change'
        DOCUMENT_STATUS = 'document_status', 'Document Status Change'
        MANUAL = 'manual', 'Manual Only'
        API_CALL = 'api_call', 'API Call'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workflow = models.ForeignKey(
        Workflow, on_delete=models.CASCADE, related_name='event_triggers',
    )
    name = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Human-readable trigger name',
    )
    trigger_type = models.CharField(
        max_length=20, choices=TriggerType.choices,
    )
    is_active = models.BooleanField(default=True)

    # Trigger-specific config (schema depends on trigger_type)
    config = models.JSONField(
        default=dict, blank=True,
        help_text='Trigger-specific configuration (varies by type)',
    )

    # Webhook: unique inbound URL token
    webhook_token = models.UUIDField(
        null=True, blank=True, unique=True,
        help_text='Unique token for webhook triggers: /api/clm/triggers/<token>/',
    )
    webhook_secret = models.CharField(
        max_length=255, blank=True, default='',
        help_text='HMAC secret for webhook payload verification',
    )

    # Schedule: next scheduled run
    next_run_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Next scheduled trigger time (for schedule type)',
    )
    last_triggered_at = models.DateTimeField(
        null=True, blank=True,
    )

    # Stats
    total_triggers = models.PositiveIntegerField(default=0)
    total_executions = models.PositiveIntegerField(default=0)
    consecutive_failures = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default='')

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['workflow', 'is_active']),
            models.Index(fields=['trigger_type', 'is_active']),
            models.Index(fields=['webhook_token']),
            models.Index(fields=['next_run_at']),
        ]

    def __str__(self):
        return f"{self.name or self.get_trigger_type_display()} → {self.workflow.name}"

    def save(self, *args, **kwargs):
        """Auto-generate webhook token for webhook triggers."""
        if self.trigger_type == 'webhook' and not self.webhook_token:
            self.webhook_token = uuid.uuid4()
        super().save(*args, **kwargs)

