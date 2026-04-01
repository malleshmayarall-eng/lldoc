"""
communications/consumers.py — WebSocket consumer for real-time notifications
=============================================================================

Provides a persistent WebSocket connection per authenticated user for
receiving real-time notification pushes.

Connection URL:
    ws://localhost:8000/ws/notifications/

Authentication:
    - Session-based (cookie): works automatically with Django sessions
    - Token-based (query param): ws://…/ws/notifications/?token=<session_key>

Channel group naming:
    ``notifications_<user_id>`` — each user gets their own group.

Message format (server → client):
    {
        "type": "notification",
        "data": {
            "id": "<uuid>",
            "category": "workflow.assigned",
            "priority": "high",
            "title": "New task assigned",
            "message": "...",
            "target_type": "workflow",
            "target_id": "<uuid>",
            "metadata": {...},
            "actor": {"id": 1, "name": "Jane Doe"},
            "is_read": false,
            "created_at": "2026-03-28T12:00:00Z"
        }
    }

Client → server commands:
    {"action": "mark_read",     "alert_id": "<uuid>"}
    {"action": "mark_all_read"}
    {"action": "ping"}          → responds with {"type": "pong"}
"""
from __future__ import annotations

import json
import logging

try:
    from channels.generic.websocket import AsyncJsonWebSocketConsumer
    from channels.db import database_sync_to_async
    HAS_CHANNELS = True
except ImportError:
    # If django-channels is not installed, provide a no-op base
    HAS_CHANNELS = False

logger = logging.getLogger('communications.consumers')


if HAS_CHANNELS:

    class NotificationConsumer(AsyncJsonWebSocketConsumer):
        """
        Async WebSocket consumer for real-time notification delivery.

        Each authenticated user joins a channel group named
        ``notifications_<user_id>``.  The ``push_realtime_notification``
        Celery task sends messages to this group.
        """

        async def connect(self):
            """Accept connection if user is authenticated."""
            self.user = self.scope.get('user')

            if not self.user or self.user.is_anonymous:
                await self.close(code=4001)
                return

            self.group_name = f'notifications_{self.user.id}'

            # Join the user's notification group
            await self.channel_layer.group_add(
                self.group_name,
                self.channel_name,
            )
            await self.accept()

            # Send initial unread count
            count = await self._get_unread_count()
            await self.send_json({
                'type': 'connected',
                'unread_count': count,
            })

        async def disconnect(self, close_code):
            """Leave the notification group on disconnect."""
            if hasattr(self, 'group_name'):
                await self.channel_layer.group_discard(
                    self.group_name,
                    self.channel_name,
                )

        async def receive_json(self, content, **kwargs):
            """
            Handle client → server commands.

            Supported actions:
              - mark_read: Mark a specific alert as read
              - mark_all_read: Mark all alerts as read
              - ping: Health check
            """
            action = content.get('action', '')

            if action == 'ping':
                await self.send_json({'type': 'pong'})

            elif action == 'mark_read':
                alert_id = content.get('alert_id')
                if alert_id:
                    success = await self._mark_alert_read(alert_id)
                    await self.send_json({
                        'type': 'read_confirmed',
                        'alert_id': alert_id,
                        'success': success,
                    })
                    # Send updated count
                    count = await self._get_unread_count()
                    await self.send_json({
                        'type': 'unread_count',
                        'count': count,
                    })

            elif action == 'mark_all_read':
                count = await self._mark_all_read()
                await self.send_json({
                    'type': 'all_read_confirmed',
                    'marked': count,
                })
                await self.send_json({
                    'type': 'unread_count',
                    'count': 0,
                })

            else:
                await self.send_json({
                    'type': 'error',
                    'message': f'Unknown action: {action}',
                })

        # ── Channel layer message handlers ───────────────────────────

        async def notification_send(self, event):
            """
            Called by the channel layer when a notification is pushed
            from the Celery task (via ``push_realtime_notification``).

            The event dict has ``type: 'notification.send'`` and
            ``data: {...}``.
            """
            await self.send_json({
                'type': 'notification',
                'data': event.get('data', {}),
            })

        async def notification_count_update(self, event):
            """Pushed when unread count changes from another source."""
            await self.send_json({
                'type': 'unread_count',
                'count': event.get('count', 0),
            })

        # ── Database helpers ─────────────────────────────────────────

        @database_sync_to_async
        def _get_unread_count(self) -> int:
            from .models import Alert
            return Alert.objects.filter(
                recipient=self.user,
                is_read=False,
                is_archived=False,
            ).count()

        @database_sync_to_async
        def _mark_alert_read(self, alert_id: str) -> bool:
            from .models import Alert
            try:
                alert = Alert.objects.get(id=alert_id, recipient=self.user)
                alert.mark_read()
                return True
            except Alert.DoesNotExist:
                return False

        @database_sync_to_async
        def _mark_all_read(self) -> int:
            from django.utils import timezone
            from .models import Alert
            return Alert.objects.filter(
                recipient=self.user,
                is_read=False,
            ).update(is_read=True, read_at=timezone.now())

else:
    # Placeholder when channels is not installed
    class NotificationConsumer:
        """Stub — install django-channels for WebSocket support."""
        pass
