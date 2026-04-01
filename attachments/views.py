"""
AttachmentViewSet — centralised upload / browse / manage for images
and documents, scoped by user → team → organisation.

Endpoints (under ``/api/attachments/``):
  GET    /                          → list (filtered by scope / kind / search)
  POST   /                          → upload new attachment
  GET    /<uuid>/                   → detail
  PATCH  /<uuid>/                   → update metadata (name, tags, scope …)
  DELETE /<uuid>/                   → delete
  POST   /upload/                   → alias for create
  GET    /my-uploads/               → current user's uploads only
  GET    /team/<team_uuid>/         → team-scoped attachments
  GET    /organization/             → org-wide attachments
  GET    /images/                   → images only (shortcut)
  GET    /documents/                → documents only (shortcut)
"""

import logging

from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Attachment
from .serializers import (
    AttachmentDetailSerializer,
    AttachmentListSerializer,
    AttachmentUploadSerializer,
)

logger = logging.getLogger(__name__)


class AttachmentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    # ── Serializer routing ───────────────────────────────────────────────

    def get_serializer_class(self):
        if self.action in ('create', 'upload'):
            return AttachmentUploadSerializer
        if self.action == 'list' or self.action in (
            'my_uploads', 'team_attachments', 'organization_attachments',
            'images', 'documents_list',
        ):
            return AttachmentListSerializer
        return AttachmentDetailSerializer

    # ── Queryset ─────────────────────────────────────────────────────────

    def get_queryset(self):
        """
        Default list returns everything the user is allowed to see.
        Supports query params for additional filtering:
          ?scope=user|team|organization|document
          ?file_kind=image|document|other
          ?image_type=logo|watermark|…
          ?team=<uuid>
          ?document=<uuid>
          ?search=keyword
          ?sort=created_at|-created_at|name|-name  (default: -created_at)
        """
        user = self.request.user
        qs = Attachment.visible_to_user(user)

        # ── Filters ─────────────────────────────────────────────────
        params = self.request.query_params

        scope = params.get('scope', '').strip()
        if scope:
            qs = qs.filter(scope=scope)

        file_kind = params.get('file_kind', '').strip()
        if file_kind:
            qs = qs.filter(file_kind=file_kind)

        image_type = params.get('image_type', '').strip()
        if image_type:
            qs = qs.filter(image_type=image_type)

        team_id = params.get('team', '').strip()
        if team_id:
            qs = qs.filter(team_id=team_id)

        document_id = params.get('document', '').strip()
        if document_id:
            qs = qs.filter(document_id=document_id)

        search = params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(description__icontains=search) |
                Q(tags__icontains=search)
            )

        # ── Sort ────────────────────────────────────────────────────
        sort = params.get('sort', '-created_at').strip()
        allowed_sorts = {
            'created_at', '-created_at', 'name', '-name',
            'file_size', '-file_size',
        }
        if sort not in allowed_sorts:
            sort = '-created_at'
        qs = qs.order_by(sort)

        return qs

    # ── CREATE ───────────────────────────────────────────────────────────

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        attachment = serializer.save()

        # Mirror image attachments → DocumentImage so the LaTeX renderer
        # (which queries DocumentImage) can find them via the same UUID.
        if attachment.file_kind == 'image' and attachment.file:
            self._mirror_to_document_image(attachment, request)

        detail = AttachmentDetailSerializer(attachment).data
        return Response(
            {'status': 'success', 'attachment': detail},
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _mirror_to_document_image(attachment, request):
        """Create a DocumentImage record with the **same PK** as the
        Attachment so that ``[[image:<uuid>]]`` placeholders resolve
        correctly during LaTeX compilation."""
        try:
            from documents.models import DocumentImage

            # Avoid duplicates — idempotent
            if DocumentImage.objects.filter(pk=attachment.pk).exists():
                return

            DocumentImage.objects.create(
                id=attachment.pk,                # same UUID!
                document=attachment.document,
                name=attachment.name or 'Unnamed',
                image_type=attachment.image_type or 'picture',
                caption='',
                image=attachment.file,           # reuse the same storage path
                uploaded_by=attachment.uploaded_by,
                scope=attachment.scope or 'user',
                organization=attachment.organization,
                team=attachment.team,
                file_size=attachment.file_size,
                mime_type=attachment.mime_type,
                width=attachment.width,
                height=attachment.height,
                tags=attachment.tags or [],
            )
        except Exception:
            logger.warning(
                'Failed to mirror Attachment %s → DocumentImage',
                attachment.pk,
                exc_info=True,
            )

    # ── Convenience upload alias ─────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='upload')
    def upload(self, request):
        """POST /api/attachments/upload/ — alias for create."""
        return self.create(request)

    # ── My uploads ───────────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='my-uploads')
    def my_uploads(self, request):
        """GET /api/attachments/my-uploads/"""
        qs = Attachment.objects.filter(uploaded_by=request.user).order_by('-created_at')

        file_kind = request.query_params.get('file_kind', '').strip()
        if file_kind:
            qs = qs.filter(file_kind=file_kind)

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(name__icontains=search) | Q(tags__icontains=search)
            )

        serializer = AttachmentListSerializer(qs[:200], many=True)
        return Response({'attachments': serializer.data, 'count': qs.count()})

    # ── Team attachments ─────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path=r'team/(?P<team_id>[0-9a-f\-]{36})')
    def team_attachments(self, request, team_id=None):
        """GET /api/attachments/team/<uuid>/"""
        qs = Attachment.objects.filter(
            scope='team', team_id=team_id,
        ).order_by('-created_at')

        file_kind = request.query_params.get('file_kind', '').strip()
        if file_kind:
            qs = qs.filter(file_kind=file_kind)

        serializer = AttachmentListSerializer(qs[:200], many=True)
        return Response({'attachments': serializer.data, 'count': qs.count()})

    # ── Organization attachments ─────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='organization')
    def organization_attachments(self, request):
        """GET /api/attachments/organization/"""
        try:
            org = request.user.profile.organization
        except Exception:
            return Response({'attachments': [], 'count': 0})

        qs = Attachment.objects.filter(
            scope='organization', organization=org,
        ).order_by('-created_at')

        file_kind = request.query_params.get('file_kind', '').strip()
        if file_kind:
            qs = qs.filter(file_kind=file_kind)

        serializer = AttachmentListSerializer(qs[:200], many=True)
        return Response({'attachments': serializer.data, 'count': qs.count()})

    # ── Images shortcut ──────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='images')
    def images(self, request):
        """GET /api/attachments/images/ — images only."""
        qs = Attachment.visible_to_user(request.user, file_kind='image')

        image_type = request.query_params.get('image_type', '').strip()
        if image_type:
            qs = qs.filter(image_type=image_type)

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(name__icontains=search) | Q(tags__icontains=search)
            )

        scope = request.query_params.get('scope', '').strip()
        if scope:
            qs = qs.filter(scope=scope)

        qs = qs.order_by('-created_at')[:200]
        serializer = AttachmentListSerializer(qs, many=True)
        return Response({'attachments': serializer.data, 'count': len(serializer.data)})

    # ── Documents shortcut ───────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='documents')
    def documents_list(self, request):
        """GET /api/attachments/documents/ — uploaded documents/PDFs only."""
        qs = Attachment.visible_to_user(request.user, file_kind='document')

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(name__icontains=search) | Q(tags__icontains=search)
            )

        scope = request.query_params.get('scope', '').strip()
        if scope:
            qs = qs.filter(scope=scope)

        qs = qs.order_by('-created_at')[:200]
        serializer = AttachmentListSerializer(qs, many=True)
        return Response({'attachments': serializer.data, 'count': len(serializer.data)})

    # ── Grouped summary ──────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        """
        GET /api/attachments/summary/
        Returns counts grouped by scope and file_kind for the sidebar.
        """
        qs = Attachment.visible_to_user(request.user)
        from django.db.models import Count
        by_scope = dict(qs.values_list('scope').annotate(c=Count('id')).values_list('scope', 'c'))
        by_kind = dict(qs.values_list('file_kind').annotate(c=Count('id')).values_list('file_kind', 'c'))
        return Response({
            'total': qs.count(),
            'by_scope': by_scope,
            'by_kind': by_kind,
        })
