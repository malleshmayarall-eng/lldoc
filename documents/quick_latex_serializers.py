"""
Serializers for the Quick LaTeX Document workflow.

A Quick LaTeX Document is a Document with document_mode='quick_latex'.
It auto-creates a single Section + single LatexCode block,
exposing a flat, metadata-centric API that's ideal for:
  • Rapid LaTeX creation with AI
  • Duplicating / branching with metadata overrides
  • Repository-driven document generation
"""

from rest_framework import serializers
from .models import Document, Section, LatexCode


# ─────────────────────────────────────────────────────────────────────────────
# Create
# ─────────────────────────────────────────────────────────────────────────────

class QuickLatexCreateSerializer(serializers.Serializer):
    """
    POST /api/documents/quick-latex/
    Creates a Document (mode=quick_latex) + 1 Section + 1 LatexCode block.
    """
    # Required
    title = serializers.CharField(max_length=255, default='Untitled LaTeX Document')

    # Optional LaTeX content (can be empty — user can add / AI-generate later)
    latex_code = serializers.CharField(required=False, allow_blank=True, default='')

    # Optional metadata for [[placeholder]] rendering
    document_type = serializers.CharField(required=False, default='contract')
    category = serializers.CharField(required=False, default='contract')
    author = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    document_metadata = serializers.JSONField(required=False, default=dict)
    custom_metadata = serializers.JSONField(required=False, default=dict)
    parties = serializers.JSONField(required=False, default=list)

    # Dates
    effective_date = serializers.DateField(required=False, allow_null=True, default=None)
    expiration_date = serializers.DateField(required=False, allow_null=True, default=None)

    # LaTeX code block metadata
    code_type = serializers.CharField(required=False, default='latex')
    topic = serializers.CharField(required=False, allow_blank=True, default='')

    # Optional: source document to duplicate from
    source_document_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    metadata_overrides = serializers.JSONField(
        required=False, default=dict,
        help_text="Overrides applied on top of source document metadata (deep-merged).",
    )
    custom_metadata_overrides = serializers.JSONField(
        required=False, default=dict,
        help_text="Overrides applied on top of source document custom_metadata.",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Read (list + detail)
# ─────────────────────────────────────────────────────────────────────────────

class QuickLatexCodeInlineSerializer(serializers.ModelSerializer):
    """Flat representation of the single LatexCode block."""
    class Meta:
        model = LatexCode
        fields = [
            'id',
            'latex_code',
            'edited_code',
            'has_edits',
            'code_type',
            'topic',
            'custom_metadata',
            'order',
            'last_modified',
            'edit_count',
        ]
        read_only_fields = ['id', 'last_modified', 'edit_count']


class QuickLatexDocumentSerializer(serializers.ModelSerializer):
    """
    Read serializer for Quick LaTeX documents.
    Returns the document + its single LatexCode block inline.
    """
    latex_block = serializers.SerializerMethodField()
    section_id = serializers.SerializerMethodField()
    placeholders = serializers.SerializerMethodField()
    image_placeholders = serializers.SerializerMethodField()
    image_slots = serializers.SerializerMethodField()
    # Creator info (expose the user id so clients can link to profiles)
    created_by_id = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id',
            'title',
            'document_mode',
            'is_latex_code',
            'latex_code',
            'document_type',
            'category',
            'author',
            'status',
            'version',
            'parties',
            'signatories',
            'effective_date',
            'expiration_date',
            'execution_date',
            'governing_law',
            'reference_number',
            'project_name',
            'document_metadata',
            'custom_metadata',
            'created_at',
            'updated_at',
            'created_by_id',
            'created_by_username',
            # Inline extras
            'section_id',
            'latex_block',
            'placeholders',
            'image_placeholders',
            'image_slots',
        ]
        read_only_fields = [
            'id', 'document_mode', 'is_latex_code',
            'created_at', 'updated_at',
            'created_by_id', 'created_by_username',
            'section_id', 'latex_block', 'placeholders', 'image_placeholders',
            'image_slots',
        ]

    # ── helpers ──────────────────────────────────────────────────────────

    def _get_primary_section(self, obj):
        """Return the first (only) section of a quick-latex document."""
        if not hasattr(obj, '_ql_section_cache'):
            obj._ql_section_cache = (
                obj.sections.order_by('order').first()
            )
        return obj._ql_section_cache

    def _get_latex_block(self, obj):
        """Return the single LatexCode object attached to the primary section."""
        if not hasattr(obj, '_ql_latex_cache'):
            section = self._get_primary_section(obj)
            if section:
                obj._ql_latex_cache = (
                    section.latex_codes.order_by('order').first()
                )
            else:
                obj._ql_latex_cache = None
        return obj._ql_latex_cache

    # ── SerializerMethodField callbacks ──────────────────────────────────

    def get_section_id(self, obj):
        sec = self._get_primary_section(obj)
        return str(sec.id) if sec else None

    def get_latex_block(self, obj):
        block = self._get_latex_block(obj)
        if block:
            return QuickLatexCodeInlineSerializer(block).data
        return None

    def get_placeholders(self, obj):
        """
        Extract [[placeholder]] keys from the effective LaTeX code
        so the frontend can show a metadata form.
        Excludes image placeholders (``[[image:UUID]]``).
        """
        import re
        block = self._get_latex_block(obj)
        code = ''
        if block:
            code = block.get_effective_content() or ''
        elif obj.latex_code:
            code = obj.latex_code
        all_keys = re.findall(r'\[\[([^\]]+)\]\]', code)
        # Filter out image placeholders
        return sorted(set(k for k in all_keys if not k.startswith('image:')))

    def get_image_placeholders(self, obj):
        """
        Extract ``[[image:<uuid>]]`` patterns from the LaTeX code
        and return the UUIDs so the frontend can resolve them.
        """
        import re
        block = self._get_latex_block(obj)
        code = ''
        if block:
            code = block.get_effective_content() or ''
        elif obj.latex_code:
            code = obj.latex_code
        return sorted(set(re.findall(r'\[\[image:([0-9a-fA-F\-]{36})\]\]', code)))

    def get_image_slots(self, obj):
        """
        Return named image placeholder slots from
        ``document_metadata._image_placeholders`` merged with any named
        ``[[image:name]]`` still present in the code.

        Each entry: { name, mapped_image_id, is_mapped }
        """
        import re
        _UUID_RE = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
            r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        block = self._get_latex_block(obj)
        code = ''
        if block:
            code = block.get_effective_content() or ''
        elif obj.latex_code:
            code = obj.latex_code

        # Merge metadata map + code-level named slots
        meta = obj.document_metadata or {}
        img_map = meta.get('_image_placeholders', {})
        if not isinstance(img_map, dict):
            img_map = {}

        # Named slots still in code
        all_img_names = set(re.findall(r'\[\[image:([^\]]+)\]\]', code))
        named_in_code = {n for n in all_img_names if not _UUID_RE.match(n)}
        for n in named_in_code:
            if n not in img_map:
                img_map[n] = None

        result = []
        for name in sorted(img_map.keys()):
            mapped_id = img_map.get(name)
            result.append({
                'name': name,
                'mapped_image_id': mapped_id,
                'is_mapped': mapped_id is not None,
            })
        return result

    # ── Created-by helpers ─────────────────────────────────────────────────
    def get_created_by_id(self, obj):
        """Return the UUID string of the user who created this document, or None."""
        if getattr(obj, 'created_by', None):
            try:
                return str(obj.created_by.id)
            except Exception:
                return None
        return None

    def get_created_by_username(self, obj):
        """Return the username of the creator (for convenience)."""
        if getattr(obj, 'created_by', None):
            return obj.created_by.username
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Update (PATCH)
# ─────────────────────────────────────────────────────────────────────────────

