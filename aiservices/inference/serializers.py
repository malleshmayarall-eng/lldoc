"""
Inference Serializers — DRF serializers for all inference models
================================================================
"""
from rest_framework import serializers

from .models import ComponentInference, SectionAggregateInference, DocumentInferenceSummary, LateralEdge


class ComponentInferenceSerializer(serializers.ModelSerializer):
    component_id = serializers.UUIDField(source='object_id', read_only=True)

    class Meta:
        model = ComponentInference
        fields = [
            'id', 'component_id', 'component_type',
            'document', 'section',
            'summary', 'key_entities', 'context_tags', 'relationships',
            'sentiment', 'complexity', 'importance',
            'content_hash', 'model_name',
            'document_version_number', 'is_latest',
            'created_at', 'inference_duration_ms',
        ]
        read_only_fields = fields


class ComponentInferenceDetailSerializer(ComponentInferenceSerializer):
    """Extended serializer that includes raw LLM output and embedding."""

    class Meta(ComponentInferenceSerializer.Meta):
        fields = ComponentInferenceSerializer.Meta.fields + [
            'embedding_json', 'raw_llm_output', 'custom_metadata',
        ]


class SectionAggregateInferenceSerializer(serializers.ModelSerializer):
    section_title = serializers.CharField(source='section.title', read_only=True)

    class Meta:
        model = SectionAggregateInference
        fields = [
            'id', 'section', 'section_title', 'document',
            'summary', 'child_summaries',
            'aggregated_entities', 'aggregated_tags', 'aggregated_relationships',
            'avg_sentiment', 'avg_complexity', 'max_importance',
            'total_components', 'total_paragraphs', 'total_sentences',
            'total_tables', 'total_latex_codes', 'total_subsections',
            'children_hash', 'model_name',
            'document_version_number', 'is_latest',
            'created_at', 'inference_duration_ms',
            'custom_metadata',
        ]
        read_only_fields = fields


class DocumentInferenceSummarySerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source='document.title', read_only=True)

    class Meta:
        model = DocumentInferenceSummary
        fields = [
            'id', 'document', 'document_title',
            'summary', 'section_summaries',
            'all_entities', 'all_tags', 'all_relationships',
            'avg_sentiment', 'avg_complexity',
            'total_sections', 'total_components',
            'sections_hash', 'model_name',
            'document_version_number', 'is_latest',
            'created_at', 'inference_duration_ms',
            'custom_metadata',
        ]
        read_only_fields = fields


# ── Request serializers ──────────────────────────────────────────────────

class InferDocumentRequestSerializer(serializers.Serializer):
    """Request body for POST /inference/documents/<pk>/infer/"""
    model = serializers.CharField(required=False, default='')
    force = serializers.BooleanField(required=False, default=False)


class InferSectionRequestSerializer(serializers.Serializer):
    """Request body for POST /inference/sections/<pk>/infer/"""
    model = serializers.CharField(required=False, default='')
    force = serializers.BooleanField(required=False, default=False)


class InferComponentRequestSerializer(serializers.Serializer):
    """Request body for POST /inference/components/<component_type>/<pk>/infer/"""
    model = serializers.CharField(required=False, default='')
    force = serializers.BooleanField(required=False, default=False)


# ── Tree context response serializer ─────────────────────────────────────

class SectionTreeContextSerializer(serializers.Serializer):
    """Serializes the pre-built context string for a section."""
    section_id = serializers.UUIDField()
    section_title = serializers.CharField()
    context = serializers.CharField()
    has_inference = serializers.BooleanField()
    is_stale = serializers.BooleanField()


class DocumentTreeContextSerializer(serializers.Serializer):
    """Serializes the full document inference context."""
    document_id = serializers.UUIDField()
    document_title = serializers.CharField()
    context = serializers.CharField()
    has_inference = serializers.BooleanField()
    section_contexts = SectionTreeContextSerializer(many=True)


