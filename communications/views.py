"""
alerts/views.py — REST API for alert management
=================================================

Endpoints (all prefixed by ``/api/alerts/``):

  GET    /                   — list alerts (filterable)
  GET    /<id>/              — single alert detail
  PATCH  /<id>/read/         — mark one alert read
  PATCH  /read-all/          — mark all (or a list) read
  GET    /unread-count/      — quick badge count
  DELETE /<id>/              — delete single alert
  DELETE /clear/             — delete all read alerts

  GET    /preferences/       — list user's alert preferences
  POST   /preferences/       — create / upsert a preference
  PATCH  /preferences/<id>/  — update a preference
  DELETE /preferences/<id>/  — delete a preference

  GET    /categories/        — list available categories
"""
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Alert, AlertPreference, CATEGORY_CHOICES
from .serializers import (
    AlertSerializer,
    AlertPreferenceSerializer,
    BulkMarkReadSerializer,
)


class AlertViewSet(viewsets.ModelViewSet):
    """
    CRUD + convenience actions for the current user's alerts.
    """
    serializer_class = AlertSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = Alert.objects.filter(recipient=self.request.user)

        # Optional filters
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category)

        priority = self.request.query_params.get('priority')
        if priority:
            qs = qs.filter(priority=priority)

        is_read = self.request.query_params.get('is_read')
        if is_read is not None:
            qs = qs.filter(is_read=is_read.lower() in ('true', '1'))

        target_type = self.request.query_params.get('target_type')
        if target_type:
            qs = qs.filter(target_type=target_type)

        target_id = self.request.query_params.get('target_id')
        if target_id:
            qs = qs.filter(target_id=target_id)

        return qs

    # ── Mark single alert as read ────────────────────────────────────
    @action(detail=True, methods=['patch'], url_path='read')
    def mark_read(self, request, pk=None):
        alert = self.get_object()
        alert.mark_read()
        return Response(AlertSerializer(alert).data)

    # ── Mark all / selected as read ──────────────────────────────────
    @action(detail=False, methods=['patch'], url_path='read-all')
    def mark_all_read(self, request):
        ser = BulkMarkReadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        alert_ids = ser.validated_data.get('alert_ids', [])

        qs = Alert.objects.filter(recipient=request.user, is_read=False)
        if alert_ids:
            qs = qs.filter(id__in=alert_ids)

        count = qs.update(is_read=True, read_at=timezone.now())
        return Response({'marked': count})

    # ── Unread count (for badge) ─────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        count = Alert.objects.filter(
            recipient=request.user, is_read=False,
        ).count()
        return Response({'unread_count': count})

    # ── Clear read alerts ────────────────────────────────────────────
    @action(detail=False, methods=['delete'], url_path='clear')
    def clear_read(self, request):
        count, _ = Alert.objects.filter(
            recipient=request.user, is_read=True,
        ).delete()
        return Response({'deleted': count})


class AlertPreferenceViewSet(viewsets.ModelViewSet):
    """
    Manage the current user's per-category email/in-app preferences.
    """
    serializer_class = AlertPreferenceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return AlertPreference.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        # Upsert: if a preference for this user+category+channel exists, update it
        existing = AlertPreference.objects.filter(
            user=self.request.user,
            category=serializer.validated_data['category'],
            channel=serializer.validated_data['channel'],
        ).first()
        if existing:
            existing.enabled = serializer.validated_data.get('enabled', True)
            existing.save(update_fields=['enabled'])
            # Replace the serializer's instance so the response returns the existing obj
            serializer.instance = existing
        else:
            serializer.save(user=self.request.user)

    # ── List available categories ────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='categories')
    def list_categories(self, request):
        cats = [{'key': k, 'label': v} for k, v in CATEGORY_CHOICES]
        return Response(cats)
