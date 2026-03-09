from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("dms", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="dmsdocument",
            name="search_index",
            field=models.TextField(blank=True, db_index=True),
        ),
    ]
