from rest_framework.routers import DefaultRouter
from django.urls import path, include
from .views import DriveFolderViewSet, DriveFileViewSet, DriveFavoriteViewSet

router = DefaultRouter()
router.register(r'folders', DriveFolderViewSet, basename='drive-folder')
router.register(r'files', DriveFileViewSet, basename='drive-file')
router.register(r'favorites', DriveFavoriteViewSet, basename='drive-favorite')

urlpatterns = [
    path('', include(router.urls)),
]
