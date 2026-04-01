from django.contrib import admin
from .models import Attachment


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'file_kind', 'image_type', 'scope',
        'uploaded_by', 'organization', 'team', 'created_at',
    ]
    list_filter = ['file_kind', 'scope', 'image_type', 'organization']
    search_fields = ['name', 'description', 'tags']
    readonly_fields = ['id', 'file_size', 'mime_type', 'width', 'height', 'created_at', 'updated_at']
    raw_id_fields = ['uploaded_by', 'organization', 'team', 'document']
