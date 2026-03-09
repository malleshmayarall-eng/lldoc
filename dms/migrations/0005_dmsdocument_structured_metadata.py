from __future__ import annotations

import json

from django.db import migrations, models
import django.db.models.deletion


def forwards(apps, schema_editor):
    DmsDocument = apps.get_model("dms", "DmsDocument")
    for doc in DmsDocument.objects.all().iterator():
        raw = getattr(doc, "extracted_pdf", None) or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raw = {}
        updates = {
            "extracted_pdf_title": raw.get("title", ""),
            "extracted_pdf_author": raw.get("author", ""),
            "extracted_pdf_subject": raw.get("subject", ""),
            "extracted_pdf_creator": raw.get("creator", ""),
            "extracted_pdf_producer": raw.get("producer", ""),
            "extracted_pdf_keywords": raw.get("keywords", ""),
            "extracted_pdf_page_count": raw.get("page_count"),
            "extracted_pdf_raw_metadata": json.dumps(raw.get("raw_metadata") or {}),
        }
        DmsDocument.objects.filter(pk=doc.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ("dms", "0004_dmsdocument_extracted_pdf_backfill"),
    ]

    operations = [
        migrations.CreateModel(
            name="DmsSignatory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255, blank=True)),
                ("role", models.CharField(max_length=255, blank=True)),
                ("organization", models.CharField(max_length=255, blank=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="signatories",
                        to="dms.dmsdocument",
                    ),
                ),
            ],
        ),
        migrations.RemoveField(
            model_name="dmsdocument",
            name="extracted_pdf",
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_title",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_author",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_subject",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_creator",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_producer",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_keywords",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_page_count",
            field=models.IntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf_raw_metadata",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="document_id",
            field=models.CharField(max_length=100, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="document_name",
            field=models.CharField(max_length=255, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="document_type",
            field=models.CharField(max_length=50, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="category",
            field=models.CharField(max_length=100, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="status",
            field=models.CharField(max_length=50, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="uploaded_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="signed_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="effective_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="expiration_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="termination_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="archived_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="signing_is_signed",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="signature_type",
            field=models.CharField(max_length=20, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="compliance_jurisdiction",
            field=models.CharField(max_length=100, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="compliance_retention_end_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="compliance_legal_hold",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="notes",
            field=models.TextField(blank=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