class QuickLatexUpdateSerializer(serializers.Serializer):
    """
    PATCH /api/documents/quick-latex/<uuid>/
    Allows updating document metadata AND the latex code in one request.
    """
    # Document-level
    title = serializers.CharField(required=False, max_length=255)
    author = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    document_type = serializers.CharField(required=False)
    category = serializers.CharField(required=False)
    status = serializers.CharField(required=False)
    parties = serializers.JSONField(required=False)
    signatories = serializers.JSONField(required=False)
    effective_date = serializers.DateField(required=False, allow_null=True)
    expiration_date = serializers.DateField(required=False, allow_null=True)
    execution_date = serializers.DateField(required=False, allow_null=True)
    governing_law = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    reference_number = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    project_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    document_metadata = serializers.JSONField(required=False)
    custom_metadata = serializers.JSONField(required=False)

    # LaTeX code (written to both Document.latex_code AND the LatexCode block)
    latex_code = serializers.CharField(required=False, allow_blank=True)
    code_type = serializers.CharField(required=False)
    topic = serializers.CharField(required=False, allow_blank=True)


# ─────────────────────────────────────────────────────────────────────────────
# Duplicate
# ─────────────────────────────────────────────────────────────────────────────

class QuickLatexDuplicateSerializer(serializers.Serializer):
    """
    POST /api/documents/quick-latex/<uuid>/duplicate/
    Duplicate a Quick LaTeX document, optionally overriding metadata.
    """
    title = serializers.CharField(required=False, allow_blank=True, default='')
    metadata_overrides = serializers.JSONField(required=False, default=dict)
    custom_metadata_overrides = serializers.JSONField(required=False, default=dict)
    parties_override = serializers.JSONField(required=False, default=None)
    duplicate_notes = serializers.CharField(required=False, allow_blank=True, default='')


