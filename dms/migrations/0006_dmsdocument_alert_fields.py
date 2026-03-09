from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("dms", "0005_dmsdocument_structured_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="dmsdocument",
            name="auto_renewal_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="renewal_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="renewal_decision_required",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="renewed_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="termination_initiated_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="termination_notice_start_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="deletion_eligible_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="deletion_scheduled_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="compliance_review_due_date",
            field=models.DateField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="audit_log_generated_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="dmsdocument",
            name="verification_retention_end_date",
            field=models.DateField(null=True, blank=True),
        ),
    ]
