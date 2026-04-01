"""
communications/routing.py — WebSocket URL routing for notifications
====================================================================

Maps ``/ws/notifications/`` to the ``NotificationConsumer``.

Imported by ``drafter/asgi.py`` to build the ASGI application.
"""
from django.urls import re_path

from .consumers import NotificationConsumer

websocket_urlpatterns = [
    re_path(r'ws/notifications/$', NotificationConsumer.as_asgi()),
]
