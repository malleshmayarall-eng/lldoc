"""
communications/views.py — Production REST API for notification management
==========================================================================

Endpoints (all prefixed by ``/api/alerts/``):

  ── Alerts ──────────────────────────────────────────────────────────
  GET    /                        — list alerts (filterable, paginated)
  GET    /<id>/                   — single alert detail
  PATCH  /<id>/read/              — mark one alert read
  PATCH  /<id>/unread/            — mark one alert unread
  PATCH  /read-all/               — mark all (or a list) read
  PATCH  /<id>/archive/           — archive single alert
  PATCH  /archive-bulk/           — archive multiple alerts
  PATCH  /bulk-action/            — generic bulk action (read/unread/archive/delete)
  GET    /unread-count/           — quick badge count
  GET    /stats/                  — detailed notification statistics
  GET    /grouped/                — alerts grouped by group_key
  DELETE /<id>/                   — delete single alert
  DELETE /clear/                  — delete all read alerts

  ── Preferences ─────────────────────────────────────────────────────
  GET    /preferences/            — list user's alert preferences
  POST   /preferences/            — create / upsert a preference
  PATCH  /preferences/<id>/       — update a preference
  DELETE /preferences/<id>/       — delete a preference
  PUT    /preferences/bulk/       — bulk upsert preferences
  GET    /preferences/categories/ — list available categories

  ── Webhooks ────────────────────────────────────────────────────────
  GET    /webhooks/               — list user's webhook endpoints
  POST   /webhooks/               — register a new webhook
  PATCH  /webhooks/<id>/          — update a webhook
  DELETE /webhooks/<id>/          — delete a webhook
  POST   /webhooks/<id>/test/     — send a test event to a webhook
  GET    /webhooks/<id>/deliveries/ — list delivery logs for a webhook
"""
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Alert,
    AlertPreference,
    WebhookEndpoint,
    WebhookDelivery,
    CATEGORY_CHOICES,
    CATEGORY_LOOKUP,
)
from .serializers import (
    AlertSerializer,
    AlertCompactSerializer,
    AlertPreferenceSerializer,
    BulkMarkReadSerializer,
    BulkArchiveSerializer,
    BulkActionSerializer,
    WebhookEndpointSerializer,
    WebhookDeliverySerializer,
    NotificationStatsSerializer,
    PreferenceBulkUpdateSerializer,
)


# ─── Cursor-based pagination for efficient infinite scroll ──────────

