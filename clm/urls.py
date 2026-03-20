"""
CLM URL Configuration — Simplified Workflow System
===================================================
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    NodeConnectionViewSet,
    PublicUploadView,
    PublicUploadSendOTPView,
    PublicUploadVerifyOTPView,
    WebhookReceiverView,
    WorkflowNodeViewSet,
    WorkflowViewSet,
)

router = DefaultRouter()
router.register(r'workflows', WorkflowViewSet, basename='clm-workflow')
router.register(r'nodes', WorkflowNodeViewSet, basename='clm-node')
router.register(r'connections', NodeConnectionViewSet, basename='clm-connection')

urlpatterns = [
    # Webhook receiver (no auth) — must be before router
    path('webhooks/<uuid:token>/', WebhookReceiverView.as_view(), name='clm-webhook-receiver'),
    # Public upload endpoints (no auth) — must be before router
    path('public/upload/<uuid:token>/', PublicUploadView.as_view(), name='public-upload'),
    path('public/upload/<uuid:token>/send-otp/', PublicUploadSendOTPView.as_view(), name='public-upload-send-otp'),
    path('public/upload/<uuid:token>/verify-otp/', PublicUploadVerifyOTPView.as_view(), name='public-upload-verify-otp'),
    path('', include(router.urls)),
]