class InferenceStatsSerializer(serializers.Serializer):
    """Serializes engine run statistics."""
    status = serializers.CharField()
    document_id = serializers.UUIDField()
    document_inference_id = serializers.UUIDField(allow_null=True)
    components_processed = serializers.IntegerField()
    components_skipped = serializers.IntegerField()
    sections_processed = serializers.IntegerField()
    sections_skipped = serializers.IntegerField()
    llm_calls = serializers.IntegerField()
    errors = serializers.ListField()
    duration_ms = serializers.IntegerField()


# ══════════════════════════════════════════════════════════════════════════
# Lateral Edge serializers
# ══════════════════════════════════════════════════════════════════════════

class LateralEdgeSerializer(serializers.ModelSerializer):
    """Read-only serializer for a single lateral edge."""
    source_id = serializers.UUIDField(source='source_object_id', read_only=True)
    source_type = serializers.CharField(source='source_content_type.model', read_only=True)
    target_id = serializers.UUIDField(source='target_object_id', read_only=True)
    target_type = serializers.CharField(source='target_content_type.model', read_only=True)

    class Meta:
        model = LateralEdge
        fields = [
            'id', 'document',
            'source_id', 'source_type',
            'target_id', 'target_type',
            'edge_type', 'score',
            'target_label', 'target_summary',
            'created_at',
        ]
        read_only_fields = fields


class LateralEdgeListSerializer(serializers.Serializer):
    """Wrapper for a list of edges from a specific source component."""
    component_id = serializers.UUIDField()
    component_type = serializers.CharField()
    total_edges = serializers.IntegerField()
    critical_edges = serializers.IntegerField()
    contextual_edges = serializers.IntegerField()
    edges = LateralEdgeSerializer(many=True)


# ══════════════════════════════════════════════════════════════════════════
# Write-path serializers
# ══════════════════════════════════════════════════════════════════════════

class WritePathTriggerRequestSerializer(serializers.Serializer):
    """Request body for triggering the write-path."""
    async_mode = serializers.ChoiceField(
        choices=['thread', 'celery', 'sync'],
        required=False,
        default='thread',
        help_text='Execution mode: thread (default), celery (needs worker), sync (blocking).',
    )


class WritePathResultSerializer(serializers.Serializer):
    """Response for a single-component write-path run."""
    component_id = serializers.CharField()
    component_type = serializers.CharField()
    document_id = serializers.CharField()

    embedding_ms = serializers.IntegerField()
    search_ms = serializers.IntegerField()
    rerank_ms = serializers.IntegerField()
    upsert_ms = serializers.IntegerField()
    total_ms = serializers.IntegerField()

    candidates_found = serializers.IntegerField()
    critical_edges = serializers.IntegerField()
    contextual_edges = serializers.IntegerField()
    noise_discarded = serializers.IntegerField()
    edges_written = serializers.IntegerField()

    success = serializers.BooleanField()
    error = serializers.CharField(allow_blank=True)
    skipped = serializers.BooleanField()
    skip_reason = serializers.CharField(allow_blank=True)


class DocumentWritePathResultSerializer(serializers.Serializer):
    """Response for a document-level write-path run."""
    document_id = serializers.CharField()
    total_components = serializers.IntegerField()
    components_processed = serializers.IntegerField()
    components_skipped = serializers.IntegerField()
    components_failed = serializers.IntegerField()
    total_edges = serializers.IntegerField()
    total_ms = serializers.IntegerField()
    results = WritePathResultSerializer(many=True)


class WritePathStatusSerializer(serializers.Serializer):
    """Response for the write-path health-check endpoint."""
    enabled = serializers.BooleanField()
    embedding_backend = serializers.CharField()
    vector_store_backend = serializers.CharField()
    reranker_backend = serializers.CharField()
    vector_count = serializers.IntegerField()
    lateral_edges = serializers.DictField()
    thresholds = serializers.DictField()
