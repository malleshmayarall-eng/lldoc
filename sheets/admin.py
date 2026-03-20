from django.contrib import admin
from .models import Sheet, SheetRow, SheetCell, SheetShareLink, SheetFormSubmission


class SheetCellInline(admin.TabularInline):
    model = SheetCell
    extra = 0
    readonly_fields = ('id',)


class SheetRowInline(admin.TabularInline):
    model = SheetRow
    extra = 0
    readonly_fields = ('id',)
    show_change_link = True


@admin.register(Sheet)
class SheetAdmin(admin.ModelAdmin):
    list_display = ('title', 'organization', 'created_by', 'row_count', 'col_count', 'updated_at')
    list_filter = ('organization', 'is_archived')
    search_fields = ('title', 'description')
    readonly_fields = ('id', 'created_at', 'updated_at')
    inlines = [SheetRowInline]


@admin.register(SheetRow)
class SheetRowAdmin(admin.ModelAdmin):
    list_display = ('sheet', 'order', 'updated_at')
    readonly_fields = ('id',)
    inlines = [SheetCellInline]


@admin.register(SheetCell)
class SheetCellAdmin(admin.ModelAdmin):
    list_display = ('row', 'column_key', 'raw_value', 'computed_value', 'value_type')
    readonly_fields = ('id',)


@admin.register(SheetShareLink)
class SheetShareLinkAdmin(admin.ModelAdmin):
    list_display = ('sheet', 'token', 'label', 'is_active', 'access_type', 'submission_count', 'created_at')
    list_filter = ('is_active', 'access_type')
    search_fields = ('label', 'sheet__title')
    readonly_fields = ('id', 'token', 'created_at', 'updated_at')


@admin.register(SheetFormSubmission)
class SheetFormSubmissionAdmin(admin.ModelAdmin):
    list_display = ('sheet', 'share_link', 'submitter_identifier', 'created_at')
    list_filter = ('sheet',)
    readonly_fields = ('id', 'created_at')
