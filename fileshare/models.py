import hashlib
import mimetypes
import uuid
from django.db import models
from django.contrib.auth.models import User
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from user_management.models import Organization, Team


def drive_upload_path(instance, filename):
    organization_id = instance.organization_id or 'org'
    folder_id = instance.folder_id or 'root'
    return f"fileshare/{organization_id}/{folder_id}/{instance.id}/{filename}"


DRIVE_SCOPE_CHOICES = [
    ('personal', 'Personal'),
    ('shared', 'Shared with me'),
    ('team', 'Team'),
    ('organization', 'Organization'),
]


class DriveFolder(models.Model):
    ROOT_TYPE_CHOICES = DRIVE_SCOPE_CHOICES

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='drive_folders')
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='drive_folders')
    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='drive_folders',
        null=True,
        blank=True,
    )
    parent = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        related_name='children',
        on_delete=models.CASCADE,
    )
    is_root = models.BooleanField(default=False)
    root_type = models.CharField(max_length=20, choices=ROOT_TYPE_CHOICES, default='personal')
    drive_scope = models.CharField(max_length=20, choices=DRIVE_SCOPE_CHOICES, default='personal')
    description = models.TextField(blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['organization', 'is_deleted']),
            models.Index(fields=['owner', 'is_deleted']),
            models.Index(fields=['parent']),
            models.Index(fields=['is_root', 'root_type']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'parent', 'name'],
                name='unique_folder_name_in_parent',
                condition=models.Q(is_deleted=False),
            )
        ]

    def __str__(self):
        return self.name

    def mark_deleted(self):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=['is_deleted', 'deleted_at'])

    def get_path(self):
        parts = [self.name]
        current = self.parent
        while current:
            parts.append(current.name)
            current = current.parent
        return "/" + "/".join(reversed(parts))

    def get_ancestors(self):
        ancestors = []
        current = self.parent
        while current:
            ancestors.append(current)
            current = current.parent
        return list(reversed(ancestors))


class DriveFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='drive_files')
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='drive_files')
    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='drive_files',
        null=True,
        blank=True,
    )
    folder = models.ForeignKey(DriveFolder, on_delete=models.CASCADE, related_name='files', null=True, blank=True)
    drive_scope = models.CharField(max_length=20, choices=DRIVE_SCOPE_CHOICES, default='personal')
    file = models.FileField(upload_to=drive_upload_path, null=True, blank=True, max_length=500)
    file_size = models.BigIntegerField(default=0)
    mime_type = models.CharField(max_length=150, blank=True)
    checksum = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)
    tags = models.JSONField(default=list, blank=True)
    source = models.CharField(max_length=50, default='upload')
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['organization', 'is_deleted']),
            models.Index(fields=['owner', 'is_deleted']),
            models.Index(fields=['folder', 'is_deleted']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'folder', 'name'],
                name='unique_file_name_in_folder',
                condition=models.Q(is_deleted=False),
            )
        ]

    def __str__(self):
        return self.name

    def mark_deleted(self):
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=['is_deleted', 'deleted_at'])

    def _compute_checksum(self):
        if not self.file:
            return ''
        hasher = hashlib.sha256()
        self.file.seek(0)
        for chunk in self.file.chunks():
            hasher.update(chunk)
        self.file.seek(0)
        return hasher.hexdigest()

    def save(self, *args, **kwargs):
        if self.file:
            self.file_size = self.file.size or 0
            guessed_type, _ = mimetypes.guess_type(self.file.name)
            self.mime_type = guessed_type or self.mime_type
            if not self.checksum:
                self.checksum = self._compute_checksum()
        super().save(*args, **kwargs)


class DriveFavorite(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='drive_favorites')
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.CharField(max_length=255)
    content_object = GenericForeignKey('content_type', 'object_id')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'content_type', 'object_id'],
                name='unique_drive_favorite',
            )
        ]

    def __str__(self):
        return f"Favorite {self.content_type.model} {self.object_id} by {self.user.pk}"
