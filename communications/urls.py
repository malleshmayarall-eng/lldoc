"""
alerts/urls.py
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import AlertViewSet, AlertPreferenceViewSet

router = DefaultRouter()
router.register(r'preferences', AlertPreferenceViewSet, basename='alert-preference')
router.register(r'', AlertViewSet, basename='alert')

urlpatterns = [
    path('', include(router.urls)),
]
