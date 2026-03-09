# 0002 — Add viewer_token FK to WorkflowDecisionStep (deferred to break circular dep)

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('documents', '0001_initial'),
        ('viewer', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflowdecisionstep',
            name='viewer_token',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='decision_steps',
                to='viewer.viewertoken',
            ),
        ),
    ]
