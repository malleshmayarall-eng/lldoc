from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient
from rest_framework import status

from .models import Share, AccessLog
from user_management.models import Team, Organization, Role, UserProfile
from documents.models import Document


class ShareModelTestCase(TestCase):
    """Test Share model functionality."""
    
    def setUp(self):
        """Set up test data."""
        self.user1 = User.objects.create_user(username='user1', email='user1@test.com')
        self.user2 = User.objects.create_user(username='user2', email='user2@test.com')
        self.team = Team.objects.create(name='Test Team')
        self.team.members.add(self.user1)
        
        # Create test document
        self.document = Document.objects.create(
            title='Test Document',
            created_by=self.user1
        )
        self.content_type = ContentType.objects.get_for_model(Document)
    
    def test_create_user_share(self):
        """Test creating share with user."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='editor',
            share_type='user',
            shared_by=self.user1
        )
        
        self.assertEqual(share.share_type, 'user')
        self.assertEqual(share.role, 'editor')
        self.assertTrue(share.is_active)
        self.assertFalse(share.is_expired())
    
    def test_create_team_share(self):
        """Test creating share with team."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_team=self.team,
            role='viewer',
            share_type='team',
            shared_by=self.user1
        )
        
        self.assertEqual(share.share_type, 'team')
        self.assertEqual(share.shared_with_team, self.team)
    
    def test_external_invitation_token(self):
        """Test external invitation with token generation."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            invitation_email='external@test.com',
            role='viewer',
            share_type='email',
            shared_by=self.user1
        )
        
        # Generate token
        token = share.generate_invitation_token()
        self.assertIsNotNone(token)
        self.assertEqual(len(token), 64)  # token_urlsafe(48) produces 64 chars
        self.assertEqual(share.invitation_token, token)
    
    def test_share_expiration(self):
        """Test share expiration."""
        # Create expired share
        expired_share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1,
            expires_at=timezone.now() - timedelta(days=1)
        )
        
        self.assertTrue(expired_share.is_expired())
        
        # Create non-expired share
        valid_share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1,
            expires_at=timezone.now() + timedelta(days=7)
        )
        
        self.assertFalse(valid_share.is_expired())
    
    def test_can_access_user_share(self):
        """Test can_access method for user share."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        self.assertTrue(share.can_access(user=self.user2))
        self.assertFalse(share.can_access(user=self.user1))
    
    def test_can_access_token(self):
        """Test can_access method with token."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            invitation_email='external@test.com',
            role='viewer',
            share_type='email',
            shared_by=self.user1
        )
        token = share.generate_invitation_token()
        share.save()
        
        self.assertTrue(share.can_access(token=token))
        self.assertFalse(share.can_access(token='invalid-token'))
    
    def test_record_access(self):
        """Test access recording."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        initial_count = share.access_count
        share.record_access()
        
        self.assertEqual(share.access_count, initial_count + 1)
        self.assertIsNotNone(share.last_accessed_at)


class AccessLogModelTestCase(TestCase):
    """Test AccessLog model functionality."""
    
    def setUp(self):
        """Set up test data."""
        self.user = User.objects.create_user(username='testuser', email='test@test.com')
        self.document = Document.objects.create(
            title='Test Document',
            created_by=self.user
        )
        self.content_type = ContentType.objects.get_for_model(Document)
    
    def test_create_access_log(self):
        """Test creating access log."""
        log = AccessLog.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            user=self.user,
            access_type='view',
            ip_address='127.0.0.1',
            success=True
        )
        
        self.assertEqual(log.access_type, 'view')
        self.assertEqual(log.user, self.user)
        self.assertTrue(log.success)
    
    def test_anonymous_access_log(self):
        """Test access log for anonymous user with token."""
        log = AccessLog.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            access_token='test-token-123',
            access_type='view',
            ip_address='192.168.1.1',
            success=True
        )
        
        self.assertIsNone(log.user)
        self.assertEqual(log.access_token, 'test-token-123')


