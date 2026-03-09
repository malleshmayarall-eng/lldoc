"""
Inference Models — Persisted AI summaries for every document component
======================================================================

Each row in ``ComponentInference`` stores the AI-generated summary, key
entities, and context vector for a single component (Section, Paragraph,
Sentence, LatexCode, Table).  A SHA-256 ``content_hash`` enables staleness
detection: if the component text changed since the last inference, the row
is stale and a re-inference is needed.

``SectionAggregateInference`` is the **rolled-up** inference for a Section:
it merges all child component inferences into a single summary + context
that parent sections and document-level AI can consume.

``LateralEdge`` stores pre-computed dependency edges between any two
document components, discovered by the write path (embed → MaxSim →
cross-encoder reranker).  These provide cross-section context in the
read path (``context_window.py``).
"""
import hashlib
import uuid

from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.contrib.auth.models import User


# ──────────────────────────────────────────────────────────────────────────
# Component-level inference (leaf nodes)
# ──────────────────────────────────────────────────────────────────────────

class ComponentInference(models.Model):
    """
    AI-generated inference result for a single document component.

    Uses GenericForeignKey so it works with Paragraph, Sentence, LatexCode,
    Table, or any future component type.

    Fields:
        summary         — 1-3 sentence natural-language summary of the component
        key_entities    — extracted named entities / legal terms / numbers
        context_tags    — classification tags (obligation, definition, etc.)
        sentiment       — -1.0 … 1.0 sentiment polarity
        complexity      — 0.0 … 1.0 readability complexity
        importance      — 0.0 … 1.0 relevance weight for parent aggregation
        embedding_json  — optional float vector for semantic similarity
        content_hash    — SHA-256 of the source text at inference time
        model_name      — which LLM produced this inference
    """

    class ComponentType(models.TextChoices):
        SECTION     = 'section',     'Section'
        PARAGRAPH   = 'paragraph',   'Paragraph'
        SENTENCE    = 'sentence',    'Sentence'
        LATEX_CODE  = 'latex_code',  'LaTeX Code'
        TABLE       = 'table',       'Table'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Generic FK to any component ──────────────────────────────────
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.UUIDField()
    component = GenericForeignKey('content_type', 'object_id')

    component_type = models.CharField(
        max_length=20, choices=ComponentType.choices, db_index=True,
    )

    # ── Link to the owning document (for fast bulk queries) ──────────
    document = models.ForeignKey(
        'documents.Document', on_delete=models.CASCADE,
        related_name='component_inferences',
    )
    section = models.ForeignKey(
        'documents.Section', on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='component_inferences',
        help_text='Parent section (for all component types)',
    )

    # ── Inference outputs ────────────────────────────────────────────
    summary = models.TextField(
        blank=True, default='',
        help_text='1-3 sentence natural-language summary',
    )
    key_entities = models.JSONField(
        default=list, blank=True,
        help_text='Extracted named entities, legal terms, monetary values',
    )
    context_tags = models.JSONField(
        default=list, blank=True,
        help_text='Classification tags: obligation, definition, condition, etc.',
    )
    relationships = models.JSONField(
        default=list, blank=True,
        help_text='Cross-references to other components [{target_id, relation_type, description}]',
    )
    sentiment = models.FloatField(
        null=True, blank=True,
        help_text='Sentiment polarity -1.0 (negative) to 1.0 (positive)',
    )
    complexity = models.FloatField(
        null=True, blank=True,
        help_text='Readability/complexity score 0.0 (simple) to 1.0 (complex)',
    )
    importance = models.FloatField(
        default=0.5,
        help_text='Relevance weight 0.0-1.0 for parent aggregation',
    )
    embedding_json = models.JSONField(
        null=True, blank=True,
        help_text='Float vector for semantic similarity (optional)',
    )
    raw_llm_output = models.JSONField(
        null=True, blank=True,
        help_text='Full LLM response for audit',
    )

    # ── Staleness detection ──────────────────────────────────────────
    content_hash = models.CharField(
        max_length=64, db_index=True,
        help_text='SHA-256 of source text at inference time',
    )
    model_name = models.CharField(max_length=200, blank=True, default='')

    # ── Versioning ───────────────────────────────────────────────────
    document_version_number = models.IntegerField(default=1, db_index=True)
    is_latest = models.BooleanField(default=True, db_index=True)

    # ── Metadata ─────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
    )
    inference_duration_ms = models.IntegerField(
        null=True, blank=True,
        help_text='Inference wall-time in milliseconds',
    )
    custom_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['content_type', 'object_id', 'is_latest']),
            models.Index(fields=['document', 'component_type', 'is_latest']),
            models.Index(fields=['section', 'is_latest']),
            models.Index(fields=['content_hash']),
        ]
        verbose_name = 'Component Inference'
        verbose_name_plural = 'Component Inferences'

    def __str__(self):
        return f'{self.component_type}:{self.object_id} — {self.summary[:60]}'

    def save(self, *args, **kwargs):
        # Mark previous inferences for the same component as not-latest
        if self.is_latest:
            ComponentInference.objects.filter(
                content_type=self.content_type,
                object_id=self.object_id,
                is_latest=True,
            ).exclude(id=self.id).update(is_latest=False)
        super().save(*args, **kwargs)

    # ── Helpers ──────────────────────────────────────────────────────

    @staticmethod
    def compute_hash(text: str) -> str:
        return hashlib.sha256((text or '').encode('utf-8')).hexdigest()

    def is_stale(self, current_text: str) -> bool:
        """Return True if the component text has changed since this inference."""
        return self.content_hash != self.compute_hash(current_text)