# ─────────────────────────────────────────────────────────────────────────────
# AI Generate
# ─────────────────────────────────────────────────────────────────────────────

class QuickLatexAIGenerateSerializer(serializers.Serializer):
    """
    POST /api/documents/quick-latex/<uuid>/ai-generate/
    Generate, edit, or regenerate the LaTeX/HTML code block using AI.
    """
    prompt = serializers.CharField(
        help_text="Natural-language description of the document to generate, or edit instructions.",
    )
    preamble = serializers.CharField(required=False, allow_blank=True, default='')
    replace = serializers.BooleanField(
        required=False, default=True,
        help_text="If true (default), replaces existing code. If false, appends.",
    )
    code_type = serializers.ChoiceField(
        choices=[('latex', 'LaTeX'), ('html', 'HTML')],
        required=False, default='latex',
        help_text="Generate LaTeX or HTML code. Defaults to 'latex'.",
    )
    mode = serializers.ChoiceField(
        choices=[('generate', 'Generate'), ('edit', 'Edit')],
        required=False, default='generate',
        help_text=(
            "'generate' (default) — create new code from scratch or extend existing. "
            "'edit' — modify existing code based on the prompt instructions."
        ),
    )
    suggestions = serializers.CharField(
        required=False, allow_blank=True, default='',
        help_text=(
            "Optional user hints, corrections, or additional instructions for the AI. "
            "These are appended to the prompt as extra guidance."
        ),
    )
    max_retries = serializers.IntegerField(
        required=False, default=5, min_value=1, max_value=10,
        help_text=(
            "Maximum compile-fix iterations. The AI generates code, compiles it, "
            "and if it fails, feeds errors back to the AI for correction — up to "
            "this many times. Defaults to 5, capped at 10."
        ),
    )


class QuickLatexBulkDuplicateSerializer(serializers.Serializer):
    """
    POST /api/documents/quick-latex/<uuid>/bulk-duplicate/
    Duplicate a Quick LaTeX document multiple times with different metadata per copy.
    Ideal for repository-driven generation.
    """
    copies = serializers.ListField(
        child=serializers.DictField(),
        help_text=(
            "Array of objects, each containing: "
            "title (str), metadata_overrides (dict), custom_metadata_overrides (dict), "
            "parties_override (list)."
        ),
    )
