from __future__ import annotations

from django.db import migrations, models


def forwards(apps, schema_editor):
    DmsDocument = apps.get_model("dms", "DmsDocument")
    for doc in DmsDocument.objects.all().iterator():
        meta = (doc.metadata_index or "").strip()
        text = (doc.extracted_text or "").strip()
        combined = " ".join([value for value in (meta, text) if value])
        DmsDocument.objects.filter(pk=doc.pk).update(search_index=combined)


class Migration(migrations.Migration):
    dependencies = [
        ("dms", "0003_rename_dms_docum_created_8aa8bb_idx_dms_dmsdocu_created_6e626e_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="dmsdocument",
            name="extracted_pdf",
            field=models.JSONField(default=dict, blank=True),
        ),
        migrations.AlterField(
            model_name="dmsdocument",
            name="search_index",
            field=models.TextField(default="", blank=True, db_index=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