class ShareAPITestCase(TestCase):
    """Test Share API endpoints."""
    
    def setUp(self):
        """Set up test data and client."""
        self.client = APIClient()
        self.organization = Organization.objects.create(name='Acme Corp')
        self.role = Role.objects.create(name='Editor', display_name='Editor', role_type='editor', permissions={})
        self.user1 = User.objects.create_user(username='user1', password='pass123')
        self.user2 = User.objects.create_user(username='user2', email='user2@test.com')
        self.user3 = User.objects.create_user(username='user3', email='user3@test.com')

        self.profile1 = UserProfile.objects.create(user=self.user1, organization=self.organization, role=self.role)
        self.profile2 = UserProfile.objects.create(user=self.user2, organization=self.organization, role=self.role)
        self.profile3 = UserProfile.objects.create(user=self.user3, organization=self.organization, role=self.role)
        
        self.document = Document.objects.create(
            title='Test Document',
            created_by=self.user1
        )
        self.content_type = ContentType.objects.get_for_model(Document)
        
        self.client.force_authenticate(user=self.user1)
    
    def test_create_share_api(self):
        """Test creating share via API."""
        data = {
            'content_type_id': self.content_type.id,
            'object_id': str(self.document.id),
            'shared_with_user_id': self.user2.id,
            'role': 'editor'
        }
        
        response = self.client.post('/api/sharing/shares/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Share.objects.count(), 1)
        
        share = Share.objects.first()
        self.assertEqual(share.shared_with_user, self.user2)
        self.assertEqual(share.role, 'editor')
    
    def test_list_shares_api(self):
        """Test listing shares via API."""
        # Create some shares
        Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        response = self.client.get('/api/sharing/shares/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
    
    def test_update_share_api(self):
        """Test updating share via API."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        data = {'role': 'editor'}
        response = self.client.patch(f'/api/sharing/shares/{share.id}/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_organization_users_endpoint(self):
        """Ensure org user dropdown returns users in same organization."""
        response = self.client.get('/api/sharing/shares/organization-users/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        usernames = {user['username'] for user in response.data}
        self.assertIn('user2', usernames)
        self.assertIn('user3', usernames)
        self.assertNotIn('user1', usernames)
        
        share.refresh_from_db()
        self.assertEqual(share.role, 'editor')
    
    def test_delete_share_api(self):
        """Test deleting (deactivating) share via API."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        response = self.client.delete(f'/api/sharing/shares/{share.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        
        share.refresh_from_db()
        self.assertFalse(share.is_active)
    
    def test_accept_invitation_api(self):
        """Test accepting external invitation via API."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            invitation_email='external@test.com',
            role='viewer',
            share_type='email',
            shared_by=self.user1
        )
        token = share.generate_invitation_token()
        share.save()
        
        # Accept without authentication
        self.client.force_authenticate(user=None)
        
        data = {'token': token}
        response = self.client.post('/api/sharing/shares/accept_invitation/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        share.refresh_from_db()
        self.assertTrue(share.invitation_accepted)
        self.assertIsNotNone(share.invitation_accepted_at)
    
    def test_search_users_api(self):
        """Test user search API."""
        response = self.client.get('/api/sharing/shares/search_users/?q=user')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(len(response.data), 0)
    
    def test_analytics_api(self):
        """Test analytics API."""
        # Create some shares
        Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        response = self.client.get('/api/sharing/shares/analytics/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('total_shares', response.data)
        self.assertIn('active_shares', response.data)


class PermissionTestCase(TestCase):
    """Test permission classes."""
    
    def setUp(self):
        """Set up test data."""
        self.user1 = User.objects.create_user(username='user1')
        self.user2 = User.objects.create_user(username='user2')
        self.document = Document.objects.create(
            title='Test Document',
            created_by=self.user1
        )
        self.content_type = ContentType.objects.get_for_model(Document)
    
    def test_owner_has_access(self):
        """Test that owner has access to content."""
        from .permissions import can_user_access
        
        # Owner should have access
        self.assertTrue(can_user_access(self.user1, self.document))
        
        # Non-owner should not have access
        self.assertFalse(can_user_access(self.user2, self.document))
    
    def test_shared_user_has_access(self):
        """Test that shared user has access."""
        from .permissions import can_user_access
        
        # Create share
        Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        # User2 should now have access
        self.assertTrue(can_user_access(self.user2, self.document))
    
    def test_get_user_role(self):
        """Test getting user role for content."""
        from .permissions import get_user_role
        
        # Owner should have editor role
        self.assertEqual(get_user_role(self.user1, self.document), 'editor')
        
        # Create viewer share
        Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user2,
            role='viewer',
            share_type='user',
            shared_by=self.user1
        )
        
        # User2 should have viewer role
        self.assertEqual(get_user_role(self.user2, self.document), 'viewer')


class EdgeCaseTestCase(TestCase):
    """Test edge cases and error handling."""
    
    def setUp(self):
        """Set up test data."""
        self.user = User.objects.create_user(username='testuser')
        self.document = Document.objects.create(
            title='Test Document',
            created_by=self.user
        )
        self.content_type = ContentType.objects.get_for_model(Document)
    
    def test_expired_share_no_access(self):
        """Test that expired share denies access."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user,
            role='viewer',
            share_type='user',
            shared_by=self.user,
            expires_at=timezone.now() - timedelta(days=1)
        )
        
        from .permissions import can_user_access
        self.assertFalse(can_user_access(self.user, self.document))
    
    def test_inactive_share_no_access(self):
        """Test that inactive share denies access."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            shared_with_user=self.user,
            role='viewer',
            share_type='user',
            shared_by=self.user,
            is_active=False
        )
        
        from .permissions import can_user_access
        self.assertFalse(can_user_access(self.user, self.document))
    
    def test_invalid_token_no_access(self):
        """Test that invalid token denies access."""
        share = Share.objects.create(
            content_type=self.content_type,
            object_id=str(self.document.id),
            invitation_email='test@test.com',
            role='viewer',
            share_type='email',
            shared_by=self.user
        )
        share.generate_invitation_token()
        share.save()
        
        # Try with wrong token
        self.assertFalse(share.can_access(token='wrong-token'))


# Run tests with:
# python manage.py test sharing
