"""
Viewer App — Tests
"""

from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status
from datetime import timedelta
from django.utils import timezone

from documents.models import Document
from .models import ViewerToken, ViewerOTP, ViewerSession


class ViewerTokenTestCase(TestCase):
    """Test ViewerToken model."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='owner', email='owner@test.com', password='pass123'
        )
        self.doc = Document.objects.create(
            title='Test Doc',
            raw_text='Hello world',
            created_by=self.user,
        )

    def test_create_public_token(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='public',
            created_by=self.user,
        )
        self.assertTrue(vt.token)
        self.assertTrue(vt.can_access())
        self.assertEqual(vt.allowed_actions, ['view'])

    def test_expired_token(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='public',
            expires_at=timezone.now() - timedelta(hours=1),
            created_by=self.user,
        )
        self.assertFalse(vt.can_access())

    def test_max_access_limit(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='public',
            max_access_count=2,
            created_by=self.user,
        )
        vt.access_count = 2
        vt.save()
        self.assertFalse(vt.can_access())

    def test_password_protection(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='public',
            created_by=self.user,
        )
        vt.set_password('secret123')
        vt.save()
        self.assertTrue(vt.check_password('secret123'))
        self.assertFalse(vt.check_password('wrong'))


class ViewerAPITestCase(TestCase):
    """Test viewer API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='owner', email='owner@test.com', password='pass123'
        )
        self.doc = Document.objects.create(
            title='Test Doc',
            raw_text='Hello world',
            created_by=self.user,
        )
        self.client.force_authenticate(user=self.user)

    def test_create_public_token(self):
        resp = self.client.post('/api/viewer/tokens/', {
            'document_id': str(self.doc.id),
            'access_mode': 'public',
            'allowed_actions': ['view', 'ai_chat'],
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn('token', resp.data)
        self.assertEqual(resp.data['access_mode'], 'public')

    def test_create_email_otp_token(self):
        resp = self.client.post('/api/viewer/tokens/', {
            'document_id': str(self.doc.id),
            'access_mode': 'email_otp',
            'recipient_email': 'viewer@test.com',
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_create_email_otp_without_email_fails(self):
        resp = self.client.post('/api/viewer/tokens/', {
            'document_id': str(self.doc.id),
            'access_mode': 'email_otp',
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_tokens(self):
        ViewerToken.objects.create(
            document=self.doc, access_mode='public', created_by=self.user,
        )
        resp = self.client.get('/api/viewer/tokens/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(len(resp.data) >= 1)

    def test_resolve_public_token(self):
        vt = ViewerToken.objects.create(
            document=self.doc, access_mode='public', created_by=self.user,
        )
        # Resolve is public — no auth needed
        self.client.logout()
        resp = self.client.get(f'/api/viewer/resolve/{vt.token}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['valid'])
        self.assertEqual(resp.data['access_mode'], 'public')
        self.assertFalse(resp.data['requires_otp'])

    def test_resolve_expired_token(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='public',
            expires_at=timezone.now() - timedelta(hours=1),
            created_by=self.user,
        )
        self.client.logout()
        resp = self.client.get(f'/api/viewer/resolve/{vt.token}/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_revoke_token(self):
        vt = ViewerToken.objects.create(
            document=self.doc, access_mode='public', created_by=self.user,
        )
        resp = self.client.delete(f'/api/viewer/tokens/{vt.id}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        vt.refresh_from_db()
        self.assertFalse(vt.is_active)

    def test_tokens_by_document(self):
        ViewerToken.objects.create(
            document=self.doc, access_mode='public', created_by=self.user,
        )
        resp = self.client.get(f'/api/viewer/tokens/by-document/{self.doc.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(len(resp.data) >= 1)


class ViewerSessionTestCase(TestCase):
    """Test viewer session creation and auto-linking."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='owner', email='owner@test.com', password='pass123'
        )
        self.existing = User.objects.create_user(
            username='existing', email='existing@test.com', password='pass123'
        )
        self.doc = Document.objects.create(
            title='Test Doc', raw_text='Hello', created_by=self.user,
        )

    def test_session_auto_links_user(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='email_otp',
            recipient_email='existing@test.com',
            created_by=self.user,
        )
        session = ViewerSession(
            viewer_token=vt,
            email='existing@test.com',
            expires_at=timezone.now() + timedelta(hours=24),
        )
        session.save()
        self.assertEqual(session.user, self.existing)

    def test_session_no_user_for_unknown_email(self):
        vt = ViewerToken.objects.create(
            document=self.doc,
            access_mode='email_otp',
            recipient_email='unknown@test.com',
            created_by=self.user,
        )
        session = ViewerSession(
            viewer_token=vt,
            email='unknown@test.com',
            expires_at=timezone.now() + timedelta(hours=24),
        )
        session.save()
        self.assertIsNone(session.user)
