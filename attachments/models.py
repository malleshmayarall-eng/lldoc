"""
Attachment — centralised image / document storage with
user → team → organisation scoping.

Visibility rules
─────────────────
  scope='user'         → only the uploader can see it
  scope='team'         → all members of ``team`` see it
  scope='organization' → everyone in the org sees it
  scope='document'     → only visible in the context of that document

Images uploaded through the document editor create Attachment records
so they also appear in the central attachments library.
"""

import os
import uuid

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.db.models import Q


# ─────────────────────────────────────────────────────────────────────────────
# Choices
# ─────────────────────────────────────────────────────────────────────────────

SCOPE_CHOICES = [
    ('user', 'User (private)'),
    ('team', 'Team'),
    ('organization', 'Organization'),
    ('document', 'Document-specific'),
]

FILE_KIND_CHOICES = [
    ('image', 'Image'),
    ('document', 'Document / PDF'),
    ('other', 'Other'),
]

IMAGE_TYPE_CHOICES = [
    ('logo', 'Company/Organization Logo'),
    ('watermark', 'Watermark Image'),
    ('background', 'Background Image'),
    ('header_icon', 'Header Icon'),
    ('footer_icon', 'Footer Icon'),
    ('signature', 'Signature Image'),
    ('stamp', 'Stamp/Seal'),
    ('diagram', 'Diagram/Chart'),
    ('figure', 'Figure/Illustration'),
    ('chart', 'Chart/Graph'),
    ('screenshot', 'Screenshot'),
    ('photo', 'Photograph'),
    ('picture', 'General Picture'),
    ('embedded', 'Embedded Image'),
    ('other', 'Other'),
]


def _upload_path(instance, filename):
    """
    Store files under  attachments/<org_id>/<kind>/<Y>/<m>/<filename>
    """
    org_id = str(instance.organization_id) if instance.organization_id else 'no-org'
    kind = instance.file_kind or 'other'
    from django.utils import timezone
    now = timezone.now()
    return f'attachments/{org_id}/{kind}/{now.year}/{now.month:02d}/{filename}'


# ─────────────────────────────────────────────────────────────────────────────
# Model
# ─────────────────────────────────────────────────────────────────────────────