# ──────────────────────────────────────────────────────────────────────────
# Section-level aggregate inference (rolled-up from children)
# ──────────────────────────────────────────────────────────────────────────

class SectionAggregateInference(models.Model):
    """
    Rolled-up inference for a Section, merging all child component
    inferences (paragraphs, sentences, tables, latex blocks, subsections).

    This is the data that parent sections read when building *their* own
    aggregate, and it's what CLM / document-level AI consumes.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    section = models.ForeignKey(
        'documents.Section', on_delete=models.CASCADE,
        related_name='aggregate_inferences',
    )
    document = models.ForeignKey(
        'documents.Document', on_delete=models.CASCADE,
        related_name='section_aggregate_inferences',
    )

    # ── Aggregated outputs ───────────────────────────────────────────
    summary = models.TextField(
        blank=True, default='',
        help_text='Merged summary of all children — 3-5 sentences',
    )
    child_summaries = models.JSONField(
        default=list, blank=True,
        help_text='Ordered list of {component_id, component_type, summary, importance}',
    )
    aggregated_entities = models.JSONField(
        default=list, blank=True,
        help_text='Union of all child key_entities, deduplicated',
    )
    aggregated_tags = models.JSONField(
        default=list, blank=True,
        help_text='Union of all child context_tags, deduplicated',
    )
    aggregated_relationships = models.JSONField(
        default=list, blank=True,
        help_text='All cross-references from children',
    )
    avg_sentiment = models.FloatField(null=True, blank=True)
    avg_complexity = models.FloatField(null=True, blank=True)
    max_importance = models.FloatField(null=True, blank=True)

    # ── Statistics ───────────────────────────────────────────────────
    total_components = models.IntegerField(default=0)
    total_paragraphs = models.IntegerField(default=0)
    total_sentences = models.IntegerField(default=0)
    total_tables = models.IntegerField(default=0)
    total_latex_codes = models.IntegerField(default=0)
    total_subsections = models.IntegerField(default=0)

    # ── Staleness ────────────────────────────────────────────────────
    children_hash = models.CharField(
        max_length=64, db_index=True,
        help_text='SHA-256 of sorted child content hashes — detects any subtree change',
    )
    model_name = models.CharField(max_length=200, blank=True, default='')

    # ── Versioning ───────────────────────────────────────────────────
    document_version_number = models.IntegerField(default=1, db_index=True)
    is_latest = models.BooleanField(default=True, db_index=True)

    # ── Metadata ─────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
    )
    inference_duration_ms = models.IntegerField(null=True, blank=True)
    custom_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['section', 'is_latest']),
            models.Index(fields=['document', 'is_latest']),
            models.Index(fields=['children_hash']),
        ]
        verbose_name = 'Section Aggregate Inference'
        verbose_name_plural = 'Section Aggregate Inferences'

    def __str__(self):
        return f'Aggregate:{self.section_id} — {self.summary[:60]}'

    def save(self, *args, **kwargs):
        if self.is_latest:
            SectionAggregateInference.objects.filter(
                section=self.section,
                is_latest=True,
            ).exclude(id=self.id).update(is_latest=False)
        super().save(*args, **kwargs)

    @staticmethod
    def compute_children_hash(child_hashes: list[str]) -> str:
        """Deterministic hash of all child content hashes."""
        combined = '|'.join(sorted(child_hashes))
        return hashlib.sha256(combined.encode('utf-8')).hexdigest()

    def is_stale(self, current_child_hashes: list[str]) -> bool:
        return self.children_hash != self.compute_children_hash(current_child_hashes)


# ──────────────────────────────────────────────────────────────────────────
# Document-level aggregate inference
# ──────────────────────────────────────────────────────────────────────────

class DocumentInferenceSummary(models.Model):
    """
    Top-level document inference — merges all root-section aggregates
    into a single document-wide context.  Used by CLM nodes, chat, and
    document scoring.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        'documents.Document', on_delete=models.CASCADE,
        related_name='inference_summaries',
    )

    summary = models.TextField(blank=True, default='')
    section_summaries = models.JSONField(
        default=list, blank=True,
        help_text='[{section_id, title, summary, importance, tags}]',
    )
    all_entities = models.JSONField(default=list, blank=True)
    all_tags = models.JSONField(default=list, blank=True)
    all_relationships = models.JSONField(default=list, blank=True)

    avg_sentiment = models.FloatField(null=True, blank=True)
    avg_complexity = models.FloatField(null=True, blank=True)

    total_sections = models.IntegerField(default=0)
    total_components = models.IntegerField(default=0)

    sections_hash = models.CharField(max_length=64, db_index=True)
    model_name = models.CharField(max_length=200, blank=True, default='')
    document_version_number = models.IntegerField(default=1, db_index=True)
    is_latest = models.BooleanField(default=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
    )
    inference_duration_ms = models.IntegerField(null=True, blank=True)
    custom_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['document', 'is_latest']),
        ]

    def __str__(self):
        return f'DocInference:{self.document_id} — {self.summary[:60]}'

    def save(self, *args, **kwargs):
        if self.is_latest:
            DocumentInferenceSummary.objects.filter(
                document=self.document,
                is_latest=True,
            ).exclude(id=self.id).update(is_latest=False)
        super().save(*args, **kwargs)


