from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ShareViewSet, AccessLogViewSet

router = DefaultRouter()
router.register(r'shares', ShareViewSet, basename='share')
router.register(r'access-logs', AccessLogViewSet, basename='accesslog')

urlpatterns = [
    # Direct user search endpoint for cleaner frontend URLs
    path('users/search/', ShareViewSet.as_view({'get': 'search_users'}), name='sharing-user-search'),
    path('teams/search/', ShareViewSet.as_view({'get': 'search_teams'}), name='sharing-team-search'),
    path('', include(router.urls)),
]
