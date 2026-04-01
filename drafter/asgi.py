"""
ASGI config for drafter project.

Supports both HTTP and WebSocket protocols:
  - HTTP:      Standard Django request handling
  - WebSocket: Real-time notifications via Django Channels

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'drafter.settings')

# Initialize Django ASGI application early to ensure AppRegistry is populated
django_asgi_app = get_asgi_application()


def get_application():
    """
    Build the full ASGI application with HTTP + WebSocket routing.

    Falls back to plain Django ASGI if django-channels is not installed.
    """
    try:
        from channels.routing import ProtocolTypeRouter, URLRouter
        from channels.auth import AuthMiddlewareStack
        from communications.routing import websocket_urlpatterns

        return ProtocolTypeRouter({
            'http': django_asgi_app,
            'websocket': AuthMiddlewareStack(
                URLRouter(websocket_urlpatterns)
            ),
        })
    except ImportError:
        # django-channels not installed — HTTP only
        return django_asgi_app


application = get_application()
