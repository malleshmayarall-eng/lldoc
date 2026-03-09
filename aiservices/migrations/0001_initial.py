import uuid
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("documents", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AIInteraction",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("interaction_type", models.CharField(choices=[("analysis", "Analysis"), ("summary", "Summary"), ("rewrite", "Rewrite"), ("qa", "Q&A"), ("other", "Other")], default="analysis", max_length=30)),
                ("model_name", models.CharField(default="gpt", max_length=100)),
                ("prompt", models.TextField()),
                ("response", models.TextField(blank=True, null=True)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("completed", "Completed"), ("failed", "Failed")], default="pending", max_length=20)),
                ("error_message", models.TextField(blank=True, null=True)),
                ("tokens_in", models.IntegerField(default=0)),
                ("tokens_out", models.IntegerField(default=0)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="ai_interactions", to="documents.document")),
                ("requested_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["document", "-created_at"], name="aiservices__documen_b76302_idx"),
                    models.Index(fields=["status"], name="aiservices__status_0bb947_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="DocumentAnalysisRun",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("analysis_type", models.CharField(choices=[("risk", "Risk"), ("summary", "Summary"), ("quality", "Quality"), ("compliance", "Compliance"), ("custom", "Custom")], default="summary", max_length=30)),
                ("model_name", models.CharField(default="gpt", max_length=100)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")], default="pending", max_length=20)),
                ("result", models.JSONField(blank=True, default=dict)),
                ("error_message", models.TextField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("document", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="analysis_runs", to="documents.document")),
                ("requested_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["document", "-created_at"], name="aiservices__documen_9c9f6b_idx"),
                    models.Index(fields=["status"], name="aiservices__status_cdd8ad_idx"),
                ],
            },
        ),
    ]
