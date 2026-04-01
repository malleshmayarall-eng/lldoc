# communications — Production notification & alert system for the entire platform.
#
# Single entry-point:
#   from communications.dispatch import send_alert
#   send_alert('workflow.assigned', recipient=user, title='...', message='...')
#
# Bulk:
#   from communications.dispatch import send_alert_bulk
#   send_alert_bulk('document.shared', recipients=[u1, u2], title='...')
#
# Stats:
#   from communications.dispatch import get_notification_stats
#   stats = get_notification_stats(user)
#
# Features:
#   - Multi-channel: in-app (sync) + email (async) + webhook (async)
#   - Deduplication: prevents duplicate alerts within 5min window
#   - Rate limiting: 20 alerts/user/category/minute
#   - Digest batching: hourly/daily/weekly email summaries
#   - WebSocket push: real-time via Django Channels
#   - Retry with backoff: failed deliveries auto-retry up to 3×
#   - Quiet hours: respect user DND preferences
#   - Auto-cleanup: expired & old alerts pruned by Celery Beat
