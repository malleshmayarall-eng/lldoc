from django.contrib import admin

from .models import AIInteraction, DocumentAnalysisRun, DocumentTypeAIPreset, DocumentAIConfig


@admin.register(AIInteraction)
class AIInteractionAdmin(admin.ModelAdmin):
	list_display = ('id', 'document', 'interaction_type', 'status', 'requested_by', 'created_at')
	list_filter = ('interaction_type', 'status', 'created_at')
	search_fields = ('document__title', 'prompt', 'response')


@admin.register(DocumentAnalysisRun)
class DocumentAnalysisRunAdmin(admin.ModelAdmin):
	list_display = ('id', 'document', 'analysis_type', 'status', 'requested_by', 'created_at')
	list_filter = ('analysis_type', 'status', 'created_at')
	search_fields = ('document__title',)


@admin.register(DocumentTypeAIPreset)
class DocumentTypeAIPresetAdmin(admin.ModelAdmin):
	list_display = ('id', 'document_type', 'display_name', 'created_by', 'created_at')
	list_filter = ('document_type', 'created_at')
	search_fields = ('document_type', 'display_name', 'description')


@admin.register(DocumentAIConfig)
class DocumentAIConfigAdmin(admin.ModelAdmin):
	list_display = ('id', 'document', 'created_at', 'updated_at')
	search_fields = ('document__title',)
