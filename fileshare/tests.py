from django.core.files.uploadedfile import SimpleUploadedFile
from typing import Any, cast
from django.test import Client
from rest_framework.test import APITestCase
from django.contrib.auth.models import User
from user_management.models import Organization, Role, UserProfile, Team
from django.contrib.contenttypes.models import ContentType
from sharing.models import Share
from fileshare.models import DriveFolder, DriveFile


class FileShareApiTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name='Acme Corp')
        self.role = Role.objects.create(name='Editor', display_name='Editor', role_type='editor', permissions={})
        self.user = User.objects.create_user(username='jane', email='jane@example.com', password='testpass123')
        self.profile = UserProfile.objects.create(user=self.user, organization=self.organization, role=self.role)
        self.team = Team.objects.create(
            name='Litigation',
            organization=self.organization,
            team_lead=self.profile,
            created_by=self.profile,
        )
        self.team.members.add(self.profile)
        self.client = Client()
        self.client.force_login(self.user)

    def test_create_folder_and_upload_file(self):
        folder_response = self.client.post('/api/fileshare/folders/', {
            'name': 'Contracts',
            'description': 'Client contracts'
        })
        self.assertEqual(folder_response.status_code, 201)
        folder_payload = cast(dict[str, Any], folder_response.json())
        folder_id = str(folder_payload['id'])

        upload = SimpleUploadedFile('sample.txt', b'Hello world', content_type='text/plain')
        folder = DriveFolder.objects.get(id=folder_id)
        drive_file = DriveFile.objects.create(
            name='sample.txt',
            owner=self.user,
            organization=self.organization,
            folder=folder,
            file=upload,
        )

        list_response = self.client.get('/api/fileshare/files/')
        self.assertEqual(list_response.status_code, 200)
        list_payload = cast(list[dict[str, Any]], list_response.json())
        self.assertEqual(len(list_payload), 1)
        self.assertEqual(list_payload[0]['name'], 'sample.txt')

        self.assertEqual(drive_file.folder, folder)

        download_response = self.client.get(f"/api/fileshare/files/{drive_file.id}/download/")
        self.assertEqual(download_response.status_code, 200)

    def test_shared_file_visible_to_recipient(self):
        recipient = User.objects.create_user(username='alex', email='alex@example.com', password='testpass123')
        UserProfile.objects.create(user=recipient, organization=self.organization, role=self.role)

        upload = SimpleUploadedFile('shared.txt', b'Shared content', content_type='text/plain')
        drive_file = DriveFile.objects.create(
            name='shared.txt',
            owner=self.user,
            organization=self.organization,
            file=upload,
        )

        content_type = ContentType.objects.get_for_model(DriveFile)
        Share.objects.create(
            content_type=content_type,
            object_id=str(drive_file.id),
            shared_with_user=recipient,
            role='viewer',
            share_type='user',
            shared_by=self.user,
        )

        self.client.force_login(recipient)
        response = self.client.get('/api/fileshare/files/')
        self.assertEqual(response.status_code, 200)
        payload = cast(list[dict[str, Any]], response.json())
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]['id'], str(drive_file.id))

        shared_only_response = self.client.get('/api/fileshare/files/?shared_only=true')
        self.assertEqual(shared_only_response.status_code, 200)
        shared_payload = cast(list[dict[str, Any]], shared_only_response.json())
        self.assertEqual(len(shared_payload), 1)
        self.assertEqual(shared_payload[0]['id'], str(drive_file.id))

    def test_access_list_endpoint(self):
        upload = SimpleUploadedFile('access.txt', b'Access content', content_type='text/plain')
        drive_file = DriveFile.objects.create(
            name='access.txt',
            owner=self.user,
            organization=self.organization,
            file=upload,
        )

        response = self.client.get(f"/api/fileshare/files/{drive_file.id}/access-list/")
        self.assertEqual(response.status_code, 200)
        payload = cast(dict[str, Any], response.json())
        self.assertIn('owner', payload)

    def test_roots_endpoint(self):
        response = self.client.get('/api/fileshare/folders/roots/')
        self.assertEqual(response.status_code, 200)
        payload = cast(dict[str, Any], response.json())
        self.assertIn('personal', payload)
        self.assertIn('shared', payload)
        self.assertIn('organization', payload)
        self.assertIn('teams', payload)
        self.assertEqual(len(payload['teams']), 1)

    def test_favorites_flow(self):
        folder = DriveFolder.objects.create(
            name='Favorites',
            owner=self.user,
            organization=self.organization,
        )
        content_types = self.client.get('/api/fileshare/files/content_types/').json()
        folder_type_id = content_types['drive_folder']

        create_response = self.client.post('/api/fileshare/favorites/', {
            'content_type_id': folder_type_id,
            'object_id': str(folder.id),
        })
        self.assertIn(create_response.status_code, (200, 201))

        list_response = self.client.get('/api/fileshare/favorites/')
        self.assertEqual(list_response.status_code, 200)
        favorites_payload = cast(dict[str, Any], list_response.json())
        self.assertEqual(len(favorites_payload['folders']), 1)
