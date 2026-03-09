from django.contrib import admin
from .models import DriveFolder, DriveFile


@admin.register(DriveFolder)
class DriveFolderAdmin(admin.ModelAdmin):
    list_display = ('name', 'organization', 'owner', 'parent', 'is_root', 'root_type', 'is_deleted')
    search_fields = ('name', 'owner__username', 'organization__name')
    list_filter = ('is_root', 'root_type', 'is_deleted')


@admin.register(DriveFile)
class DriveFileAdmin(admin.ModelAdmin):
    list_display = ('name', 'organization', 'owner', 'folder', 'mime_type', 'file_size', 'is_deleted')
    search_fields = ('name', 'owner__username', 'organization__name')
    list_filter = ('mime_type', 'is_deleted')