# ──────────────────────────────────────────────────────────────────────────
# Lateral dependency edges (write-path output, read-path input)
# ──────────────────────────────────────────────────────────────────────────

class LateralEdge(models.Model):
    """
    Pre-computed dependency edge between two document components.

    Discovered by the write path: embed → MaxSim search → cross-encoder
    reranker → classify (CRITICAL / CONTEXTUAL) → persist here.

    Read path queries outbound edges for a component and renders them as
    lateral context in the AI prompt.

    Uses GenericForeignKey for both source and target so edges can link
    any component type (Paragraph↔Table, Paragraph↔Paragraph, etc.).
    """

    class EdgeType(models.TextChoices):
        CRITICAL = 'critical', 'Critical'           # score ≥ 0.85
        CONTEXTUAL = 'contextual', 'Contextual'     # score 0.65–0.84

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    document = models.ForeignKey(
        'documents.Document', on_delete=models.CASCADE,
        related_name='lateral_edges',
        help_text='Owning document (for fast bulk queries / cleanup)',
    )

    # ── Source (the component that was edited / embedded) ────────────
    source_content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE,
        related_name='lateral_edge_sources',
    )
    source_object_id = models.UUIDField()
    source = GenericForeignKey('source_content_type', 'source_object_id')

    # ── Target (the discovered dependency) ───────────────────────────
    target_content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE,
        related_name='lateral_edge_targets',
    )
    target_object_id = models.UUIDField()
    target = GenericForeignKey('target_content_type', 'target_object_id')

    # ── Edge metadata ────────────────────────────────────────────────
    edge_type = models.CharField(
        max_length=20, choices=EdgeType.choices, db_index=True,
        help_text='CRITICAL (≥0.85) or CONTEXTUAL (0.65–0.84)',
    )
    score = models.FloatField(
        help_text='Cross-encoder relevance score (0.0–1.0)',
    )

    # ── Cache: target summary snapshot for fast read-path ────────────
    target_summary = models.TextField(
        blank=True, default='',
        help_text='Snapshot of target ComponentInference.summary at edge creation time',
    )
    target_label = models.CharField(
        max_length=300, blank=True, default='',
        help_text='Human-readable label: section title + component type',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-score']
        indexes = [
            # Read path: "all outbound edges from this source"
            models.Index(
                fields=['source_content_type', 'source_object_id'],
                name='idx_lateral_source',
            ),
            # Reverse lookup: "what points at this target"
            models.Index(
                fields=['target_content_type', 'target_object_id'],
                name='idx_lateral_target',
            ),
            # Bulk cleanup: "all edges in this document"
            models.Index(
                fields=['document'],
                name='idx_lateral_document',
            ),
            # Filtered queries
            models.Index(
                fields=['document', 'edge_type'],
                name='idx_lateral_doc_type',
            ),
        ]
        verbose_name = 'Lateral Edge'
        verbose_name_plural = 'Lateral Edges'

    def __str__(self):
        return (
            f'{self.edge_type.upper()}({self.score:.2f}): '
            f'{self.source_content_type.model}:{self.source_object_id} → '
            f'{self.target_content_type.model}:{self.target_object_id}'
        )
