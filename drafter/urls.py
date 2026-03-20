"""
URL configuration for drafter project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from documents.metadata_views import DocumentMetadataViewSet

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # Metadata endpoints - MUST come before api/documents/ to avoid being caught by DocumentViewSet
    path('api/documents/<uuid:pk>/metadata/', DocumentMetadataViewSet.as_view({'get': 'list'}), name='document-metadata-list'),
    path('api/documents/<uuid:pk>/metadata/extract/', DocumentMetadataViewSet.as_view({'get': 'extract_metadata'}), name='document-metadata-extract'),
    path('api/documents/<uuid:pk>/metadata/upload/', DocumentMetadataViewSet.as_view({'post': 'upload_metadata'}), name='document-metadata-upload'),
    path('api/documents/<uuid:pk>/metadata/bulk-update/', DocumentMetadataViewSet.as_view({'put': 'bulk_update_metadata'}), name='document-metadata-bulk-update'),
    path('api/documents/<uuid:pk>/metadata/merge/', DocumentMetadataViewSet.as_view({'patch': 'merge_metadata'}), name='document-metadata-merge'),
    path('api/documents/<uuid:pk>/metadata/remove/', DocumentMetadataViewSet.as_view({'delete': 'remove_metadata'}), name='document-metadata-remove'),
    path('api/documents/<uuid:pk>/metadata/schema/', DocumentMetadataViewSet.as_view({'get': 'get_metadata_schema'}), name='document-metadata-schema'),
    path('api/documents/<uuid:pk>/metadata/history/', DocumentMetadataViewSet.as_view({'get': 'get_metadata_history'}), name='document-metadata-history'),
    
    path('api/documents/', include('documents.urls')),
    path('api/dms/', include('dms.urls')),
    path('api/ai/', include('aiservices.urls')),
    path('api/users/', include('user_management.urls')),
    path('api/auth/', include('user_management.auth_urls')),
    path('api/sharing/', include('sharing.urls')),  # Generic sharing API
    path('api/viewer/', include('viewer.urls')),  # External viewer & commentator
    path('api/fileshare/', include('fileshare.urls')),
    path('api/clm/', include('clm.urls')),  # Contract Lifecycle Management
    path('api/alerts/', include('communications.urls')),  # Centralized communications & alerts
    path('api/sheets/', include('sheets.urls')),  # Spreadsheet / data tables
    path('documents/', include('exporter.urls')),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
