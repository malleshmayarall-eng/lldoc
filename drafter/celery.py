"""
Celery application for the Drafter backend.

Start the worker:
    celery -A drafter worker -l info

Start the beat scheduler (periodic tasks):
    celery -A drafter beat -l info

Or combined (dev only):
    celery -A drafter worker -B -l info
"""
import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'drafter.settings')

app = Celery('drafter')

# Read config from Django settings, CELERY_ namespace
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks.py in all installed apps
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
