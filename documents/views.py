from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.core import signing
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import Q
import hashlib
import difflib
from django.contrib.contenttypes.models import ContentType
import uuid
import logging
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder
import json
import re
from user_management.models import OrganizationDocumentSettings
from exporter.pdf_system import PDFLayoutOptions
logger = logging.getLogger(__name__)

# Sharing system imports
from sharing.permissions import IsOwnerOrSharedWith, CanAccessByRole, get_user_role
from sharing.models import AccessLog
from .models import (
    Document,
    HeaderFooterTemplate,
    Issue,
    Section,
    Paragraph,
    ChangeLog,
    DocumentVersion,
    DocumentImage,
    SectionReference,
    Table,
    ImageComponent,
    DocumentFile,
    DocumentFileComponent,
    HeaderFooterTemplate,
    ParagraphHistory,
)
from .serializers import (
    DocumentSerializer, 
    DocumentCreateSerializer,
    IssueSerializer,
    IssueUpdateSerializer,
    TemplateDocumentSerializer,
    StructuredDocumentSerializer,
    FullDocumentEditSerializer,
    CompleteDocumentSerializer,
    SectionReferenceSerializer,
    SectionReferenceCreateSerializer,
    PartialSectionSerializer,
    PartialParagraphSerializer,
    PartialTableSerializer,
    PartialImageComponentSerializer,
    PartialFileComponentSerializer,
)
from .partial_save import HANDLERS

from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from rest_framework.permissions import IsAuthenticated

class UserInfoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not user or not user.is_authenticated:
            return Response({'error': 'Not authenticated'}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({
            'id': str(user.id),
            'username': user.username,
            'email': user.email,
            'first_name': getattr(user, 'first_name', ''),
            'last_name': getattr(user, 'last_name', ''),
        })

from .services import DocumentParser, DocumentAnalyzer
from .document_drafter import DocumentDrafter, DocumentTemplate


class DocumentViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Document CRUD operations with share-based access control.
    
    Access Rules:
    - List: Only documents user owns or is shared with
    - Retrieve: Owner or shared users only (any role)
    - Update: Owner or users with 'editor' role
    - Delete: Owner only
    
    Performance Optimizations:
    - Uses denormalized component indexes (section_ids, paragraph_ids, etc.)
    - Reduces N+1 queries by fetching components via ID lists
    - Maintains same API responses and endpoints
    """
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrSharedWith]
    
    def get_queryset(self):
        """
        Filter documents based on sharing permissions.
        Users can only see documents they own or are shared with.
        
        Handles edge cases:
        - Users without profiles (can't be in teams)
        - Expired shares (filtered out)
        - Invalid UUID strings (handled gracefully)
        - Deleted shares (is_active=True filter)
        """
        from sharing.models import Share
        from user_management.models import Team
        
        user = self.request.user
        
        # If user is not authenticated, return empty queryset
        if not user or not user.is_authenticated:
            return Document.objects.none()
        
        # Get user's profile for team lookups (Team.members is ManyToMany to UserProfile)
        try:
            user_profile = user.profile
            user_teams = Team.objects.filter(members=user_profile)
        except Exception:
            # If user has no profile, they can't be in teams
            user_teams = Team.objects.none()
        
        # Get ContentType for Document
        content_type = ContentType.objects.get_for_model(Document)
        
        # Get IDs of documents shared with user
        # Only include active, non-expired shares
        from django.utils import timezone
        shared_doc_ids = Share.objects.filter(
            content_type=content_type,
            is_active=True
        ).filter(
            Q(shared_with_user=user) |
            Q(shared_with_team__in=user_teams)
        ).filter(
            Q(expires_at__isnull=True) |  # No expiration
            Q(expires_at__gt=timezone.now())  # Or not expired yet
        ).values_list('object_id', flat=True)
        
        # Convert string UUIDs to proper UUID objects for comparison
        import uuid as uuid_module
        shared_doc_uuids = []
        for obj_id in shared_doc_ids:
            try:
                # Convert string to UUID
                shared_doc_uuids.append(uuid_module.UUID(str(obj_id)))
            except (ValueError, AttributeError, TypeError):
                # Skip invalid UUIDs
                pass
        
        # Return documents user owns or is shared with
        queryset = Document.objects.filter(
            Q(created_by=user) |  # Own documents
            Q(id__in=shared_doc_uuids)  # Shared documents (using UUID objects)
        ).distinct()
        
        # Optimize queries based on action - no more prefetch_related needed
        # Component data is fetched via denormalized indexes in serializers
        return queryset

    def perform_create(self, serializer):
        """Set created_by to the current user when creating a document."""
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get', 'post'], url_path='header-footer-templates')
    def header_footer_templates(self, request):
        """List or create/update header/footer templates."""
        user = request.user
        template_type = request.query_params.get('type')

        templates = HeaderFooterTemplate.objects.all()
        if template_type in ('header', 'footer'):
            templates = templates.filter(template_type=template_type)

        if user and user.is_authenticated:
            templates = templates.filter(
                Q(is_public=True) |
                Q(is_system=True) |
                Q(created_by=user) |
                Q(shared_with=user)
            ).distinct()
        else:
            templates = templates.filter(is_public=True)

        placeholder_pattern = re.compile(r"\{[^{}]+\}")

        if request.method.lower() == 'post':
            if not user or not user.is_authenticated:
                return Response({'error': 'Authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

            data = request.data or {}
            template_id = data.get('template_id')
            name = data.get('name')
            template_type_value = data.get('template_type')
            config = data.get('config')

            if not name or template_type_value not in ('header', 'footer') or not isinstance(config, dict):
                return Response({'error': 'Name, template_type, and config are required.'}, status=status.HTTP_400_BAD_REQUEST)

            if template_id:
                try:
                    template = HeaderFooterTemplate.objects.get(id=template_id)
                except HeaderFooterTemplate.DoesNotExist:
                    return Response({'error': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)

                if not template.can_user_access(user) and not user.is_staff:
                    return Response({'error': 'No access to update this template.'}, status=status.HTTP_403_FORBIDDEN)
            else:
                template = HeaderFooterTemplate(created_by=user)

            template.name = name
            template.template_type = template_type_value
            template.description = data.get('description') or ''
            template.category = data.get('category') or None
            template.tags = data.get('tags') or []
            template.config = config

            if user.is_staff:
                if 'is_system' in data:
                    template.is_system = bool(data.get('is_system'))
                if 'is_public' in data:
                    template.is_public = bool(data.get('is_public'))
            else:
                template.is_public = bool(data.get('is_public', False))

            template.save()

            return Response({
                'id': str(template.id),
                'name': template.name,
                'template_type': template.template_type,
                'description': template.description,
                'is_system': template.is_system,
                'is_public': template.is_public,
                'config': template.config,
            })

        data = []
        for template in templates.order_by('name'):
            if not template.can_user_access(user):
                continue
            placeholders = set()
            config = template.config if isinstance(template.config, dict) else {}
            text_config = config.get('text') if isinstance(config, dict) else {}
            if isinstance(text_config, dict):
                for value in text_config.values():
                    if isinstance(value, str):
                        placeholders.update(placeholder_pattern.findall(value))
            data.append({
                'id': str(template.id),
                'name': template.name,
                'template_type': template.template_type,
                'description': template.description,
                'is_system': template.is_system,
                'is_public': template.is_public,
                'placeholders': sorted(placeholders),
                'text': text_config if isinstance(text_config, dict) else {},
                'config': config,
            })

        return Response({'templates': data})

    @action(detail=True, methods=['get', 'patch'], url_path='header-footer')
    def header_footer(self, request, pk=None):
        """
        Get or update header/footer PDF overlay settings for a document.

        Unified flow — all PDF overlays go through HeaderFooterPDF records:
        1. Upload PDF          → POST /api/documents/files/
        2. Crop header/footer  → POST /api/documents/header-footer-pdfs/
        3. Apply to document   → PATCH /api/documents/<id>/header-footer/
                                 { "header_pdf_id": "<uuid>" }
        4. Remove              → PATCH /api/documents/<id>/header-footer/
                                 { "header_pdf": null }

        GET returns current header/footer state.
        PATCH accepts:
          - header_pdf_id / footer_pdf_id  — UUID of a HeaderFooterPDF record to apply
          - header_pdf: null / footer_pdf: null  — remove the overlay
          - show_on_first_page, show_on_all_pages, show_pages  — page scope
          - header_template / footer_template  — text-based template ID (separate system)
          - header_config / footer_config  — text-based config overrides
        """
        from documents.models import HeaderFooterPDF

        document = self.get_object()

        # ── Helper ─────────────────────────────────────────────────────
        def _safe_dict(value):
            if not isinstance(value, dict):
                return {}
            try:
                json.dumps(value, cls=DjangoJSONEncoder)
            except Exception:
                return {}
            return value

        def _get_processing_settings():
            cm = _safe_dict(document.custom_metadata) if document.custom_metadata else {}
            ps = cm.get('processing_settings')
            return cm, ps if isinstance(ps, dict) else {}

        def _build_hf_config(hf_obj, scope_data=None):
            """Build the processing_settings config dict from a HeaderFooterPDF record."""
            scope = scope_data or {}
            return {
                'file_id': str(hf_obj.id),
                'source_file_id': str(hf_obj.source_file_id) if hf_obj.source_file_id else None,
                'height': hf_obj.region_height,
                'page': hf_obj.source_page,
                'crop_top_offset': hf_obj.crop_top_offset,
                'crop_height': hf_obj.crop_height,
                'show_on_first_page': bool(scope.get('show_on_first_page', True)),
                'show_on_all_pages': bool(scope.get('show_on_all_pages', True)),
                'show_pages': scope.get('show_pages', []),
                'name': hf_obj.name,
                'auto_detected': hf_obj.auto_detected,
            }

        # ── Scope helper ───────────────────────────────────────────────
        def _extract_scope(config):
            if not isinstance(config, dict):
                return {'show_on_all_pages': True, 'show_on_first_page': True, 'show_pages': []}
            return {
                'show_on_all_pages': config.get('show_on_all_pages', True),
                'show_on_first_page': config.get('show_on_first_page', True),
                'show_pages': config.get('show_pages', []),
            }

        # ── GET ────────────────────────────────────────────────────────
        if request.method.lower() == 'get':
            custom_metadata, processing_settings = _get_processing_settings()
            header_pdf_config = processing_settings.get('header_pdf')
            footer_pdf_config = processing_settings.get('footer_pdf')

            header_pdf_active = isinstance(header_pdf_config, dict) and bool(header_pdf_config.get('file_id'))
            footer_pdf_active = isinstance(footer_pdf_config, dict) and bool(footer_pdf_config.get('file_id'))
            effective_header = document.get_rendered_header_config()
            effective_footer = document.get_rendered_footer_config()
            header_text_active = bool(document.header_template_id or (isinstance(effective_header, dict) and effective_header))
            footer_text_active = bool(document.footer_template_id or (isinstance(effective_footer, dict) and effective_footer))

            return Response({
                'document_id': str(document.id),
                'header_template': str(document.header_template_id) if document.header_template_id else None,
                'footer_template': str(document.footer_template_id) if document.footer_template_id else None,
                'header_config': document.header_config or {},
                'footer_config': document.footer_config or {},
                'effective_header_config': effective_header,
                'effective_footer_config': effective_footer,
                'header_pdf': header_pdf_config if isinstance(header_pdf_config, dict) else None,
                'footer_pdf': footer_pdf_config if isinstance(footer_pdf_config, dict) else None,
                # Page-scope summary (also available via /page-scope/ endpoint)
                'header_pdf_active': header_pdf_active,
                'footer_pdf_active': footer_pdf_active,
                'header_text_active': header_text_active,
                'footer_text_active': footer_text_active,
                'page_scope': {
                    'header_pdf': _extract_scope(header_pdf_config) if header_pdf_active else None,
                    'footer_pdf': _extract_scope(footer_pdf_config) if footer_pdf_active else None,
                    'header_text': _extract_scope(effective_header) if header_text_active else None,
                    'footer_text': _extract_scope(effective_footer) if footer_text_active else None,
                },
                'custom_metadata': custom_metadata,
            })

        # ── PATCH ──────────────────────────────────────────────────────
        data = request.data or {}
        errors = {}

        # --- Text-based template updates (unchanged) ---
        def _normalize_template_id(value):
            if value in (None, '', 'null'):
                return None
            return value

        if 'header_template' in data:
            header_template_id = _normalize_template_id(data.get('header_template'))
            if not document.set_header_template(header_template_id, user=request.user):
                errors['header_template'] = 'Header template not found or no access.'

        if 'footer_template' in data:
            footer_template_id = _normalize_template_id(data.get('footer_template'))
            if not document.set_footer_template(footer_template_id, user=request.user):
                errors['footer_template'] = 'Footer template not found or no access.'

        if data.get('reset_header_to_template'):
            document.reset_header_to_template()

        if data.get('reset_footer_to_template'):
            document.reset_footer_to_template()

        if 'header_config' in data:
            header_config = data.get('header_config') or {}
            if not isinstance(header_config, dict):
                errors['header_config'] = 'Header config must be a JSON object.'
            else:
                document.header_config = header_config
                document.save(update_fields=['header_config', 'updated_at'])

        if 'footer_config' in data:
            footer_config = data.get('footer_config') or {}
            if not isinstance(footer_config, dict):
                errors['footer_config'] = 'Footer config must be a JSON object.'
            else:
                document.footer_config = footer_config
                document.save(update_fields=['footer_config', 'updated_at'])

        # --- PDF overlay updates (unified via HeaderFooterPDF) ---
        header_pdf_payload = ...  # sentinel: not provided
        footer_pdf_payload = ...  # sentinel: not provided

        # ── Header PDF: accept UUID directly or { file_id: ... } ──
        if 'header_pdf_id' in data or 'header_pdf' in data:
            hf_id = data.get('header_pdf_id') or (
                data['header_pdf'].get('file_id') or data['header_pdf'].get('id')
                if isinstance(data.get('header_pdf'), dict) else None
            )
            raw = data.get('header_pdf')

            if raw in (None, '', {}) and not data.get('header_pdf_id'):
                # Explicit removal
                header_pdf_payload = None
            elif hf_id:
                try:
                    hf_obj = HeaderFooterPDF.objects.get(id=hf_id, is_active=True)
                    if not hf_obj.can_access(request.user):
                        errors['header_pdf'] = 'No access to the selected header PDF.'
                    else:
                        scope = data.get('header_pdf') if isinstance(data.get('header_pdf'), dict) else data
                        header_pdf_payload = _build_hf_config(hf_obj, scope)
                        # Clear conflicting text-based template
                        if document.header_template_id:
                            document.set_header_template(None, user=request.user)
                except HeaderFooterPDF.DoesNotExist:
                    errors['header_pdf'] = 'Header PDF record not found. Upload and crop a PDF first via /api/documents/header-footer-pdfs/'
            else:
                errors['header_pdf'] = 'Provide header_pdf_id (UUID of a cropped HeaderFooterPDF) or header_pdf: null to remove.'

        # ── Footer PDF: accept UUID directly or { file_id: ... } ──
        if 'footer_pdf_id' in data or 'footer_pdf' in data:
            fh_id = data.get('footer_pdf_id') or (
                data['footer_pdf'].get('file_id') or data['footer_pdf'].get('id')
                if isinstance(data.get('footer_pdf'), dict) else None
            )
            raw = data.get('footer_pdf')

            if raw in (None, '', {}) and not data.get('footer_pdf_id'):
                # Explicit removal
                footer_pdf_payload = None
            elif fh_id:
                try:
                    fh_obj = HeaderFooterPDF.objects.get(id=fh_id, is_active=True)
                    if not fh_obj.can_access(request.user):
                        errors['footer_pdf'] = 'No access to the selected footer PDF.'
                    else:
                        scope = data.get('footer_pdf') if isinstance(data.get('footer_pdf'), dict) else data
                        footer_pdf_payload = _build_hf_config(fh_obj, scope)
                        # Clear conflicting text-based template
                        if document.footer_template_id:
                            document.set_footer_template(None, user=request.user)
                except HeaderFooterPDF.DoesNotExist:
                    errors['footer_pdf'] = 'Footer PDF record not found. Upload and crop a PDF first via /api/documents/header-footer-pdfs/'
            else:
                errors['footer_pdf'] = 'Provide footer_pdf_id (UUID of a cropped HeaderFooterPDF) or footer_pdf: null to remove.'

        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        # --- Persist to processing_settings ---
        custom_metadata, processing_settings = _get_processing_settings()

        effective_header_config = document.header_config or document.get_effective_header_config()
        effective_footer_config = document.footer_config or document.get_effective_footer_config()

        processing_settings['header_footer'] = {
            'header_template': str(document.header_template_id) if document.header_template_id else None,
            'footer_template': str(document.footer_template_id) if document.footer_template_id else None,
            'header_config': effective_header_config or {},
            'footer_config': effective_footer_config or {},
        }

        if header_pdf_payload is not ...:
            if header_pdf_payload is not None:
                processing_settings['header_pdf'] = header_pdf_payload
            else:
                # Store explicit removal marker so org defaults don't leak through
                processing_settings['header_pdf'] = '__removed__'

        if footer_pdf_payload is not ...:
            if footer_pdf_payload is not None:
                processing_settings['footer_pdf'] = footer_pdf_payload
            else:
                # Store explicit removal marker so org defaults don't leak through
                processing_settings['footer_pdf'] = '__removed__'

        custom_metadata['processing_settings'] = processing_settings
        if hasattr(document, 'get_search_metadata'):
            custom_metadata['search_metadata'] = document.get_search_metadata(include_custom_metadata=False)
        document.custom_metadata = custom_metadata
        document.save(update_fields=['custom_metadata', 'updated_at'])

        # Propagate to organization defaults (best-effort)
        try:
            organization = request.user.profile.organization
            settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                organization=organization
            )
            preferences = settings_obj.preferences if isinstance(settings_obj.preferences, dict) else {}
            org_defaults = preferences.get('processing_defaults')
            if not isinstance(org_defaults, dict):
                org_defaults = {}
            org_defaults['header_footer'] = processing_settings.get('header_footer', {})
            if header_pdf_payload is not ...:
                if header_pdf_payload is not None:
                    org_defaults['header_pdf'] = header_pdf_payload
                else:
                    # Store explicit removal marker so deep-merge can't resurrect stale defaults.
                    # (This matches the document-level '__removed__' pattern stripped in
                    # Document.get_processing_defaults().)
                    org_defaults['header_pdf'] = '__removed__'
            if footer_pdf_payload is not ...:
                if footer_pdf_payload is not None:
                    org_defaults['footer_pdf'] = footer_pdf_payload
                else:
                    # Store explicit removal marker so deep-merge can't resurrect stale defaults.
                    org_defaults['footer_pdf'] = '__removed__'
            preferences['processing_defaults'] = org_defaults
            settings_obj.preferences = preferences
            settings_obj.save(update_fields=['preferences', 'updated_at'])
        except Exception:
            pass

        # Build clean response — filter out removal markers
        resp_header_pdf = processing_settings.get('header_pdf')
        resp_footer_pdf = processing_settings.get('footer_pdf')

        # Compute active flags for the response page_scope summary
        resp_hpdf_active = isinstance(resp_header_pdf, dict) and bool(resp_header_pdf.get('file_id'))
        resp_fpdf_active = isinstance(resp_footer_pdf, dict) and bool(resp_footer_pdf.get('file_id'))
        resp_eff_header = document.get_rendered_header_config()
        resp_eff_footer = document.get_rendered_footer_config()
        resp_htxt_active = bool(document.header_template_id or (isinstance(resp_eff_header, dict) and resp_eff_header))
        resp_ftxt_active = bool(document.footer_template_id or (isinstance(resp_eff_footer, dict) and resp_eff_footer))

        return Response({
            'document_id': str(document.id),
            'header_template': str(document.header_template_id) if document.header_template_id else None,
            'footer_template': str(document.footer_template_id) if document.footer_template_id else None,
            'header_config': document.header_config or {},
            'footer_config': document.footer_config or {},
            'effective_header_config': resp_eff_header,
            'effective_footer_config': resp_eff_footer,
            'header_pdf': resp_header_pdf if isinstance(resp_header_pdf, dict) else None,
            'footer_pdf': resp_footer_pdf if isinstance(resp_footer_pdf, dict) else None,
            'header_pdf_active': resp_hpdf_active,
            'footer_pdf_active': resp_fpdf_active,
            'header_text_active': resp_htxt_active,
            'footer_text_active': resp_ftxt_active,
            'page_scope': {
                'header_pdf': _extract_scope(resp_header_pdf) if resp_hpdf_active else None,
                'footer_pdf': _extract_scope(resp_footer_pdf) if resp_fpdf_active else None,
                'header_text': _extract_scope(resp_eff_header) if resp_htxt_active else None,
                'footer_text': _extract_scope(resp_eff_footer) if resp_ftxt_active else None,
            },
            'custom_metadata': document.custom_metadata or {},
        })

    # ── PAGE-SCOPE ─────────────────────────────────────────────────────
    @action(detail=True, methods=['get', 'patch'], url_path='page-scope')
    def page_scope(self, request, pk=None):
        """
        Get or update which pages headers/footers appear on.

        Controls ``show_on_all_pages``, ``show_on_first_page`` and ``show_pages``
        for **both** PDF-overlay and text-template systems independently.

        GET returns the current page-scope state plus whether each region is
        active (has a PDF overlay or text template/config).

        PATCH accepts any subset of:
        {
            "header_pdf_scope": {
                "show_on_all_pages": true,
                "show_on_first_page": true,
                "show_pages": []
            },
            "footer_pdf_scope": {
                "show_on_all_pages": false,
                "show_on_first_page": true,
                "show_pages": [1, 3]
            },
            "header_text_scope": {
                "show_on_all_pages": true,
                "show_on_first_page": true,
                "show_pages": []
            },
            "footer_text_scope": {
                "show_on_all_pages": true,
                "show_on_first_page": true,
                "show_pages": []
            }
        }

        Validation: scope updates are rejected for any region that has no
        active header/footer (no PDF overlay, no text template, no inline
        config).  The response always includes ``*_active`` booleans so the
        frontend can disable the controls.
        """
        document = self.get_object()

        # ── helpers ────────────────────────────────────────────────────
        def _ps():
            cm = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
            ps = cm.get('processing_settings')
            return cm, ps if isinstance(ps, dict) else {}

        SCOPE_KEYS = ('show_on_all_pages', 'show_on_first_page', 'show_pages')

        def _extract_scope(config):
            """Pull page-scope fields from a config dict."""
            if not isinstance(config, dict):
                return {'show_on_all_pages': True, 'show_on_first_page': True, 'show_pages': []}
            return {
                'show_on_all_pages': config.get('show_on_all_pages', True),
                'show_on_first_page': config.get('show_on_first_page', True),
                'show_pages': config.get('show_pages', []),
            }

        def _validate_scope(scope, label):
            """Validate page-scope values, return cleaned dict or error string."""
            if not isinstance(scope, dict):
                return None, f'{label} must be a JSON object.'
            cleaned = {}
            if 'show_on_all_pages' in scope:
                cleaned['show_on_all_pages'] = bool(scope['show_on_all_pages'])
            if 'show_on_first_page' in scope:
                cleaned['show_on_first_page'] = bool(scope['show_on_first_page'])
            if 'show_pages' in scope:
                sp = scope['show_pages']
                if isinstance(sp, str):
                    sp = [p.strip() for p in sp.split(',') if p.strip()]
                if not isinstance(sp, (list, tuple)):
                    return None, f'{label}.show_pages must be a list.'
                pages = []
                for p in sp:
                    try:
                        pages.append(int(p))
                    except (TypeError, ValueError):
                        return None, f'{label}.show_pages contains non-integer: {p}'
                cleaned['show_pages'] = pages
            return cleaned, None

        # ── Active detection ───────────────────────────────────────────
        _, processing_settings = _ps()
        header_pdf_config = processing_settings.get('header_pdf')
        footer_pdf_config = processing_settings.get('footer_pdf')
        header_pdf_active = isinstance(header_pdf_config, dict) and bool(header_pdf_config.get('file_id'))
        footer_pdf_active = isinstance(footer_pdf_config, dict) and bool(footer_pdf_config.get('file_id'))

        effective_header = document.get_effective_header_config()
        effective_footer = document.get_effective_footer_config()
        header_text_active = bool(document.header_template_id or (isinstance(effective_header, dict) and effective_header))
        footer_text_active = bool(document.footer_template_id or (isinstance(effective_footer, dict) and effective_footer))

        # ── GET ────────────────────────────────────────────────────────
        if request.method.lower() == 'get':
            return Response({
                'document_id': str(document.id),
                'header_pdf_active': header_pdf_active,
                'footer_pdf_active': footer_pdf_active,
                'header_text_active': header_text_active,
                'footer_text_active': footer_text_active,
                'header_pdf_scope': _extract_scope(header_pdf_config) if header_pdf_active else None,
                'footer_pdf_scope': _extract_scope(footer_pdf_config) if footer_pdf_active else None,
                'header_text_scope': _extract_scope(effective_header) if header_text_active else None,
                'footer_text_scope': _extract_scope(effective_footer) if footer_text_active else None,
            })

        # ── PATCH ──────────────────────────────────────────────────────
        data = request.data or {}
        errors = {}

        # Validate & collect updates
        updates = {}  # key -> cleaned scope dict
        for field, is_active, label in [
            ('header_pdf_scope', header_pdf_active, 'Header PDF'),
            ('footer_pdf_scope', footer_pdf_active, 'Footer PDF'),
            ('header_text_scope', header_text_active, 'Header text'),
            ('footer_text_scope', footer_text_active, 'Footer text'),
        ]:
            if field not in data:
                continue
            if not is_active:
                errors[field] = f'{label} is not active on this document. Set a {label.lower()} first.'
                continue
            cleaned, err = _validate_scope(data[field], field)
            if err:
                errors[field] = err
            else:
                updates[field] = cleaned

        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        # Apply updates
        custom_metadata, processing_settings = _ps()

        # PDF overlays — update in-place inside processing_settings
        if 'header_pdf_scope' in updates:
            if isinstance(processing_settings.get('header_pdf'), dict):
                processing_settings['header_pdf'].update(updates['header_pdf_scope'])

        if 'footer_pdf_scope' in updates:
            if isinstance(processing_settings.get('footer_pdf'), dict):
                processing_settings['footer_pdf'].update(updates['footer_pdf_scope'])

        # Text templates — update document.header_config / footer_config
        # so scope rides alongside the template overrides.
        if 'header_text_scope' in updates:
            hc = document.header_config if isinstance(document.header_config, dict) else {}
            hc.update(updates['header_text_scope'])
            document.header_config = hc

        if 'footer_text_scope' in updates:
            fc = document.footer_config if isinstance(document.footer_config, dict) else {}
            fc.update(updates['footer_text_scope'])
            document.footer_config = fc

        # Also mirror text scope into processing_settings.header_footer
        hf_block = processing_settings.get('header_footer')
        if not isinstance(hf_block, dict):
            hf_block = {}
        if 'header_text_scope' in updates:
            hc_ps = hf_block.get('header_config')
            if not isinstance(hc_ps, dict):
                hc_ps = {}
            hc_ps.update(updates['header_text_scope'])
            hf_block['header_config'] = hc_ps
        if 'footer_text_scope' in updates:
            fc_ps = hf_block.get('footer_config')
            if not isinstance(fc_ps, dict):
                fc_ps = {}
            fc_ps.update(updates['footer_text_scope'])
            hf_block['footer_config'] = fc_ps
        processing_settings['header_footer'] = hf_block

        custom_metadata['processing_settings'] = processing_settings
        document.custom_metadata = custom_metadata

        save_fields = ['custom_metadata', 'updated_at']
        if 'header_text_scope' in updates:
            save_fields.append('header_config')
        if 'footer_text_scope' in updates:
            save_fields.append('footer_config')
        document.save(update_fields=save_fields)

        # Re-read state for response
        _, ps_after = _ps()
        hpc = ps_after.get('header_pdf')
        fpc = ps_after.get('footer_pdf')
        eff_h = document.get_effective_header_config()
        eff_f = document.get_effective_footer_config()

        return Response({
            'document_id': str(document.id),
            'header_pdf_active': header_pdf_active,
            'footer_pdf_active': footer_pdf_active,
            'header_text_active': header_text_active,
            'footer_text_active': footer_text_active,
            'header_pdf_scope': _extract_scope(hpc) if header_pdf_active else None,
            'footer_pdf_scope': _extract_scope(fpc) if footer_pdf_active else None,
            'header_text_scope': _extract_scope(eff_h) if header_text_active else None,
            'footer_text_scope': _extract_scope(eff_f) if footer_text_active else None,
            'updated': list(updates.keys()),
        })

    @action(detail=True, methods=['get', 'patch'], url_path='export-settings')
    def export_settings(self, request, pk=None):
        """Get or update all export studio settings for a document."""
        document = self.get_object()

        def _safe_metadata(value):
            if not isinstance(value, dict):
                return {}
            try:
                json.dumps(value, cls=DjangoJSONEncoder)
            except Exception:
                return {}
            return value

        def _clean_processing_settings(ps):
            """Strip internal removal markers before sending to frontend."""
            if not isinstance(ps, dict):
                return {}
            return {k: v for k, v in ps.items() if v != '__removed__' and v is not None}

        custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
        processing_settings = custom_metadata.get('processing_settings')
        if not isinstance(processing_settings, dict):
            processing_settings = {}

        if request.method.lower() == 'get':
            org_defaults = {}
            try:
                organization = request.user.profile.organization
                settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                    organization=organization
                )
                preferences = settings_obj.preferences if isinstance(settings_obj.preferences, dict) else {}
                org_defaults = preferences.get('processing_defaults') or {}
            except Exception:
                org_defaults = {}

            if not isinstance(processing_settings.get('pdf_layout'), dict):
                processing_settings['pdf_layout'] = PDFLayoutOptions().to_metadata_dict()
            if isinstance(org_defaults, dict) and not isinstance(org_defaults.get('pdf_layout'), dict):
                org_defaults['pdf_layout'] = PDFLayoutOptions().to_metadata_dict()

            def _template_payload(templates):
                return [
                    {
                        'id': str(template.id),
                        'name': template.name,
                        'template_type': template.template_type,
                        'description': template.description,
                        'category': template.category,
                        'tags': template.tags,
                        'is_system': template.is_system,
                        'is_public': template.is_public,
                        'config': template.config,
                    }
                    for template in templates
                ]

            header_templates = HeaderFooterTemplate.objects.filter(template_type='header')
            footer_templates = HeaderFooterTemplate.objects.filter(template_type='footer')
            if request.user and request.user.is_authenticated:
                header_templates = header_templates.filter(
                    Q(is_public=True) |
                    Q(is_system=True) |
                    Q(created_by=request.user) |
                    Q(shared_with=request.user)
                ).distinct()
                footer_templates = footer_templates.filter(
                    Q(is_public=True) |
                    Q(is_system=True) |
                    Q(created_by=request.user) |
                    Q(shared_with=request.user)
                ).distinct()
            else:
                header_templates = header_templates.filter(is_public=True)
                footer_templates = footer_templates.filter(is_public=True)

            def _image_payload(image_type):
                images = DocumentImage.get_user_images_by_type(request.user, image_type)
                return [
                    {
                        'id': str(img.id),
                        'name': img.name,
                        'type': img.image_type,
                        'url': img.get_url(),
                        'thumbnail_url': img.get_thumbnail_url(),
                        'width': img.width,
                        'height': img.height,
                        'file_size': img.file_size,
                        'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None,
                        'usage_count': img.usage_count,
                        'tags': img.tags,
                    }
                    for img in images
                ]

            response_payload = {
                'document_id': str(document.id),
                'header_template': str(document.header_template_id) if document.header_template_id else None,
                'footer_template': str(document.footer_template_id) if document.footer_template_id else None,
                'header_config': document.header_config or {},
                'footer_config': document.footer_config or {},
                'effective_header_config': document.get_rendered_header_config(),
                'effective_footer_config': document.get_rendered_footer_config(),
                'processing_settings': _clean_processing_settings(processing_settings),
                'custom_metadata': _safe_metadata(custom_metadata),
                'organization_defaults': _safe_metadata(org_defaults),
                'dropdowns': {
                    'header_templates': _template_payload(header_templates),
                    'footer_templates': _template_payload(footer_templates),
                    'images': {
                        'logo': _image_payload('logo'),
                        'watermark': _image_payload('watermark'),
                        'background': _image_payload('background'),
                    },
                    'table_style_presets': [
                        {'value': 'standard', 'label': 'Standard', 'description': 'Grey header with beige rows'},
                        {'value': 'clean',    'label': 'Clean',    'description': 'Light grey header, white rows'},
                        {'value': 'dark',     'label': 'Dark',     'description': 'Dark header with dark rows'},
                        {'value': 'minimal',  'label': 'Minimal',  'description': 'White header, thin grid lines'},
                    ],
                    'table_overflow_modes': [
                        {'value': 'split_columns',  'label': 'Split columns across pages'},
                        {'value': 'separate_page',  'label': 'Table on separate page'},
                        {'value': 'rotate_page',    'label': 'Rotate page (landscape)'},
                        {'value': 'auto',           'label': 'Auto (let ReportLab decide)'},
                    ],
                },
            }
            return Response(response_payload)
        data = request.data or {}
        errors = {}

        incoming_settings = data.get('processing_settings')
        if incoming_settings is not None and not isinstance(incoming_settings, dict):
            errors['processing_settings'] = 'processing_settings must be a JSON object.'

        if 'header_template' in data:
            header_template_id = data.get('header_template') or None
            if not document.set_header_template(header_template_id, user=request.user):
                errors['header_template'] = 'Header template not found or no access.'

        if 'footer_template' in data:
            footer_template_id = data.get('footer_template') or None
            if not document.set_footer_template(footer_template_id, user=request.user):
                errors['footer_template'] = 'Footer template not found or no access.'

        if 'header_config' in data:
            header_config = data.get('header_config') or {}
            if not isinstance(header_config, dict):
                errors['header_config'] = 'Header config must be a JSON object.'
            else:
                document.header_config = header_config

        if 'footer_config' in data:
            footer_config = data.get('footer_config') or {}
            if not isinstance(footer_config, dict):
                errors['footer_config'] = 'Footer config must be a JSON object.'
            else:
                document.footer_config = footer_config

        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

        if isinstance(incoming_settings, dict):
            processing_settings.update(incoming_settings)
            custom_metadata['processing_settings'] = processing_settings

        if hasattr(document, 'get_search_metadata'):
            custom_metadata['search_metadata'] = document.get_search_metadata(include_custom_metadata=False)

        document.custom_metadata = custom_metadata
        document.save(update_fields=['custom_metadata', 'header_config', 'footer_config', 'updated_at'])

        return Response({
            'document_id': str(document.id),
            'processing_settings': _clean_processing_settings(processing_settings),
            'custom_metadata': _safe_metadata(custom_metadata),
            'header_template': str(document.header_template_id) if document.header_template_id else None,
            'footer_template': str(document.footer_template_id) if document.footer_template_id else None,
            'header_config': document.header_config or {},
            'footer_config': document.footer_config or {},
            'effective_header_config': document.get_rendered_header_config(),
            'effective_footer_config': document.get_rendered_footer_config(),
        })

    @action(detail=True, methods=['get'], url_path='download-token')
    def download_token(self, request, pk=None):
        """Return a short-lived signed token for download-pdf access."""
        document = self.get_object()
        token = signing.dumps(
            {
                'doc': str(document.id),
                'user': str(request.user.id),
                'scope': 'download',
            }
        )
        return Response({'download_token': token})

    def _get_document_etag(self, document):
        """Generate a strong ETag for a document based on updated_at and id."""
        updated_at = document.updated_at
        updated_at_value = updated_at.isoformat() if updated_at else ""
        etag_source = f"{document.id}:{updated_at_value}"
        etag_hash = hashlib.sha256(etag_source.encode("utf-8")).hexdigest()
        return f"\"{etag_hash}\""

    def _check_if_match(self, request, document):
        """Validate If-Match header to prevent overwriting newer data."""
        if_match = request.headers.get("If-Match")
        if not if_match:
            return None
        current_etag = self._get_document_etag(document)
        if if_match != current_etag:
            return Response(
                {
                    "error": "Document has been modified by another request.",
                    "detail": "ETag mismatch. Fetch the latest document and retry.",
                    "current_etag": current_etag,
                },
                status=status.HTTP_412_PRECONDITION_FAILED,
            )
        return None
    
    def retrieve(self, request, *args, **kwargs):
        """
        Get document details.
        Logs access for analytics.
        """
        instance = self.get_object()

        current_etag = self._get_document_etag(instance)
        if_none_match = request.headers.get("If-None-Match")
        if if_none_match == current_etag:
            response = Response(status=status.HTTP_304_NOT_MODIFIED)
            response["ETag"] = current_etag
            return response
        
        # Log access
        self._log_document_access(request, instance, 'view')
        
        serializer = self.get_serializer(instance)
        response = Response(serializer.data)
        response["ETag"] = current_etag
        return response
    
    def update(self, request, *args, **kwargs):
        """
        Update document.
        Requires 'editor' role or ownership.
        """
        instance = self.get_object()

        precondition_failed = self._check_if_match(request, instance)
        if precondition_failed:
            return precondition_failed
        
        # Check if user has editor access
        if not self._check_editor_access(request, instance):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Log access
        self._log_document_access(request, instance, 'edit')

        response = super().update(request, *args, **kwargs)
        if response.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED):
            instance.refresh_from_db()
            response["ETag"] = self._get_document_etag(instance)
            # Dispatch CLM workflow event
            try:
                from clm.event_system import handle_document_update
                handle_document_update(
                    document_id=str(instance.id),
                    change_summary={'update_type': 'full', 'fields': list(request.data.keys())},
                    user=request.user,
                )
            except Exception:
                pass  # Non-critical — don't break the save
        return response
    
    def partial_update(self, request, *args, **kwargs):
        """
        Partial update document.
        Requires 'editor' role or ownership.
        """
        instance = self.get_object()

        precondition_failed = self._check_if_match(request, instance)
        if precondition_failed:
            return precondition_failed
        
        # Check if user has editor access
        if not self._check_editor_access(request, instance):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Log access
        self._log_document_access(request, instance, 'edit')

        response = super().partial_update(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            instance.refresh_from_db()
            response["ETag"] = self._get_document_etag(instance)
            # Dispatch CLM workflow event
            try:
                from clm.event_system import handle_document_update
                handle_document_update(
                    document_id=str(instance.id),
                    change_summary={'update_type': 'partial', 'fields': list(request.data.keys())},
                    user=request.user,
                )
            except Exception:
                pass  # Non-critical — don't break the save
        return response
    
    def destroy(self, request, *args, **kwargs):
        """
        Delete document.
        Only owner can delete.
        """
        instance = self.get_object()
        
        # Only owner can delete
        if instance.created_by != request.user:
            return Response(
                {'error': 'Only document owner can delete'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Log access
        self._log_document_access(request, instance, 'delete')
        
        return super().destroy(request, *args, **kwargs)
    
    # Helper methods for access control
    
    def _check_editor_access(self, request, document):
        """
        Check if user has editor access to document.
        
        Handles edge cases:
        - Deleted documents (document could be None)
        - Missing user (anonymous access)
        - Expired shares (checked in get_user_role)
        - Missing profiles (handled in get_user_role)
        
        Returns:
            bool: True if user has editor access, False otherwise
        """
        if not document:
            return False
            
        user = request.user
        
        # Anonymous users can't edit
        if not user or not user.is_authenticated:
            return False
        
        # Owner has full access
        if hasattr(document, 'created_by') and document.created_by == user:
            return True
        
        # Check role via sharing system
        try:
            role = get_user_role(user, document)
            return role == 'editor'
        except Exception:
            # If anything goes wrong (deleted share, etc.), deny access
            return False
    
    def _log_document_access(self, request, document, access_type):
        """Log document access for analytics and audit."""
        # Get share if accessed via share
        share_instance = getattr(request, 'share', None)
        share_id = share_instance.id if share_instance else None
        
        AccessLog.objects.create(
            content_object=document,
            user=request.user,
            access_type=access_type,
            ip_address=request.META.get('REMOTE_ADDR'),
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
            share_id=share_id,
            session_id=request.session.session_key if hasattr(request, 'session') else None,
            success=True
        )
    
    @action(detail=False, methods=['get'], url_path='my-documents')
    def my_documents(self, request):
        """
        GET /api/documents/my-documents/
        Get documents created by the current user.
        """
        documents = Document.objects.filter(
            created_by=request.user
        ).order_by('-created_at')
        
        serializer = self.get_serializer(documents, many=True)
        return Response({
            'count': documents.count(),
            'results': serializer.data
        })
    
    @action(detail=False, methods=['get'], url_path='shared-with-me')
    def shared_with_me(self, request):
        """
        GET /api/documents/shared-with-me/
        Get documents that have been shared with the current user.
        Excludes documents owned by the user.
        
        Response includes:
        - Document details
        - Share role (viewer, commenter, editor)
        - Shared by (user who shared it)
        - Shared date
        """
        from sharing.models import Share
        from user_management.models import Team
        
        user = request.user
        
        # Get user's teams (handle case where user has no profile)
        user_teams = Team.objects.none()
        if hasattr(user, 'profile'):
            try:
                user_teams = Team.objects.filter(members=user.profile)
            except Exception as e:
                print(f"Error getting user teams: {e}")
        
        # Get ContentType for Document
        content_type = ContentType.objects.get_for_model(Document)
        
        # Get shares for this user (direct or via team)
        shares = Share.objects.filter(
            content_type=content_type,
            is_active=True
        ).filter(
            Q(shared_with_user=user) |
            Q(shared_with_team__in=user_teams)
        ).select_related(
            'shared_by', 'shared_with_user', 'shared_with_team'
        )
        
        # Debug: print shares found
        print(f"DEBUG: User {user.username} (ID: {user.id})")
        print(f"DEBUG: Found {shares.count()} shares")
        for share in shares:
            print(f"DEBUG: Share object_id={share.object_id}, type={type(share.object_id)}")
        
        # Get document IDs from shares - handle both string and UUID
        shared_doc_ids = list(shares.values_list('object_id', flat=True))
        print(f"DEBUG: Shared doc IDs: {shared_doc_ids}")
        
        # Get documents (exclude ones user owns)
        documents = Document.objects.filter(
            id__in=shared_doc_ids
        ).exclude(
            created_by=user
        )
        
        print(f"DEBUG: Found {documents.count()} documents")
        
        documents = documents.order_by('-created_at').prefetch_related(
            'sections__paragraphs__sentences',
            'issues'
        )
        
        # Build response with share information
        results = []
        share_map = {str(share.object_id): share for share in shares}
        
        for doc in documents:
            share = share_map.get(str(doc.id))
            doc_data = self.get_serializer(doc).data
            
            # Add share metadata
            doc_data['share_info'] = {
                'role': share.role if share else 'viewer',
                'shared_by': share.shared_by.username if share and share.shared_by else None,
                'shared_at': share.shared_at.isoformat() if share else None,
                'share_type': share.share_type if share else None,
                'can_edit': share.role == 'editor' if share else False,
                'can_comment': share.role in ['editor', 'commenter'] if share else False,
            }
            
            results.append(doc_data)
        
        return Response({
            'count': len(results),
            'results': results
        })
    
    @action(detail=False, methods=['get'], url_path='organization-documents')
    def organization_documents(self, request):
        """
        GET /api/documents/organization-documents/
        Get documents from the user's organization.
        """
        try:
            user_profile = request.user.profile
            organization = user_profile.organization
            
            # Get all users in the organization
            org_users = organization.user_profiles.values_list('user', flat=True)
            
            documents = Document.objects.filter(
                created_by__in=org_users
            ).order_by('-created_at')
            
            serializer = self.get_serializer(documents, many=True)
            return Response({
                'count': documents.count(),
                'results': serializer.data
            })
        except Exception as e:
            return Response(
                {'error': 'Could not fetch organization documents'},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'], url_path='import')
    def import_document(self, request):
        """
        POST /api/documents/import
        Parse and import a new document.
        """
        serializer = DocumentCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        data = serializer.validated_data
        
        try:
            # Parse the document using the service
            document = DocumentParser.parse_document(
                raw_text=data['content'],
                title=data.get('title', 'Untitled Document'),
                author=data.get('author')
            )
            
            # Serialize and return
            output_serializer = DocumentSerializer(document)
            return Response(output_serializer.data, status=status.HTTP_201_CREATED)
        
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _partial_save_change_envelope(self, request, document):
        """
        Process a list of change operations.

        Supported ops:
          - "update"  — requires ``id``, dispatches to handler.update()
          - "create"  — dispatches to handler.create(); ``id`` is optional
                        (client may supply a client_id in data for response mapping)
          - "delete"  — requires ``id``, dispatches to handler.delete()

        document-type changes only support "update".
        """
        changes = request.data.get("changes")
        if not isinstance(changes, list):
            return Response(
                {"error": "changes must be a list"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        VALID_OPS = {"update", "create", "delete"}
        # Only the document handler supports update; others support all three ops.
        DOCUMENT_ONLY_TYPES = {"document"}

        errors = []
        for index, change in enumerate(changes):
            if not isinstance(change, dict):
                errors.append({"index": index, "error": "change must be an object"})
                continue

            change_type = change.get("type")
            op = change.get("op")
            if not change_type:
                errors.append({"index": index, "error": "type is required"})
                continue
            if op not in VALID_OPS:
                errors.append({
                    "index": index,
                    "error": f"op must be one of: {', '.join(sorted(VALID_OPS))}. Got: '{op}'.",
                })
                continue
            if change_type in DOCUMENT_ONLY_TYPES and op != "update":
                errors.append({
                    "index": index,
                    "error": f"'{change_type}' only supports 'update' op.",
                })
                continue
            # update/delete require an id; create does not (backend assigns UUID)
            if op in {"update", "delete"} and not change.get("id"):
                errors.append({"index": index, "error": f"id is required for {op}"})
                continue
            if not isinstance(change.get("data") or {}, dict):
                errors.append({"index": index, "error": "data must be an object"})
                continue

            handler = HANDLERS.get(change_type)
            if not handler:
                errors.append({"index": index, "error": f"unknown type: {change_type}"})
                continue

            handler_errors = handler.validate(change)
            if handler_errors:
                errors.append({"index": index, "error": handler_errors})

        if errors:
            return Response({"errors": errors}, status=status.HTTP_400_BAD_REQUEST)

        updated: list = []
        deleted: list = []
        conflicts: list = []
        changes_applied = False

        try:
            with transaction.atomic():
                for change in changes:
                    handler = HANDLERS[change["type"]]
                    op = change.get("op")

                    if op == "create":
                        result = handler.create(document, change, request.user)
                    elif op == "delete":
                        result = handler.delete(document, change, request.user)
                    else:
                        result = handler.update(document, change, request.user)

                    if not isinstance(result, dict) or "type" not in result or "id" not in result:
                        raise ValueError("Handler result must include type and id")

                    if result.get("conflict"):
                        conflicts.append(result)
                        continue

                    if op == "delete":
                        deleted.append(result)
                    else:
                        updated.append(result)
                    changes_applied = True

                if changes_applied:
                    document.last_modified_by = request.user
                    document.save()
                    self._log_document_save(
                        document,
                        request.user,
                        description='Document partial-save applied (change envelope)',
                        change_summary=request.data.get('change_summary') if isinstance(request.data, dict) else None,
                    )

            status_code = status.HTTP_200_OK
            if conflicts and not updated and not deleted:
                status_code = status.HTTP_409_CONFLICT

            response = Response(
                {"updated": updated, "deleted": deleted, "conflicts": conflicts},
                status=status_code,
            )
            response["ETag"] = self._get_document_etag(document)

            # ── Dispatch CLM workflow event for document update ─────────
            if changes_applied:
                try:
                    from clm.event_system import handle_document_update
                    change_types = list({c.get('type', '') for c in changes if c.get('type')})
                    handle_document_update(
                        document_id=str(document.id),
                        change_summary={
                            'changes_applied': len(updated) + len(deleted),
                            'updated_count': len(updated),
                            'deleted_count': len(deleted),
                            'types': change_types,
                        },
                        user=request.user,
                    )
                except Exception as e:
                    logger.warning(f'CLM event dispatch failed for document {document.id}: {e}')

            return response

        except (Section.DoesNotExist, Paragraph.DoesNotExist, Table.DoesNotExist,
                ImageComponent.DoesNotExist, DocumentFileComponent.DoesNotExist,
                DocumentFile.DoesNotExist, DocumentImage.DoesNotExist) as exc:
            return Response(
                {"error": "Referenced resource not found", "detail": str(exc)},
                status=status.HTTP_404_NOT_FOUND,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=True, methods=['post'])
    def analyze(self, request, pk=None):
        """
        POST /api/documents/{id}/analyze
        Run AI analysis on the document.
        """
        document = self.get_object()
        
        # Check if user has editor access (analysis modifies document)
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to analyze document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            # Clear existing issues before re-analysis
            document.issues.all().delete()
            
            # Run analysis
            issues = DocumentAnalyzer.analyze_document(document)
            
            # Refresh and return updated document
            document.refresh_from_db()
            serializer = DocumentSerializer(document)
            return Response(serializer.data)
        
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['post'])
    def export(self, request, pk=None):
        """
        POST /api/documents/{id}/export
        Export document in specified format.
        """
        document = self.get_object()
        export_format = request.data.get('format', 'docx')
        
        # TODO: Implement DOCX/PDF export using python-docx
        # For now, return raw text
        
        return Response({
            'format': export_format,
            'content': document.raw_text,
            'title': document.title
        })
    
    @action(detail=True, methods=['get'], url_path='complete')
    def get_complete(self, request, pk=None):
        """
        GET /api/documents/{id}/complete/
        
        Get complete document with ALL elements in a single optimized response:
        - All sections (with nested hierarchy)
        - All paragraphs (with sentences)
        - All inline images (with absolute URLs)
        - All document images (logo, watermark, header/footer icons, background)
        - All attachments
        - All metadata fields
        - Referenced documents
        - Issues/suggestions
        - Document statistics
        
        This endpoint is optimized for fast frontend rendering by providing
        everything needed to display the document in a single request.
        
        Response includes:
        {
            "id": "uuid",
            "title": "Document Title",
            "sections": [
                {
                    "id": "s1",
                    "title": "Section 1",
                    "paragraphs": [
                        {
                            "id": "p1",
                            "content": {...},
                            "inline_images": [
                                {
                                    "id": "img1",
                                    "image_url": "http://...",
                                    "alignment": "center",
                                    ...
                                }
                            ],
                            "sentences": [...]
                        }
                    ],
                    "children": [...]
                }
            ],
            "issues": [...],
            "logo_url": "http://...",
            "watermark_url": "http://...",
            "attachments": [...],
            "referenced_documents": [...],
            "metadata": {...},
            "stats": {...}
        }
        """
        try:
            # Get document using proper access control (includes shared documents)
            document = self.get_object()
            
            # Optimize with prefetch_related for performance
            # Re-fetch with optimizations while maintaining access control
            # This also verifies the user still has access (in case share was revoked)
            document = self.get_queryset().prefetch_related(
                'sections__paragraphs__sentences',
                'sections__tables',  # Tables in sections
                'sections__image_components',  # Image components in sections
                'sections__file_components',  # File components in sections
                'sections__children',
                'issues',
                'file_attachments'
            ).get(pk=document.pk)
            
            serializer = CompleteDocumentSerializer(document, context={'request': request})
            data = serializer.data

            # Inject share_info so the frontend knows the user's role
            if document.created_by != request.user:
                from sharing.permissions import get_user_role
                from sharing.models import Share
                from user_management.models import Team
                role = get_user_role(request.user, document)
                if role:
                    try:
                        user_teams = Team.objects.filter(members=request.user.profile)
                    except Exception:
                        user_teams = Team.objects.none()
                    share = Share.objects.filter(
                        content_type=ContentType.objects.get_for_model(Document),
                        object_id=str(document.pk),
                        is_active=True,
                    ).filter(
                        Q(shared_with_user=request.user) |
                        Q(shared_with_team__in=user_teams)
                    ).select_related('shared_by').first()
                    data['share_info'] = {
                        'role': role,
                        'shared_by': share.shared_by.username if share and share.shared_by else None,
                        'shared_by_name': (
                            share.shared_by.get_full_name() or share.shared_by.username
                        ) if share and share.shared_by else None,
                        'shared_at': share.shared_at.isoformat() if share else None,
                        'share_type': share.share_type if share else None,
                        'can_edit': role == 'editor',
                        'can_comment': role in ('editor', 'commenter'),
                    }

            return Response(data)
        except Document.DoesNotExist:
            # Document was deleted or access was revoked between checks
            return Response(
                {'detail': 'Document not found or access denied'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['post', 'put'], url_path='bulk-save')
    def bulk_save(self, request, pk=None):
        """
        REMOVED — This endpoint has been fully removed.

        All document editing now uses:
        - Direct REST endpoints for creates/deletes (sections, paragraphs, tables,
          image-components, file-components, latex-codes)
        - POST /partial-save/ for updates (via SaveCoordinator change-envelope)
        """
        return Response(
            {
                'error': 'bulk-save endpoint has been removed. '
                         'Use direct REST endpoints for creates/deletes '
                         'and POST /partial-save/ for updates.'
            },
            status=status.HTTP_410_GONE,
        )

    @action(detail=True, methods=['post'], url_path='partial-save')
    def partial_save(self, request, pk=None):
        """
        POST /api/documents/{id}/partial-save/

        Save only updated parts of a document (sections/paragraphs) and
        return only the updated data to reduce bandwidth.

        Request body:
        {
            "document": { "title": "...", "status": "..." },
            "sections": [
                {
                    "id": "section-uuid",
                    "version": 3,
                    "title": "Updated Title",
                    "content": "Edited section text",
                    "order": 2,
                    "metadata": {"key": "value"}
                }
            ],
            "paragraphs": [
                {
                    "id": "paragraph-uuid",
                    "content": "Edited paragraph text",
                    "base_last_modified": "2026-01-19T10:00:00Z"
                }
            ],
            "deleted": {
                "sections": ["section-uuid"],
                "paragraphs": ["paragraph-uuid"]
            }
        }

        Response:
        {
            "message": "Partial save applied",
            "updated": {"sections": [...], "paragraphs": [...]},
            "deleted": {"sections": [...], "paragraphs": [...]},
            "conflicts": {"sections": [...], "paragraphs": [...]}
        }
        """
        document = self.get_object()

        precondition_failed = self._check_if_match(request, document)
        if precondition_failed:
            return precondition_failed

        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )

        if isinstance(request.data, dict) and "changes" in request.data:
            return self._partial_save_change_envelope(request, document)


        # Old-format partial save (with sections/paragraphs/deleted keys) is no longer supported.
        # Only the change-envelope format {"changes": [...]} is accepted.
        return Response(
            {
                'error': 'Legacy partial-save format is no longer supported. '
                         'Use the change-envelope format: {"changes": [{"type": ..., "op": "update", "id": ..., "data": {...}}]}. '
                         'Creates and deletes must use direct REST endpoints.'
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    
    @action(detail=True, methods=['get'], url_path='graph')
    def get_graph(self, request, pk=None):
        """
        GET /api/documents/{id}/graph/
        
        Get complete document graph with full hierarchical structure optimized for AI and frontend.
        
        This endpoint provides a comprehensive view of the entire document including:
        - Complete section hierarchy (recursive, unlimited depth)
        - All paragraphs with inline images and formatting
        - All sentences with linguistic analysis
        - All cross-references and bidirectional links
        - All formatting metadata
        - Document-level images and attachments
        - Issues grouped by severity
        - Version history
        - Comprehensive statistics
        
        PERFORMANCE: Optimized with select_related and prefetch_related for single-query loading.
        
        USE CASES:
        - AI document analysis and processing
        - Frontend document rendering with full context
        - Document export with complete structure
        - Cross-reference validation
        - Hierarchical navigation
        
        Response structure:
        {
            "id": "doc-uuid",
            "title": "Document Title",
            "metadata": {
                "document_metadata": {...},
                "custom_metadata": {...},
                "parties": [...],
                "dates": {...},
                "legal": {...}
            },
            "sections": [
                {
                    "id": "s1",
                    "title": "Section 1",
                    "numbering": "1",
                    "depth_level": 1,
                    "effective_content": "...",
                    "formatting": {...},
                    "references": [...],
                    "referenced_by": [...],
                    "paragraphs": [
                        {
                            "id": "p1",
                            "effective_content": "...",
                            "formatting": {...},
                            "references": [...],
                            "inline_images": [...],
                            "sentences": [...]
                        }
                    ],
                    "children": [
                        {
                            "id": "s1.1",
                            "depth_level": 2,
                            "paragraphs": [...],
                            "children": [...]
                        }
                    ]
                }
            ],
            "issues": {
                "total": 10,
                "critical": [...],
                "high": [...],
                "medium": [...],
                "low": [...],
                "all": [...]
            },
            "images": {
                "logo": {...},
                "watermark": {...},
                "inline_images": [...]
            },
            "attachments": [...],
            "versions": [...],
            "statistics": {
                "sections_count": 15,
                "paragraphs_count": 45,
                "sentences_count": 120,
                "sections_by_type": {...},
                "sections_by_depth": {...},
                "word_count": 5000,
                "completion_percentage": 85
            }
        }
        """
        from .serializers import DocumentGraphSerializer
        
        # Get document with all related data optimized
        document = Document.objects.prefetch_related(
            # Sections and nested hierarchy
            'sections',
            'sections__children',
            'sections__children__children',
            'sections__children__children__children',
            # Paragraphs and sentences
            'sections__paragraphs',
            'sections__paragraphs__sentences',
            'sections__children__paragraphs',
            'sections__children__paragraphs__sentences',
            # Other related data
            'issues',
            'issues__section',
            'issues__paragraph',
            'issues__sentence',
            'file_attachments',
            'versions'
        ).select_related(
            'logo_image',
            'watermark_image',
            'background_image',
            'header_template',
            'footer_template',
            'created_by',
            'last_modified_by'
        ).get(pk=pk)
        
        serializer = DocumentGraphSerializer(document, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'], url_path='export')
    def export_document(self, request, pk=None):
        """
        GET /api/documents/{id}/export/
        
        Export COMPLETE document with ALL content and referenced documents.
        
        This is the COMPREHENSIVE EXPORT API for printing/downloading.
        Includes:
        - Complete document text (all sections, paragraphs)
        - ALL inline references with their full content
        - ALL referenced sections/paragraphs (expanded)
        - Document metadata and formatting
        - Images and attachments
        - Version information
        - Statistics
        
        Perfect for:
        - PDF generation
        - Word document export
        - Complete HTML rendering
        - Archival/backup
        - Legal compliance (complete records)
        
        Query Parameters:
        - include_referenced=true (default) - Include full content of all referenced documents
        - include_images=true (default) - Include image data
        - include_metadata=true (default) - Include all metadata
        - format=json|html|markdown (default: json)
        
        Response includes everything needed for complete document reconstruction.
        """
        document = self.get_object()
        
        # Parse query parameters
        include_referenced = request.query_params.get('include_referenced', 'true').lower() == 'true'
        include_images = request.query_params.get('include_images', 'true').lower() == 'true'
        include_metadata = request.query_params.get('include_metadata', 'true').lower() == 'true'
        export_format = request.query_params.get('format', 'json')
        
        # Build complete export data
        export_data = {
            'document': {
                'id': str(document.id),
                'title': document.title,
                'document_type': document.document_type,
                'created_at': document.created_at,
                'updated_at': document.updated_at,
                'version': document.version,
            }
        }
        
        # Add metadata if requested
        if include_metadata:
            export_data['document']['metadata'] = {
                'parties': document.parties or [],
                'effective_date': str(document.effective_date) if document.effective_date else None,
                'execution_date': str(document.execution_date) if document.execution_date else None,
                'expiration_date': str(document.expiration_date) if document.expiration_date else None,
                'governing_law': document.governing_law,
                'jurisdiction': document.jurisdiction,
                'reference_number': document.reference_number,
                'custom_metadata': document.custom_metadata or {}
            }
        
        # Build complete section hierarchy with content
        sections_data = []
        referenced_content = {}  # Store all referenced content here
        all_reference_ids = set()  # Track all references for batch loading
        
        # First pass: Build document structure and collect reference IDs
        for section in document.sections.filter(parent__isnull=True).order_by('order'):
            section_data = self._build_section_export(section, all_reference_ids)
            sections_data.append(section_data)
        
        export_data['sections'] = sections_data
        
        # Second pass: Load ALL referenced content if requested
        if include_referenced and all_reference_ids:
            referenced_content = self._load_all_referenced_content(
                list(all_reference_ids), 
                request.user
            )
            export_data['referenced_content'] = referenced_content
        
        # Add images if requested
        if include_images:
            images_data = []
            for img in document.images.all():
                img_data = {
                    'id': str(img.id),
                    'name': img.name,
                    'image_type': img.image_type,
                    'caption': img.caption,
                    'alt_text': img.alt_text,
                    'width': img.width,
                    'height': img.height,
                }
                if img.image:
                    img_data['url'] = request.build_absolute_uri(img.image.url) if request else img.image.url
                if img.thumbnail:
                    img_data['thumbnail_url'] = request.build_absolute_uri(img.thumbnail.url) if request else img.thumbnail.url
                images_data.append(img_data)
            
            export_data['images'] = images_data
        
        # Add statistics
        export_data['statistics'] = {
            'total_sections': document.sections.count(),
            'total_paragraphs': sum(s.paragraphs.count() for s in document.sections.all()),
            'total_words': document.word_count or 0,
            'total_references': len(all_reference_ids),
            'total_images': document.images.count(),
        }
        
        # Format conversion
        if export_format == 'html':
            return Response({
                'format': 'html',
                'content': self._convert_to_html(export_data)
            })
        elif export_format == 'markdown':
            return Response({
                'format': 'markdown',
                'content': self._convert_to_markdown(export_data)
            })
        else:
            # Default JSON format
            return Response(export_data)
    
    def _build_section_export(self, section, reference_ids_collector):
        """
        Recursively build section data for export.
        Collects all reference IDs encountered.
        """
        section_data = {
            'id': str(section.id),
            'title': section.title,
            'section_type': section.section_type,
            'order': section.order,
            'depth_level': section.depth_level,
            'content': section.get_effective_content(),
            'paragraphs': []
        }
        
        # Add all paragraphs
        for para in section.paragraphs.all().order_by('order'):
            content = para.get_effective_content()
            
            para_data = {
                'id': str(para.id),
                'content': content,
                'paragraph_type': para.paragraph_type,
                'order': para.order,
                'has_edits': para.has_edits
            }
            
            section_data['paragraphs'].append(para_data)
        
        # Add subsections (recursive)
        subsections = section.children.all().order_by('order')
        if subsections.exists():
            section_data['subsections'] = [
                self._build_section_export(subsec, reference_ids_collector)
                for subsec in subsections
            ]
        
        return section_data
    
    def _convert_to_html(self, export_data):
        """Convert export data to HTML format for printing."""
        html_parts = []
        
        # Document header
        doc = export_data['document']
        html_parts.append(f"<html><head><title>{doc['title']}</title>")
        html_parts.append("<style>")
        html_parts.append("body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }")
        html_parts.append("h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }")
        html_parts.append("h2 { color: #2196F3; margin-top: 30px; }")
        html_parts.append("h3 { color: #666; margin-top: 20px; }")
        html_parts.append("p { line-height: 1.6; margin: 10px 0; }")
        html_parts.append(".inline-ref { color: #2196F3; text-decoration: underline; cursor: pointer; }")
        html_parts.append(".metadata { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }")
        html_parts.append(".referenced-content { background: #fff3cd; padding: 15px; margin: 10px 0; border-left: 3px solid #ffc107; }")
        html_parts.append("</style></head><body>")
        
        html_parts.append(f"<h1>{doc['title']}</h1>")
        
        # Metadata
        if 'metadata' in doc:
            html_parts.append("<div class='metadata'>")
            html_parts.append("<h3>Document Metadata</h3>")
            meta = doc['metadata']
            if meta.get('effective_date'):
                html_parts.append(f"<p><strong>Effective Date:</strong> {meta['effective_date']}</p>")
            if meta.get('governing_law'):
                html_parts.append(f"<p><strong>Governing Law:</strong> {meta['governing_law']}</p>")
            if meta.get('parties'):
                html_parts.append(f"<p><strong>Parties:</strong> {', '.join(meta['parties'])}</p>")
            html_parts.append("</div>")
        
        # Sections
        for section in export_data.get('sections', []):
            html_parts.append(self._section_to_html(section, level=2))
        
        # Referenced content
        if export_data.get('referenced_content'):
            html_parts.append("<div style='page-break-before: always;'>")
            html_parts.append("<h2>Referenced Documents</h2>")
            for ref_id, ref_content in export_data['referenced_content'].items():
                html_parts.append("<div class='referenced-content'>")
                if ref_content['type'] == 'section':
                    html_parts.append(f"<h3>{ref_content['title']}</h3>")
                    html_parts.append(f"<p><em>From: {ref_content['document_title']}</em></p>")
                    html_parts.append(f"<div>{ref_content['full_text'].replace(chr(10), '<br>')}</div>")
                elif ref_content['type'] == 'paragraph':
                    html_parts.append(f"<p><strong>{ref_content['section_title']}</strong></p>")
                    html_parts.append(f"<p>{ref_content['content']}</p>")
                html_parts.append("</div>")
            html_parts.append("</div>")
        
        html_parts.append("</body></html>")
        
        return '\n'.join(html_parts)
    
    def _section_to_html(self, section, level=2):
        """Convert section to HTML recursively."""
        html_parts = []
        
        html_parts.append(f"<h{level}>{section['title']}</h{level}>")
        
        for para in section.get('paragraphs', []):
            content = para['content'] or ''
            
            # Replace inline reference markers with styled spans
            for ref in para.get('inline_references', []):
                marker = ref.get('marker', '')
                display = ref.get('display_text', '')
                if marker and display:
                    content = content.replace(
                        marker,
                        f"<span class='inline-ref' title='Reference'>{display}</span>"
                    )
            
            html_parts.append(f"<p>{content}</p>")
        
        # Subsections
        for subsec in section.get('subsections', []):
            html_parts.append(self._section_to_html(subsec, level + 1))
        
        return '\n'.join(html_parts)
    
    def _convert_to_markdown(self, export_data):
        """Convert export data to Markdown format."""
        md_parts = []
        
        # Document header
        doc = export_data['document']
        md_parts.append(f"# {doc['title']}\n")
        
        # Metadata
        if 'metadata' in doc:
            md_parts.append("## Metadata\n")
            meta = doc['metadata']
            if meta.get('effective_date'):
                md_parts.append(f"**Effective Date:** {meta['effective_date']}\n")
            if meta.get('governing_law'):
                md_parts.append(f"**Governing Law:** {meta['governing_law']}\n")
            md_parts.append("\n")
        
        # Sections
        for section in export_data.get('sections', []):
            md_parts.append(self._section_to_markdown(section, level=2))
        
        # Referenced content
        if export_data.get('referenced_content'):
            md_parts.append("\n---\n\n## Referenced Documents\n")
            for ref_id, ref_content in export_data['referenced_content'].items():
                if ref_content['type'] == 'section':
                    md_parts.append(f"\n### {ref_content['title']}\n")
                    md_parts.append(f"*From: {ref_content['document_title']}*\n\n")
                    md_parts.append(f"{ref_content['full_text']}\n")
                elif ref_content['type'] == 'paragraph':
                    md_parts.append(f"\n**{ref_content['section_title']}**\n\n")
                    md_parts.append(f"{ref_content['content']}\n")
        
        return '\n'.join(md_parts)
    
    def _section_to_markdown(self, section, level=2):
        """Convert section to Markdown recursively."""
        md_parts = []
        
        md_parts.append(f"{'#' * level} {section['title']}\n")
        
        for para in section.get('paragraphs', []):
            content = para['content'] or ''
            
            # Replace inline reference markers with markdown links
            for ref in para.get('inline_references', []):
                marker = ref.get('marker', '')
                display = ref.get('display_text', '')
                target = ref.get('target_section') or ref.get('target_paragraph') or ref.get('target_url', '')
                if marker and display:
                    content = content.replace(
                        marker,
                        f"[{display}](#ref-{target})"
                    )
            
            md_parts.append(f"{content}\n")
        
        # Subsections
        for subsec in section.get('subsections', []):
            md_parts.append(self._section_to_markdown(subsec, level + 1))
        
        return '\n'.join(md_parts)
    
    @action(detail=True, methods=['post'])
    def rewrite(self, request, pk=None):
        """
        POST /api/documents/{id}/rewrite
        Get AI rewrite for a specific section.
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to rewrite content'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        section_id = request.data.get('sectionId')
        prompt = request.data.get('prompt', '')
        
        # TODO: Integrate with AI model for rewriting
        
        return Response({
            'sectionId': section_id,
            'rewritten': 'AI rewrite would appear here',
            'prompt': prompt
        })
    
    @action(detail=False, methods=['get'], url_path='templates')
    def list_templates(self, request):
        """
        GET /api/documents/templates/
        Get list of available document templates.
        """
        templates = DocumentDrafter.get_available_templates()
        return Response({
            'count': len(templates),
            'templates': templates
        })
    
    @action(detail=False, methods=['get'], url_path='templates/(?P<template_name>[^/.]+)')
    def template_details(self, request, template_name=None):
        """
        GET /api/documents/templates/{template_name}/
        Get details and placeholders for a specific template.
        """
        if template_name not in DocumentTemplate.TEMPLATES:
            return Response(
                {'error': 'Template not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        template = DocumentTemplate.TEMPLATES[template_name]
        placeholders = DocumentDrafter.get_template_placeholders(template_name)
        
        return Response({
            'name': template_name,
            'title': template['title'],
            'type': template['document_type'],
            'category': template['category'],
            'sections': template['sections'],
            'placeholders': placeholders
        })
    
    @action(detail=False, methods=['post'], url_path='create-from-template')
    def create_from_template(self, request):
        """
        POST /api/documents/create-from-template/
        Create a new document from a template.
        
        Body:
        {
            "template_name": "service_agreement",
            "title": "Custom Title (optional)",
            "metadata": {
                "parties": [...],
                "effective_date": "2025-01-01",
                "contract_value": "100000.00",
                "governing_law": "State of California",
                ...
            },
            "replacements": {
                "PARTY_A": "Acme Corp",
                "PARTY_B": "Client Inc",
                "START_DATE": "January 1, 2025",
                ...
            }
        }
        """
        serializer = TemplateDocumentSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            document = DocumentDrafter.create_from_template(
                template_name=serializer.validated_data['template_name'],
                user=request.user,
                metadata=serializer.validated_data.get('metadata', {}),
                replacements=serializer.validated_data.get('replacements', {})
            )
            
            # Rebuild indexes after template creation
            document.rebuild_component_indexes()
            
            output_serializer = DocumentSerializer(document)
            return Response(output_serializer.data, status=status.HTTP_201_CREATED)
        
        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=False, methods=['post'], url_path='create-structured')
    def create_structured(self, request):
        """
        POST /api/documents/create-structured/
        Create a fully structured document from custom sections.
        
        Body:
        {
            "title": "Custom Agreement",
            "sections": [
                {
                    "title": "Introduction",
                    "content": "This is the intro text..."
                },
                {
                    "title": "Terms",
                    "paragraphs": ["First paragraph", "Second paragraph"]
                }
            ],
            "metadata": {
                "document_type": "contract",
                "category": "contract",
                "parties": [...],
                ...
            }
        }
        """
        serializer = StructuredDocumentSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            document = DocumentDrafter.create_structured_document(
                user=request.user,
                title=serializer.validated_data['title'],
                sections_data=serializer.validated_data['sections'],
                metadata=serializer.validated_data.get('metadata', {})
            )
            
            # Rebuild indexes after structured creation
            document.rebuild_component_indexes()
            
            output_serializer = DocumentSerializer(document)
            return Response(output_serializer.data, status=status.HTTP_201_CREATED)
        
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['get', 'patch'], url_path='document-status')
    def document_status(self, request, pk=None):
        """
        GET  /api/documents/{id}/document-status/  → current status + choices
        PATCH /api/documents/{id}/document-status/  → update status

        Body (PATCH):
            { "status": "draft" }

        Response:
            {
                "status": "draft",
                "status_display": "Draft",
                "choices": [
                    {"value": "draft", "label": "Draft"},
                    {"value": "under_review", "label": "Under Review"},
                    ...
                ]
            }
        """
        document = self.get_object()

        if request.method == 'GET':
            return Response({
                'status': document.status,
                'status_display': document.get_status_display(),
                'choices': [
                    {'value': v, 'label': l}
                    for v, l in Document.STATUS_CHOICES
                ],
            })

        # PATCH
        new_status = request.data.get('status')
        if not new_status:
            return Response(
                {'error': 'status is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_statuses = {v for v, _ in Document.STATUS_CHOICES}
        if new_status not in valid_statuses:
            return Response(
                {'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_status = document.status
        if new_status != old_status:
            document.status = new_status
            document.last_modified_by = request.user
            document.save(update_fields=['status', 'last_modified_by', 'updated_at'])

        return Response({
            'status': document.status,
            'status_display': document.get_status_display(),
            'previous_status': old_status,
            'choices': [
                {'value': v, 'label': l}
                for v, l in Document.STATUS_CHOICES
            ],
        })

    @action(detail=True, methods=['put', 'patch'], url_path='edit-full')
    def edit_full(self, request, pk=None):
        """
        PUT/PATCH /api/documents/{id}/edit-full/
        Comprehensive endpoint to edit ALL document fields in one atomic request.
        
        Supports:
        - All metadata fields (title, author, dates, parties, financial terms, etc.)
        - Document images (logo, watermark, header_icon, footer_icon, background)
        - Attachments
        - Version information
        - Legal provisions
        - Financial terms
        - Custom metadata
        
        Request body example:
        {
            "title": "Updated Contract Title",
            "author": "John Doe",
            "effective_date": "2026-01-01",
            "contract_value": "50000.00",
            "currency": "USD",
            "parties": [{"name": "Company A", "role": "Provider"}],
            "logo_image_id": "uuid-here",
            "watermark_image_id": "uuid-here",
            "header_icon_id": "uuid-here",
            "footer_icon_id": "uuid-here",
            "background_image_id": "uuid-here",
            "attachments": [{"name": "Exhibit A", "type": "exhibit"}],
            "payment_terms": {"schedule": "monthly", "due_days": 30},
            "governing_law": "California",
            "dispute_resolution_method": "arbitration",
            "change_summary": "Updated contract terms and added exhibit"
        }
        """
        document = self.get_object()

        precondition_failed = self._check_if_match(request, document)
        if precondition_failed:
            return precondition_failed
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        serializer = FullDocumentEditSerializer(data=request.data)
        
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        data = serializer.validated_data
        changes = []
        
        try:
            with transaction.atomic():
                # Track all changes for changelog
                original_values = {}
                
                # Update Core Metadata
                if 'title' in data and data['title'] != document.title:
                    original_values['title'] = document.title
                    document.title = data['title']
                    changes.append(f"Title changed from '{original_values['title']}' to '{document.title}'")
                
                if 'author' in data and data['author'] != document.author:
                    original_values['author'] = document.author
                    document.author = data['author']
                    changes.append(f"Author changed to '{document.author}'")
                
                if 'version' in data:
                    original_values['version'] = document.version
                    document.version = data['version']
                    changes.append(f"Version updated to {document.version}")
                
                if 'document_type' in data:
                    document.document_type = data['document_type']
                
                # Update Version Management
                for field in ['version_number', 'major_version', 'minor_version', 'patch_version']:
                    if field in data:
                        setattr(document, field, data[field])
                
                if 'is_draft' in data:
                    document.is_draft = data['is_draft']
                    changes.append(f"Draft status: {data['is_draft']}")
                
                if 'version_label' in data:
                    document.version_label = data['version_label']
                
                if 'version_notes' in data:
                    document.version_notes = data['version_notes']
                
                # Update Parties and Stakeholders
                if 'parties' in data:
                    original_values['parties'] = document.parties
                    document.parties = data['parties']
                    changes.append(f"Updated {len(data['parties'])} parties")
                
                if 'signatories' in data:
                    document.signatories = data['signatories']
                    changes.append(f"Updated {len(data['signatories'])} signatories")
                
                # Update Dates
                for date_field in ['effective_date', 'expiration_date', 'execution_date']:
                    if date_field in data:
                        old_value = getattr(document, date_field)
                        new_value = data[date_field]
                        if old_value != new_value:
                            setattr(document, date_field, new_value)
                            changes.append(f"{date_field.replace('_', ' ').title()} updated to {new_value}")
                
                # Update Legal Information
                if 'governing_law' in data:
                    document.governing_law = data['governing_law']
                    changes.append(f"Governing law: {data['governing_law']}")
                
                if 'reference_number' in data:
                    document.reference_number = data['reference_number']
                
                if 'project_name' in data:
                    document.project_name = data['project_name']
                
                # Update Financial Terms
                if 'contract_value' in data:
                    old_value = document.contract_value
                    document.contract_value = data['contract_value']
                    if old_value != document.contract_value:
                        changes.append(f"Contract value: {document.contract_value} {document.currency}")
                
                if 'currency' in data:
                    document.currency = data['currency']
                
                if 'payment_terms' in data:
                    document.payment_terms = data['payment_terms']
                    changes.append("Payment terms updated")
                
                # Update Term and Renewal
                if 'term_length' in data:
                    document.term_length = data['term_length']
                
                if 'auto_renewal' in data:
                    document.auto_renewal = data['auto_renewal']
                
                if 'renewal_terms' in data:
                    document.renewal_terms = data['renewal_terms']
                
                if 'notice_period' in data:
                    document.notice_period = data['notice_period']
                
                # Update Legal Provisions
                if 'liability_cap' in data:
                    document.liability_cap = data['liability_cap']
                    changes.append(f"Liability cap: {data['liability_cap']}")
                
                if 'indemnification_clauses' in data:
                    document.indemnification_clauses = data['indemnification_clauses']
                
                if 'insurance_requirements' in data:
                    document.insurance_requirements = data['insurance_requirements']
                
                if 'termination_clauses' in data:
                    document.termination_clauses = data['termination_clauses']
                
                if 'termination_for_convenience' in data:
                    document.termination_for_convenience = data['termination_for_convenience']
                
                # Update Compliance
                if 'regulatory_requirements' in data:
                    document.regulatory_requirements = data['regulatory_requirements']
                
                if 'compliance_certifications' in data:
                    document.compliance_certifications = data['compliance_certifications']
                
                # Update Confidentiality
                if 'confidentiality_period' in data:
                    document.confidentiality_period = data['confidentiality_period']
                
                if 'nda_type' in data:
                    document.nda_type = data['nda_type']
                
                # Update Dispute Resolution
                if 'dispute_resolution_method' in data:
                    document.dispute_resolution_method = data['dispute_resolution_method']
                    changes.append(f"Dispute resolution: {data['dispute_resolution_method']}")
                
                if 'arbitration_location' in data:
                    document.arbitration_location = data['arbitration_location']
                
                # Update Classification
                if 'category' in data:
                    document.category = data['category']
                
                if 'jurisdiction' in data:
                    document.jurisdiction = data['jurisdiction']
                
                if 'status' in data:
                    old_status = document.status
                    document.status = data['status']
                    if old_status != document.status:
                        changes.append(f"Status changed from '{old_status}' to '{document.status}'")
                
                # Update File Information
                if 'source_file_name' in data:
                    document.source_file_name = data['source_file_name']
                
                if 'source_file_type' in data:
                    document.source_file_type = data['source_file_type']
                
                if 'source_file_size' in data:
                    document.source_file_size = data['source_file_size']
                
                if 'attachments' in data:
                    document.attachments = data['attachments']
                    changes.append(f"Attachments updated ({len(data['attachments'])} items)")
                
                # Update Scanned Document Info
                if 'is_scanned' in data:
                    document.is_scanned = data['is_scanned']
                
                if 'ocr_confidence' in data:
                    document.ocr_confidence = data['ocr_confidence']
                
                if 'page_count' in data:
                    document.page_count = data['page_count']
                
                # Update Document Images (ForeignKey references)
                if 'logo_image_id' in data:
                    if data['logo_image_id']:
                        try:
                            logo = DocumentImage.objects.get(id=data['logo_image_id'])
                            document.logo_image = logo
                            changes.append("Logo image updated")
                        except DocumentImage.DoesNotExist:
                            return Response(
                                {'error': f"Logo image with id {data['logo_image_id']} not found"},
                                status=status.HTTP_400_BAD_REQUEST
                            )
                    else:
                        document.logo_image = None
                        changes.append("Logo image removed")
                
                if 'watermark_image_id' in data:
                    if data['watermark_image_id']:
                        try:
                            watermark = DocumentImage.objects.get(id=data['watermark_image_id'])
                            document.watermark_image = watermark
                            changes.append("Watermark image updated")
                        except DocumentImage.DoesNotExist:
                            return Response(
                                {'error': f"Watermark image with id {data['watermark_image_id']} not found"},
                                status=status.HTTP_400_BAD_REQUEST
                            )
                    else:
                        document.watermark_image = None
                
                if 'background_image_id' in data:
                    if data['background_image_id']:
                        try:
                            bg = DocumentImage.objects.get(id=data['background_image_id'])
                            document.background_image = bg
                            changes.append("Background image updated")
                        except DocumentImage.DoesNotExist:
                            return Response(
                                {'error': f"Background image with id {data['background_image_id']} not found"},
                                status=status.HTTP_400_BAD_REQUEST
                            )
                    else:
                        document.background_image = None
                
                if 'header_icon_id' in data:
                    if data['header_icon_id']:
                        try:
                            header = DocumentImage.objects.get(id=data['header_icon_id'])
                            document.header_icon = header
                            changes.append("Header icon updated")
                        except DocumentImage.DoesNotExist:
                            return Response(
                                {'error': f"Header icon with id {data['header_icon_id']} not found"},
                                status=status.HTTP_400_BAD_REQUEST
                            )
                    else:
                        document.header_icon = None
                
                if 'footer_icon_id' in data:
                    if data['footer_icon_id']:
                        try:
                            footer = DocumentImage.objects.get(id=data['footer_icon_id'])
                            document.footer_icon = footer
                            changes.append("Footer icon updated")
                        except DocumentImage.DoesNotExist:
                            return Response(
                                {'error': f"Footer icon with id {data['footer_icon_id']} not found"},
                                status=status.HTTP_400_BAD_REQUEST
                            )
                    else:
                        document.footer_icon = None
                
                # Update Custom Metadata
                if 'custom_metadata' in data:
                    document.custom_metadata = data['custom_metadata']
                    changes.append("Custom metadata updated")

                update_pdf_images = any(
                    field in data for field in ('logo_image_id', 'watermark_image_id', 'background_image_id')
                )
                if update_pdf_images:
                    custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
                    processing_settings = custom_metadata.get('processing_settings')
                    if not isinstance(processing_settings, dict):
                        processing_settings = {}
                    processing_settings['pdf_images'] = {
                        'logo_image_id': str(document.logo_image_id) if document.logo_image_id else None,
                        'watermark_image_id': str(document.watermark_image_id) if document.watermark_image_id else None,
                        'background_image_id': str(document.background_image_id) if document.background_image_id else None,
                    }
                    custom_metadata['processing_settings'] = processing_settings
                    document.custom_metadata = custom_metadata
                
                # Update Related Documents
                if 'related_documents' in data:
                    document.related_documents = data['related_documents']
                
                # Update Auto-save
                if 'auto_save_enabled' in data:
                    document.auto_save_enabled = data['auto_save_enabled']
                
                # Update search metadata snapshot
                custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
                if hasattr(document, 'get_search_metadata'):
                    custom_metadata['search_metadata'] = document.get_search_metadata(include_custom_metadata=False)
                document.custom_metadata = custom_metadata

                # Update modified_by
                document.last_modified_by = request.user
                
                # Save document
                document.save()

                if update_pdf_images:
                    try:
                        organization = request.user.profile.organization
                        settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                            organization=organization
                        )
                        preferences = settings_obj.preferences if isinstance(settings_obj.preferences, dict) else {}
                        processing_defaults = preferences.get('processing_defaults')
                        if not isinstance(processing_defaults, dict):
                            processing_defaults = {}
                        processing_defaults['pdf_images'] = {
                            'logo_image_id': str(document.logo_image_id) if document.logo_image_id else None,
                            'watermark_image_id': str(document.watermark_image_id) if document.watermark_image_id else None,
                            'background_image_id': str(document.background_image_id) if document.background_image_id else None,
                        }
                        preferences['processing_defaults'] = processing_defaults
                        settings_obj.preferences = preferences
                        settings_obj.save(update_fields=['preferences', 'updated_at'])
                    except Exception:
                        pass
                
                # Create comprehensive changelog entry
                change_summary = data.get('change_summary', 'Document fully updated')
                if changes:
                    ChangeLog.objects.create(
                        document=document,
                        changed_by=request.user,
                        change_type='manual_edit',
                        description=f"{change_summary}. Changes: {'; '.join(changes[:10])}",  # Limit to first 10 changes
                        original_content=str(original_values) if original_values else None,
                        new_content=f"Updated {len(changes)} fields"
                    )
                
                # Return updated document
                document.refresh_from_db()
                serializer = DocumentSerializer(document)
                response = Response({
                    'message': 'Document fully updated successfully',
                    'changes_count': len(changes),
                    'changes': changes,
                    'document': serializer.data
                })
                response["ETag"] = self._get_document_etag(document)

                # Dispatch CLM workflow event
                if changes:
                    try:
                        from clm.event_system import handle_document_update
                        handle_document_update(
                            document_id=str(document.id),
                            change_summary={
                                'update_type': 'edit_full',
                                'changes_count': len(changes),
                                'changes': changes[:20],
                            },
                            user=request.user,
                        )
                    except Exception:
                        pass  # Non-critical

                return response
        
        except Exception as e:
            return Response(
                {'error': f"Failed to update document: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=True, methods=['post'], url_path='save-structure')
    def save_structure(self, request, pk=None):
        """
        REMOVED — This endpoint has been fully removed.
        
        All document editing now uses:
        - Direct REST endpoints for creates/deletes (sections, paragraphs, tables,
          image-components, file-components, latex-codes)
        - POST /partial-save/ for updates (via SaveCoordinator)
        """
        return Response(
            {
                'error': 'save-structure endpoint has been removed. '
                         'Use direct REST endpoints for creates/deletes '
                         'and POST /partial-save/ for updates.'
            },
            status=status.HTTP_410_GONE,
        )

    
    @action(detail=True, methods=['post'], url_path='edit-section')
    def edit_section(self, request, pk=None):
        """
        POST /api/documents/{id}/edit-section/
        Edit a specific section in the document.
        
        Request body:
        {
            "section_id": "section_uuid",
            "title": "New Section Title",
            "content": "New section content"
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        section_id = request.data.get('section_id')
        
        if not section_id:
            return Response(
                {'error': 'section_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            section = Section.objects.get(id=section_id, document=document)
            
            # Store old values for change tracking
            old_title = section.title
            # Section has content_text and edited_text, not content
            old_content = section.edited_text if section.has_edits else section.content_text
            
            # Update section
            if 'title' in request.data:
                section.title = request.data['title']
            if 'content' in request.data:
                # Set edited_text when user updates content
                section.edited_text = request.data['content']
                section.has_edits = True
            
            section.save()
            
            # Create changelog entry
            changes_made = []
            if 'title' in request.data and old_title != section.title:
                changes_made.append(f"Title changed from '{old_title}' to '{section.title}'")
            if 'content' in request.data:
                new_content = section.edited_text if section.has_edits else section.content_text
                if old_content != new_content:
                    changes_made.append("Content updated")
            
            if changes_made:
                new_content = section.edited_text if section.has_edits else section.content_text
                ChangeLog.objects.create(
                    document=document,
                    changed_by=request.user,
                    change_type='edit_section',
                    target_section=section,
                    description='; '.join(changes_made),
                    original_content=old_content or old_title or '',
                    new_content=new_content or section.title or ''
                )
            
            document.refresh_from_db()
            serializer = DocumentSerializer(document)
            return Response({
                'message': 'Section updated successfully',
                'document': serializer.data,
                'changes': changes_made
            })
        
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['post'], url_path='edit-paragraph')
    def edit_paragraph(self, request, pk=None):
        """
        POST /api/documents/{id}/edit-paragraph/
        Edit a specific paragraph in the document.
        
        Request body:
        {
            "paragraph_id": "paragraph_id",
            "content": "New paragraph content",
            "formatting": {"bold": true, "italic": false}
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        paragraph_id = request.data.get('paragraph_id')
        
        if not paragraph_id:
            return Response(
                {'error': 'paragraph_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            paragraph = Paragraph.objects.get(id=paragraph_id, section__document=document)
            
            # Store old content (use edited_text if exists, otherwise content_text)
            old_content = paragraph.edited_text if paragraph.has_edits else paragraph.content_text
            
            # Update paragraph
            if 'content' in request.data:
                paragraph.edited_text = request.data['content']
                paragraph.has_edits = True
            if 'topic' in request.data:
                paragraph.topic = request.data.get('topic') or ''
            
            paragraph.save()
            
            # Create changelog entry
            new_content = paragraph.edited_text if paragraph.has_edits else paragraph.content_text
            if old_content != new_content:
                ChangeLog.objects.create(
                    document=document,
                    changed_by=request.user,
                    change_type='edit_paragraph',
                    target_paragraph=paragraph,
                    description=f"Paragraph content updated",
                    original_content=old_content or '',
                    new_content=new_content or ''
                )
                ParagraphHistory.record(paragraph, 'edited', request.user, previous_content=old_content or '')
            
            document.refresh_from_db()
            serializer = DocumentSerializer(document)
            return Response({
                'message': 'Paragraph updated successfully',
                'document': serializer.data
            })
        
        except Paragraph.DoesNotExist:
            return Response(
                {'error': 'Paragraph not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['post'], url_path='add-section')
    def add_section(self, request, pk=None):
        """
        POST /api/documents/{id}/add-section/
        Add a new section to the document.
        
        Request body:
        {
            "title": "Section Title",
            "content": "Section content",
            "order": 1,
            "depth_level": 1,
            "parent_id": null
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        title = request.data.get('title', 'Untitled Section')
        content = request.data.get('content', '')
        order = request.data.get('order', 0)
        depth_level = request.data.get('depth_level', 1)
        parent_id = request.data.get('parent_id')
        
        # Generate section ID
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        section_id = f"{document.id}_s{timestamp}_{order}"
        
        # Create section
        # Note: Section model uses content_text, not content
        section = Section.objects.create(
            id=section_id,
            document=document,
            title=title,
            content_text=content,  # Store in content_text field
            order=order,
            depth_level=depth_level,
            parent_id=parent_id
        )
        
        # Log the addition
        ChangeLog.objects.create(
            document=document,
            changed_by=request.user,
            change_type='edit_section',
            target_section=section,
            description=f"Added new section: {title}",
            new_content=content
        )
        
        document.refresh_from_db()
        serializer = DocumentSerializer(document)
        return Response({
            'message': 'Section added successfully',
            'section_id': section_id,
            'document': serializer.data
        }, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['delete'], url_path='delete-section/(?P<section_id>[^/.]+)')
    def delete_section(self, request, pk=None, section_id=None):
        """
        DELETE /api/documents/{id}/delete-section/{section_id}/
        Delete a section from the document.
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        try:
            section = Section.objects.get(id=section_id, document=document)
            section_title = section.title or 'Untitled'
            # Section has content_text and edited_text, not content
            section_content = section.edited_text if section.has_edits else section.content_text
            
            # Log the deletion
            ChangeLog.objects.create(
                document=document,
                changed_by=request.user,
                change_type='edit_section',
                target_section=section,
                description=f"Deleted section: {section_title}",
                original_content=section_content or ''
            )
            
            section.delete()
            
            document.refresh_from_db()
            serializer = DocumentSerializer(document)
            return Response({
                'message': 'Section deleted successfully',
                'document': serializer.data
            })
        
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['get'], url_path='changelog')
    def changelog(self, request, pk=None):
        """
        GET /api/documents/{id}/changelog/
        Get the change history for this document.
        """
        document = self.get_object()
        changes = ChangeLog.objects.filter(document=document).order_by('-changed_at')
        
        change_list = [{
            'id': change.id,
            'changed_by': change.changed_by.username if change.changed_by else 'System',
            'changed_at': change.changed_at.isoformat(),
            'change_type': change.change_type,
            'description': change.description,
            'section_id': str(change.target_section_id) if change.target_section_id else None,
            'paragraph_id': str(change.target_paragraph_id) if change.target_paragraph_id else None,
            'old_value': change.original_content,
            'new_value': change.new_content,
            'fields_changed': change.fields_changed,
            'changes_summary': change.changes_summary,
            'version_at_change': change.version_at_change,
        } for change in changes]
        
        return Response({
            'count': len(change_list),
            'changes': change_list
        })

    def _serialize_version(self, version, include_content: bool):
        payload = {
            'id': str(version.id),
            'version_number': version.version_number,
            'version_name': version.version_name,
            'created_at': version.created_at.isoformat(),
            'created_by': version.created_by.username if version.created_by else 'System',
            'is_major_version': version.is_major_version,
            'change_summary': version.change_summary,
        }
        if include_content:
            payload['content_snapshot'] = version.content_snapshot
            payload['metadata_snapshot'] = json.loads(
                json.dumps(version.metadata_snapshot, cls=DjangoJSONEncoder)
            )
            payload['diff_from_previous'] = version.diff_from_previous
        return payload

    def _compute_version_diff(self, previous_version, new_snapshot, new_text, new_version_number):
        if not previous_version:
            return None, {}, []

        previous_text = previous_version.content_snapshot or ''
        next_text = new_text or ''
        diff_lines = list(difflib.unified_diff(
            previous_text.splitlines(),
            next_text.splitlines(),
            fromfile=f"v{previous_version.version_number}",
            tofile=f"v{new_version_number}",
            lineterm=''
        ))
        diff_text = "\n".join(diff_lines)

        lines_added = 0
        lines_removed = 0
        for line in diff_lines:
            if line.startswith('+++') or line.startswith('---') or line.startswith('@@'):
                continue
            if line.startswith('+'):
                lines_added += 1
            elif line.startswith('-'):
                lines_removed += 1

        diff_stats = {
            'lines_added': lines_added,
            'lines_removed': lines_removed,
            'lines_changed': lines_added + lines_removed,
        }

        previous_meta = previous_version.metadata_snapshot or {}
        new_meta = new_snapshot or {}
        metadata_fields = [
            'title',
            'author',
            'document_type',
            'status',
            'document_metadata',
            'parties',
            'signatories',
            'custom_metadata',
            'effective_date',
            'expiration_date',
            'execution_date',
        ]
        metadata_changes = {}
        fields_changed = set()
        for field in metadata_fields:
            previous_value = previous_meta.get(field)
            new_value = new_meta.get(field)
            if previous_value != new_value:
                metadata_changes[field] = {
                    'old': previous_value,
                    'new': new_value,
                }
                fields_changed.add(field)

        def _section_key(section, index):
            return str(section.get('id') or section.get('section_id') or f"{section.get('title', '')}-{section.get('order', index)}")

        def _build_section_map(section_list):
            section_map = {}
            for idx, section in enumerate(section_list or []):
                section_map[_section_key(section, idx)] = section
            return section_map

        previous_sections = _build_section_map(previous_meta.get('sections', []))
        new_sections = _build_section_map(new_meta.get('sections', []))

        added_sections = [
            new_sections[key].get('title') or key
            for key in new_sections.keys() - previous_sections.keys()
        ]
        removed_sections = [
            previous_sections[key].get('title') or key
            for key in previous_sections.keys() - new_sections.keys()
        ]

        modified_sections = []
        common_keys = previous_sections.keys() & new_sections.keys()
        for key in common_keys:
            previous_section = previous_sections[key]
            new_section = new_sections[key]
            compare_fields = ['title', 'content_text', 'edited_text', 'section_type', 'order', 'depth_level']
            if any(previous_section.get(field) != new_section.get(field) for field in compare_fields):
                modified_sections.append(new_section.get('title') or key)

        section_summary = {
            'added': len(added_sections),
            'removed': len(removed_sections),
            'modified': len(modified_sections),
            'added_samples': added_sections[:10],
            'removed_samples': removed_sections[:10],
            'modified_samples': modified_sections[:10],
        }

        if section_summary['added'] or section_summary['removed'] or section_summary['modified']:
            fields_changed.add('sections')

        if diff_stats['lines_changed']:
            fields_changed.add('content_snapshot')

        changes_summary = {
            'diff_stats': diff_stats,
            'metadata_changes': metadata_changes,
            'sections': section_summary,
        }
        return diff_text, changes_summary, sorted(fields_changed)

    def _build_version_change_summary(self, diff_stats, section_summary):
        if not diff_stats and not section_summary:
            return 'No differences detected from previous version'
        if diff_stats and section_summary:
            if diff_stats.get('lines_changed', 0) == 0:
                if (section_summary.get('added', 0) == 0
                        and section_summary.get('removed', 0) == 0
                        and section_summary.get('modified', 0) == 0):
                    return 'No differences detected from previous version'
        sections_clause = ''
        if section_summary:
            sections_clause = (
                f"; sections +{section_summary.get('added', 0)}"
                f" -{section_summary.get('removed', 0)}"
                f" ~{section_summary.get('modified', 0)}"
            )
        return (
            f"{diff_stats.get('lines_added', 0)} lines added, "
            f"{diff_stats.get('lines_removed', 0)} lines removed"
            f"{sections_clause}"
        )

    def _log_document_save(self, document, user, description: str, change_summary: str | None = None):
        ChangeLog.log_change(
            document=document,
            change_type='manual_edit',
            user=user,
            description=description,
            change_summary=change_summary,
        )
    
    @action(detail=True, methods=['post'], url_path='create-version')
    def create_version(self, request, pk=None):
        """
        POST /api/documents/{id}/create-version/
        Create a version snapshot of the document.
        
        Request body:
        {
            "version_number": "1.0",
            "version_name": "Draft 1",
            "change_summary": "Initial version",
            "is_major_version": false
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to create versions'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        version_number = request.data.get('version_number') or document.version
        version_name = request.data.get('version_name')
        change_summary = request.data.get('change_summary')
        is_major_version = bool(request.data.get('is_major_version', False))

        if not version_number:
            return Response(
                {'error': 'version_number is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Check if version already exists
        if DocumentVersion.objects.filter(document=document, version_number=version_number).exists():
            return Response(
                {'error': f"Version '{version_number}' already exists"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create version snapshot (include full structure)
        snapshot_data = CompleteDocumentSerializer(document, context={'request': request}).data
        snapshot_data = json.loads(json.dumps(snapshot_data, cls=DjangoJSONEncoder))
        previous_version = DocumentVersion.objects.filter(document=document).order_by('-created_at').first()
        diff_text = None
        changes_summary = {}
        fields_changed = []
        if previous_version:
            diff_text, changes_summary, fields_changed = self._compute_version_diff(
                previous_version,
                snapshot_data,
                document.current_text or document.raw_text or '',
                version_number,
            )

        if not change_summary:
            if previous_version:
                change_summary = self._build_version_change_summary(
                    changes_summary.get('diff_stats', {}),
                    changes_summary.get('sections', {})
                )
            else:
                change_summary = 'Initial version snapshot'
                changes_summary = {
                    'initial_snapshot': True,
                    'diff_stats': {'lines_added': 0, 'lines_removed': 0, 'lines_changed': 0},
                    'sections': {'added': 0, 'removed': 0, 'modified': 0},
                    'metadata_changes': {},
                }
        version = DocumentVersion.objects.create(
            document=document,
            version_number=version_number,
            version_name=version_name,
            content_snapshot=document.current_text or document.raw_text or '',
            metadata_snapshot=snapshot_data,
            is_major_version=is_major_version,
            change_summary=change_summary or '',
            diff_from_previous=diff_text,
            created_by=request.user,
        )

        ChangeLog.log_change(
            document=document,
            change_type='version_created',
            user=request.user,
            description=f"Created version {version_number}",
            change_summary=change_summary,
            fields_changed=fields_changed,
            changes_summary=changes_summary,
            impact='minor',
            related_version=version,
        )
        
        return Response({
            'message': 'Version created successfully',
            'version': {
                'id': version.id,
                'version_number': version.version_number,
                'version_name': version.version_name,
                'created_at': version.created_at.isoformat(),
                'created_by': request.user.username,
                'change_summary': version.change_summary,
                'is_major_version': version.is_major_version,
            }
        }, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['get'], url_path='versions')
    def versions(self, request, pk=None):
        """
        GET /api/documents/{id}/versions/
        Get all versions of this document.

        Query params:
        - include_content=true|false (default false)
        - at=<ISO8601 timestamp> (optional) -> returns the latest version at/before time
        """
        document = self.get_object()
        include_content = request.query_params.get('include_content', 'false').lower() == 'true'
        at_param = request.query_params.get('at')

        if at_param:
            at_dt = parse_datetime(at_param)
            if not at_dt:
                return Response({'error': 'Invalid at timestamp'}, status=status.HTTP_400_BAD_REQUEST)
            version = DocumentVersion.objects.filter(
                document=document,
                created_at__lte=at_dt
            ).order_by('-created_at').first()
            if not version:
                return Response({'error': 'No version found at given time'}, status=status.HTTP_404_NOT_FOUND)
            return Response({'version': self._serialize_version(version, include_content)})

        versions = DocumentVersion.objects.filter(document=document).order_by('-created_at')
        version_list = [self._serialize_version(version, include_content) for version in versions]

        return Response({'count': len(version_list), 'versions': version_list})

    @action(detail=False, methods=['get'], url_path='versions')
    def versions_global(self, request):
        """
        GET /api/documents/versions/?document_id=<uuid>
        Global access to versions list by document id.
        Supports include_content and at parameters.
        """
        document_id = request.query_params.get('document_id')
        if not document_id:
            return Response({'error': 'document_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        document = get_object_or_404(Document, id=document_id)
        if not self._check_editor_access(request, document) and not document in self.get_queryset():
            return Response({'error': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        include_content = request.query_params.get('include_content', 'false').lower() == 'true'
        at_param = request.query_params.get('at')
        if at_param:
            at_dt = parse_datetime(at_param)
            if not at_dt:
                return Response({'error': 'Invalid at timestamp'}, status=status.HTTP_400_BAD_REQUEST)
            version = DocumentVersion.objects.filter(
                document=document,
                created_at__lte=at_dt
            ).order_by('-created_at').first()
            if not version:
                return Response({'error': 'No version found at given time'}, status=status.HTTP_404_NOT_FOUND)
            return Response({'version': self._serialize_version(version, include_content)})

        versions = DocumentVersion.objects.filter(document=document).order_by('-created_at')
        version_list = [self._serialize_version(version, include_content) for version in versions]
        return Response({'count': len(version_list), 'versions': version_list})

    @action(detail=True, methods=['get'], url_path='versions/(?P<version_id>[^/.]+)')
    def version_detail(self, request, pk=None, version_id=None):
        """
        GET /api/documents/{id}/versions/{version_id}/
        Retrieve a specific version snapshot, including content and metadata.
        """
        document = self.get_object()
        version = get_object_or_404(DocumentVersion, id=version_id, document=document)
        return Response({'version': self._serialize_version(version, include_content=True)})
    
    @action(detail=True, methods=['post'], url_path='restore-version')
    def restore_version(self, request, pk=None):
        """
        POST /api/documents/{id}/restore-version/
        Restore the document to a previous version.
        
        Request body:
        {
            "version_id": "version_uuid"
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to restore versions'},
                status=status.HTTP_403_FORBIDDEN
            )

        version_id = request.data.get('version_id')
        
        if not version_id:
            return Response(
                {'error': 'version_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            version = DocumentVersion.objects.get(id=version_id, document=document)
            
            # Create a backup of current state before restoring
            backup_suffix = uuid.uuid4().hex[:8]
            DocumentVersion.objects.create(
                document=document,
                version_number=f"backup-{document.version}-{backup_suffix}",
                version_name=f"Backup before restore to {version.version_name or version.version_number}",
                content_snapshot=document.current_text or document.raw_text or '',
                metadata_snapshot=json.loads(
                    json.dumps(
                        CompleteDocumentSerializer(document, context={'request': request}).data,
                        cls=DjangoJSONEncoder,
                    )
                ),
                created_by=request.user,
                change_summary="Auto-created backup before version restore",
            )

            # Restore core document fields from snapshot
            metadata = version.metadata_snapshot or {}
            document.title = metadata.get('title', document.title)
            document.author = metadata.get('author', document.author)
            document.document_type = metadata.get('document_type', document.document_type)
            document.status = metadata.get('status', document.status)
            document.document_metadata = metadata.get('document_metadata', document.document_metadata)
            document.parties = metadata.get('parties', document.parties)
            document.signatories = metadata.get('signatories', document.signatories)
            document.custom_metadata = metadata.get('custom_metadata', document.custom_metadata)

            if metadata.get('effective_date'):
                document.effective_date = metadata.get('effective_date')
            if metadata.get('expiration_date'):
                document.expiration_date = metadata.get('expiration_date')
            if metadata.get('execution_date'):
                document.execution_date = metadata.get('execution_date')

            document.current_text = version.content_snapshot or document.current_text
            if not document.raw_text:
                document.raw_text = document.current_text
            document.last_modified_by = request.user

            def _restore_sections(section_list, parent=None):
                restored_ids = []
                for section_data in section_list or []:
                    # Note: Section model does not have a `created_by` field. Use `modified_by`
                    # and cache the username instead. Avoid passing unsupported kwargs.
                    section = Section.objects.create(
                        document=document,
                        parent=parent,
                        title=section_data.get('title') or 'Untitled Section',
                        content_text=section_data.get('content_text') or '',
                        edited_text=section_data.get('edited_text'),
                        has_edits=bool(section_data.get('edited_text')),
                        section_type=section_data.get('section_type') or 'clause',
                        order=section_data.get('order') or 0,
                        depth_level=section_data.get('depth_level') or 1,
                        custom_metadata=section_data.get('metadata') or section_data.get('custom_metadata') or {},
                        modified_by=request.user,
                        last_modified_by_username=request.user.username if request.user else None,
                    )
                    restored_ids.append(section.id)

                    for para_data in section_data.get('paragraphs', []) or []:
                        Paragraph.objects.create(
                            section=section,
                            content_text=para_data.get('content_text') or '',
                            edited_text=para_data.get('edited_text') or para_data.get('content'),
                            has_edits=bool(para_data.get('edited_text') or para_data.get('content')),
                            order=para_data.get('order') or 0,
                            paragraph_type=para_data.get('paragraph_type') or 'standard',
                            topic=para_data.get('topic') or '',
                            modified_by=request.user,
                        )

                    for table_data in section_data.get('tables', []) or []:
                        Table.objects.create(
                            section=section,
                            title=table_data.get('title'),
                            description=table_data.get('description'),
                            num_columns=table_data.get('num_columns') or 2,
                            num_rows=table_data.get('num_rows') or 1,
                            column_headers=table_data.get('column_headers') or [],
                            table_data=table_data.get('table_data') or [],
                            table_config=table_data.get('table_config') or {},
                            table_type=table_data.get('table_type') or 'data',
                            order=table_data.get('order') or 0,
                            custom_metadata=table_data.get('metadata') or table_data.get('custom_metadata') or {},
                            modified_by=request.user,
                        )

                    for image_data in section_data.get('image_components', []) or []:
                        image_ref_id = image_data.get('image_reference') or image_data.get('image_reference_id')
                        image_reference = None
                        if image_ref_id:
                            try:
                                image_reference = DocumentImage.objects.get(id=image_ref_id)
                            except DocumentImage.DoesNotExist:
                                image_reference = None
                        ImageComponent.objects.create(
                            section=section,
                            image_reference=image_reference,
                            caption=image_data.get('caption'),
                            alt_text=image_data.get('alt_text'),
                            title=image_data.get('title'),
                            figure_number=image_data.get('figure_number'),
                            alignment=image_data.get('alignment') or 'center',
                            size_mode=image_data.get('size_mode') or 'medium',
                            custom_width_percent=image_data.get('custom_width_percent'),
                            custom_width_pixels=image_data.get('custom_width_pixels'),
                            custom_height_pixels=image_data.get('custom_height_pixels'),
                            maintain_aspect_ratio=image_data.get('maintain_aspect_ratio', True),
                            component_type=image_data.get('component_type') or 'figure',
                            order=image_data.get('order') or 0,
                            show_border=image_data.get('show_border', False),
                            link_url=image_data.get('link_url'),
                            custom_metadata=image_data.get('custom_metadata') or image_data.get('metadata') or {},
                            created_by=request.user,
                            modified_by=request.user,
                            edit_count=1,
                        )

                    for file_data in section_data.get('file_components', []) or []:
                        file_ref_id = file_data.get('file_reference') or file_data.get('file_reference_id')
                        if not file_ref_id:
                            continue
                        try:
                            file_reference = DocumentFile.objects.get(id=file_ref_id)
                        except DocumentFile.DoesNotExist:
                            continue
                        DocumentFileComponent.objects.create(
                            section=section,
                            file_reference=file_reference,
                            label=file_data.get('label') or file_data.get('caption'),
                            description=file_data.get('description'),
                            reference_number=file_data.get('reference_number'),
                            display_mode=file_data.get('display_mode') or 'embed',
                            alignment=file_data.get('alignment') or 'left',
                            width_percent=file_data.get('width_percent'),
                            height_pixels=file_data.get('height_pixels'),
                            margin_top=file_data.get('margin_top', 20),
                            margin_bottom=file_data.get('margin_bottom', 20),
                            show_preview=file_data.get('show_preview', True),
                            show_download_button=file_data.get('show_download_button', True),
                            show_filename=file_data.get('show_filename', True),
                            show_file_size=file_data.get('show_file_size', True),
                            show_file_type=file_data.get('show_file_type', True),
                            is_visible=file_data.get('is_visible', True),
                            custom_metadata=file_data.get('custom_metadata') or file_data.get('metadata') or {},
                            order=file_data.get('order') or 0,
                            created_by=request.user,
                            modified_by=request.user,
                            edit_count=1,
                        )

                    children_data = section_data.get('children', []) or []
                    if children_data:
                        _restore_sections(children_data, parent=section)
                return restored_ids

            with transaction.atomic():
                sections_snapshot = metadata.get('sections')
                if sections_snapshot is not None:
                    document.sections.all().delete()
                    _restore_sections(sections_snapshot, parent=None)
                document.save()
            
            # Log the restore action
            ChangeLog.objects.create(
                document=document,
                changed_by=request.user,
                change_type='version_restored',
                related_version=version,
                description=f"Restored to version: {version.version_name or version.version_number}",
                new_content=version.version_name or version.version_number
            )
            
            # Structural content is restored; references may require additional reconciliation
            return Response({
                'message': f"Version {version.version_name or version.version_number} restored successfully",
                'version_snapshot': version.content_snapshot,
                'document': {
                    'id': str(document.id),
                    'title': document.title,
                    'version': document.version,
                },
                'note': 'Section references and external links may require revalidation'
            })
        
        except DocumentVersion.DoesNotExist:
            return Response(
                {'error': 'Version not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    # ==== DOCUMENT HIERARCHY & RELATIONSHIP ENDPOINTS ====
    
    @action(detail=True, methods=['post'], url_path='set-parent')
    def set_parent(self, request, pk=None):
        """
        POST /api/documents/{id}/set-parent/
        Set parent document for hierarchy.
        
        Request body:
        {
            "parent_id": "parent_document_uuid",
            "relationship_type": "amendment"  // optional: amendment, addendum, revision
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document relationships'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        parent_id = request.data.get('parent_id')
        relationship_type = request.data.get('relationship_type', 'amendment')
        
        if not parent_id:
            return Response(
                {'error': 'parent_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            parent_doc = Document.objects.get(id=parent_id)
            
            # Prevent circular references
            if parent_doc.id == document.id:
                return Response(
                    {'error': 'Document cannot be its own parent'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check if parent would create a cycle
            ancestors = document.get_ancestors()
            if parent_doc in ancestors:
                return Response(
                    {'error': 'This would create a circular reference'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            document.set_parent(parent_doc, relationship_type)
            
            # Log the change
            ChangeLog.log_change(
                document=document,
                change_type='metadata_update',
                user=request.user,
                description=f"Set parent document to: {parent_doc.title}",
                change_summary=f"Parent: {parent_doc.title}",
                impact='minor'
            )
            
            return Response({
                'message': 'Parent document set successfully',
                'parent': {
                    'id': str(parent_doc.id),
                    'title': parent_doc.title,
                    'relationship_type': relationship_type
                }
            })
        
        except Document.DoesNotExist:
            return Response(
                {'error': 'Parent document not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['post'], url_path='add-related')
    def add_related(self, request, pk=None):
        """
        POST /api/documents/{id}/add-related/
        Add a related document reference.
        
        Request body:
        {
            "related_id": "document_uuid",
            "relationship_type": "related",  // related, supersedes, reference, etc.
            "bidirectional": true  // create reverse link
        }
        """
        document = self.get_object()
        
        # Check if user has editor access
        if not self._check_editor_access(request, document):
            return Response(
                {'error': 'Editor access required to modify document relationships'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        related_id = request.data.get('related_id')
        relationship_type = request.data.get('relationship_type', 'related')
        bidirectional = request.data.get('bidirectional', True)
        
        if not related_id:
            return Response(
                {'error': 'related_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            related_doc = Document.objects.get(id=related_id)
            
            if related_doc.id == document.id:
                return Response(
                    {'error': 'Document cannot be related to itself'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            document.add_related_document(related_doc, relationship_type, bidirectional)
            
            return Response({
                'message': 'Related document added successfully',
                'related': {
                    'id': str(related_doc.id),
                    'title': related_doc.title,
                    'relationship_type': relationship_type,
                    'bidirectional': bidirectional
                }
            })
        
        except Document.DoesNotExist:
            return Response(
                {'error': 'Related document not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['delete'], url_path='remove-related/(?P<related_id>[^/.]+)')
    def remove_related(self, request, pk=None, related_id=None):
        """
        DELETE /api/documents/{id}/remove-related/{related_id}/
        Remove a related document reference.
        """
        document = self.get_object()
        
        if document.remove_related_document(related_id):
            return Response({
                'message': 'Related document removed successfully'
            })
        else:
            return Response(
                {'error': 'Related document not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['get'], url_path='hierarchy')
    def hierarchy(self, request, pk=None):
        """
        GET /api/documents/{id}/hierarchy/
        Get complete document hierarchy tree.
        
        Query params:
        - max_depth: Maximum depth to traverse (default: 5)
        """
        document = self.get_object()
        max_depth = int(request.query_params.get('max_depth', 5))
        
        tree = document.get_hierarchy_tree(max_depth=max_depth)
        
        return Response({
            'hierarchy': tree
        })
    
    @action(detail=True, methods=['get'], url_path='lineage')
    def lineage(self, request, pk=None):
        """
        GET /api/documents/{id}/lineage/
        Get complete document lineage (ancestors + current + descendants).
        """
        document = self.get_object()
        lineage = document.get_document_lineage()
        
        return Response(lineage)
    
    @action(detail=True, methods=['get'], url_path='children')
    def children(self, request, pk=None):
        """
        GET /api/documents/{id}/children/
        Get all child documents.
        """
        document = self.get_object()
        children = document.get_children()
        
        children_list = [{
            'id': str(child.id),
            'title': child.title,
            'version': child.version,
            'status': child.status,
            'document_type': child.document_type,
            'created_at': child.created_at.isoformat() if child.created_at else None,
            'created_by': child.created_by.username if child.created_by else None
        } for child in children]
        
        return Response({
            'count': len(children_list),
            'children': children_list
        })
    
    @action(detail=True, methods=['get'], url_path='ancestors')
    def ancestors(self, request, pk=None):
        """
        GET /api/documents/{id}/ancestors/
        Get all ancestor documents (parent chain).
        """
        document = self.get_object()
        ancestors = document.get_ancestors()
        
        ancestors_list = [{
            'id': str(anc.id),
            'title': anc.title,
            'version': anc.version,
            'status': anc.status,
            'created_at': anc.created_at.isoformat() if anc.created_at else None
        } for anc in ancestors]
        
        return Response({
            'count': len(ancestors_list),
            'ancestors': ancestors_list,
            'root': {
                'id': str(document.get_root_document().id),
                'title': document.get_root_document().title
            }
        })
    
    @action(detail=True, methods=['get'], url_path='related')
    def related(self, request, pk=None):
        """
        GET /api/documents/{id}/related/
        Get all related documents.
        
        Query params:
        - type: Filter by relationship type
        """
        document = self.get_object()
        relationship_type = request.query_params.get('type', None)
        
        related_docs = document.get_all_related(relationship_type)
        
        related_list = [{
            'id': str(doc.id),
            'title': doc.title,
            'version': doc.version,
            'status': doc.status,
            'document_type': doc.document_type,
            'relationship': next(
                (r.get('relationship') for r in document.related_documents 
                 if r.get('id') == str(doc.id)), 
                'unknown'
            )
        } for doc in related_docs]
        
        return Response({
            'count': len(related_list),
            'related': related_list
        })
    
    @action(detail=False, methods=['get'], url_path='roots')
    def roots(self, request):
        """
        GET /api/documents/roots/
        Get all root documents (documents with no parent).
        """
        roots = Document.get_root_documents()
        
        # Filter by user if requested
        if request.query_params.get('my_only', 'false').lower() == 'true':
            roots = roots.filter(created_by=request.user)
        
        roots_list = [{
            'id': str(doc.id),
            'title': doc.title,
            'version': doc.version,
            'status': doc.status,
            'document_type': doc.document_type,
            'created_at': doc.created_at.isoformat() if doc.created_at else None,
            'children_count': doc.get_children().count()
        } for doc in roots]
        
        return Response({
            'count': len(roots_list),
            'roots': roots_list
        })
    
    @action(detail=True, methods=['get'], url_path='preview')
    def preview(self, request, pk=None):
        """
        GET /api/documents/{id}/preview/
        
        Returns a fully formatted HTML preview of the document with all sections,
        paragraphs, tables, and images styled for viewing.
        
        This is useful for:
        - Viewing the document as it would appear when rendered
        - Checking if all changes are reflected
        - Sharing a read-only view
        - Printing/exporting
        """
        from django.http import HttpResponse
        
        # self.get_object() will automatically check permissions via permission_classes
        # If user doesn't have access, DRF will raise PermissionDenied
        document = self.get_object()
        
        # Get all sections with related data
        sections = document.sections.filter(parent=None).prefetch_related(
            'paragraphs',
            'tables',
            'image_components',
            'image_components__image_reference',
            'children'
        ).order_by('order')
        
        # Build sections data
        def build_section_data(section, depth=0):
            # Combine all components
            components = []
            
            # Add paragraphs
            for para in section.paragraphs.order_by('order'):
                components.append({
                    'type': 'paragraph',
                    'order': para.order,
                    'content': para.get_effective_content()
                })
            
            # Add tables
            for table in section.tables.order_by('order'):
                headers = table.column_headers or []
                
                # Normalize headers - handle both dict and string formats
                normalized_headers = []
                for h in headers:
                    if isinstance(h, dict):
                        normalized_headers.append(h)
                    elif isinstance(h, str):
                        # Convert string to dict format
                        normalized_headers.append({
                            'id': f'col{len(normalized_headers)}',
                            'label': h,
                            'width': 'auto',
                            'align': 'left',
                            'type': 'text'
                        })
                    else:
                        # Skip invalid entries
                        continue
                
                # If no headers were provided, auto-generate from first row
                if not normalized_headers and table.table_data:
                    first_row = table.table_data[0] if table.table_data else None
                    if isinstance(first_row, dict) and 'cells' in first_row:
                        cells = first_row['cells']
                        if isinstance(cells, dict):
                            # Generate headers from cell keys, but filter out 'row_id'
                            for col_id in cells.keys():
                                if col_id != 'row_id':  # Skip row_id
                                    normalized_headers.append({
                                        'id': col_id,
                                        'label': col_id.replace('_', ' ').title(),
                                        'width': 'auto',
                                        'align': 'left',
                                        'type': 'text'
                                    })
                
                rows = []
                for row_data in table.table_data:
                    if isinstance(row_data, dict) and 'cells' in row_data:
                        # Extract cell values in the correct column order
                        row_cells = row_data['cells']
                        if isinstance(row_cells, dict):
                            # Cells is a dictionary mapping column IDs to values
                            # Extract values in header order, skip row_id
                            cells = []
                            for h in normalized_headers:
                                col_id = h.get('id', '')
                                # Get value from cells dict, default to empty string
                                cell_value = row_cells.get(col_id, '')
                                cells.append(str(cell_value) if cell_value is not None else '')
                        elif isinstance(row_cells, list):
                            # Cells is already a list
                            cells = [str(c) if c is not None else '' for c in row_cells]
                        else:
                            # Unexpected format - create empty cells
                            cells = [''] * len(normalized_headers)
                    else:
                        # Fallback for malformed data - create empty cells
                        cells = [''] * len(normalized_headers)
                    
                    # Only add row if we have cells
                    if cells:
                        rows.append({'cells': cells})
                
                components.append({
                    'type': 'table',
                    'order': table.order,
                    'data': {
                        'title': table.title,
                        'headers': normalized_headers,
                        'rows': rows
                    }
                })
            
            # Add image components
            for img_comp in section.image_components.order_by('order'):
                components.append({
                    'type': 'image',
                    'order': img_comp.order,
                    'data': {
                        'image_url': request.build_absolute_uri(img_comp.image_reference.image.url) if img_comp.image_reference and img_comp.image_reference.image else '',
                        'alt_text': img_comp.alt_text or img_comp.caption or '',
                        'caption': img_comp.caption,
                        'figure_number': img_comp.figure_number,
                        'alignment': img_comp.alignment,
                        'width': img_comp.get_effective_width(),
                        'show_caption': img_comp.show_caption,
                        'show_figure_number': img_comp.show_figure_number,
                        'link_url': img_comp.link_url
                    }
                })
            
            # Sort by order
            components.sort(key=lambda x: x['order'])
            
            return {
                'section': section,
                'components': components,
                'depth': depth,
                'children': [build_section_data(child, depth + 1) for child in section.children.order_by('order')]
            }
        
        sections_data = [build_section_data(s) for s in sections]
        
        # Generate HTML
        html = self._generate_preview_html(document, sections_data, request)
        
        return HttpResponse(html)
    
    def _generate_preview_html(self, document, sections_data, request):
        """Generate the full HTML for document preview."""
        html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{document.title}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }}
        
        .document-container {{
            max-width: 900px;
            margin: 0 auto;
            background: white;
            padding: 60px 80px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 8px;
        }}
        
        .document-header {{
            border-bottom: 3px solid #2563eb;
            padding-bottom: 30px;
            margin-bottom: 40px;
        }}
        
        .document-title {{
            font-size: 2.5em;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 10px;
        }}
        
        .document-meta {{
            color: #666;
            font-size: 0.95em;
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }}
        
        .section {{
            margin-bottom: 40px;
        }}
        
        .section-title {{
            font-size: 1.8em;
            font-weight: 600;
            color: #2563eb;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e5e7eb;
        }}
        
        .subsection {{
            margin-left: 30px;
            margin-top: 30px;
        }}
        
        .subsection .section-title {{
            font-size: 1.4em;
            color: #4f46e5;
        }}
        
        .paragraph {{
            margin-bottom: 20px;
            text-align: justify;
            font-size: 1.05em;
            line-height: 1.8;
        }}
        
        .table-container {{
            margin: 30px 0;
            overflow-x: auto;
        }}
        
        .table-title {{
            font-weight: 600;
            font-size: 1.1em;
            margin-bottom: 10px;
            color: #374151;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
            background: white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        
        thead {{
            background: #f3f4f6;
        }}
        
        th {{
            padding: 12px 15px;
            text-align: left;
            font-weight: 600;
            color: #374151;
            border-bottom: 2px solid #e5e7eb;
        }}
        
        td {{
            padding: 12px 15px;
            border-bottom: 1px solid #e5e7eb;
        }}
        
        tbody tr:hover {{
            background: #f9fafb;
        }}
        
        .image-component {{
            margin: 30px 0;
            page-break-inside: avoid;
        }}
        
        .image-component.align-left {{
            text-align: left;
        }}
        
        .image-component.align-center {{
            text-align: center;
        }}
        
        .image-component.align-right {{
            text-align: right;
        }}
        
        .image-component img {{
            max-width: 100%;
            height: auto;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        
        .image-caption {{
            margin-top: 10px;
            font-size: 0.9em;
            color: #666;
            font-style: italic;
        }}
        
        .figure-number {{
            font-weight: 600;
            color: #2563eb;
        }}
        
        .empty-section {{
            color: #9ca3af;
            font-style: italic;
            padding: 20px;
            background: #f9fafb;
            border-radius: 4px;
            text-align: center;
        }}
        
        @media print {{
            body {{
                background: white;
                padding: 0;
            }}
            
            .document-container {{
                max-width: none;
                box-shadow: none;
                padding: 0;
            }}
            
            .section {{
                page-break-inside: avoid;
            }}
        }}
        
        @media (max-width: 768px) {{
            .document-container {{
                padding: 30px 20px;
            }}
            
            .document-title {{
                font-size: 2em;
            }}
            
            .section-title {{
                font-size: 1.5em;
            }}
        }}
    </style>
</head>
<body>
    <div class="document-container">
        <div class="document-header">
            <h1 class="document-title">{document.title}</h1>
            <div class="document-meta">'''
        
        if document.author:
            html += f'<span><strong>Author:</strong> {document.author}</span>'
        if document.document_type:
            html += f'<span><strong>Type:</strong> {document.document_type}</span>'
        if document.version:
            html += f'<span><strong>Version:</strong> {document.version}</span>'
        if document.status:
            html += f'<span><strong>Status:</strong> {document.status}</span>'
        
        html += '''
            </div>
        </div>
        
        <div class="document-content">'''
        
        if sections_data:
            for section_data in sections_data:
                html += self._render_section(section_data, request)
        else:
            html += '''
            <div class="empty-section">
                <p>This document is empty. No sections have been added yet.</p>
            </div>'''
        
        html += '''
        </div>
    </div>
</body>
</html>'''
        
        return html
    
    def _render_section(self, section_data, request, depth=0):
        """Helper to render a section recursively."""
        section = section_data['section']
        components = section_data['components']
        
        html = f'<div class="section {"subsection" if depth > 0 else ""}" style="margin-left: {depth * 30}px;">\n'
        
        if section.title:
            html += f'    <h2 class="section-title">{section.title}</h2>\n'
        
        if section.content_text:
            html += f'    <div class="paragraph">{section.content_text}</div>\n'
        
        # Render components
        for comp in components:
            if comp['type'] == 'paragraph':
                html += f'    <div class="paragraph">{comp["content"]}</div>\n'
            
            elif comp['type'] == 'table':
                html += '    <div class="table-container">\n'
                if comp['data']['title']:
                    html += f'        <div class="table-title">{comp["data"]["title"]}</div>\n'
                html += '        <table>\n            <thead>\n                <tr>\n'
                for header in comp['data']['headers']:
                    html += f'                    <th>{header["label"]}</th>\n'
                html += '                </tr>\n            </thead>\n            <tbody>\n'
                for row in comp['data']['rows']:
                    html += '                <tr>\n'
                    # Ensure we're iterating over a list of cell values
                    cells = row.get('cells', [])
                    if isinstance(cells, list):
                        for cell in cells:
                            html += f'                    <td>{cell}</td>\n'
                    else:
                        # Fallback: if cells is somehow a dict, get its values
                        for cell_value in (cells.values() if isinstance(cells, dict) else []):
                            html += f'                    <td>{cell_value}</td>\n'
                    html += '                </tr>\n'
                html += '            </tbody>\n        </table>\n    </div>\n'
            
            elif comp['type'] == 'image':
                data = comp['data']
                html += f'    <div class="image-component align-{data["alignment"]}">\n'
                img_tag = f'<img src="{data["image_url"]}" alt="{data["alt_text"]}" style="width: {data["width"]};">'
                if data.get('link_url'):
                    html += f'        <a href="{data["link_url"]}" target="_blank">{img_tag}</a>\n'
                else:
                    html += f'        {img_tag}\n'
                
                if data.get('show_caption') and data.get('caption'):
                    html += '        <div class="image-caption">\n'
                    if data.get('show_figure_number') and data.get('figure_number'):
                        html += f'            <span class="figure-number">{data["figure_number"]}:</span> '
                    html += f'{data["caption"]}\n'
                    html += '        </div>\n'
                html += '    </div>\n'
        
        # Render children recursively
        for child_data in section_data['children']:
            html += self._render_section(child_data, request, depth + 1)
        
        html += '</div>\n'
        return html

    # ============================================================
    # METADATA ENDPOINTS
    # ============================================================

    @action(detail=True, methods=['get'], url_path='metadata')
    def get_metadata(self, request, pk=None):
        """
        Get all metadata for a document.
        
        Query Parameters:
        - fields: Comma-separated field paths to extract
        - include_custom: Include custom_metadata (default: true)
        - include_structured: Include document_metadata (default: true)
        - format: Output format - 'nested' or 'flat' (default: nested)
        """
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.get_metadata(request, pk=pk)

    @action(detail=True, methods=['get'], url_path='metadata/extract')
    def extract_metadata(self, request, pk=None):
        """Extract specific metadata fields using dot notation."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.extract_metadata(request, pk=pk)

    @action(detail=True, methods=['post'], url_path='metadata/upload')
    def upload_metadata(self, request, pk=None):
        """Upload or update document metadata."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.upload_metadata(request, pk=pk)

    @action(detail=True, methods=['put'], url_path='metadata/bulk-update')
    def bulk_update_metadata(self, request, pk=None):
        """Update multiple metadata fields at once."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.bulk_update_metadata(request, pk=pk)

    @action(detail=True, methods=['patch'], url_path='metadata/merge')
    def merge_metadata(self, request, pk=None):
        """Merge new metadata while preserving existing fields."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.merge_metadata(request, pk=pk)

    @action(detail=True, methods=['delete'], url_path='metadata/remove')
    def remove_metadata(self, request, pk=None):
        """Remove specific metadata fields from a document."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.remove_metadata(request, pk=pk)

    @action(detail=True, methods=['get'], url_path='metadata/schema')
    def get_metadata_schema(self, request, pk=None):
        """Get the metadata schema/structure for a document."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.get_metadata_schema(request, pk=pk)

    @action(detail=True, methods=['get'], url_path='metadata/history')
    def get_metadata_history(self, request, pk=None):
        """View the complete metadata change history."""
        from .metadata_views import DocumentMetadataViewSet
        metadata_viewset = DocumentMetadataViewSet()
        metadata_viewset.request = request
        metadata_viewset.format_kwarg = self.format_kwarg
        metadata_viewset.check_object_permissions = self.check_object_permissions
        return metadata_viewset.get_metadata_history(request, pk=pk)

    # ── Document Duplication & Branching shortcuts ────────────────────────

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate_document(self, request, pk=None):
        """
        Duplicate this document into a new document with optional metadata overrides.

        POST /api/documents/<uuid>/duplicate/
        Body: {
            title?: "New Title",
            branch_name?: "My Copy",
            metadata_overrides?: {...},
            custom_metadata_overrides?: {...},
            include_structure?: true,
            include_images?: false,
            duplicate_notes?: "..."
        }
        """
        from .branching_views import _deep_clone_document
        from .models import DocumentBranch
        from .branching_serializers import DocumentBranchListSerializer

        source = self.get_object()
        data = request.data or {}

        with transaction.atomic():
            new_doc = _deep_clone_document(
                source,
                user=request.user,
                title_override=data.get('title', ''),
                metadata_overrides=data.get('metadata_overrides'),
                custom_metadata_overrides=data.get('custom_metadata_overrides'),
                include_structure=data.get('include_structure', True),
                include_images=data.get('include_images', False),
            )

            branch_name = data.get('branch_name') or f"Duplicate of {source.title}"
            branch = DocumentBranch.objects.create(
                master=getattr(source, 'master_document_ref', None) if hasattr(source, 'master_document_ref') else None,
                source_document=source,
                document=new_doc,
                branch_name=branch_name,
                branch_notes=data.get('duplicate_notes', ''),
                branch_type='duplicate',
                metadata_overrides=data.get('metadata_overrides') or {},
                created_by=request.user,
            )

        return Response({
            'status': 'success',
            'document': {
                'id': str(new_doc.id),
                'title': new_doc.title,
            },
            'branch': DocumentBranchListSerializer(branch).data,
            'source_document_id': str(source.id),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='promote-to-master')
    def promote_to_master(self, request, pk=None):
        """
        Promote this document to a Master Document.

        POST /api/documents/<uuid>/promote-to-master/
        Body: { name?, description?, category?, tags?, ... }
        """
        import copy as copy_module
        from .models import MasterDocument
        from .branching_serializers import MasterDocumentDetailSerializer

        doc = self.get_object()
        data = request.data or {}

        # Check if already a master
        if hasattr(doc, 'master_document_ref') and doc.master_document_ref:
            return Response(
                {'error': 'This document is already a master document.',
                 'master_id': str(doc.master_document_ref.id)},
                status=status.HTTP_409_CONFLICT,
            )

        master = MasterDocument.objects.create(
            name=data.get('name', doc.title),
            description=data.get('description', ''),
            template_document=doc,
            category=data.get('category', doc.category),
            document_type=data.get('document_type', doc.document_type),
            tags=data.get('tags', []),
            default_metadata=copy_module.deepcopy(doc.document_metadata or {}),
            default_custom_metadata=copy_module.deepcopy(doc.custom_metadata or {}),
            default_parties=copy_module.deepcopy(doc.parties or []),
            created_by=request.user,
        )

        return Response(
            MasterDocumentDetailSerializer(master).data,
            status=status.HTTP_201_CREATED,
        )

    # ── IMAGE SLOTS — scan document content for [[image:name]] ──────────

    @action(detail=True, methods=['get'], url_path='image-slots')
    def image_slots(self, request, pk=None):
        """
        GET /api/documents/<uuid>/image-slots/
        Scan all sections, paragraphs, latex codes and sentences for
        ``[[image:<name>]]`` placeholders (non-UUID names = unmapped slots).
        Returns the slot list + mapping state from ``document_metadata._image_placeholders``.
        """
        from .models import LatexCode, Sentence

        doc = self.get_object()
        _UUID_RE = re.compile(
            r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
            r'[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        )

        # Collect all text from the document tree
        text_chunks = []
        for section in doc.sections.all():
            text_chunks.append(section.get_effective_content() or '')
            for para in section.paragraphs.all():
                text_chunks.append(para.get_effective_content() or '')
                for sent in para.sentences.all():
                    text_chunks.append(sent.content_text or '')
            for lc in section.latex_codes.all():
                text_chunks.append(lc.get_effective_content() or '')

        all_text = '\n'.join(text_chunks)

        # Extract named (non-UUID) image placeholders
        all_img_names = set(re.findall(r'\[\[image:([^\]]+)\]\]', all_text))
        named_slots = sorted(n for n in all_img_names if not _UUID_RE.match(n))
        uuid_images = sorted(n for n in all_img_names if _UUID_RE.match(n))

        # Read / seed _image_placeholders in document_metadata
        meta = doc.document_metadata
        if not isinstance(meta, dict):
            meta = {}
            doc.document_metadata = meta
        img_map = meta.get('_image_placeholders', {})
        if not isinstance(img_map, dict):
            img_map = {}

        changed = False
        for name in named_slots:
            if name not in img_map:
                img_map[name] = None
                changed = True
        if changed:
            meta['_image_placeholders'] = img_map
            doc.document_metadata = meta
            doc.save(update_fields=['document_metadata'])

        # Build response — resolve image URLs for mapped UUIDs
        all_mapped_uuids = set()
        for name in img_map:
            mid = img_map[name]
            if mid:
                all_mapped_uuids.add(str(mid))
        for uid in uuid_images:
            all_mapped_uuids.add(uid)

        # Fetch DocumentImage objects for all UUIDs in one query
        image_url_map = {}
        if all_mapped_uuids:
            images_qs = DocumentImage.objects.filter(
                id__in=[u for u in all_mapped_uuids]
            )
            for img in images_qs:
                img_id = str(img.id)
                image_url_map[img_id] = {
                    'url': request.build_absolute_uri(img.get_url()) if img.get_url() else None,
                    'thumbnail_url': request.build_absolute_uri(img.get_thumbnail_url()) if img.get_thumbnail_url() else None,
                    'name': img.name,
                    'image_type': img.image_type,
                }

        # Also persist image_url_map in document_metadata so the placeholder
        # renderer can resolve [[image:UUID]] to <img> tags.
        meta['_image_url_map'] = {
            uid: data['url'] for uid, data in image_url_map.items() if data.get('url')
        }
        doc.document_metadata = meta
        doc.save(update_fields=['document_metadata'])

        slot_data = []
        for name in sorted(img_map.keys()):
            mapped_id = img_map.get(name)
            slot_entry = {
                'name': name,
                'mapped_image_id': mapped_id,
                'is_mapped': mapped_id is not None,
                'in_code': (f'[[image:{name}]]' in all_text) or
                           (mapped_id and f'[[image:{mapped_id}]]' in all_text),
            }
            # Include image URL info for mapped slots
            if mapped_id and str(mapped_id) in image_url_map:
                slot_entry['image_url'] = image_url_map[str(mapped_id)].get('url')
                slot_entry['image_thumbnail_url'] = image_url_map[str(mapped_id)].get('thumbnail_url')
                slot_entry['image_name'] = image_url_map[str(mapped_id)].get('name')
            slot_data.append(slot_entry)

        return Response({
            'image_slots': slot_data,
            'image_slots_total': len(slot_data),
            'image_slots_mapped': sum(1 for s in slot_data if s['is_mapped']),
            'image_uuids': uuid_images,
            'image_url_map': image_url_map,
        })

    @action(detail=True, methods=['post'], url_path='map-image')
    def map_image(self, request, pk=None):
        """
        POST /api/documents/<uuid>/map-image/
        Map a named image placeholder to an actual uploaded image.

        Replaces ``[[image:descriptive_name]]`` → ``[[image:<real-uuid>]]``
        across all sections, paragraphs, latex codes and sentences.

        Body:
          { "placeholder_name": "company_logo", "image_id": "<uuid>" }
        To unmap:
          { "placeholder_name": "company_logo", "image_id": null }
        """
        from .models import LatexCode, Sentence

        doc = self.get_object()
        placeholder_name = request.data.get('placeholder_name', '').strip()
        image_id = request.data.get('image_id')

        if not placeholder_name:
            return Response(
                {'error': 'placeholder_name is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        meta = doc.document_metadata
        if not isinstance(meta, dict):
            meta = {}
            doc.document_metadata = meta
        img_map = meta.setdefault('_image_placeholders', {})

        # Determine old and new patterns for find-replace
        if image_id is None:
            # ── Unmap: revert [[image:<uuid>]] back to [[image:name]] ──
            old_uuid = img_map.get(placeholder_name)
            old_pattern = f'[[image:{old_uuid}]]' if old_uuid else None
            new_pattern = f'[[image:{placeholder_name}]]'
            img_map[placeholder_name] = None
        else:
            # ── Map: validate image first ────────────────────────────
            try:
                img_uuid = uuid.UUID(str(image_id))
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
                # Fallback: check Attachment table
                try:
                    from attachments.models import Attachment
                    img = Attachment.objects.filter(
                        id=img_uuid, file_kind='image',
                    ).first()
                except Exception:
                    pass
            if not img:
                return Response(
                    {'error': 'Image not found or not accessible.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # Build old/new patterns
            old_uuid = img_map.get(placeholder_name)
            if old_uuid and isinstance(old_uuid, str) and old_uuid != str(img_uuid):
                old_pattern = f'[[image:{old_uuid}]]'
            else:
                old_pattern = f'[[image:{placeholder_name}]]'
            new_pattern = f'[[image:{img_uuid}]]'
            img_map[placeholder_name] = str(img_uuid)

        # ── Apply find-replace across all content ────────────────────
        def _replace_in_field(obj, field_name):
            val = getattr(obj, field_name, None)
            if val and old_pattern and old_pattern in val:
                setattr(obj, field_name, val.replace(old_pattern, new_pattern))
                return True
            return False

        for section in doc.sections.all():
            s_changed = False
            if section.has_edits:
                s_changed = _replace_in_field(section, 'edited_text')
            else:
                s_changed = _replace_in_field(section, 'content_text')
            if s_changed:
                section.modified_by = request.user
                section.save(update_fields=[
                    'edited_text' if section.has_edits else 'content_text',
                    'modified_by', 'last_modified',
                ])

            for para in section.paragraphs.all():
                p_changed = False
                if para.has_edits:
                    p_changed = _replace_in_field(para, 'edited_text')
                else:
                    p_changed = _replace_in_field(para, 'content_text')
                if p_changed:
                    para.save(update_fields=[
                        'edited_text' if para.has_edits else 'content_text',
                    ])
                for sent in para.sentences.all():
                    if _replace_in_field(sent, 'content_text'):
                        sent.save(update_fields=['content_text'])

            for lc in section.latex_codes.all():
                lc_changed = False
                if lc.has_edits:
                    lc_changed = _replace_in_field(lc, 'edited_code')
                else:
                    lc_changed = _replace_in_field(lc, 'latex_code')
                if lc_changed:
                    lc.modified_by = request.user
                    lc.save(update_fields=[
                        'edited_code' if lc.has_edits else 'latex_code',
                        'modified_by',
                    ])

        meta['_image_placeholders'] = img_map

        # Rebuild _image_url_map for all currently mapped UUIDs
        mapped_uuids = [v for v in img_map.values() if v]
        url_map = {}
        if mapped_uuids:
            for img_obj in DocumentImage.objects.filter(id__in=mapped_uuids):
                u = img_obj.get_url()
                if u:
                    url_map[str(img_obj.id)] = request.build_absolute_uri(u)
            # Fallback to Attachment table for any missing UUIDs
            missing = [u for u in mapped_uuids if str(u) not in url_map]
            if missing:
                try:
                    from attachments.models import Attachment
                    for att in Attachment.objects.filter(id__in=missing, file_kind='image'):
                        u = att.get_url()
                        if u:
                            url_map[str(att.id)] = request.build_absolute_uri(u)
                except Exception:
                    pass
        meta['_image_url_map'] = url_map

        doc.document_metadata = meta
        doc.last_modified_by = request.user
        doc.save(update_fields=['document_metadata', 'last_modified_by', 'updated_at'])

        return Response({
            'status': 'success',
            'placeholder_name': placeholder_name,
            'image_id': img_map.get(placeholder_name),
            'image_placeholders': img_map,
            'image_url_map': url_map,
        })


class IssueViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Issue management.
    """
    queryset = Issue.objects.all()
    serializer_class = IssueSerializer
    
    def update(self, request, pk=None):
        """
        PUT /api/issues/{id}
        Update issue status (accept/reject/ignore).
        """
        issue = self.get_object()
        serializer = IssueUpdateSerializer(data=request.data)
        
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        issue.status = serializer.validated_data['status']
        issue.save()
        
        output_serializer = IssueSerializer(issue)
        return Response(output_serializer.data)


class SectionReferenceViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Section Reference management with access control.
    Users can only create references to sections from documents they have access to.
    
    Endpoints:
    - GET /api/section-references/ - List all section references for accessible documents
    - POST /api/section-references/ - Create a new section reference
    - GET /api/section-references/{id}/ - Get a specific section reference
    - PUT/PATCH /api/section-references/{id}/ - Update a section reference
    - DELETE /api/section-references/{id}/ - Delete a section reference
    - GET /api/section-references/by-document/{document_id}/ - Get all references for a document
    """
    queryset = SectionReference.objects.all()
    serializer_class = SectionReferenceSerializer
    
    def get_serializer_class(self):
        """Use different serializers for read vs write operations."""
        if self.action in ['create', 'update', 'partial_update']:
            return SectionReferenceCreateSerializer
        return SectionReferenceSerializer
    
    def get_queryset(self):
        """
        Filter section references to only show those where user has access
        to both the source document and the referenced document.
        """
        user = self.request.user
        
        if not user.is_authenticated:
            return SectionReference.objects.none()
        
        # Get all section references and filter by access
        queryset = SectionReference.objects.select_related(
            'source_document',
            'referenced_section',
            'referenced_section__document',
            'created_by'
        ).all()
        
        # Filter to only include references where user can access both documents
        accessible_refs = []
        for ref in queryset:
            if ref.can_access(user):
                accessible_refs.append(ref.id)
        
        return SectionReference.objects.filter(id__in=accessible_refs)
    
    def perform_create(self, serializer):
        """Set the created_by user when creating a new reference."""
        serializer.save(created_by=self.request.user)
    
    def perform_destroy(self, instance):
        """Only allow deletion if user owns the source document or created the reference."""
        user = self.request.user
        source_doc = instance.source_document
        
        if source_doc.created_by != user and instance.created_by != user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You don't have permission to delete this reference")
        
        instance.delete()
    
    @action(detail=False, methods=['get'], url_path='by-document/(?P<document_id>[^/.]+)')
    def by_document(self, request, document_id=None):
        """
        GET /api/section-references/by-document/{document_id}/
        
        Get all section references for a specific document.
        Returns references where this document is the source.
        """
        user = request.user
        
        try:
            document = Document.objects.get(id=document_id)
        except Document.DoesNotExist:
            return Response(
                {'error': 'Document not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Import Share model and ContentType
        from django.contrib.contenttypes.models import ContentType
        from sharing.models import Share
        
        # Get Document content type
        doc_content_type = ContentType.objects.get_for_model(Document)
        
        # Check access to document
        has_access = (
            document.created_by == user or
            Share.objects.filter(
                content_type=doc_content_type,
                object_id=str(document.id),
                shared_with_user=user
            ).exists()
        )
        
        if not has_access:
            return Response(
                {'error': 'You do not have access to this document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Get all references for this document
        references = SectionReference.objects.filter(
            source_document=document
        ).select_related(
            'referenced_section',
            'referenced_section__document',
            'created_by'
        ).order_by('order')
        
        # Filter to only include references user can access
        accessible_refs = [ref for ref in references if ref.can_access(user)]
        
        serializer = self.get_serializer(accessible_refs, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        """
        GET /api/section-references/{id}/preview/
        
        Get a preview of the referenced section with full content.
        """
        reference = self.get_object()
        
        if not reference.can_access(request.user):
            return Response(
                {'error': 'You do not have access to this reference'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        preview_data = reference.get_reference_data()
        return Response(preview_data)


class DocumentImageViewSet(viewsets.ModelViewSet):
    """
    API endpoints for uploading and managing document images.
    
    Supports specific image types: logo, watermark, background, header_icon, footer_icon, etc.
    Users can upload images to their library and query by type.
    
    Endpoints:
    - POST /api/images/upload/ - Upload new image
    - GET /api/images/ - List user's images
    - GET /api/images/?type=logo - Filter by image type
    - GET /api/images/{id}/ - Get specific image
    - DELETE /api/images/{id}/ - Delete image
    - GET /api/images/my-images/ - Get all user images grouped by type
    - GET /api/images/by-type/{type}/ - Get images of specific type
    """
    queryset = DocumentImage.objects.all()
    permission_classes = [IsAuthenticated]
    
    def get_serializer_class(self):
        """Return appropriate serializer based on action."""
        from .serializers import (
            DocumentImageSerializer, ImageUploadSerializer, ImageListSerializer
        )
        
        if self.action == 'create' or self.action == 'upload':
            return ImageUploadSerializer
        elif self.action == 'list' or self.action == 'my_images':
            return ImageListSerializer
        return DocumentImageSerializer
    
    def get_queryset(self):
        """
        Filter images by current user's visibility scope.

        Uses ``DocumentImage.visible_to_user()`` as base, then applies
        additional query-param filters:
          ?scope=user|team|organization|document
          ?upload_scope=...  (legacy alias for scope)
          ?document=<uuid>
          ?type=logo|watermark|…  (or ?image_type=…)
          ?search=keyword
          ?include_public=true
        """
        from django.db.models import Q

        user = self.request.user
        scope = (
            self.request.query_params.get('scope', '').strip()
            or self.request.query_params.get('upload_scope', '').strip()
        )
        document_id = self.request.query_params.get('document', None)
        image_type = (
            self.request.query_params.get('type', None)
            or self.request.query_params.get('image_type', None)
        )
        search = self.request.query_params.get('search', '').strip()

        # ── Base: everything the user is allowed to see ─────────────
        queryset = DocumentImage.visible_to_user(user, image_type=image_type or None)

        # ── Narrow by scope ─────────────────────────────────────────
        if scope == 'document' and document_id:
            queryset = queryset.filter(
                Q(document_id=document_id) | Q(uploaded_by=user, document__isnull=True)
            )
        elif scope == 'team':
            queryset = queryset.filter(scope='team')
        elif scope == 'organization':
            queryset = queryset.filter(scope='organization')
        elif scope == 'user':
            queryset = queryset.filter(uploaded_by=user)

        # ── Additional filters ──────────────────────────────────────
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(tags__icontains=search)
            )

        return queryset.order_by('-uploaded_at')
    
    def create(self, request, *args, **kwargs):
        """Upload a new image with auto org/team/scope."""
        serializer = self.get_serializer(data=request.data, context={'request': request})
        
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        image = serializer.save()

        # Auto-set organization from user profile if not already set
        updated_fields = []
        if not image.organization:
            try:
                image.organization = request.user.profile.organization
                updated_fields.append('organization')
            except Exception:
                pass

        # Set scope from request (defaults to 'user')
        scope = request.data.get('scope', 'user')
        if scope in ('user', 'team', 'organization', 'document'):
            image.scope = scope
            updated_fields.append('scope')

        team_id = request.data.get('team')
        if scope == 'team' and team_id:
            image.team_id = team_id
            updated_fields.append('team')

        if updated_fields:
            image.save(update_fields=updated_fields)

        # Mirror to centralised Attachment library (best-effort)
        try:
            from attachments.models import Attachment
            Attachment.objects.create(
                name=image.name,
                file_kind='image',
                image_type=image.image_type,
                file=image.image,
                scope=image.scope,
                uploaded_by=request.user,
                organization=image.organization,
                team=image.team,
                document=image.document,
                file_size=image.file_size,
                mime_type=image.mime_type,
                width=image.width,
                height=image.height,
                tags=image.tags or [],
            )
        except Exception:
            pass
        
        # Return full details
        from .serializers import DocumentImageSerializer
        output_serializer = DocumentImageSerializer(image)
        
        return Response({
            'message': 'Image uploaded successfully',
            'image': output_serializer.data
        }, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['post'], url_path='upload')
    def upload(self, request):
        """
        POST /api/images/upload/
        Upload a new image with multipart/form-data.
        
        Required fields:
        - image: Image file
        - name: Image name
        - image_type: Type (logo, watermark, background, header_icon, footer_icon, etc.)
        
        Optional fields:
        - caption: Short caption
        - description: Longer description
        - document: Document ID to attach to
        - is_public: Make available to all users (default: false)
        - tags: JSON array of tags
        """
        return self.create(request)
    
    @action(detail=False, methods=['get'], url_path='my-images')
    def my_images(self, request):
        """
        GET /api/images/my-images/
        Get all images uploaded by current user, grouped by type.
        """
        images = self.get_queryset()
        
        # Group by type
        grouped = {}
        for img in images:
            img_type = img.image_type
            if img_type not in grouped:
                grouped[img_type] = []
            
            grouped[img_type].append({
                'id': str(img.id),
                'name': img.name,
                'type': img.image_type,
                'url': img.get_url(),
                'thumbnail_url': img.get_thumbnail_url(),
                'width': img.width,
                'height': img.height,
                'file_size': img.file_size,
                'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None,
                'usage_count': img.usage_count,
                'tags': img.tags,
            })
        
        return Response({
            'total_count': images.count(),
            'by_type': grouped,
            'available_types': list(grouped.keys())
        })
    
    @action(detail=False, methods=['get'], url_path='by-type/(?P<image_type>[^/.]+)')
    def by_type(self, request, image_type=None):
        """
        GET /api/images/by-type/{type}/
        Get all images of a specific type for current user.
        
        Example: GET /api/images/by-type/logo/
        """
        images = DocumentImage.get_user_images_by_type(request.user, image_type)
        serializer = self.get_serializer(images, many=True)
        
        return Response({
            'type': image_type,
            'count': images.count(),
            'images': serializer.data
        })
    
    @action(detail=False, methods=['get'], url_path='public')
    def public_images(self, request):
        """
        GET /api/images/public/
        Get all public images available to all users.
        """
        image_type = request.query_params.get('type', None)
        images = DocumentImage.get_public_images_by_type(image_type)
        serializer = self.get_serializer(images, many=True)
        
        return Response({
            'count': images.count(),
            'images': serializer.data
        })
    
    @action(detail=True, methods=['post'], url_path='make-public')
    def make_public(self, request, pk=None):
        """
        POST /api/images/{id}/make-public/
        Make an image public (available to all users).
        """
        image = self.get_object()
        
        # Only owner can make public
        if image.uploaded_by != request.user:
            return Response({
                'error': 'Only the image owner can make it public'
            }, status=status.HTTP_403_FORBIDDEN)
        
        image.is_public = True
        image.save(update_fields=['is_public'])
        
        return Response({
            'message': 'Image is now public',
            'image_id': str(image.id),
            'is_public': True
        })
    
    @action(detail=True, methods=['post'], url_path='make-private')
    def make_private(self, request, pk=None):
        """
        POST /api/images/{id}/make-private/
        Make an image private (only owner can use).
        """
        image = self.get_object()
        
        if image.uploaded_by != request.user:
            return Response({
                'error': 'Only the image owner can make it private'
            }, status=status.HTTP_403_FORBIDDEN)
        
        image.is_public = False
        image.save(update_fields=['is_public'])
        
        return Response({
            'message': 'Image is now private',
            'image_id': str(image.id),
            'is_public': False
        })
    
    @action(detail=False, methods=['get'], url_path='types')
    def image_types(self, request):
        """
        GET /api/images/types/
        Get all available image types.
        """
        types = [
            {'value': t[0], 'label': t[1]} 
            for t in DocumentImage.IMAGE_TYPES
        ]
        
        return Response({
            'types': types
        })
    
    def destroy(self, request, *args, **kwargs):
        """Delete an image (only if uploaded by current user)."""
        image = self.get_object()
        
        if image.uploaded_by != request.user:
            return Response({
                'error': 'You can only delete your own images'
            }, status=status.HTTP_403_FORBIDDEN)
        
        image_name = image.name
        image.delete()
        
        return Response({
            'message': f'Image "{image_name}" deleted successfully'
        }, status=status.HTTP_200_OK)


class DocumentSearchViewSet(viewsets.ViewSet):
    """
    Smart search for inline references.
    Searches sections, paragraphs, and documents across user's accessible documents.
    """
    permission_classes = [IsAuthenticated]
    
    def list(self, request):
        """
        Search for sections, paragraphs, and documents.
        Triggered when user types * in text editor.
        
        Query Parameters:
        - q: Search query (minimum 2 characters)
        - current_doc: Current document ID (optional)
        - limit: Maximum results per type (default: 5)
        """
        from django.db.models import Q, Value, CharField
        from django.db.models.functions import Concat
        
        query = request.query_params.get('q', '').strip()
        current_doc_id = request.query_params.get('current_doc')
        limit = int(request.query_params.get('limit', 5))
        
        if len(query) < 2:
            return Response({
                'query': query,
                'results': [],
                'count': 0,
                'message': 'Query too short (minimum 2 characters)'
            })
        
        # Get documents user has access to (created by them)
        # TODO: Add sharing functionality later for Q(shared_with=request.user)
        user_documents = Document.objects.filter(
            created_by=request.user
        ).distinct()
        
        results = []
        
        # 1. Search sections
        sections = Section.objects.filter(
            document__in=user_documents
        ).filter(
            Q(title__icontains=query) | 
            Q(content_text__icontains=query) |
            Q(edited_text__icontains=query)
        ).select_related('document')[:limit]
        
        for section in sections:
            # Extract matched content snippet
            content = section.get_effective_content()
            matched_content = self._extract_match_snippet(content or section.title or '', query)
            
            results.append({
                'type': 'section',
                'id': str(section.id),
                'document_id': str(section.document.id),
                'document_title': section.document.title,
                'title': section.title or 'Untitled Section',
                'section_title': section.title or 'Untitled Section',
                'matched_content': matched_content,
                'similarity_score': self._calculate_similarity(section.title or '', query),
                'section_number': section.id  # Using id as section number
            })
        
        # 2. Search paragraphs
        from .models import Paragraph
        paragraphs = Paragraph.objects.filter(
            section__document__in=user_documents
        ).filter(
            Q(content_text__icontains=query) |
            Q(edited_text__icontains=query)
        ).select_related('section', 'section__document')[:limit]
        
        for para in paragraphs:
            content = para.get_effective_content()
            matched_content = self._extract_match_snippet(content, query)
            
            results.append({
                'type': 'paragraph',
                'id': str(para.id),
                'document_id': str(para.section.document.id),
                'document_title': para.section.document.title,
                'section_id': str(para.section.id),
                'section_title': para.section.title or 'Untitled Section',
                'matched_content': matched_content,
                'similarity_score': self._calculate_similarity(content, query),
                'section_number': para.section.id
            })
        
        # 3. Search documents (exclude current document)
        documents = user_documents.filter(
            Q(title__icontains=query) |
            Q(raw_text__icontains=query) |
            Q(current_text__icontains=query)
        )
        
        if current_doc_id:
            documents = documents.exclude(id=current_doc_id)
        
        documents = documents[:limit]
        
        for doc in documents:
            # Get a preview from document metadata or text
            matched_content = doc.title
            if doc.current_text:
                matched_content = doc.current_text[:200]
            elif doc.raw_text:
                matched_content = doc.raw_text[:200]
            
            results.append({
                'type': 'document',
                'id': str(doc.id),
                'title': doc.title,
                'section_id': None,
                'section_title': None,
                'matched_content': matched_content,
                'similarity_score': self._calculate_similarity(doc.title, query),
                'section_number': ''
            })
        
        # Sort by similarity score
        results.sort(key=lambda x: x['similarity_score'], reverse=True)
        
        return Response({
            'query': query,
            'results': results[:limit * 3],  # Return top results across all types
            'count': len(results)
        })
    
    def _extract_match_snippet(self, content, query, context_length=100):
        """Extract snippet around the matched query"""
        if not content:
            return ''
        
        content_lower = content.lower()
        query_lower = query.lower()
        
        # Find query position
        pos = content_lower.find(query_lower)
        if pos == -1:
            # Query not found exactly, return beginning
            return content[:context_length] + ('...' if len(content) > context_length else '')
        
        # Extract context around match
        start = max(0, pos - context_length // 2)
        end = min(len(content), pos + len(query) + context_length // 2)
        
        snippet = content[start:end]
        if start > 0:
            snippet = '...' + snippet
        if end < len(content):
            snippet = snippet + '...'
        
        return snippet
    
    def _calculate_similarity(self, text, query):
        """Simple similarity calculation based on query position and length"""
        if not text:
            return 0.0
        
        text_lower = text.lower()
        query_lower = query.lower()
        
        # Exact match in title gets highest score
        if query_lower == text_lower:
            return 1.0
        
        # Contains query
        if query_lower in text_lower:
            # Higher score if query appears earlier
            pos = text_lower.find(query_lower)
            position_score = 1.0 - (pos / len(text_lower))
            
            # Higher score for longer matches relative to text length
            length_score = len(query_lower) / len(text_lower)
            
            return (position_score * 0.7) + (length_score * 0.3)
        
        return 0.0


class UnifiedSearchViewSet(viewsets.ViewSet):
    """
    Comprehensive search across ALL resource types:
    - Documents
    - Sections & Subsections  
    - Paragraphs
    - Attachments
    - Images
    - Defined Terms
    - Document Versions
    - Change Logs
    - Specialist Reviews
    - Issues
    - Inline References
    
    Features:
    - User/team filtering (only searches user's accessible resources)
    - Metadata enrichment (includes all relevant metadata)
    - **FUZZY SEARCH** - Finds results even with typos/partial matches
    - Relevance scoring (sorts by best match)
    - Resource type filtering (search specific types)
    - Date filtering
    - Severity filtering (for issues)
    - Status filtering (for reviews)
    """
    permission_classes = [IsAuthenticated]
    
    def list(self, request):
        """
        Unified search endpoint with FUZZY SEARCH.
        
        Query Parameters:
        - q: Search query (required, min 2 chars)
        - types: Comma-separated resource types to search
                 (document,section,paragraph,attachment,image,term,version,changelog,review,issue,reference)
                 If not provided, searches all types
        - document_id: Filter to specific document (optional)
        - document_type: Filter by document type (optional)
        - created_after: ISO datetime (optional)
        - created_before: ISO datetime (optional)
        - severity: Filter issues by severity (low|medium|high|critical)
        - status: Filter reviews by status
        - limit: Max results per resource type (default: 50)
        - min_score: Minimum relevance score to include (default: 0, useful for fuzzy: 30-50)
        
        Example:
            GET /api/unified-search/?q=warranty&types=section,paragraph&limit=20
            GET /api/unified-search/?q=confidential&document_id=abc-123
            GET /api/unified-search/?q=error&types=issue&severity=high
            GET /api/unified-search/?q=warrnty&min_score=40  # Fuzzy search with typo
        
        Response:
        {
            "query": "warranty",
            "total_count": 45,
            "fuzzy_search_enabled": true,
            "min_score_threshold": 40.0,
            "results": [
                {
                    "resource_type": "section",
                    "resource_id": "uuid",
                    "title": "5. Warranties",
                    "content": "Full section text...",
                    "matched_content": "...warranty provision...",
                    "relevance_score": 85.5,
                    "metadata": {
                        "order": 5,
                        "depth": 1,
                        "is_subsection": false,
                        "paragraph_count": 3
                    },
                    "document_info": {
                        "id": "uuid",
                        "title": "Software License Agreement",
                        "type": "contract"
                    },
                    "created_at": "2026-01-01T10:00:00Z",
                    "created_by": "john_doe"
                },
                ...
            ],
            "resource_type_counts": {
                "section": 12,
                "paragraph": 20,
                "term": 3,
                "issue": 10
            }
        }
        """
        from .services import UnifiedSearchService
        from .serializers import UnifiedSearchResponseSerializer
        from datetime import datetime
        
        # Get query parameters
        query = request.query_params.get('q', '').strip()
        types_param = request.query_params.get('types', '')
        limit = int(request.query_params.get('limit', 50))
        
        # Parse resource types
        resource_types = None
        if types_param:
            resource_types = [t.strip() for t in types_param.split(',') if t.strip()]
        
        # Build filters
        filters = {}
        
        if request.query_params.get('document_id'):
            filters['document_id'] = request.query_params.get('document_id')
        
        if request.query_params.get('document_type'):
            filters['document_type'] = request.query_params.get('document_type')
        
        if request.query_params.get('created_after'):
            try:
                filters['created_after'] = datetime.fromisoformat(
                    request.query_params.get('created_after').replace('Z', '+00:00')
                )
            except (ValueError, AttributeError):
                pass
        
        if request.query_params.get('created_before'):
            try:
                filters['created_before'] = datetime.fromisoformat(
                    request.query_params.get('created_before').replace('Z', '+00:00')
                )
            except (ValueError, AttributeError):
                pass
        
        if request.query_params.get('severity'):
            filters['severity'] = request.query_params.get('severity')
        
        if request.query_params.get('status'):
            filters['status'] = request.query_params.get('status')
        
        # Get min_score threshold for filtering low-relevance results
        min_score = float(request.query_params.get('min_score', 0))
        
        # Execute search
        search_service = UnifiedSearchService(user=request.user)
        results = search_service.search(
            query=query,
            resource_types=resource_types,
            filters=filters,
            limit=limit
        )
        
        # Filter by minimum score if specified
        if min_score > 0:
            original_count = results['total_count']
            results['results'] = [
                r for r in results['results'] 
                if r['relevance_score'] >= min_score
            ]
            results['total_count'] = len(results['results'])
            results['filtered_count'] = original_count - results['total_count']
            results['min_score_threshold'] = min_score
        
        # Add fuzzy search indicator
        results['fuzzy_search_enabled'] = True
        
        # Serialize and return
        serializer = UnifiedSearchResponseSerializer(results)
        return Response(serializer.data)


class ReferenceContextViewSet(viewsets.ViewSet):
    """
    Get context/content for referenced documents, sections, and paragraphs.
    Used by frontend to display tooltip previews and navigate to references.
    """
    permission_classes = [IsAuthenticated]
    
    @action(detail=False, methods=['get'], url_path='document/(?P<document_id>[^/.]+)')
    def document_context(self, request, document_id=None):
        """
        Get full context for a document.
        
        Returns: Document metadata, sections, and preview text
        """
        try:
            document = Document.objects.filter(
                id=document_id,
                created_by=request.user
            ).first()
            
            if not document:
                return Response({
                    'error': 'Document not found or access denied'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get sections summary
            sections = Section.objects.filter(
                document=document
            ).order_by('order').values('id', 'title', 'order')
            
            return Response({
                'id': str(document.id),
                'title': document.title,
                'document_type': document.document_type,
                'status': document.status,
                'preview_text': document.current_text[:500] if document.current_text else document.raw_text[:500],
                'full_text': document.current_text or document.raw_text,
                'sections': list(sections),
                'metadata': {
                    'author': document.author,
                    'version': document.version,
                    'effective_date': document.effective_date.isoformat() if document.effective_date else None,
                    'governing_law': document.governing_law,
                }
            })
        except Exception as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['get'], url_path='section/(?P<section_id>[^/.]+)')
    def section_context(self, request, section_id=None):
        """
        Get full context for a section.
        
        Returns: Section content, parent section, and surrounding context
        """
        try:
            section = Section.objects.filter(
                id=section_id
            ).select_related('document', 'parent').first()
            
            if not section:
                return Response({
                    'error': 'Section not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check user has access to document
            if section.document.created_by != request.user:
                return Response({
                    'error': 'Access denied'
                }, status=status.HTTP_403_FORBIDDEN)
            
            # Get paragraphs
            paragraphs = Paragraph.objects.filter(
                section=section
            ).order_by('order').values('id', 'order')
            
            # Get child sections
            child_sections = Section.objects.filter(
                parent=section
            ).order_by('order').values('id', 'title', 'order')
            
            content = section.get_effective_content()
            
            return Response({
                'id': str(section.id),
                'title': section.title or 'Untitled Section',
                'content': content,
                'preview': content[:300] if content else '',
                'section_type': section.section_type,
                'document': {
                    'id': str(section.document.id),
                    'title': section.document.title
                },
                'parent': {
                    'id': str(section.parent.id),
                    'title': section.parent.title
                } if section.parent else None,
                'paragraphs': list(paragraphs),
                'child_sections': list(child_sections),
                'metadata': {
                    'depth_level': section.depth_level,
                    'importance_level': section.importance_level,
                    'tags': section.tags
                }
            })
        except Exception as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['get'], url_path='paragraph/(?P<paragraph_id>[^/.]+)')
    def paragraph_context(self, request, paragraph_id=None):
        """
        Get full context for a paragraph.
        
        Returns: Paragraph content, parent section, and surrounding paragraphs
        """
        try:
            paragraph = Paragraph.objects.filter(
                id=paragraph_id
            ).select_related('section', 'section__document').first()
            
            if not paragraph:
                return Response({
                    'error': 'Paragraph not found'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check user has access
            if paragraph.section.document.created_by != request.user:
                return Response({
                    'error': 'Access denied'
                }, status=status.HTTP_403_FORBIDDEN)
            
            content = paragraph.get_effective_content()
            
            # Get surrounding paragraphs for context
            prev_paragraph = Paragraph.objects.filter(
                section=paragraph.section,
                order__lt=paragraph.order
            ).order_by('-order').first()
            
            next_paragraph = Paragraph.objects.filter(
                section=paragraph.section,
                order__gt=paragraph.order
            ).order_by('order').first()
            
            return Response({
                'id': str(paragraph.id),
                'content': content,
                'preview': content[:300] if content else '',
                'paragraph_type': paragraph.paragraph_type,
                'section': {
                    'id': str(paragraph.section.id),
                    'title': paragraph.section.title
                },
                'document': {
                    'id': str(paragraph.section.document.id),
                    'title': paragraph.section.document.title
                },
                'surrounding_context': {
                    'previous': {
                        'id': str(prev_paragraph.id),
                        'preview': prev_paragraph.get_effective_content()[:100] if prev_paragraph.get_effective_content() else ''
                    } if prev_paragraph else None,
                    'next': {
                        'id': str(next_paragraph.id),
                        'preview': next_paragraph.get_effective_content()[:100] if next_paragraph.get_effective_content() else ''
                    } if next_paragraph else None
                },
                'metadata': {
                    'complexity_score': paragraph.complexity_score,
                    'is_ambiguous': paragraph.is_ambiguous,
                    'edit_count': paragraph.edit_count
                }
            })
        except Exception as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['post'], url_path='batch')
    def batch_context(self, request):
        """
        Get context for multiple references at once.
        
        Request body:
        {
            "references": [
                {"type": "section", "id": "s1"},
                {"type": "paragraph", "id": "p1"},
                {"type": "document", "id": "doc-uuid"}
            ]
        }
        """
        references = request.data.get('references', [])
        
        if not references:
            return Response({
                'error': 'No references provided'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        results = []
        
        for ref in references:
            ref_type = ref.get('type')
            ref_id = ref.get('id')
            
            try:
                if ref_type == 'document':
                    doc = Document.objects.filter(
                        id=ref_id,
                        created_by=request.user
                    ).first()
                    
                    if doc:
                        results.append({
                            'type': 'document',
                            'id': str(doc.id),
                            'title': doc.title,
                            'preview': (doc.current_text or doc.raw_text)[:200]
                        })
                
                elif ref_type == 'section':
                    section = Section.objects.filter(
                        id=ref_id,
                        document__created_by=request.user
                    ).select_related('document').first()
                    
                    if section:
                        content = section.get_effective_content()
                        results.append({
                            'type': 'section',
                            'id': str(section.id),
                            'title': section.title,
                            'preview': content[:200] if content else '',
                            'document_title': section.document.title
                        })
                
                elif ref_type == 'paragraph':
                    para = Paragraph.objects.filter(
                        id=ref_id,
                        section__document__created_by=request.user
                    ).select_related('section', 'section__document').first()
                    
                    if para:
                        content = para.get_effective_content()
                        results.append({
                            'type': 'paragraph',
                            'id': str(para.id),
                            'preview': content[:200] if content else '',
                            'section_title': para.section.title,
                            'document_title': para.section.document.title
                        })
            
            except Exception as e:
                results.append({
                    'type': ref_type,
                    'id': ref_id,
                    'error': str(e)
                })
        
        return Response({
            'results': results,
            'count': len(results)
        })

