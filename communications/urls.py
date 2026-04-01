"""
communications/urls.py — URL routing for the notification system
=================================================================

Mounted at ``/api/alerts/`` in ``drafter/urls.py``.

Router registration order matters:
  1. webhooks     → /api/alerts/webhooks/…
  2. preferences  → /api/alerts/preferences/…
  3. alerts       → /api/alerts/…  (empty prefix, must be LAST)
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import AlertViewSet, AlertPreferenceViewSet, WebhookEndpointViewSet

router = DefaultRouter()
router.register(r'webhooks', WebhookEndpointViewSet, basename='webhook-endpoint')
router.register(r'preferences', AlertPreferenceViewSet, basename='alert-preference')
router.register(r'', AlertViewSet, basename='alert')  # Must be LAST (empty prefix)

urlpatterns = [
    path('', include(router.urls)),
]
