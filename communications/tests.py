"""
alerts/tests.py
"""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .dispatch import send_alert, send_alert_bulk
from .models import Alert, AlertPreference

User = get_user_model()


class SendAlertTests(TestCase):
    """Test the core send_alert() dispatch function."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser', email='test@example.com', password='pass',
        )
        self.actor = User.objects.create_user(
            username='actor', email='actor@example.com', password='pass',
        )

    def test_send_creates_in_app_alert(self):
        alert = send_alert(
            category='workflow.assigned',
            recipient=self.user,
            title='New task',
            message='Please review the NDA.',
            actor=self.actor,
            priority='high',
            target_type='workflow',
            target_id='abc-123',
        )
        self.assertIsInstance(alert, Alert)
        self.assertEqual(alert.recipient, self.user)
        self.assertEqual(alert.category, 'workflow.assigned')
        self.assertEqual(alert.priority, 'high')
        self.assertFalse(alert.is_read)
        self.assertIn('in_app', alert.channels_delivered)

    def test_send_alert_bulk(self):
        user2 = User.objects.create_user(username='u2', password='pass')
        alerts = send_alert_bulk(
            category='document.shared',
            recipients=[self.user, user2],
            title='Shared doc',
        )
        self.assertEqual(len(alerts), 2)
        self.assertEqual(Alert.objects.filter(category='document.shared').count(), 2)

    def test_mark_read(self):
        alert = send_alert(
            category='system.info',
            recipient=self.user,
            title='Hello',
        )
        self.assertFalse(alert.is_read)
        alert.mark_read()
        alert.refresh_from_db()
        self.assertTrue(alert.is_read)
        self.assertIsNotNone(alert.read_at)


class AlertPreferenceTests(TestCase):
    """Test preference-based email routing."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='prefuser', email='pref@example.com', password='pass',
        )

    def test_no_preference_defaults_no_email(self):
        from .dispatch import _should_email
        self.assertFalse(_should_email(self.user, 'workflow.assigned', force=False))

    def test_force_overrides_preference(self):
        from .dispatch import _should_email
        self.assertTrue(_should_email(self.user, 'workflow.assigned', force=True))

    def test_specific_preference_enabled(self):
        from .dispatch import _should_email
        AlertPreference.objects.create(
            user=self.user,
            category='workflow.assigned',
            channel='email',
            enabled=True,
        )
        self.assertTrue(_should_email(self.user, 'workflow.assigned', force=False))

    def test_wildcard_preference(self):
        from .dispatch import _should_email
        AlertPreference.objects.create(
            user=self.user,
            category='*',
            channel='email',
            enabled=True,
        )
        self.assertTrue(_should_email(self.user, 'anything.here', force=False))

    def test_specific_overrides_wildcard(self):
        from .dispatch import _should_email
        AlertPreference.objects.create(
            user=self.user, category='*', channel='email', enabled=True,
        )
        AlertPreference.objects.create(
            user=self.user, category='workflow.assigned', channel='email', enabled=False,
        )
        # Specific opt-out should win
        self.assertFalse(_should_email(self.user, 'workflow.assigned', force=False))
        # Other categories still get the wildcard
        self.assertTrue(_should_email(self.user, 'document.shared', force=False))


class AlertAPITests(TestCase):
    """Test the REST endpoints."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='apiuser', email='api@example.com', password='pass',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Create a few alerts
        for i in range(5):
            send_alert(
                category='system.info',
                recipient=self.user,
                title=f'Alert {i}',
            )

    def test_list_alerts(self):
        resp = self.client.get('/api/alerts/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 5)

    def test_filter_by_is_read(self):
        resp = self.client.get('/api/alerts/', {'is_read': 'false'})
        self.assertEqual(len(resp.data), 5)

    def test_mark_read_single(self):
        alert = Alert.objects.filter(recipient=self.user).first()
        resp = self.client.patch(f'/api/alerts/{alert.id}/read/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['is_read'])

    def test_mark_all_read(self):
        resp = self.client.patch('/api/alerts/read-all/', {}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['marked'], 5)
        self.assertEqual(Alert.objects.filter(recipient=self.user, is_read=False).count(), 0)

    def test_unread_count(self):
        resp = self.client.get('/api/alerts/unread-count/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['unread_count'], 5)

    def test_clear_read(self):
        Alert.objects.filter(recipient=self.user).update(is_read=True)
        resp = self.client.delete('/api/alerts/clear/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Alert.objects.filter(recipient=self.user).count(), 0)

    def test_preferences_crud(self):
        # Create
        resp = self.client.post('/api/alerts/preferences/', {
            'category': 'workflow.assigned',
            'channel': 'email',
            'enabled': True,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        pref_id = resp.data['id']

        # List
        resp = self.client.get('/api/alerts/preferences/')
        self.assertEqual(len(resp.data), 1)

        # Update
        resp = self.client.patch(f'/api/alerts/preferences/{pref_id}/', {
            'enabled': False,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['enabled'])

        # Delete
        resp = self.client.delete(f'/api/alerts/preferences/{pref_id}/')
        self.assertEqual(resp.status_code, 204)

    def test_categories_list(self):
        resp = self.client.get('/api/alerts/preferences/categories/')
        self.assertEqual(resp.status_code, 200)
        keys = [c['key'] for c in resp.data]
        self.assertIn('workflow.assigned', keys)
        self.assertIn('document.shared', keys)
