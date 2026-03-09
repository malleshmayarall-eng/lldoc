"""
Views for the Master Document & Branching system.

Provides:
- MasterDocumentViewSet  – CRUD + search + AI-generate + branch from master
- DocumentBranchViewSet  – CRUD + AI content generation on branches
- DocumentDuplicateView  – Standalone duplication of any document
"""

import copy
import logging
import os
import uuid as uuid_module

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Document, Section, Paragraph, Table,
    ImageComponent, DocumentFile, DocumentFileComponent,
    MasterDocument, DocumentBranch,
)
from .branching_serializers import (
    MasterDocumentListSerializer,
    MasterDocumentDetailSerializer,
    MasterDocumentCreateSerializer,
    MasterDocumentUpdateSerializer,
    DocumentBranchListSerializer,
    DocumentBranchDetailSerializer,
    CreateBranchSerializer,
    DuplicateDocumentSerializer,
    AIGenerateMasterSerializer,
    AIGenerateBranchContentSerializer,
    BranchSearchSerializer,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _deep_clone_document(source: Document, *,
                         user=None,
                         title_override: str = '',
                         metadata_overrides: dict | None = None,
                         custom_metadata_overrides: dict | None = None,
                         parties_override: list | None = None,
                         style_overrides: dict | None = None,
                         include_structure: bool = True,
                         include_images: bool = False,
                         ai_config_overrides: dict | None = None,
                         ai_system_prompt_override: str = '',
                         ai_service_prompts_override: dict | None = None,
                         ai_focus_override: str = '') -> Document:
    """
    Create a full deep-copy of a Document, optionally including its
    entire Section → Paragraph → Table tree.

    Returns the newly created Document.
    """
    # ── Clone document-level fields ──────────────────────────────────────
    new_doc = Document(
        title=title_override or f"{source.title} (Copy)",
        raw_text=source.raw_text,
        current_text=source.current_text,
        is_latex_code=source.is_latex_code,
        latex_code=source.latex_code,
        author=source.author,
        version='1.0',
        version_number=1,
        major_version=1,
        minor_version=0,
        patch_version=0,
        is_draft=True,
        is_latest_version=True,
        document_type=source.document_type,
        category=source.category,
        jurisdiction=source.jurisdiction,
        governing_law=source.governing_law,
        reference_number=source.reference_number,
        project_name=source.project_name,
        term_length=source.term_length,
        auto_renewal=source.auto_renewal,
        renewal_terms=source.renewal_terms,
        effective_date=source.effective_date,
        expiration_date=source.expiration_date,
        execution_date=source.execution_date,
        parties=parties_override if parties_override else copy.deepcopy(source.parties or []),
        signatories=copy.deepcopy(source.signatories or []),
        document_metadata=copy.deepcopy(source.document_metadata or {}),
        custom_metadata=copy.deepcopy(source.custom_metadata or {}),
        header_config=copy.deepcopy(source.header_config or {}),
        footer_config=copy.deepcopy(source.footer_config or {}),
        header_template=source.header_template,
        footer_template=source.footer_template,
        status='draft',
        created_by=user or source.created_by,
        parent_document=source,
    )

    # Apply metadata overrides (deep-merge)
    if metadata_overrides:
        for key, value in metadata_overrides.items():
            if isinstance(value, dict) and isinstance(new_doc.document_metadata.get(key), dict):
                new_doc.document_metadata[key].update(value)
            else:
                new_doc.document_metadata[key] = value

    # Apply custom_metadata overrides
    if custom_metadata_overrides:
        new_doc.custom_metadata.update(custom_metadata_overrides)

    # Apply style overrides into processing_settings
    if style_overrides:
        ps = new_doc.custom_metadata.setdefault('processing_settings', {})
        ps.update(style_overrides)

    new_doc.save()

    # ── Clone AI service config ──────────────────────────────────────────
    _clone_ai_config(source, new_doc,
                     ai_config_overrides=ai_config_overrides,
                     ai_system_prompt_override=ai_system_prompt_override,
                     ai_service_prompts_override=ai_service_prompts_override,
                     ai_focus_override=ai_focus_override)

    # ── Clone structure (sections, paragraphs, tables) ───────────────────
    if include_structure:
        _clone_structure(source, new_doc)

    # Rebuild component indexes
    new_doc.rebuild_component_indexes()

    return new_doc


def _clone_ai_config(source: Document, target: Document, *,
                     ai_config_overrides: dict | None = None,
                     ai_system_prompt_override: str = '',
                     ai_service_prompts_override: dict | None = None,
                     ai_focus_override: str = ''):
    """
    Clone the source document's AI service config onto the target document.
    If ai_config_overrides are provided (e.g. from a MasterDocument's
    default_ai_service_config), they are deep-merged on top of the cloned config.
    """
    from aiservices.models import DocumentAIConfig

    # Check if source has an AI config to clone
    source_cfg = getattr(source, 'ai_config', None)
    if source_cfg is None and not ai_config_overrides and not ai_system_prompt_override:
        return  # Nothing to clone

    cloned_services = copy.deepcopy(source_cfg.services_config or {}) if source_cfg else {}
    cloned_prompt = (source_cfg.system_prompt or '') if source_cfg else ''
    cloned_service_prompts = copy.deepcopy(source_cfg.service_prompts or {}) if source_cfg else {}
    cloned_focus = (source_cfg.ai_focus or '') if source_cfg else ''

    # Merge overrides on top
    if ai_config_overrides:
        for svc, cfg in ai_config_overrides.items():
            if svc in cloned_services and isinstance(cfg, dict) and isinstance(cloned_services[svc], dict):
                cloned_services[svc].update(cfg)
            else:
                cloned_services[svc] = cfg

    if ai_system_prompt_override:
        cloned_prompt = ai_system_prompt_override

    if ai_service_prompts_override:
        cloned_service_prompts.update(ai_service_prompts_override)

    if ai_focus_override:
        cloned_focus = ai_focus_override

    DocumentAIConfig.objects.update_or_create(
        document=target,
        defaults={
            'services_config': cloned_services,
            'system_prompt': cloned_prompt,
            'service_prompts': cloned_service_prompts,
            'ai_focus': cloned_focus,
        }
    )


def _clone_structure(source_doc: Document, target_doc: Document):
    """
    Recursively clone the full Section → Paragraph → Sentence → Table tree
    from source_doc into target_doc, preserving hierarchy.
    """
    # Map old section IDs → new section IDs (needed for parent references)
    section_id_map = {}

    # Get root sections ordered
    root_sections = source_doc.sections.filter(parent__isnull=True).order_by('order')

    def _clone_section(old_section, new_parent=None):
        new_section_id = uuid_module.uuid4()
        section_id_map[str(old_section.id)] = new_section_id

        new_section = Section.objects.create(
            id=new_section_id,
            document=target_doc,
            parent=new_parent,
            title=old_section.title,
            content_start=old_section.content_start,
            content_end=old_section.content_end,
            content_text=old_section.content_text,
            edited_text=old_section.edited_text,
            has_edits=old_section.has_edits,
            section_type=old_section.section_type,
            importance_level=old_section.importance_level,
            is_boilerplate=old_section.is_boilerplate,
            tags=copy.deepcopy(old_section.tags or []),
            custom_metadata=copy.deepcopy(old_section.custom_metadata or {}),
            order=old_section.order,
            depth_level=old_section.depth_level,
        )

        # Clone paragraphs
        for old_para in old_section.paragraphs.all().order_by('order'):
            Paragraph.objects.create(
                section=new_section,
                content_start=old_para.content_start,
                content_end=old_para.content_end,
                content_text=old_para.content_text,
                edited_text=old_para.edited_text,
                has_edits=old_para.has_edits,
                paragraph_type=old_para.paragraph_type,
                topic=old_para.topic,
                order=old_para.order,
                custom_metadata=copy.deepcopy(old_para.custom_metadata or {}),
            )

        # Clone tables
        for old_table in old_section.tables.all().order_by('order'):
            Table.objects.create(
                section=new_section,
                title=old_table.title,
                description=old_table.description,
                num_columns=old_table.num_columns,
                num_rows=old_table.num_rows,
                column_headers=copy.deepcopy(old_table.column_headers or []),
                table_data=copy.deepcopy(old_table.table_data or []),
                table_config=copy.deepcopy(old_table.table_config or {}),
                table_type=old_table.table_type,
                order=old_table.order,
            )

        # Recurse into children
        for child in old_section.children.all().order_by('order'):
            _clone_section(child, new_parent=new_section)

        return new_section

    for root_sec in root_sections:
        _clone_section(root_sec)


# ─────────────────────────────────────────────────────────────────────────────
# MasterDocumentViewSet
# ─────────────────────────────────────────────────────────────────────────────

class MasterDocumentViewSet(viewsets.ModelViewSet):
    """
    CRUD for Master Documents + branching + AI generation.

    Endpoints:
      GET    /api/documents/masters/              – list (searchable)
      POST   /api/documents/masters/              – create
      GET    /api/documents/masters/<uuid>/        – detail
      PATCH  /api/documents/masters/<uuid>/        – update
      DELETE /api/documents/masters/<uuid>/        – delete
      POST   /api/documents/masters/<uuid>/branch/ – create a branch
      POST   /api/documents/masters/ai-generate/   – AI-create a master
      GET    /api/documents/masters/search/         – advanced search
    """
    queryset = MasterDocument.objects.all()
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
            return MasterDocumentListSerializer
        if self.action in ('create',):
            return MasterDocumentCreateSerializer
        if self.action in ('update', 'partial_update'):
            return MasterDocumentUpdateSerializer
        return MasterDocumentDetailSerializer

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return MasterDocument.objects.none()

        return MasterDocument.objects.filter(
            Q(created_by=user) | Q(is_public=True) | Q(is_system=True)
        ).select_related('template_document', 'created_by').distinct()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    # ── Branch from master ───────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='branch')
    def create_branch(self, request, pk=None):
        """
        Create a new Document by branching from this master's template_document.

        POST /api/documents/masters/<uuid>/branch/
        Body: { branch_name, metadata_overrides?, style_overrides?, ... }
        """
        master = self.get_object()

        if not master.template_document:
            return Response(
                {'error': 'Master has no template document attached. '
                          'Create or link a template_document first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = CreateBranchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        # Merge master defaults with branch overrides
        merged_metadata = master.get_merged_metadata(d.get('metadata_overrides'))
        merged_custom = copy.deepcopy(master.default_custom_metadata or {})
        merged_custom.update(d.get('custom_metadata_overrides') or {})

        merged_parties = d.get('parties_override') or copy.deepcopy(master.default_parties or [])

        style = copy.deepcopy(master.style_preset or {})
        style.update(d.get('style_overrides') or {})

        with transaction.atomic():
            new_doc = _deep_clone_document(
                master.template_document,
                user=request.user,
                title_override=d.get('title_override') or d['branch_name'],
                metadata_overrides=merged_metadata,
                custom_metadata_overrides=merged_custom,
                parties_override=merged_parties,
                style_overrides=style,
                include_structure=d.get('include_content', True),
                ai_config_overrides=copy.deepcopy(master.default_ai_service_config or {}),
                ai_system_prompt_override=master.default_ai_system_prompt or '',
                ai_service_prompts_override=copy.deepcopy(master.default_ai_service_prompts or {}),
                ai_focus_override=master.default_ai_focus or '',
            )

            branch = DocumentBranch.objects.create(
                master=master,
                source_document=master.template_document,
                document=new_doc,
                branch_name=d['branch_name'],
                branch_notes=d.get('branch_notes', ''),
                branch_type='branch',
                metadata_overrides=d.get('metadata_overrides') or {},
                style_overrides=d.get('style_overrides') or {},
                created_by=request.user,
            )

            master.increment_branch_count()

        return Response(
            DocumentBranchDetailSerializer(branch).data,
            status=status.HTTP_201_CREATED,
        )

    # ── AI-generate a master document ────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='ai-generate')
    def ai_generate(self, request):
        """
        Use AI (Gemini) to create a fully structured master document
        from a prompt or raw text.

        POST /api/documents/masters/ai-generate/
        Body: { prompt, name?, category?, ... }
        """
        ser = AIGenerateMasterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        prompt = d.get('prompt', '')
        raw_text = d.get('raw_text', '')
        ai_system_prompt = d.get('ai_system_prompt', '')

        # Build the text for AI
        if prompt and not raw_text:
            raw_text = (
                f"Generate a professional {d.get('document_type', 'contract')} document.\n"
                f"Category: {d.get('category', 'contract')}\n"
                f"Requirements: {prompt}\n"
            )
            if d.get('default_parties'):
                parties_str = ', '.join(
                    p.get('name', '') for p in d['default_parties'] if isinstance(p, dict)
                )
                raw_text += f"Parties: {parties_str}\n"

        # Call Gemini
        from aiservices.gemini_ingest import generate_document_from_text

        result = generate_document_from_text(
            raw_text=raw_text,
            system_prompt=ai_system_prompt or None,
            create_in_db=True,
            created_by=request.user,
        )

        if not result.get('db_result') or not result['db_result'].get('document_id'):
            return Response(
                {'error': 'AI generation failed. No document was created.',
                 'ai_response': result.get('structure')},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Wrap the generated Document in a MasterDocument
        doc_id = result['db_result']['document_id']
        template_doc = Document.objects.get(id=doc_id)

        master = MasterDocument.objects.create(
            name=d.get('name') or template_doc.title or 'AI-Generated Master',
            description=d.get('description') or f"AI-generated from prompt: {prompt[:200]}",
            template_document=template_doc,
            category=d.get('category', 'contract'),
            document_type=d.get('document_type', 'contract'),
            tags=d.get('tags', []),
            default_metadata=d.get('default_metadata', {}),
            default_parties=d.get('default_parties', []),
            style_preset=d.get('style_preset', {}),
            ai_system_prompt=ai_system_prompt,
            ai_generation_notes=prompt,
            created_by=request.user,
        )

        return Response(
            MasterDocumentDetailSerializer(master).data,
            status=status.HTTP_201_CREATED,
        )

    # ── Advanced search ──────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='search')
    def search(self, request):
        """
        GET /api/documents/masters/search/?q=...&category=...&tags=...

        Search master documents by name, description, tags, category, etc.
        """
        ser = BranchSearchSerializer(data=request.query_params)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        qs = self.get_queryset()

        # Text search
        q = d.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) |
                Q(description__icontains=q) |
                Q(document_type__icontains=q)
            )

        # Category filter
        if d.get('category'):
            qs = qs.filter(category=d['category'])

        # Document type filter
        if d.get('document_type'):
            qs = qs.filter(document_type=d['document_type'])

        # Tags filter (JSON array contains)
        if d.get('tags'):
            tag_list = [t.strip() for t in d['tags'].split(',') if t.strip()]
            for tag in tag_list:
                qs = qs.filter(tags__contains=[tag])

        # Ordering
        ordering = d.get('ordering', '-updated_at')
        qs = qs.order_by(ordering)

        return Response(MasterDocumentListSerializer(qs[:100], many=True).data)

    # ── Promote an existing document to master ───────────────────────────

    @action(detail=False, methods=['post'], url_path='promote')
    def promote_to_master(self, request):
        """
        Promote an existing Document to a Master Document.

        POST /api/documents/masters/promote/
        Body: { document_id, name, description?, category?, ... }
        """
        doc_id = request.data.get('document_id')
        if not doc_id:
            return Response({'error': 'document_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        doc = get_object_or_404(Document, id=doc_id)
        name = request.data.get('name', doc.title)

        # Check if already a master
        if hasattr(doc, 'master_document_ref') and doc.master_document_ref:
            return Response(
                {'error': 'This document is already a master document.',
                 'master_id': str(doc.master_document_ref.id)},
                status=status.HTTP_409_CONFLICT,
            )

        master = MasterDocument.objects.create(
            name=name,
            description=request.data.get('description', ''),
            template_document=doc,
            category=request.data.get('category', doc.category),
            document_type=request.data.get('document_type', doc.document_type),
            tags=request.data.get('tags', []),
            default_metadata=copy.deepcopy(doc.document_metadata or {}),
            default_custom_metadata=copy.deepcopy(doc.custom_metadata or {}),
            default_parties=copy.deepcopy(doc.parties or []),
            created_by=request.user,
        )

        # Copy AI config from the promoted document into master defaults
        source_ai_cfg = getattr(doc, 'ai_config', None)
        if source_ai_cfg:
            master.default_ai_service_config = copy.deepcopy(source_ai_cfg.services_config or {})
            master.default_ai_system_prompt = source_ai_cfg.system_prompt or ''
            master.default_ai_service_prompts = copy.deepcopy(source_ai_cfg.service_prompts or {})
            master.default_ai_focus = source_ai_cfg.ai_focus or ''
            master.save(update_fields=[
                'default_ai_service_config', 'default_ai_system_prompt',
                'default_ai_service_prompts', 'default_ai_focus', 'updated_at',
            ])

        return Response(
            MasterDocumentDetailSerializer(master).data,
            status=status.HTTP_201_CREATED,
        )


# ─────────────────────────────────────────────────────────────────────────────
# DocumentBranchViewSet
# ─────────────────────────────────────────────────────────────────────────────

class DocumentBranchViewSet(viewsets.ModelViewSet):
    """
    CRUD for branches.

    Endpoints:
      GET    /api/documents/branches/                  – list user's branches
      GET    /api/documents/branches/<uuid>/            – detail
      PATCH  /api/documents/branches/<uuid>/            – update branch metadata
      DELETE /api/documents/branches/<uuid>/            – delete branch (and its document)
      POST   /api/documents/branches/<uuid>/ai-content/ – AI-generate content for branch
      POST   /api/documents/branches/<uuid>/duplicate/  – duplicate this branch
    """
    queryset = DocumentBranch.objects.all()
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
            return DocumentBranchListSerializer
        return DocumentBranchDetailSerializer

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return DocumentBranch.objects.none()

        qs = DocumentBranch.objects.filter(
            Q(created_by=user) |
            Q(master__created_by=user) |
            Q(master__is_public=True) |
            Q(document__created_by=user)
        ).select_related(
            'document', 'master', 'source_document', 'created_by',
        ).distinct()

        # Optional filters
        master_id = self.request.query_params.get('master')
        if master_id:
            qs = qs.filter(master_id=master_id)

        branch_type = self.request.query_params.get('branch_type')
        if branch_type:
            qs = qs.filter(branch_type=branch_type)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs

    def perform_destroy(self, instance):
        """Delete branch and optionally its document."""
        keep_document = self.request.query_params.get('keep_document', 'false').lower() == 'true'
        doc = instance.document

        # Decrement master branch count
        if instance.master:
            if instance.master.branch_count > 0:
                instance.master.branch_count -= 1
                instance.master.save(update_fields=['branch_count', 'updated_at'])

        instance.delete()

        if not keep_document and doc:
            doc.delete()

    # ── AI content generation for a branch ───────────────────────────────

    @action(detail=True, methods=['post'], url_path='ai-content')
    def ai_content(self, request, pk=None):
        """
        Generate or modify content for this branch's document using AI.

        POST /api/documents/branches/<uuid>/ai-content/
        Body: { prompt, merge_strategy? }
        """
        branch = self.get_object()
        doc = branch.document

        if not doc:
            return Response({'error': 'Branch has no associated document.'},
                            status=status.HTTP_400_BAD_REQUEST)

        ser = AIGenerateBranchContentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        prompt = d['prompt']
        strategy = d.get('merge_strategy', 'replace')

        # Build context-aware prompt
        context_prompt = (
            f"You are editing an existing document titled '{doc.title}'.\n"
            f"Document type: {doc.document_type}, Category: {doc.category}\n"
        )
        if branch.master and branch.master.ai_system_prompt:
            context_prompt = branch.master.ai_system_prompt + "\n\n" + context_prompt

        if strategy == 'append':
            context_prompt += (
                f"\nCurrent document has {doc.sections_count} sections. "
                f"Generate ADDITIONAL sections to append. "
                f"Start section ordering from {doc.sections_count}.\n"
            )
        elif strategy == 'merge_sections':
            context_prompt += (
                f"\nThe document currently has these sections:\n"
            )
            for sec in doc.sections.filter(parent__isnull=True).order_by('order')[:20]:
                context_prompt += f"  - {sec.title}\n"
            context_prompt += "\nGenerate updated/merged content for these sections.\n"

        context_prompt += f"\nUser request: {prompt}\n"

        # Call Gemini
        from aiservices.gemini_ingest import (
            _build_payload, call_gemini, extract_function_call_result,
        )

        api_key = os.environ.get('GEMINI_API')
        payload = _build_payload(raw_text=context_prompt)
        resp = call_gemini(payload, api_key=api_key)
        structure = extract_function_call_result(resp)

        if not structure:
            return Response(
                {'error': 'AI did not return a valid document structure.',
                 'raw_response': resp},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Apply the generated content
        with transaction.atomic():
            if strategy == 'replace':
                # Clear existing structure
                doc.sections.all().delete()
                doc.title = structure.get('title', doc.title)

            # Update document metadata from AI output
            if structure.get('document_metadata'):
                for k, v in structure['document_metadata'].items():
                    if isinstance(v, dict) and isinstance(doc.document_metadata.get(k), dict):
                        doc.document_metadata[k].update(v)
                    else:
                        doc.document_metadata[k] = v

            doc.raw_text = structure.get('raw_text', doc.raw_text)
            doc.current_text = structure.get('current_text', doc.current_text)
            doc.save()

            # Create sections from AI output
            from aiservices.gemini_ingest import create_document_in_db
            # We reuse the section-creation logic but target our existing doc
            _create_sections_on_doc(doc, structure.get('sections', []),
                                    start_order=doc.sections_count if strategy == 'append' else 0)

            doc.rebuild_component_indexes()

        return Response({
            'status': 'success',
            'document_id': str(doc.id),
            'branch_id': str(branch.id),
            'sections_created': len(structure.get('sections', [])),
            'merge_strategy': strategy,
        })

    # ── Duplicate a branch ───────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate_branch(self, request, pk=None):
        """
        Create a copy of this branch (and its document).

        POST /api/documents/branches/<uuid>/duplicate/
        Body: { branch_name?, title?, metadata_overrides? }
        """
        source_branch = self.get_object()

        if not source_branch.document:
            return Response({'error': 'Branch has no document to duplicate.'},
                            status=status.HTTP_400_BAD_REQUEST)

        title = request.data.get('title', '')
        branch_name = request.data.get('branch_name', f"{source_branch.branch_name} (Copy)")

        with transaction.atomic():
            new_doc = _deep_clone_document(
                source_branch.document,
                user=request.user,
                title_override=title or f"{source_branch.document.title} (Copy)",
                metadata_overrides=request.data.get('metadata_overrides'),
                custom_metadata_overrides=request.data.get('custom_metadata_overrides'),
            )

            new_branch = DocumentBranch.objects.create(
                master=source_branch.master,
                source_document=source_branch.document,
                document=new_doc,
                branch_name=branch_name,
                branch_notes=request.data.get('branch_notes', f"Duplicated from {source_branch.branch_name}"),
                branch_type='duplicate',
                metadata_overrides=request.data.get('metadata_overrides', {}),
                style_overrides=request.data.get('style_overrides', {}),
                created_by=request.user,
            )

            if source_branch.master:
                source_branch.master.increment_duplicate_count()

        return Response(
            DocumentBranchDetailSerializer(new_branch).data,
            status=status.HTTP_201_CREATED,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Standalone Document Duplication ViewSet
# ─────────────────────────────────────────────────────────────────────────────

class DocumentDuplicateViewSet(viewsets.ViewSet):
    """
    Duplicate any document (master or not) into a new document + optional branch record.

    Endpoints:
      POST /api/documents/duplicate/ – duplicate a document
    """
    permission_classes = [IsAuthenticated]

    def create(self, request):
        """
        POST /api/documents/duplicate/
        Body: {
            source_document: "<uuid>",
            title?: "...",
            branch_name?: "...",
            metadata_overrides?: {...},
            include_structure?: true,
            include_images?: false,
            duplicate_notes?: "..."
        }
        """
        ser = DuplicateDocumentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        source = get_object_or_404(Document, id=d['source_document'])

        with transaction.atomic():
            new_doc = _deep_clone_document(
                source,
                user=request.user,
                title_override=d.get('title') or '',
                metadata_overrides=d.get('metadata_overrides'),
                custom_metadata_overrides=d.get('custom_metadata_overrides'),
                include_structure=d.get('include_structure', True),
                include_images=d.get('include_images', False),
            )

            # Create a branch record for traceability
            branch_name = d.get('branch_name') or f"Duplicate of {source.title}"
            branch = DocumentBranch.objects.create(
                master=getattr(source, 'master_document_ref', None) if hasattr(source, 'master_document_ref') else None,
                source_document=source,
                document=new_doc,
                branch_name=branch_name,
                branch_notes=d.get('duplicate_notes', ''),
                branch_type='duplicate',
                metadata_overrides=d.get('metadata_overrides') or {},
                created_by=request.user,
            )

            # Increment master duplicate count if applicable
            if branch.master:
                branch.master.increment_duplicate_count()

        return Response({
            'status': 'success',
            'document': {
                'id': str(new_doc.id),
                'title': new_doc.title,
            },
            'branch': DocumentBranchListSerializer(branch).data,
            'source_document_id': str(source.id),
        }, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper: create sections on an existing document
# ─────────────────────────────────────────────────────────────────────────────

def _create_sections_on_doc(doc: Document, sections_data: list, start_order: int = 0):
    """
    Create Section → Paragraph → Table tree on an existing Document
    from AI-generated structure data.
    """
    def _process_section(s_data, parent=None, depth=1, order_offset=0):
        sec = Section.objects.create(
            document=doc,
            parent=parent,
            title=(s_data.get('title') or '')[:255],
            content_text=s_data.get('content_text', ''),
            order=s_data.get('order', 0) + order_offset,
            depth_level=s_data.get('depth_level', depth),
            section_type=s_data.get('section_type', 'clause'),
        )

        for p in s_data.get('paragraphs', []):
            Paragraph.objects.create(
                section=sec,
                content_text=p.get('content_text', ''),
                edited_text=p.get('edited_text'),
                order=p.get('order', 0),
                paragraph_type=p.get('paragraph_type', 'standard'),
                topic=p.get('topic', ''),
            )

        for t_data in s_data.get('tables', []) or []:
            Table.objects.create(
                section=sec,
                title=t_data.get('title', ''),
                description=t_data.get('description'),
                num_columns=t_data.get('num_columns', 2),
                num_rows=t_data.get('num_rows', 1),
                column_headers=t_data.get('column_headers', []),
                table_data=t_data.get('table_data', []),
                table_config=t_data.get('table_config', {}),
                table_type=t_data.get('table_type', 'data'),
                order=t_data.get('order', 0),
            )

        for child in s_data.get('children', []):
            _process_section(child, parent=sec, depth=depth + 1,
                             order_offset=order_offset)

    for i, s_data in enumerate(sections_data):
        _process_section(s_data, order_offset=start_order + i)
