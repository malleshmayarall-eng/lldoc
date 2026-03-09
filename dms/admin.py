from django.contrib import admin

from .models import DmsDocument


@admin.register(DmsDocument)
class DmsDocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "original_filename", "file_size", "created_at")
    search_fields = ("title", "original_filename", "metadata_index")
    readonly_fields = ("created_at", "updated_at")
