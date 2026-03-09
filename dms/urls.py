from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DmsDocumentViewSet


router = DefaultRouter()
router.register(r"documents", DmsDocumentViewSet, basename="dms-document")

urlpatterns = [
    path("", include(router.urls)),
]
