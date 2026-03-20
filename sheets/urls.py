"""
Sheets app — urls.py
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SheetViewSet, PublicSheetFormView

router = DefaultRouter()
router.register(r'', SheetViewSet, basename='sheet')

urlpatterns = [
    # Public form endpoints (no auth) — must be before router
    path('public/form/<uuid:token>/', PublicSheetFormView.as_view(), name='public-sheet-form'),

    path('', include(router.urls)),
]