class Attachment(models.Model):
    """
    A centrally-managed uploaded file (image or document).

    Scoping:
      • ``scope='user'`` → visible only to ``uploaded_by``
      • ``scope='team'`` → visible to all members of ``team``
      • ``scope='organization'`` → visible to everyone in ``organization``
      • ``scope='document'`` → linked to a specific ``document``

    The same physical file may be *referenced* by many documents (via
    ``DocumentImage`` or via ``[[image:<uuid>]]`` placeholders) without
    duplication.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # ── Classification ───────────────────────────────────────────────────
    name = models.CharField(max_length=255, help_text="User-friendly display name")
    description = models.TextField(null=True, blank=True)
    file_kind = models.CharField(
        max_length=20, choices=FILE_KIND_CHOICES, default='image',
        db_index=True,
        help_text="Broad category: image or document",
    )
    image_type = models.CharField(
        max_length=50, choices=IMAGE_TYPE_CHOICES, default='picture',
        blank=True, db_index=True,
        help_text="Sub-type (only relevant when file_kind='image')",
    )

    # ── File storage ─────────────────────────────────────────────────────
    file = models.FileField(upload_to=_upload_path, help_text="The uploaded file")
    thumbnail = models.ImageField(
        upload_to='attachments/thumbnails/%Y/%m/',
        null=True, blank=True,
        help_text="Auto-generated thumbnail (images only)",
    )

    # Auto-populated on save
    file_size = models.BigIntegerField(null=True, blank=True, help_text="Bytes")
    mime_type = models.CharField(max_length=100, null=True, blank=True)
    width = models.IntegerField(null=True, blank=True, help_text="Image width in px")
    height = models.IntegerField(null=True, blank=True, help_text="Image height in px")

    # ── Scope / ownership ────────────────────────────────────────────────
    scope = models.CharField(
        max_length=20, choices=SCOPE_CHOICES, default='user',
        db_index=True,
    )
    uploaded_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='attachments',
        db_index=True,
    )
    organization = models.ForeignKey(
        'user_management.Organization',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='attachments',
        db_index=True,
    )
    team = models.ForeignKey(
        'user_management.Team',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='attachments',
        db_index=True,
    )

    # Optional link to a specific document
    document = models.ForeignKey(
        'documents.Document',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='attachment_files',
    )

    # ── Organisational helpers ───────────────────────────────────────────
    tags = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    # ── Timestamps ───────────────────────────────────────────────────────
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['uploaded_by', '-created_at']),
            models.Index(fields=['organization', '-created_at']),
            models.Index(fields=['team', '-created_at']),
            models.Index(fields=['scope', '-created_at']),
            models.Index(fields=['file_kind', '-created_at']),
            models.Index(fields=['organization', 'file_kind']),
            models.Index(fields=['organization', 'scope']),
        ]
        verbose_name = 'Attachment'
        verbose_name_plural = 'Attachments'

    def __str__(self):
        return f"{self.name} ({self.get_file_kind_display()}) [{self.get_scope_display()}]"

    # ── Save hook ────────────────────────────────────────────────────────

    def save(self, *args, **kwargs):
        """Auto-populate file metadata and generate thumbnail for images."""
        if self.file:
            # File size
            if hasattr(self.file, 'size'):
                self.file_size = self.file.size

            # MIME type
            if not self.mime_type:
                import mimetypes
                guessed, _ = mimetypes.guess_type(self.file.name or '')
                self.mime_type = guessed or 'application/octet-stream'

            # Image-specific metadata
            if self.file_kind == 'image':
                try:
                    from PIL import Image
                    img = Image.open(self.file)
                    self.width, self.height = img.size
                    if not self.thumbnail:
                        self._generate_thumbnail(img)
                except Exception:
                    pass  # Not a valid image or Pillow missing

        super().save(*args, **kwargs)

    def _generate_thumbnail(self, pil_image, size=(200, 200)):
        from io import BytesIO
        import sys
        from PIL import Image
        from django.core.files.uploadedfile import InMemoryUploadedFile

        try:
            img = pil_image.copy()
            img.thumbnail(size, Image.Resampling.LANCZOS)
            buf = BytesIO()
            fmt = pil_image.format or 'PNG'
            img.save(buf, format=fmt, quality=85)
            buf.seek(0)
            fname = f"thumb_{os.path.basename(self.file.name)}"
            self.thumbnail.save(
                fname,
                InMemoryUploadedFile(buf, None, fname, self.mime_type, sys.getsizeof(buf), None),
                save=False,
            )
        except Exception:
            pass

    # ── Helpers ──────────────────────────────────────────────────────────

    def get_url(self):
        return self.file.url if self.file else None

    def get_thumbnail_url(self):
        if self.thumbnail:
            return self.thumbnail.url
        return self.get_url()

    # ── Scoped querysets ─────────────────────────────────────────────────

    @classmethod
    def visible_to_user(cls, user, file_kind=None):
        """
        Return a queryset of all attachments the *user* is allowed to see,
        respecting scope rules.

        Includes:
          1. Their own uploads  (scope=user)
          2. Team uploads for any team they belong to
          3. Organization-wide uploads in their org
          4. Document-scoped uploads for documents they own
        """
        try:
            profile = user.profile
            org = profile.organization
        except Exception:
            # No profile → can only see own uploads
            qs = cls.objects.filter(uploaded_by=user)
            if file_kind:
                qs = qs.filter(file_kind=file_kind)
            return qs

        # Team IDs the user belongs to
        team_ids = list(profile.teams.values_list('id', flat=True))

        qs = cls.objects.filter(
            Q(uploaded_by=user) |                                    # own
            Q(scope='organization', organization=org) |             # org-wide
            Q(scope='team', team_id__in=team_ids) |                 # team
            Q(scope='document', document__created_by=user)           # own docs
        ).distinct()

        if file_kind:
            qs = qs.filter(file_kind=file_kind)

        return qs