class AlertCursorPagination(CursorPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100
    ordering = '-created_at'


class AlertViewSet(viewsets.ModelViewSet):
    """
    Full CRUD + convenience actions for the current user's alerts.

    Supports filtering, cursor pagination, bulk operations, grouping,
    and notification statistics.
    """
    serializer_class = AlertSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = AlertCursorPagination
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    def get_serializer_class(self):
        """Use compact serializer for list endpoint."""
        if self.action == 'list':
            compact = self.request.query_params.get('compact', '').lower()
            if compact in ('true', '1'):
                return AlertCompactSerializer
        return AlertSerializer

    def get_queryset(self):
        qs = Alert.objects.filter(
            recipient=self.request.user,
        ).select_related('actor')

        # ── Filters ──────────────────────────────────────────────────
        category = self.request.query_params.get('category')
        if category:
            # Support comma-separated categories
            cats = [c.strip() for c in category.split(',')]
            qs = qs.filter(category__in=cats)

        priority = self.request.query_params.get('priority')
        if priority:
            priorities = [p.strip() for p in priority.split(',')]
            qs = qs.filter(priority__in=priorities)

        is_read = self.request.query_params.get('is_read')
        if is_read is not None:
            qs = qs.filter(is_read=is_read.lower() in ('true', '1'))

        is_archived = self.request.query_params.get('is_archived')
        if is_archived is not None:
            qs = qs.filter(is_archived=is_archived.lower() in ('true', '1'))
        else:
            # Default: exclude archived unless explicitly requested
            qs = qs.filter(is_archived=False)

        target_type = self.request.query_params.get('target_type')
        if target_type:
            qs = qs.filter(target_type=target_type)

        target_id = self.request.query_params.get('target_id')
        if target_id:
            qs = qs.filter(target_id=target_id)

        group_key = self.request.query_params.get('group_key')
        if group_key:
            qs = qs.filter(group_key=group_key)

        # Date range filter
        since = self.request.query_params.get('since')
        if since:
            qs = qs.filter(created_at__gte=since)

        # Exclude expired
        qs = qs.filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
        )

        return qs

    # ── Mark single alert as read ────────────────────────────────────
    @action(detail=True, methods=['patch'], url_path='read')
    def mark_read(self, request, pk=None):
        alert = self.get_object()
        alert.mark_read()
        return Response(AlertSerializer(alert).data)

    # ── Mark single alert as unread ──────────────────────────────────
    @action(detail=True, methods=['patch'], url_path='unread')
    def mark_unread(self, request, pk=None):
        alert = self.get_object()
        alert.mark_unread()
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

    # ── Archive single alert ─────────────────────────────────────────
    @action(detail=True, methods=['patch'], url_path='archive')
    def archive_alert(self, request, pk=None):
        alert = self.get_object()
        alert.archive()
        return Response(AlertSerializer(alert).data)

    # ── Bulk archive ─────────────────────────────────────────────────
    @action(detail=False, methods=['patch'], url_path='archive-bulk')
    def archive_bulk(self, request):
        ser = BulkArchiveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        qs = Alert.objects.filter(recipient=request.user, is_archived=False)

        if ser.validated_data.get('archive_all_read'):
            qs = qs.filter(is_read=True)
        elif ser.validated_data.get('alert_ids'):
            qs = qs.filter(id__in=ser.validated_data['alert_ids'])
        else:
            return Response(
                {'detail': 'Provide alert_ids or set archive_all_read=true'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        count = qs.update(is_archived=True, archived_at=timezone.now())
        return Response({'archived': count})

    # ── Generic bulk action ──────────────────────────────────────────
    @action(detail=False, methods=['patch'], url_path='bulk-action')
    def bulk_action(self, request):
        ser = BulkActionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        alert_ids = ser.validated_data['alert_ids']
        action_type = ser.validated_data['action']
        qs = Alert.objects.filter(recipient=request.user, id__in=alert_ids)

        now = timezone.now()
        if action_type == 'mark_read':
            count = qs.filter(is_read=False).update(is_read=True, read_at=now)
        elif action_type == 'mark_unread':
            count = qs.filter(is_read=True).update(is_read=False, read_at=None)
        elif action_type == 'archive':
            count = qs.filter(is_archived=False).update(is_archived=True, archived_at=now)
        elif action_type == 'unarchive':
            count = qs.filter(is_archived=True).update(is_archived=False, archived_at=None)
        elif action_type == 'delete':
            count, _ = qs.delete()
        else:
            count = 0

        return Response({'action': action_type, 'affected': count})

    # ── Unread count (for badge) ─────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        qs = Alert.objects.filter(
            recipient=request.user,
            is_read=False,
            is_archived=False,
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
        )

        total = qs.count()
        by_priority = {}
        if total > 0:
            priority_counts = qs.values('priority').annotate(c=Count('id'))
            by_priority = {item['priority']: item['c'] for item in priority_counts}

        return Response({
            'unread_count': total,
            'by_priority': by_priority,
        })

    # ── Notification stats (for dashboard) ───────────────────────────
    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        from .dispatch import get_notification_stats
        data = get_notification_stats(request.user)
        return Response(data)

    # ── Grouped alerts ───────────────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='grouped')
    def grouped(self, request):
        """
        Return alerts grouped by ``group_key``, with count and latest alert per group.
        Useful for collapsed notification views (e.g., "5 comments on Document X").
        """
        qs = Alert.objects.filter(
            recipient=request.user,
            is_read=False,
            is_archived=False,
            group_key__gt='',
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
        )

        groups = (
            qs.values('group_key', 'category', 'target_type', 'target_id')
            .annotate(
                count=Count('id'),
                latest=models_Max('created_at'),
            )
            .order_by('-latest')[:50]
        )

        # For each group, get the latest alert as representative
        result = []
        for g in groups:
            latest_alert = qs.filter(group_key=g['group_key']).first()
            if latest_alert:
                result.append({
                    'group_key': g['group_key'],
                    'category': g['category'],
                    'target_type': g['target_type'],
                    'target_id': g['target_id'],
                    'count': g['count'],
                    'latest_alert': AlertCompactSerializer(latest_alert).data,
                })

        return Response(result)

    # ── Clear read alerts ────────────────────────────────────────────
    @action(detail=False, methods=['delete'], url_path='clear')
    def clear_read(self, request):
        count, _ = Alert.objects.filter(
            recipient=request.user, is_read=True,
        ).delete()
        return Response({'deleted': count})


# Need this import for the grouped endpoint
from django.db.models import Max as models_Max


class AlertPreferenceViewSet(viewsets.ModelViewSet):
    """
    Manage the current user's per-category email/in-app/webhook preferences.
    Includes digest frequency, quiet hours, and bulk upsert.
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
            existing.digest_frequency = serializer.validated_data.get(
                'digest_frequency', existing.digest_frequency,
            )
            existing.quiet_hours_start = serializer.validated_data.get(
                'quiet_hours_start', existing.quiet_hours_start,
            )
            existing.quiet_hours_end = serializer.validated_data.get(
                'quiet_hours_end', existing.quiet_hours_end,
            )
            existing.save(update_fields=[
                'enabled', 'digest_frequency', 'quiet_hours_start', 'quiet_hours_end',
            ])
            serializer.instance = existing
        else:
            serializer.save(user=self.request.user)

    # ── Bulk upsert preferences ──────────────────────────────────────
    @action(detail=False, methods=['put'], url_path='bulk')
    def bulk_update(self, request):
        ser = PreferenceBulkUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        results = []
        for item in ser.validated_data['preferences']:
            pref, created = AlertPreference.objects.update_or_create(
                user=request.user,
                category=item['category'],
                channel=item['channel'],
                defaults={
                    'enabled': item.get('enabled', True),
                    'digest_frequency': item.get('digest_frequency', 'realtime'),
                    'quiet_hours_start': item.get('quiet_hours_start'),
                    'quiet_hours_end': item.get('quiet_hours_end'),
                },
            )
            results.append(AlertPreferenceSerializer(pref).data)

        return Response(results)

    # ── List available categories ────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='categories')
    def list_categories(self, request):
        cats = []
        for k, v in CATEGORY_CHOICES:
            group = k.split('.')[0].title()
            cats.append({'key': k, 'label': v, 'group': group})
        return Response(cats)

    # ── Get effective preferences (with defaults) ────────────────────
    @action(detail=False, methods=['get'], url_path='effective')
    def effective_preferences(self, request):
        """
        Returns the effective preference state for every category × channel,
        including defaults for categories the user hasn't explicitly configured.
        """
        user_prefs = {
            (p.category, p.channel): p
            for p in AlertPreference.objects.filter(user=request.user)
        }

        result = []
        for cat_key, cat_label in CATEGORY_CHOICES:
            for ch_key, ch_label in [('in_app', 'In-App'), ('email', 'Email'), ('webhook', 'Webhook')]:
                pref = user_prefs.get((cat_key, ch_key))
                wildcard = user_prefs.get(('*', ch_key))

                if pref:
                    enabled = pref.enabled
                    source = 'explicit'
                elif wildcard:
                    enabled = wildcard.enabled
                    source = 'wildcard'
                else:
                    enabled = ch_key == 'in_app'  # Default: in_app=on, others=off
                    source = 'default'

                result.append({
                    'category': cat_key,
                    'category_label': cat_label,
                    'channel': ch_key,
                    'channel_label': ch_label,
                    'enabled': enabled,
                    'source': source,
                })

        return Response(result)


class WebhookEndpointViewSet(viewsets.ModelViewSet):
    """
    Manage the current user's webhook endpoints for push notifications.
    """
    serializer_class = WebhookEndpointSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return WebhookEndpoint.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # ── Test webhook ─────────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='test')
    def test_webhook(self, request, pk=None):
        """
        Send a test event to the webhook endpoint to verify connectivity.
        """
        endpoint = self.get_object()

        # Create a transient test alert (not persisted)
        from .dispatch import send_alert
        test_alert = send_alert(
            category='system.info',
            recipient=request.user,
            title='🧪 Webhook Test',
            message=f'Test event sent to "{endpoint.name}" at {timezone.now().isoformat()}',
            priority='low',
            metadata={'test': True, 'webhook_id': str(endpoint.id)},
            deduplicate=False,
            expires_in=__import__('datetime').timedelta(hours=1),
        )

        if test_alert:
            from .tasks import deliver_webhook_async
            deliver_webhook_async.delay(str(test_alert.id), str(endpoint.id))
            return Response({
                'status': 'queued',
                'alert_id': str(test_alert.id),
                'message': f'Test event queued for delivery to {endpoint.url}',
            })
        return Response(
            {'status': 'failed', 'message': 'Could not create test alert'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # ── List deliveries for a webhook ────────────────────────────────
    @action(detail=True, methods=['get'], url_path='deliveries')
    def deliveries(self, request, pk=None):
        endpoint = self.get_object()
        deliveries = endpoint.deliveries.all()[:50]
        return Response(WebhookDeliverySerializer(deliveries, many=True).data)

    # ── Reset failure counter ────────────────────────────────────────
    @action(detail=True, methods=['patch'], url_path='reset')
    def reset_failures(self, request, pk=None):
        endpoint = self.get_object()
        endpoint.consecutive_failures = 0
        endpoint.is_active = True
        endpoint.last_error = ''
        endpoint.save(update_fields=['consecutive_failures', 'is_active', 'last_error'])
        return Response(WebhookEndpointSerializer(endpoint).data)
