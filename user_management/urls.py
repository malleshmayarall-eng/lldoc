from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    OrganizationViewSet,
    RoleViewSet,
    UserProfileViewSet,
    TeamViewSet,
    InvitationTokenViewSet
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'roles', RoleViewSet, basename='role')
router.register(r'users', UserProfileViewSet, basename='userprofile')
router.register(r'teams', TeamViewSet, basename='team')
router.register(r'invitations', InvitationTokenViewSet, basename='invitation')

urlpatterns = [
    path('', include(router.urls)),
]
