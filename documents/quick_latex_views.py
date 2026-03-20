"""
QuickLatexDocumentViewSet — streamlined CRUD + AI + duplicate for
LaTeX-only documents.

A "Quick LaTeX Document" is a standard Document with
``document_mode='quick_latex'``, ``is_latex_code=True``, exactly one
Section, and exactly one LatexCode block.  The ViewSet hides the
Section/LatexCode plumbing and exposes a flat, metadata-centric API.

Registered at  ``/api/documents/quick-latex/``
"""

import copy
import logging
import os
import re
import uuid as uuid_module

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from sharing.permissions import IsOwnerOrSharedWith
from .models import Document, Section, LatexCode, DocumentBranch, DocumentImage
from .quick_latex_serializers import (
    QuickLatexCreateSerializer,
    QuickLatexDocumentSerializer,
    QuickLatexUpdateSerializer,
    QuickLatexDuplicateSerializer,
    QuickLatexAIGenerateSerializer,
    QuickLatexBulkDuplicateSerializer,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ensure_single_latex_block(document, latex_code='', code_type='latex',
                                topic='', user=None):
    """
    Guarantee the document has exactly one Section with one LatexCode block.
    Returns ``(section, latex_block)``.
    """
    section = document.sections.order_by('order').first()
    if not section:
        section = Section.objects.create(
            document=document,
            title=document.title,
            content_text='',
            section_type='body',
            order=0,
            depth_level=1,
        )

    block = section.latex_codes.order_by('order').first()
    if not block:
        block = LatexCode.objects.create(
            section=section,
            latex_code=latex_code,
            code_type=code_type,
            topic=topic,
            order=0,
            modified_by=user,
        )
    elif latex_code and not block.latex_code:
        # Only fill in if the block was empty
        block.latex_code = latex_code
        block.code_type = code_type
        block.topic = topic
        block.modified_by = user
        block.save(update_fields=['latex_code', 'code_type', 'topic', 'modified_by'])

    return section, block


def _deep_merge(base: dict, incoming: dict) -> dict:
    """Recursively merge *incoming* into *base* (mutates base)."""
    for key, value in (incoming or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


def _extract_placeholders(latex_code: str) -> list[str]:
    """Return sorted unique [[placeholder]] keys from *latex_code*.
    Excludes image placeholders (``[[image:...]]``)."""
    if not latex_code:
        return []
    all_keys = set(re.findall(r'\[\[([^\]]+)\]\]', latex_code))
    # Filter out image placeholders — those start with "image:"
    return sorted(k for k in all_keys if not k.startswith('image:'))


def _extract_image_placeholders(latex_code: str) -> list[str]:
    """Return sorted unique image UUIDs from ``[[image:<uuid>]]`` patterns."""
    if not latex_code:
        return []
    return sorted(set(re.findall(r'\[\[image:([0-9a-fA-F\-]{36})\]\]', latex_code)))


_UUID_RE = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


def _extract_named_image_placeholders(latex_code: str) -> list[str]:
    """Return sorted unique **named** image placeholders from
    ``[[image:descriptive_name]]`` patterns — i.e. those whose value is
    *not* a UUID (named slots awaiting user mapping).
    """
    if not latex_code:
        return []
    all_img = set(re.findall(r'\[\[image:([^\]]+)\]\]', latex_code))
    return sorted(n for n in all_img if not _UUID_RE.match(n))


def _seed_metadata_from_placeholders(doc, latex_code: str, *, save: bool = True):
    """
    Extract ``[[placeholder]]`` keys from *latex_code* and seed them into
    ``doc.document_metadata`` as empty-string values for any key that
    doesn't already have a value.  This ensures newly-created or
    AI-generated documents expose their placeholder fields immediately.

    Also seeds ``_image_placeholders`` for named image slots
    (e.g. ``[[image:company_logo]]``) so the frontend can display them
    for user mapping.

    Returns the list of text placeholder keys found.
    """
    keys = _extract_placeholders(latex_code)
    named_images = _extract_named_image_placeholders(latex_code)

    changed = False
    meta = doc.document_metadata
    if not isinstance(meta, dict):
        meta = {}
        doc.document_metadata = meta

    # Seed text placeholders
    for key in keys:
        if key not in meta or meta[key] is None:
            meta[key] = ''
            changed = True

    # Seed image placeholders — stored as {name: null} (unmapped) or {name: "<uuid>"}
    if named_images:
        img_map = meta.get('_image_placeholders', {})
        if not isinstance(img_map, dict):
            img_map = {}
        for name in named_images:
            if name not in img_map:
                img_map[name] = None      # unmapped
                changed = True
        meta['_image_placeholders'] = img_map

    if changed and save:
        doc.save(update_fields=['document_metadata'])

    return keys


def _clone_quick_latex(source: Document, *, user=None,
                       title_override='',
                       metadata_overrides=None,
                       custom_metadata_overrides=None,
                       parties_override=None):
    """
    Deep-clone a Quick LaTeX document.  Copies the single Section + LatexCode block
    and applies optional metadata overrides (deep-merged).
    """
    new_doc = Document(
        title=title_override or f"{source.title} (Copy)",
        raw_text=source.raw_text or '',
        current_text=source.current_text or '',
        is_latex_code=True,
        latex_code=source.latex_code or '',
        document_mode='quick_latex',
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
        parties=parties_override if parties_override is not None else copy.deepcopy(source.parties or []),
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

    if metadata_overrides:
        _deep_merge(new_doc.document_metadata, metadata_overrides)
    if custom_metadata_overrides:
        _deep_merge(new_doc.custom_metadata, custom_metadata_overrides)

    new_doc.save()

    # Clone the single section + latex block
    src_section = source.sections.order_by('order').first()
    src_block = None
    if src_section:
        src_block = src_section.latex_codes.order_by('order').first()

    new_section = Section.objects.create(
        document=new_doc,
        title=src_section.title if src_section else new_doc.title,
        content_text=src_section.content_text if src_section else '',
        section_type=src_section.section_type if src_section else 'body',
        order=0,
        depth_level=1,
        custom_metadata=copy.deepcopy(src_section.custom_metadata or {}) if src_section else {},
    )

    LatexCode.objects.create(
        section=new_section,
        latex_code=src_block.latex_code if src_block else (source.latex_code or ''),
        edited_code=src_block.edited_code if src_block else None,
        has_edits=src_block.has_edits if src_block else False,
        code_type=src_block.code_type if src_block else 'latex',
        topic=src_block.topic if src_block else '',
        custom_metadata=copy.deepcopy(src_block.custom_metadata or {}) if src_block else {},
        order=0,
        modified_by=user,
    )

    # Clone AI config if present
    try:
        from documents.branching_views import _clone_ai_config
        _clone_ai_config(source, new_doc)
    except Exception:
        pass

    new_doc.rebuild_component_indexes()
    return new_doc


# ─────────────────────────────────────────────────────────────────────────────
# ViewSet
# ─────────────────────────────────────────────────────────────────────────────

class QuickLatexDocumentViewSet(viewsets.ModelViewSet):
    """
    CRUD + AI + duplicate for Quick LaTeX documents.

    Endpoints (under ``/api/documents/quick-latex/``):
      GET    /                               – list quick-latex docs
      POST   /                               – create a new quick-latex doc
      GET    /<uuid>/                        – retrieve
      PATCH  /<uuid>/                        – update metadata + LaTeX code
      DELETE /<uuid>/                        – delete
      POST   /<uuid>/duplicate/              – duplicate with metadata overrides
      POST   /<uuid>/bulk-duplicate/         – batch-duplicate (repository pattern)
      POST   /<uuid>/ai-generate/            – generate / regenerate LaTeX via AI
      GET    /<uuid>/placeholders/           – list [[key]] placeholders in code
      PATCH  /<uuid>/metadata/               – update only document_metadata
      POST   /from-source/                   – create from an existing document
    """
    permission_classes = [IsAuthenticated, IsOwnerOrSharedWith]
    serializer_class = QuickLatexDocumentSerializer

    def get_queryset(self):
        from sharing.models import Share

        user = self.request.user
        if not user or not user.is_authenticated:
            return Document.objects.none()

        shared_doc_ids = list(
            Share.objects.filter(
                shared_with_user=user,
                is_active=True,
                content_type__model='document',
            ).values_list('object_id', flat=True)
        )

        return Document.objects.filter(
            document_mode='quick_latex',
        ).filter(
            Q(created_by=user) | Q(id__in=shared_doc_ids)
        ).distinct().order_by('-created_at')

    # ── Serializer routing ───────────────────────────────────────────────

    def get_serializer_class(self):
        if self.action == 'create':
            return QuickLatexCreateSerializer
        if self.action in ('update', 'partial_update'):
            return QuickLatexUpdateSerializer
        return QuickLatexDocumentSerializer

    # ── CREATE ───────────────────────────────────────────────────────────

    def create(self, request, *args, **kwargs):
        """
        POST /api/documents/quick-latex/
        Create a Quick LaTeX document (optionally from a source document).
        """
        ser = QuickLatexCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        source_id = d.get('source_document_id')

        with transaction.atomic():
            if source_id:
                # ── Duplicate from source ────────────────────────────────
                source = get_object_or_404(Document, id=source_id)
                doc = _clone_quick_latex(
                    source,
                    user=request.user,
                    title_override=d.get('title', ''),
                    metadata_overrides=d.get('metadata_overrides'),
                    custom_metadata_overrides=d.get('custom_metadata_overrides'),
                )
                # Override any top-level fields the caller passed
                for field in ('document_type', 'category', 'author',
                              'effective_date', 'expiration_date'):
                    val = d.get(field)
                    if val not in (None, ''):
                        setattr(doc, field, val)
                if d.get('parties'):
                    doc.parties = d['parties']
                if d.get('document_metadata'):
                    _deep_merge(doc.document_metadata, d['document_metadata'])
                if d.get('custom_metadata'):
                    _deep_merge(doc.custom_metadata, d['custom_metadata'])
                doc.save()

                # If caller also sent latex_code, overwrite
                if d.get('latex_code'):
                    section = doc.sections.order_by('order').first()
                    if section:
                        block = section.latex_codes.order_by('order').first()
                        if block:
                            block.latex_code = d['latex_code']
                            block.has_edits = False
                            block.edited_code = None
                            block.save(update_fields=['latex_code', 'has_edits', 'edited_code'])
                    doc.latex_code = d['latex_code']
                    doc.save(update_fields=['latex_code'])

            else:
                # ── Create from scratch ──────────────────────────────────
                doc = Document(
                    title=d.get('title', 'Untitled LaTeX Document'),
                    raw_text='',
                    current_text='',
                    is_latex_code=True,
                    latex_code=d.get('latex_code', ''),
                    document_mode='quick_latex',
                    document_type=d.get('document_type', 'contract'),
                    category=d.get('category', 'contract'),
                    author=d.get('author', ''),
                    effective_date=d.get('effective_date'),
                    expiration_date=d.get('expiration_date'),
                    document_metadata=d.get('document_metadata', {}),
                    custom_metadata=d.get('custom_metadata', {}),
                    parties=d.get('parties', []),
                    status='draft',
                    created_by=request.user,
                )
                doc.save()

                _ensure_single_latex_block(
                    doc,
                    latex_code=d.get('latex_code', ''),
                    code_type=d.get('code_type', 'latex'),
                    topic=d.get('topic', ''),
                    user=request.user,
                )

                doc.rebuild_component_indexes()

            # Seed document_metadata with [[placeholder]] keys from latex_code
            effective_code = doc.latex_code or ''
            _seed_metadata_from_placeholders(doc, effective_code)

        return Response(
            QuickLatexDocumentSerializer(doc).data,
            status=status.HTTP_201_CREATED,
        )

    # ── UPDATE (PATCH) ───────────────────────────────────────────────────

    def partial_update(self, request, *args, **kwargs):
        """
        PATCH /api/documents/quick-latex/<uuid>/
        Update document fields AND/OR the LaTeX code in one request.
        """
        doc = self.get_object()
        ser = QuickLatexUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        # ── Document-level fields ────────────────────────────────────────
        doc_fields_updated = []
        simple_fields = [
            'title', 'author', 'document_type', 'category', 'status',
            'effective_date', 'expiration_date', 'execution_date',
            'governing_law', 'reference_number', 'project_name',
        ]
        for f in simple_fields:
            if f in d:
                setattr(doc, f, d[f])
                doc_fields_updated.append(f)

        json_fields = ['parties', 'signatories']
        for f in json_fields:
            if f in d:
                setattr(doc, f, d[f])
                doc_fields_updated.append(f)

        if 'document_metadata' in d:
            _deep_merge(doc.document_metadata, d['document_metadata'])
            doc_fields_updated.append('document_metadata')

        if 'custom_metadata' in d:
            _deep_merge(doc.custom_metadata, d['custom_metadata'])
            doc_fields_updated.append('custom_metadata')

        # ── LaTeX code ───────────────────────────────────────────────────
        if 'latex_code' in d:
            doc.latex_code = d['latex_code']
            doc_fields_updated.append('latex_code')

            # Also update the LatexCode block
            section = doc.sections.order_by('order').first()
            if section:
                block = section.latex_codes.order_by('order').first()
                if block:
                    block.latex_code = d['latex_code']
                    block.has_edits = False
                    block.edited_code = None
                    block_update = ['latex_code', 'has_edits', 'edited_code']
                    if 'code_type' in d:
                        block.code_type = d['code_type']
                        block_update.append('code_type')
                    if 'topic' in d:
                        block.topic = d['topic']
                        block_update.append('topic')
                    block.modified_by = request.user
                    block.edit_count = (block.edit_count or 0) + 1
                    block_update.extend(['modified_by', 'edit_count'])
                    block.save(update_fields=block_update)

        if doc_fields_updated:
            doc.last_modified_by = request.user
            doc_fields_updated.append('last_modified_by')
            doc.save(update_fields=doc_fields_updated + ['updated_at'])

        return Response(QuickLatexDocumentSerializer(doc).data)

    # ── DUPLICATE ────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/duplicate/
        Duplicate this Quick LaTeX document with optional metadata overrides.
        """
        source = self.get_object()
        ser = QuickLatexDuplicateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        with transaction.atomic():
            new_doc = _clone_quick_latex(
                source,
                user=request.user,
                title_override=d.get('title', ''),
                metadata_overrides=d.get('metadata_overrides'),
                custom_metadata_overrides=d.get('custom_metadata_overrides'),
                parties_override=d.get('parties_override'),
            )

            # Create branch record for traceability
            DocumentBranch.objects.create(
                master=getattr(source, 'master_document_ref', None) if hasattr(source, 'master_document_ref') else None,
                source_document=source,
                document=new_doc,
                branch_name=d.get('title') or f"Duplicate of {source.title}",
                branch_notes=d.get('duplicate_notes', ''),
                branch_type='duplicate',
                metadata_overrides=d.get('metadata_overrides') or {},
                created_by=request.user,
            )

        return Response(
            {
                'status': 'success',
                'document': QuickLatexDocumentSerializer(new_doc).data,
                'source_document_id': str(source.id),
            },
            status=status.HTTP_201_CREATED,
        )

    # ── BULK DUPLICATE (repository pattern) ──────────────────────────────

    @action(detail=True, methods=['post'], url_path='bulk-duplicate')
    def bulk_duplicate(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/bulk-duplicate/
        Create multiple copies with different metadata per copy.

        Body:
        {
            "copies": [
                {"title": "Contract A", "metadata_overrides": {"client_name": "Acme"}, ...},
                {"title": "Contract B", "metadata_overrides": {"client_name": "Globex"}, ...}
            ]
        }
        """
        source = self.get_object()
        ser = QuickLatexBulkDuplicateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        copies_spec = ser.validated_data['copies']
        results = []

        with transaction.atomic():
            for spec in copies_spec:
                new_doc = _clone_quick_latex(
                    source,
                    user=request.user,
                    title_override=spec.get('title', ''),
                    metadata_overrides=spec.get('metadata_overrides'),
                    custom_metadata_overrides=spec.get('custom_metadata_overrides'),
                    parties_override=spec.get('parties_override'),
                )
                results.append({
                    'id': str(new_doc.id),
                    'title': new_doc.title,
                })

        return Response(
            {
                'status': 'success',
                'source_document_id': str(source.id),
                'created': results,
                'count': len(results),
            },
            status=status.HTTP_201_CREATED,
        )

    # ── AI PREVIEW (no document required) ──────────────────────────────

    @action(detail=False, methods=['post'], url_path='ai-preview')
    def ai_preview(self, request):
        """
        POST /api/documents/quick-latex/ai-preview/
        Generate LaTeX/HTML code from an AI prompt WITHOUT creating or
        modifying any document. Returns the generated code for the user
        to review before they accept and create the document.

        Body: { "prompt": "...", "title": "...", "document_type": "...",
                "code_type": "latex"|"html" }
        Returns: { "status": "success", "latex_code": "...", "code_type": "..." }
        """
        prompt = (request.data.get('prompt') or '').strip()
        if not prompt:
            return Response(
                {'status': 'error', 'message': 'prompt is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        doc_title = request.data.get('title', 'Untitled Document')
        doc_type = request.data.get('document_type', 'general')
        code_type = request.data.get('code_type', 'latex')

        from aiservices.gemini_ingest import call_gemini

        api_key = os.environ.get('GEMINI_API')
        if not api_key:
            return Response(
                {'status': 'error', 'message': 'AI API key not configured.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if code_type == 'html':
            system_prompt = (
                "You are an expert HTML document generator. You produce clean, "
                "semantic HTML documents suitable for PDF conversion via xhtml2pdf.\n\n"
                "RULES:\n"
                "1. Return ONLY the HTML source code — no explanations, no markdown fences.\n"
                "2. Produce a complete HTML document with <!DOCTYPE html>, <html>, <head>, <body>.\n"
                "3. Include inline CSS in a <style> tag for professional formatting.\n"
                "4. Use @page CSS rules for print layout: margins, page size (A4).\n"
                "5. Use semantic HTML: <h1>, <h2>, <p>, <table>, <ul>, <ol>, <strong>, <em>.\n"
                "6. For tables use <table>, <thead>, <tbody>, <th>, <td> with CSS borders.\n"
                "7. Use [[field_name]] double-bracket placeholders for dynamic values.\n"
                "   Example: <p>This agreement is between [[party_a]] and [[party_b]].</p>\n"
                "8. NEVER use single brackets [like this] for placeholder text.\n"
                "9. The HTML MUST render correctly in xhtml2pdf.\n"
                "10. For professional look: use font-family sans-serif, proper heading hierarchy.\n"
            )
        else:
            system_prompt = (
                "You are an expert LaTeX code generator. You produce clean, compilable "
                "LaTeX documents using standard packages.\n\n"
                "RULES:\n"
                "1. Return ONLY the LaTeX source code — no explanations, no markdown fences.\n"
                "2. Always include a complete, self-contained LaTeX document.\n"
                "3. Use standard packages: amsmath, amssymb, geometry, hyperref, graphicx, "
                "   fancyhdr, enumitem, titlesec, xcolor.\n"
                "4. For tables, use booktabs and longtable.\n"
                "5. Produce professional, well-formatted output suitable for XeLaTeX.\n"
                "6. Use [[field_name]] double-bracket placeholders for dynamic values.\n"
                "   CRITICAL: NEVER place a backslash before [[ — write [[x]] directly.\n"
                "   IMPORTANT: When using [[placeholder]] after a LaTeX command, ALWAYS "
                "   wrap it in braces: \\author{[[name]]}, \\title{[[title]]}.\n"
                "7. The output MUST compile without errors under XeLaTeX.\n"
            )

        user_message = (
            f"Document: \"{doc_title}\" (type: {doc_type})\n\n"
            f"User request:\n{prompt}"
        )

        payload = {
            'contents': [
                {
                    'role': 'user',
                    'parts': [
                        {'text': system_prompt},
                        {'text': user_message},
                    ],
                }
            ],
            'generationConfig': {
                'temperature': 0.3,
                'topP': 0.9,
                'topK': 40,
                'maxOutputTokens': 16000,
            },
        }

        try:
            raw_response = call_gemini(payload, api_key=api_key)
        except Exception as exc:
            return Response(
                {'status': 'error', 'message': f'AI call failed: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        generated_code = ''
        try:
            candidates = raw_response.get('candidates', [])
            if candidates:
                parts = candidates[0].get('content', {}).get('parts', [])
                raw_text = ''.join(p.get('text', '') for p in parts)
                if code_type == 'html':
                    fence_match = re.search(r'```(?:html?)?\s*\n?(.*?)```', raw_text, re.DOTALL)
                else:
                    fence_match = re.search(r'```(?:latex|tex)?\s*\n?(.*?)```', raw_text, re.DOTALL)
                generated_code = fence_match.group(1).strip() if fence_match else raw_text.strip()
        except Exception:
            generated_code = ''

        lang_label = "HTML" if code_type == 'html' else "LaTeX"
        if not generated_code:
            return Response(
                {'status': 'error', 'message': f'AI did not return valid {lang_label} code.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Sanitize AI-generated code to fix common errors
        from .latex_render_views import sanitize_ai_latex_code
        if code_type != 'html':
            generated_code = sanitize_ai_latex_code(generated_code)

        return Response({
            'status': 'success',
            'latex_code': generated_code,
            'code_type': code_type,
            'placeholders': _extract_placeholders(generated_code),
        })

    # ── AI GENERATE ──────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='ai-generate')
    def ai_generate(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/ai-generate/
        Generate / regenerate the LaTeX code using Gemini AI.

        Delegates to the existing ``ai_generate_latex`` pipeline but
        simplifies the interface for quick-latex documents.
        """
        doc = self.get_object()
        ser = QuickLatexAIGenerateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        prompt = d['prompt']
        preamble = d.get('preamble', '')
        replace_mode = d.get('replace', True)
        code_type = d.get('code_type', 'latex')
        ai_mode = d.get('mode', 'generate')  # 'generate' or 'edit'

        # Get the section + block
        section, block = _ensure_single_latex_block(doc, user=request.user)

        # Build the request payload expected by ai_generate_latex
        from django.test import RequestFactory
        factory = RequestFactory()
        ai_request_data = {
            'prompt': prompt,
            'save': True,
            'section_id': str(section.id),
            'preamble': preamble,
            'code_type': block.code_type or 'latex',
            'topic': block.topic or prompt[:255],
        }

        # If not replacing, ask AI to extend existing code
        if not replace_mode and block.get_effective_content():
            ai_request_data['prompt'] = (
                f"The document already has LaTeX code. "
                f"Please EXTEND (not replace) it with the following:\n\n{prompt}"
            )

        # Call the existing ai_generate_latex view function directly
        from aiservices.views import ai_generate_latex as _ai_generate_latex
        from rest_framework.test import APIRequestFactory

        # Instead of calling the view function, replicate the core logic
        # to avoid request/response overhead
        from aiservices.views import _get_document_ai_context
        from aiservices.gemini_ingest import call_gemini

        api_key = os.environ.get('GEMINI_API')
        if not api_key:
            return Response(
                {'status': 'error', 'message': 'AI API key not configured.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Build AI context
        document_ai_context = _get_document_ai_context(doc, service_name='latex_generation')

        # Check if service is enabled
        from aiservices.models import DocumentAIConfig
        ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)
        effective_config = ai_cfg.get_effective_config()
        latex_svc = effective_config.get('latex_generation', {})
        if isinstance(latex_svc, dict) and not latex_svc.get('enabled', True):
            return Response(
                {'status': 'error', 'message': 'LaTeX generation is disabled for this document.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # ── Build metadata placeholder info ──────────────────────────────
        INTERNAL_KEY_PREFIXES = (
            'processing_settings', 'search_metadata', 'ai_config',
            'ai_prompt_open', 'header_pdf', 'footer_pdf', 'header_config',
            'footer_config', 'page_settings', 'export_settings',
        )
        metadata = {}
        try:
            if doc.document_metadata:
                metadata.update(doc.document_metadata)
            if doc.custom_metadata:
                metadata.update(doc.custom_metadata)
        except Exception:
            pass

        def _collect_keys(data, prefix=''):
            keys = []
            for k, v in (data or {}).items():
                full = f"{prefix}.{k}" if prefix else k
                root_key = full.split('.')[0]
                if root_key in INTERNAL_KEY_PREFIXES:
                    continue
                if isinstance(v, dict):
                    keys.extend(_collect_keys(v, full))
                else:
                    keys.append(full)
            return keys

        available_keys = _collect_keys(metadata)
        sample_lines = []
        for k in available_keys[:40]:
            parts = k.split('.')
            val = metadata
            for p in parts:
                if isinstance(val, dict):
                    val = val.get(p, '')
                else:
                    val = ''
                    break
            sample_lines.append(f"  [[{k}]] → {str(val)[:80]}")

        doc_title = doc.title or 'Untitled Document'
        doc_type = doc.document_type or 'general'
        existing_code = doc.latex_code or ''

        if code_type == 'html':
            system_prompt = (
                f"{document_ai_context}"
                "You are an expert HTML document generator. You produce clean, "
                "semantic HTML documents suitable for PDF conversion via xhtml2pdf.\n\n"
                "RULES:\n"
                "1. Return ONLY the HTML source code — no explanations, no markdown fences.\n"
                "2. Produce a complete HTML document with <!DOCTYPE html>, <html>, <head>, <body>.\n"
                "3. Include inline CSS in a <style> tag for professional formatting.\n"
                "4. Use @page CSS rules for print layout: margins, page size (A4).\n"
                "5. Use semantic HTML: <h1>, <h2>, <p>, <table>, <ul>, <ol>, <strong>, <em>.\n"
                "6. For tables use <table>, <thead>, <tbody>, <th>, <td> with CSS borders.\n"
                "7. Use [[field_name]] double-bracket placeholders for dynamic values.\n"
                "   Example: <p>This agreement is between [[party_a]] and [[party_b]].</p>\n"
                "8. NEVER use single brackets [like this] for placeholder text.\n"
                "9. The HTML MUST render correctly in xhtml2pdf (a subset of HTML/CSS).\n"
                "   Supported CSS: font-family, font-size, color, background, margin, padding,\n"
                "   border, text-align, display:block/inline, width, height, page-break-before/after.\n"
                "   Avoid: flexbox, grid, CSS variables, calc(), advanced selectors.\n"
                "10. For professional look: use font-family sans-serif, proper heading hierarchy,\n"
                "    adequate spacing, and subtle colors (#1a1a1a text, #f3f4f6 table headers).\n"
                "11. IMAGE PLACEHOLDERS: Where an image would naturally appear (company logo,\n"
                "    signature block, stamp, diagram, etc.), insert [[image:descriptive_name]]\n"
                "    using a snake_case name. Examples:\n"
                "      <div class=\"logo\">[[image:company_logo]]</div>\n"
                "      <div class=\"signature\">[[image:signature]]</div>\n"
                "      <div class=\"stamp\">[[image:company_stamp]]</div>\n"
                "    The user will map actual uploaded images to these slots later.\n"
                "    Use descriptive names: company_logo, header_logo, signature, stamp,\n"
                "    diagram_1, chart_overview, letterhead_bg, etc.\n"
            )
        else:
            system_prompt = (
                f"{document_ai_context}"
                "You are an expert LaTeX code generator. You produce clean, compilable "
                "LaTeX documents using standard packages.\n\n"
                "RULES:\n"
                "1. Return ONLY the LaTeX source code — no explanations, no markdown fences.\n"
                "2. Always include a complete, self-contained LaTeX document.\n"
                "3. Use standard packages: amsmath, amssymb, geometry, hyperref, graphicx, "
                "   fancyhdr, enumitem, titlesec, xcolor.\n"
                "4. For tables, use booktabs and longtable.\n"
                "5. Produce professional, well-formatted output suitable for XeLaTeX.\n"
                "6. NEVER use square brackets for placeholder text like [Your Name]. "
                "   Use [[field_name]] double-bracket placeholders for dynamic values.\n"
                "   CRITICAL: NEVER place a backslash before [[ — writing \\[[x]] "
                "   creates \\[ which triggers LaTeX math mode and crashes the compiler. "
                "   Write [[x]] WITHOUT a preceding backslash.\n"
                "   IMPORTANT: When using [[placeholder]] after a LaTeX command, ALWAYS "
                "   wrap it in braces: \\author{[[name]]}, \\title{[[title]]}, "
                "   \\textbf{[[value]]}. NEVER write \\author[[name]] without braces.\n"
                "7. The output MUST compile without errors under XeLaTeX.\n"
                "8. IMAGE PLACEHOLDERS: Where an image would naturally appear (company logo,\n"
                "   signature block, stamp, diagram, etc.), insert [[image:descriptive_name]]\n"
                "   as a BARE placeholder — do NOT wrap it in \\includegraphics.\n"
                "   The system will automatically generate the correct \\includegraphics\n"
                "   command with proper file paths at render time.\n"
                "   You MAY wrap [[image:name]] in a figure environment for layout:\n"
                "     \\begin{figure}[h]\\centering [[image:company_logo]] \\end{figure}\n"
                "   But write the placeholder DIRECTLY — never write:\n"
                "     \\includegraphics[width=3cm]{[[image:logo]]}  ← WRONG\n"
                "   Instead write:\n"
                "     [[image:logo]]  ← CORRECT\n"
                "   Use descriptive snake_case names: company_logo, header_logo, signature,\n"
                "   stamp, diagram_1, chart_overview, letterhead_bg, etc.\n"
                "9. NEVER use \\includegraphics directly. Never write \\includegraphics{} "
                "   with an empty path, a URL, or a [[placeholder]]. The system handles all "
                "   image inclusion automatically from [[image:name]] placeholders.\n"
            )

        if preamble:
            system_prompt += f"\nCustom preamble:\n---\n{preamble}\n---\n"

        lang_label = "HTML" if code_type == 'html' else "LaTeX"

        if ai_mode == 'edit' and existing_code:
            # ── Edit mode: modify existing code based on instructions ──
            system_prompt += (
                f"\nMODE: EDIT EXISTING CODE\n"
                f"You have been given existing {lang_label} code below. "
                f"Apply the user's requested changes to this code. "
                f"Return the COMPLETE updated document — not just the changed parts.\n"
                f"Preserve all existing structure, formatting, and [[placeholder]] "
                f"placeholders unless the user specifically asks to change them.\n"
                f"Do NOT add explanations, comments about what changed, or markdown fences.\n\n"
                f"--- EXISTING {lang_label.upper()} CODE ---\n"
                f"{existing_code[:8000]}\n"
                f"--- END EXISTING CODE ---\n"
            )
        elif not replace_mode and existing_code:
            system_prompt += (
                f"\nExisting {lang_label} code (EXTEND, do not replace):\n"
                f"--- EXISTING ---\n{existing_code[:3000]}\n--- END ---\n"
            )

        if sample_lines:
            system_prompt += (
                "\n\nMETADATA PLACEHOLDERS:\n"
                "Use [[key]] to insert dynamic values:\n"
                + '\n'.join(sample_lines) + "\n"
            )

        if ai_mode == 'edit':
            user_message = (
                f"Document: \"{doc_title}\" (type: {doc_type})\n\n"
                f"Edit instructions:\n{prompt}"
            )
        else:
            user_message = (
                f"Document: \"{doc_title}\" (type: {doc_type})\n\n"
                f"User request:\n{prompt}"
            )

        payload = {
            'contents': [
                {
                    'role': 'user',
                    'parts': [
                        {'text': system_prompt},
                        {'text': user_message},
                    ],
                }
            ],
            'generationConfig': {
                'temperature': 0.3,
                'topP': 0.9,
                'topK': 40,
                'maxOutputTokens': 16000,
            },
        }

        try:
            raw_response = call_gemini(payload, api_key=api_key)
        except Exception as exc:
            return Response(
                {'status': 'error', 'message': f'AI call failed: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Extract code from response
        generated_code = ''
        try:
            candidates = raw_response.get('candidates', [])
            if candidates:
                parts = candidates[0].get('content', {}).get('parts', [])
                raw_text = ''.join(p.get('text', '') for p in parts)
                if code_type == 'html':
                    fence_match = re.search(
                        r'```(?:html?)?\s*\n?(.*?)```',
                        raw_text,
                        re.DOTALL,
                    )
                else:
                    fence_match = re.search(
                        r'```(?:latex|tex)?\s*\n?(.*?)```',
                        raw_text,
                        re.DOTALL,
                    )
                generated_code = fence_match.group(1).strip() if fence_match else raw_text.strip()
        except Exception:
            generated_code = ''

        lang_label = "HTML" if code_type == 'html' else "LaTeX"
        if not generated_code:
            return Response(
                {'status': 'error', 'message': f'AI did not return valid {lang_label} code.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        # Sanitize AI-generated code to fix common errors
        from .latex_render_views import sanitize_ai_latex_code
        if code_type != 'html':
            generated_code = sanitize_ai_latex_code(generated_code)

        # Save to document + block
        doc.latex_code = generated_code
        doc.is_latex_code = True
        doc.save(update_fields=['latex_code', 'is_latex_code'])

        block.latex_code = generated_code
        block.code_type = code_type
        block.has_edits = False
        block.edited_code = None
        block.topic = block.topic or prompt[:255]
        block.modified_by = request.user
        block.edit_count = (block.edit_count or 0) + 1
        block.save(update_fields=[
            'latex_code', 'code_type', 'has_edits', 'edited_code', 'topic',
            'modified_by', 'edit_count',
        ])

        # Seed document_metadata with newly-discovered [[placeholder]] keys
        _seed_metadata_from_placeholders(doc, generated_code)

        return Response({
            'status': 'success',
            'latex_code': generated_code,
            'code_type': code_type,
            'document': QuickLatexDocumentSerializer(doc).data,
        })

    # ── SWITCH CODE TYPE ─────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='switch-code-type')
    def switch_code_type(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/switch-code-type/
        Switch the code block between 'latex' and 'html'.
        Optionally converts existing code via AI.

        Body: { "code_type": "html"|"latex", "convert": true|false }
        """
        doc = self.get_object()
        new_type = request.data.get('code_type')
        if new_type not in ('latex', 'html'):
            return Response(
                {'error': "code_type must be 'latex' or 'html'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        section, block = _ensure_single_latex_block(doc, user=request.user)
        old_type = block.code_type or 'latex'

        if old_type == new_type:
            return Response({
                'status': 'unchanged',
                'code_type': new_type,
                'document': QuickLatexDocumentSerializer(doc).data,
            })

        convert = request.data.get('convert', False)

        if convert and block.get_effective_content():
            # Use AI to convert the code
            from aiservices.gemini_ingest import call_gemini
            api_key = os.environ.get('GEMINI_API')
            if not api_key:
                return Response(
                    {'status': 'error', 'message': 'AI API key not configured.'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            existing = block.get_effective_content()[:6000]
            src_label = "LaTeX" if old_type == 'latex' else "HTML"
            dst_label = "HTML" if new_type == 'html' else "LaTeX"

            convert_prompt = (
                f"Convert the following {src_label} document to {dst_label}. "
                f"Preserve ALL content, structure, formatting, and [[placeholder]] "
                f"double-bracket placeholders exactly as they are.\n"
                f"Return ONLY the converted {dst_label} code — no explanations.\n\n"
                f"--- {src_label} SOURCE ---\n{existing}\n--- END ---"
            )

            payload = {
                'contents': [{'role': 'user', 'parts': [{'text': convert_prompt}]}],
                'generationConfig': {
                    'temperature': 0.2,
                    'topP': 0.9,
                    'maxOutputTokens': 16000,
                },
            }

            try:
                raw_response = call_gemini(payload, api_key=api_key)
                candidates = raw_response.get('candidates', [])
                raw_text = ''
                if candidates:
                    parts = candidates[0].get('content', {}).get('parts', [])
                    raw_text = ''.join(p.get('text', '') for p in parts)

                fence_pat = r'```(?:html?|latex|tex)?\s*\n?(.*?)```'
                fence_match = re.search(fence_pat, raw_text, re.DOTALL)
                converted = fence_match.group(1).strip() if fence_match else raw_text.strip()

                if converted:
                    block.latex_code = converted
                    doc.latex_code = converted
            except Exception:
                pass  # Fall through — just switch the type without converting

        block.code_type = new_type
        block.modified_by = request.user
        block.edit_count = (block.edit_count or 0) + 1
        block.save(update_fields=['latex_code', 'code_type', 'modified_by', 'edit_count'])

        doc.save(update_fields=['latex_code', 'updated_at'])

        return Response({
            'status': 'success',
            'code_type': new_type,
            'converted': convert and bool(block.get_effective_content()),
            'document': QuickLatexDocumentSerializer(doc).data,
        })

    # ── SAVE PDF ─────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='save-pdf')
    def save_pdf(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/save-pdf/
        Accepts base64-encoded PDF and stores it as a media file.

        Body: { "pdf_base64": "...", "filename": "optional.pdf" }
        """
        doc = self.get_object()
        pdf_b64 = request.data.get('pdf_base64')
        if not pdf_b64:
            return Response(
                {'error': 'pdf_base64 is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filename = request.data.get('filename', f'{doc.title or "document"}.pdf')

        import base64 as _b64
        from django.core.files.base import ContentFile
        from django.core.files.storage import default_storage

        pdf_bytes = _b64.b64decode(pdf_b64)
        file_content = ContentFile(pdf_bytes, name=filename)

        path = default_storage.save(
            f'quick_latex_pdfs/{doc.id}/{filename}',
            file_content,
        )

        meta = doc.custom_metadata or {}
        meta['rendered_pdf_path'] = path
        meta['rendered_pdf_filename'] = filename
        doc.custom_metadata = meta
        doc.save(update_fields=['custom_metadata'])

        return Response({
            'status': 'success',
            'pdf_path': path,
            'filename': filename,
            'document': QuickLatexDocumentSerializer(doc).data,
        })

    # ── EXPORT SETTINGS ──────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'patch'], url_path='export-settings')
    def export_settings(self, request, pk=None):
        """
        GET/PATCH /api/documents/quick-latex/<uuid>/export-settings/

        Mirrors the DocumentViewSet.export_settings endpoint for quick-latex
        documents so the frontend can use the quick-latex URL namespace.

        GET  → returns current processing_settings + org defaults
        PATCH → deep-merges incoming processing_settings into custom_metadata
        """
        doc = self.get_object()

        def _safe_dict(value):
            if not isinstance(value, dict):
                return {}
            return value

        def _clean_processing_settings(ps):
            if not isinstance(ps, dict):
                return {}
            return {k: v for k, v in ps.items() if v != '__removed__' and v is not None}

        custom_metadata = doc.custom_metadata if isinstance(doc.custom_metadata, dict) else {}
        processing_settings = custom_metadata.get('processing_settings')
        if not isinstance(processing_settings, dict):
            processing_settings = {}

        if request.method.lower() == 'get':
            org_defaults = {}
            try:
                from user_management.models import OrganizationDocumentSettings
                organization = request.user.profile.organization
                settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                    organization=organization
                )
                preferences = settings_obj.preferences if isinstance(settings_obj.preferences, dict) else {}
                org_defaults = preferences.get('processing_defaults') or {}
            except Exception:
                org_defaults = {}

            # Ensure pdf_layout has defaults
            try:
                from exporter.pdf_system import PDFLayoutOptions
                if not isinstance(processing_settings.get('pdf_layout'), dict):
                    processing_settings['pdf_layout'] = PDFLayoutOptions().to_metadata_dict()
            except ImportError:
                pass

            return Response({
                'document_id': str(doc.id),
                'processing_settings': _clean_processing_settings(processing_settings),
                'custom_metadata': _safe_dict(custom_metadata),
                'organization_defaults': _safe_dict(org_defaults),
                'header_template': str(doc.header_template_id) if doc.header_template_id else None,
                'footer_template': str(doc.footer_template_id) if doc.footer_template_id else None,
                'header_config': doc.header_config or {},
                'footer_config': doc.footer_config or {},
                'effective_header_config': doc.get_rendered_header_config() if hasattr(doc, 'get_rendered_header_config') else {},
                'effective_footer_config': doc.get_rendered_footer_config() if hasattr(doc, 'get_rendered_footer_config') else {},
            })

        # ── PATCH ──────────────────────────────────────────────────────
        data = request.data or {}
        errors = {}

        incoming_settings = data.get('processing_settings')
        if incoming_settings is not None and not isinstance(incoming_settings, dict):
            errors['processing_settings'] = 'processing_settings must be a JSON object.'

        if 'header_template' in data:
            header_template_id = data.get('header_template') or None
            if hasattr(doc, 'set_header_template'):
                if not doc.set_header_template(header_template_id, user=request.user):
                    errors['header_template'] = 'Header template not found or no access.'

        if 'footer_template' in data:
            footer_template_id = data.get('footer_template') or None
            if hasattr(doc, 'set_footer_template'):
                if not doc.set_footer_template(footer_template_id, user=request.user):
                    errors['footer_template'] = 'Footer template not found or no access.'

        if 'header_config' in data:
            header_config = data.get('header_config') or {}
            if not isinstance(header_config, dict):
                errors['header_config'] = 'Header config must be a JSON object.'
            else:
                doc.header_config = header_config

        if 'footer_config' in data:
            footer_config = data.get('footer_config') or {}
            if not isinstance(footer_config, dict):
                errors['footer_config'] = 'Footer config must be a JSON object.'
            else:
                doc.footer_config = footer_config

        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        if isinstance(incoming_settings, dict):
            processing_settings.update(incoming_settings)
            custom_metadata['processing_settings'] = processing_settings

        doc.custom_metadata = custom_metadata
        update_fields = ['custom_metadata', 'updated_at']
        if 'header_config' in data:
            update_fields.append('header_config')
        if 'footer_config' in data:
            update_fields.append('footer_config')
        doc.save(update_fields=update_fields)

        return Response({
            'document_id': str(doc.id),
            'processing_settings': _clean_processing_settings(processing_settings),
            'custom_metadata': _safe_dict(custom_metadata),
            'header_template': str(doc.header_template_id) if doc.header_template_id else None,
            'footer_template': str(doc.footer_template_id) if doc.footer_template_id else None,
            'header_config': doc.header_config or {},
            'footer_config': doc.footer_config or {},
            'effective_header_config': doc.get_rendered_header_config() if hasattr(doc, 'get_rendered_header_config') else {},
            'effective_footer_config': doc.get_rendered_footer_config() if hasattr(doc, 'get_rendered_footer_config') else {},
        })

    # ── AI CHAT HISTORY ──────────────────────────────────────────────────

    @action(detail=True, methods=['get', 'post', 'delete'], url_path='chat-history')
    def chat_history(self, request, pk=None):
        """
        GET  /api/documents/quick-latex/<uuid>/chat-history/  → load
        POST /api/documents/quick-latex/<uuid>/chat-history/  → save
        DELETE /api/documents/quick-latex/<uuid>/chat-history/ → clear

        Chat messages are stored in the LatexCode block's
        custom_metadata.ai_chat (list of message dicts).
        """
        doc = self.get_object()
        section = doc.sections.order_by('order').first()
        block = section.latex_codes.order_by('order').first() if section else None

        if not block:
            return Response({'messages': []})

        if request.method == 'GET':
            meta = block.custom_metadata or {}
            return Response({'messages': meta.get('ai_chat', [])})

        if request.method == 'DELETE':
            meta = block.custom_metadata or {}
            meta['ai_chat'] = []
            block.custom_metadata = meta
            block.save(update_fields=['custom_metadata'])
            return Response({'status': 'cleared', 'messages': []})

        # POST — save full chat array
        messages = request.data.get('messages')
        if messages is None:
            return Response(
                {'error': 'messages array is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        meta = block.custom_metadata or {}
        meta['ai_chat'] = messages
        block.custom_metadata = meta
        block.save(update_fields=['custom_metadata'])
        return Response({
            'status': 'saved',
            'message_count': len(messages),
        })

    # ── IMAGE PLACEHOLDERS ───────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='images')
    def list_images(self, request, pk=None):
        """
        GET /api/documents/quick-latex/<uuid>/images/
        List all images available to the current user for use in
        ``[[image:<uuid>]]`` placeholders.  Supports search and type filter.

        Query params:
          ?search=keyword     — filter by name (icontains)
          ?type=logo          — filter by image_type
          ?include_public=true — include public images
        """

        qs = DocumentImage.objects.filter(uploaded_by=request.user)

        include_public = request.query_params.get('include_public', 'false').lower() == 'true'
        if include_public:
            qs = DocumentImage.objects.filter(
                Q(uploaded_by=request.user) | Q(is_public=True)
            )

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(name__icontains=search) | Q(tags__icontains=search) |
                Q(caption__icontains=search)
            )

        image_type = request.query_params.get('type', '').strip()
        if image_type:
            qs = qs.filter(image_type=image_type)

        qs = qs.order_by('-uploaded_at')[:100]

        images = []
        for img in qs:
            images.append({
                'id': str(img.id),
                'name': img.name,
                'image_type': img.image_type,
                'url': img.get_url(),
                'thumbnail_url': img.get_thumbnail_url(),
                'width': img.width,
                'height': img.height,
                'file_size': img.file_size,
                'mime_type': img.mime_type,
                'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None,
                'tags': img.tags or [],
                'caption': img.caption,
                'placeholder': f'[[image:{img.id}]]',
            })

        return Response({
            'images': images,
            'count': len(images),
        })

    @action(detail=True, methods=['post'], url_path='upload-image')
    def upload_image(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/upload-image/
        Upload an image and get back the ``[[image:<uuid>]]`` placeholder
        to insert into the code editor.

        Multipart form data:
          image: file
          name: str (optional, defaults to filename)
          image_type: str (optional, defaults to 'picture')
        """
        doc = self.get_object()

        image_file = request.FILES.get('image')
        if not image_file:
            return Response(
                {'error': 'image file is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = request.data.get('name', image_file.name or 'Unnamed')
        image_type = request.data.get('image_type', 'picture')
        caption = request.data.get('caption', '')

        img = DocumentImage(
            document=doc,
            name=name,
            image_type=image_type,
            caption=caption,
            image=image_file,
            uploaded_by=request.user,
        )
        img.save()

        return Response({
            'status': 'success',
            'image': {
                'id': str(img.id),
                'name': img.name,
                'image_type': img.image_type,
                'url': img.get_url(),
                'thumbnail_url': img.get_thumbnail_url(),
                'width': img.width,
                'height': img.height,
                'file_size': img.file_size,
                'mime_type': img.mime_type,
                'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None,
                'caption': img.caption,
                'placeholder': f'[[image:{img.id}]]',
            },
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='resolve-images')
    def resolve_images(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/resolve-images/
        Resolve ``[[image:<uuid>]]`` placeholders to image URLs.

        Body (optional):
          { "image_ids": ["<uuid>", ...] }

        If ``image_ids`` is not provided, auto-detects from the
        document's LaTeX code.

        Returns:
          { "images": { "<uuid>": { url, thumbnail_url, name, ... }, ... } }
        """
        doc = self.get_object()

        image_ids = request.data.get('image_ids')
        if not image_ids:
            # Auto-detect from code
            code = doc.latex_code or ''
            section = doc.sections.order_by('order').first()
            if section:
                block = section.latex_codes.order_by('order').first()
                if block:
                    code = block.get_effective_content() or code
            image_ids = _extract_image_placeholders(code)

        if not image_ids:
            return Response({'images': {}, 'count': 0})

        # Validate UUIDs
        valid_uuids = []
        for uid in image_ids:
            try:
                valid_uuids.append(uuid_module.UUID(str(uid)))
            except (ValueError, AttributeError):
                pass

        images = DocumentImage.objects.filter(
            Q(id__in=valid_uuids),
            Q(uploaded_by=request.user) | Q(is_public=True) |
            Q(document__created_by=request.user)
        )

        result = {}
        for img in images:
            result[str(img.id)] = {
                'id': str(img.id),
                'name': img.name,
                'image_type': img.image_type,
                'url': img.get_url(),
                'thumbnail_url': img.get_thumbnail_url(),
                'width': img.width,
                'height': img.height,
                'file_size': img.file_size,
                'mime_type': img.mime_type,
                'caption': img.caption,
            }

        return Response({
            'images': result,
            'count': len(result),
            'not_found': [str(u) for u in valid_uuids if str(u) not in result],
        })

    # ── MAP IMAGE (named placeholder → real image UUID) ──────────────────

    @action(detail=True, methods=['post'], url_path='map-image')
    def map_image(self, request, pk=None):
        """
        POST /api/documents/quick-latex/<uuid>/map-image/
        Map a named image placeholder to an actual uploaded image.

        Replaces ``[[image:descriptive_name]]`` → ``[[image:<real-uuid>]]`` in
        the LaTeX/HTML code and records the mapping in
        ``document_metadata._image_placeholders``.

        Body:
          { "placeholder_name": "company_logo", "image_id": "<uuid>" }

        To **unmap** (revert to named placeholder):
          { "placeholder_name": "company_logo", "image_id": null }
        """
        doc = self.get_object()
        placeholder_name = request.data.get('placeholder_name', '').strip()
        image_id = request.data.get('image_id')

        if not placeholder_name:
            return Response(
                {'error': 'placeholder_name is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        section = doc.sections.order_by('order').first()
        block = section.latex_codes.order_by('order').first() if section else None
        code = block.get_effective_content() or '' if block else (doc.latex_code or '')

        meta = doc.document_metadata
        if not isinstance(meta, dict):
            meta = {}
            doc.document_metadata = meta
        img_map = meta.setdefault('_image_placeholders', {})

        if image_id is None:
            # ── Unmap: revert [[image:<uuid>]] back to [[image:name]] ────
            old_uuid = img_map.get(placeholder_name)
            if old_uuid and isinstance(old_uuid, str):
                code = code.replace(
                    f'[[image:{old_uuid}]]',
                    f'[[image:{placeholder_name}]]',
                )
            img_map[placeholder_name] = None
        else:
            # ── Map: validate image, then replace in code ────────────────
            try:
                img_uuid = uuid_module.UUID(str(image_id))
            except (ValueError, AttributeError):
                return Response(
                    {'error': 'image_id must be a valid UUID.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            img = DocumentImage.objects.filter(
                Q(id=img_uuid),
                Q(uploaded_by=request.user) | Q(is_public=True) |
                Q(document__created_by=request.user),
            ).first()
            if not img:
                return Response(
                    {'error': 'Image not found or not accessible.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # If previously mapped to a different UUID, replace that too
            old_uuid = img_map.get(placeholder_name)
            if old_uuid and isinstance(old_uuid, str) and old_uuid != str(img_uuid):
                code = code.replace(
                    f'[[image:{old_uuid}]]',
                    f'[[image:{img_uuid}]]',
                )
            else:
                code = code.replace(
                    f'[[image:{placeholder_name}]]',
                    f'[[image:{img_uuid}]]',
                )
            img_map[placeholder_name] = str(img_uuid)

        # Rebuild _image_url_map for all currently mapped UUIDs
        mapped_uuids = [v for v in img_map.values() if v]
        url_map = {}
        if mapped_uuids:
            for img_obj in DocumentImage.objects.filter(id__in=mapped_uuids):
                u = img_obj.get_url()
                if u:
                    url_map[str(img_obj.id)] = request.build_absolute_uri(u)
        meta['_image_url_map'] = url_map

        # Persist code changes
        if block:
            if block.has_edits:
                block.edited_code = code
            else:
                block.latex_code = code
            block.modified_by = request.user
            block.save(update_fields=[
                'latex_code' if not block.has_edits else 'edited_code',
                'modified_by',
            ])
        doc.latex_code = code
        doc.last_modified_by = request.user
        doc.save(update_fields=['latex_code', 'document_metadata',
                                'last_modified_by', 'updated_at'])

        return Response({
            'status': 'success',
            'placeholder_name': placeholder_name,
            'image_id': img_map.get(placeholder_name),
            'image_placeholders': img_map,
            'document': QuickLatexDocumentSerializer(doc).data,
        })

    # ── PLACEHOLDERS ─────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='placeholders')
    def placeholders(self, request, pk=None):
        """
        GET /api/documents/quick-latex/<uuid>/placeholders/
        List all [[key]] placeholders found in the LaTeX code,
        along with their current values from document metadata.
        """
        doc = self.get_object()
        section = doc.sections.order_by('order').first()
        block = section.latex_codes.order_by('order').first() if section else None

        code = ''
        if block:
            code = block.get_effective_content() or ''
        elif doc.latex_code:
            code = doc.latex_code

        keys = sorted(k for k in set(re.findall(r'\[\[([^\]]+)\]\]', code))
                      if not k.startswith('image:'))

        # Also collect image placeholder UUIDs
        image_uuids = _extract_image_placeholders(code)

        # Resolve current values — try exact key, then normalized key
        metadata = {}
        if doc.document_metadata:
            metadata.update(doc.document_metadata)
        if doc.custom_metadata:
            metadata.update(doc.custom_metadata)

        # Build a normalized lookup for flexible matching
        def _norm(k):
            return re.sub(r'[^A-Za-z0-9]+', '_', k).strip('_').lower()

        flat_metadata = {}
        def _flatten(data, prefix=''):
            for k, v in (data or {}).items():
                full = f"{prefix}.{k}" if prefix else str(k)
                if isinstance(v, dict):
                    _flatten(v, full)
                else:
                    flat_metadata[full] = v
                    flat_metadata[full.split('.')[-1]] = v
        _flatten(metadata)

        norm_lookup = {_norm(k): v for k, v in flat_metadata.items() if v is not None}

        def _resolve(key):
            # Try exact key first
            if key in flat_metadata:
                return flat_metadata[key]
            # Try normalized
            nk = _norm(key)
            if nk in norm_lookup:
                return norm_lookup[nk]
            return None

        placeholder_data = []
        for key in keys:
            placeholder_data.append({
                'key': key,
                'current_value': _resolve(key),
                'has_value': _resolve(key) is not None,
            })

        # Named image slots from _image_placeholders metadata
        img_map = metadata.get('_image_placeholders', {})
        if not isinstance(img_map, dict):
            img_map = {}
        # Also include any named slots still in the code (not yet in metadata)
        named_in_code = _extract_named_image_placeholders(code)
        for name in named_in_code:
            if name not in img_map:
                img_map[name] = None

        image_slot_data = []
        # Fetch image URLs for mapped slots in one query
        all_mapped_uuids = [v for v in img_map.values() if v]
        uuid_to_img = {}
        if all_mapped_uuids:
            for img_obj in DocumentImage.objects.filter(id__in=all_mapped_uuids):
                uuid_to_img[str(img_obj.id)] = img_obj

        for name in sorted(img_map.keys()):
            mapped_id = img_map.get(name)
            slot_entry = {
                'name': name,
                'mapped_image_id': mapped_id,
                'is_mapped': mapped_id is not None,
                'in_code': (f'[[image:{name}]]' in code) or
                           (mapped_id and f'[[image:{mapped_id}]]' in code),
            }
            # Include image URL info for mapped slots
            if mapped_id and str(mapped_id) in uuid_to_img:
                img_obj = uuid_to_img[str(mapped_id)]
                slot_entry['image_url'] = request.build_absolute_uri(img_obj.get_url()) if img_obj.get_url() else None
                slot_entry['image_thumbnail_url'] = request.build_absolute_uri(img_obj.get_thumbnail_url()) if img_obj.get_thumbnail_url() else None
                slot_entry['image_name'] = img_obj.name
            image_slot_data.append(slot_entry)

        # Persist _image_url_map in metadata for frontend renderers
        url_map = {}
        for uid, img_obj in uuid_to_img.items():
            u = img_obj.get_url()
            if u:
                url_map[uid] = request.build_absolute_uri(u)
        meta = doc.document_metadata
        if not isinstance(meta, dict):
            meta = {}
        if meta.get('_image_url_map') != url_map:
            meta['_image_url_map'] = url_map
            doc.document_metadata = meta
            doc.save(update_fields=['document_metadata'])

        return Response({
            'placeholders': placeholder_data,
            'total': len(placeholder_data),
            'image_placeholders': image_uuids,
            'image_slots': image_slot_data,
            'image_slots_total': len(image_slot_data),
            'image_slots_mapped': sum(1 for s in image_slot_data if s['is_mapped']),
        })

    # ── METADATA (convenience) ───────────────────────────────────────────

    @action(detail=True, methods=['patch'], url_path='metadata')
    def update_metadata(self, request, pk=None):
        """
        PATCH /api/documents/quick-latex/<uuid>/metadata/
        Update document_metadata only (deep-merged).

        Body: arbitrary JSON dict to merge into document_metadata.
        """
        doc = self.get_object()
        incoming = request.data

        if not isinstance(incoming, dict):
            return Response(
                {'error': 'Request body must be a JSON object.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        _deep_merge(doc.document_metadata, incoming)
        doc.last_modified_by = request.user
        doc.save(update_fields=['document_metadata', 'last_modified_by', 'updated_at'])

        return Response(QuickLatexDocumentSerializer(doc).data)

    # ── FROM SOURCE (create quick-latex from any standard document) ──────

    @action(detail=False, methods=['post'], url_path='from-source')
    def from_source(self, request):
        """
        POST /api/documents/quick-latex/from-source/
        Convert any existing document into a Quick LaTeX document.

        Body:
        {
            "source_document_id": "<uuid>",
            "title": "...",
            "metadata_overrides": {...}
        }
        """
        source_id = request.data.get('source_document_id')
        if not source_id:
            return Response(
                {'error': 'source_document_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source = get_object_or_404(Document, id=source_id)
        title = request.data.get('title', '') or f"{source.title} (Quick LaTeX)"
        metadata_overrides = request.data.get('metadata_overrides', {})
        custom_metadata_overrides = request.data.get('custom_metadata_overrides', {})

        with transaction.atomic():
            new_doc = _clone_quick_latex(
                source,
                user=request.user,
                title_override=title,
                metadata_overrides=metadata_overrides,
                custom_metadata_overrides=custom_metadata_overrides,
            )

        return Response(
            QuickLatexDocumentSerializer(new_doc).data,
            status=status.HTTP_201_CREATED,
        )

    # ── RENDER PREVIEW ───────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='rendered-latex')
    def rendered_latex(self, request, pk=None):
        """
        GET /api/documents/quick-latex/<uuid>/rendered-latex/
        Return the LaTeX code with all [[placeholder]] values
        replaced from document metadata.
        """
        doc = self.get_object()
        section = doc.sections.order_by('order').first()
        block = section.latex_codes.order_by('order').first() if section else None

        if not block:
            return Response({'rendered': doc.latex_code or '', 'placeholders_resolved': 0})

        # Use the LatexCode.render_with_metadata() method
        metadata = {}
        if doc.document_metadata:
            metadata.update(doc.document_metadata)
        if doc.custom_metadata:
            metadata.update(doc.custom_metadata)

        rendered = block.render_with_metadata(metadata=metadata)
        original = block.get_effective_content() or ''

        # Resolve [[image:UUID]] placeholders to actual image URLs
        image_uuids = _extract_image_placeholders(rendered)
        images_resolved = 0
        if image_uuids:
            valid_uuids = []
            for uid in image_uuids:
                try:
                    valid_uuids.append(uuid_module.UUID(uid))
                except (ValueError, AttributeError):
                    pass
            if valid_uuids:
                imgs = DocumentImage.objects.filter(
                    Q(id__in=valid_uuids),
                    Q(uploaded_by=request.user) | Q(is_public=True) |
                    Q(document__created_by=request.user)
                )
                for img in imgs:
                    url = img.get_url() or ''
                    placeholder = f'[[image:{img.id}]]'
                    code_type = block.code_type or 'latex'
                    if code_type == 'html':
                        replacement = (
                            f'<img src="{url}" alt="{img.name or "image"}" '
                            f'style="max-width:100%; height:auto;" />'
                        )
                    else:
                        # LaTeX: use includegraphics (URL will be resolved at compile time)
                        replacement = (
                            f'\\includegraphics[width=\\linewidth]{{{url}}}'
                        )
                    rendered = rendered.replace(placeholder, replacement)
                    images_resolved += 1

        # Count how many text placeholders were resolved
        original_keys = set(k for k in re.findall(r'\[\[([^\]]+)\]\]', original)
                           if not k.startswith('image:'))
        remaining_keys = set(k for k in re.findall(r'\[\[([^\]]+)\]\]', rendered)
                            if not k.startswith('image:'))
        resolved = len(original_keys) - len(remaining_keys)

        return Response({
            'rendered': rendered,
            'placeholders_total': len(original_keys),
            'placeholders_resolved': resolved,
            'placeholders_remaining': sorted(remaining_keys),
            'images_total': len(image_uuids),
            'images_resolved': images_resolved,
        })
