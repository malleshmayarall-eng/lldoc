from __future__ import annotations

import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="DmsDocument",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("title", models.CharField(max_length=255, blank=True)),
                ("original_filename", models.CharField(max_length=255, blank=True)),
                ("content_type", models.CharField(max_length=128, blank=True)),
                ("pdf_data", models.BinaryField()),
                ("file_size", models.PositiveIntegerField(default=0)),
                ("metadata", models.JSONField(default=dict, blank=True)),
                ("metadata_index", models.TextField(blank=True, db_index=True)),
                ("extracted_text", models.TextField(blank=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        to=settings.AUTH_USER_MODEL,
                        on_delete=django.db.models.deletion.SET_NULL,
                        null=True,
                        blank=True,
                        related_name="dms_documents",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="dmsdocument",
            index=models.Index(fields=["-created_at"], name="dms_docum_created_8aa8bb_idx"),
        ),
        migrations.AddIndex(
            model_name="dmsdocument",
            index=models.Index(fields=["title"], name="dms_docum_title_0f6ac0_idx"),
        ),
        migrations.AddIndex(
            model_name="dmsdocument",
            index=models.Index(fields=["content_type"], name="dms_docum_content_6b8f0a_idx"),
        ),
    ]
