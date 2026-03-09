from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Document, Section, Paragraph, Table, DocumentFile, HeaderFooterTemplate


class PartialSaveDocumentTests(TestCase):
	def setUp(self):
		self.user = User.objects.create_user(username='editor', password='pass1234')
		self.client = APIClient()
		self.client.force_authenticate(user=self.user)

		self.document = Document.objects.create(
			raw_text='Initial text',
			current_text='Initial text',
			title='Test Doc',
			created_by=self.user
		)
		self.section = Section.objects.create(
			document=self.document,
			title='Section 1',
			content_text='Section content',
			order=0,
			depth_level=0,
			modified_by=self.user
		)
		self.paragraph = Paragraph.objects.create(
			section=self.section,
			content_text='Paragraph content',
			order=0,
			modified_by=self.user
		)

	def test_partial_save_updates_section(self):
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'section',
					'op': 'update',
					'id': str(self.section.id),
					'base_version': self.section.version,
					'data': {
						'title': 'Section Updated',
						'content': 'Edited section text',
					}
				}
			]
		}

		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)

		self.section.refresh_from_db()
		self.assertEqual(self.section.title, 'Section Updated')
		self.assertTrue(self.section.has_edits)

		updated_items = response.data['updated']
		self.assertEqual(len(updated_items), 1)
		self.assertEqual(str(updated_items[0]['id']), str(self.section.id))

	def test_partial_save_paragraph_conflict(self):
		url = f'/api/documents/{self.document.id}/partial-save/'
		stale_time = self.paragraph.last_modified - timedelta(minutes=1)
		payload = {
			'changes': [
				{
					'type': 'paragraph',
					'op': 'update',
					'id': str(self.paragraph.id),
					'base_last_modified': stale_time.isoformat(),
					'data': {
						'content': 'Edited paragraph text',
					}
				}
			]
		}

		response = self.client.post(url, payload, format='json')
		# Should return 409 because base_last_modified is before actual last_modified
		self.assertEqual(response.status_code, 409)
		self.assertTrue(response.data['conflicts'])

	def test_partial_save_table_update(self):
		table = Table.objects.create(
			section=self.section,
			title='Table 1',
			num_columns=2,
			num_rows=1,
			table_data=[{'row_id': 'r1', 'cells': {'col1': 'A', 'col2': 'B'}}],
			order=0,
			modified_by=self.user
		)
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'table',
					'op': 'update',
					'id': str(table.id),
					'base_last_modified': table.last_modified.isoformat(),
					'data': {
						'table_data': [{'row_id': 'r1', 'cells': {'col1': 'X', 'col2': 'Y'}}],
					}
				}
			]
		}

		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.data['updated'])

	def test_partial_save_table_caption_via_title(self):
		"""Backend accepts 'title' as the caption field."""
		table = Table.objects.create(
			section=self.section,
			title='Old Caption',
			num_columns=1,
			num_rows=1,
			table_data=[{'row_id': 'r1', 'cells': {'col1': 'A'}}],
			order=1,
			modified_by=self.user,
		)
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'table',
					'op': 'update',
					'id': str(table.id),
					'data': {'title': 'New Caption'},
				}
			]
		}
		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)
		table.refresh_from_db()
		self.assertEqual(table.title, 'New Caption')

	def test_partial_save_table_caption_via_caption_alias(self):
		"""Backend accepts 'caption' as an alias for the title field."""
		table = Table.objects.create(
			section=self.section,
			title='Old Caption',
			num_columns=1,
			num_rows=1,
			table_data=[{'row_id': 'r1', 'cells': {'col1': 'A'}}],
			order=2,
			modified_by=self.user,
		)
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'table',
					'op': 'update',
					'id': str(table.id),
					'data': {'caption': 'Caption Via Alias'},
				}
			]
		}
		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)
		table.refresh_from_db()
		self.assertEqual(table.title, 'Caption Via Alias')

	def test_partial_save_updates_document_title_via_change_envelope(self):
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'document',
					'op': 'update',
					'id': str(self.document.id),
					'data': {
						'title': 'Updated Doc Title'
					}
				}
			]
		}

		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)

		self.document.refresh_from_db()
		self.assertEqual(self.document.title, 'Updated Doc Title')

		updated_items = response.data['updated']
		self.assertEqual(len(updated_items), 1)
		self.assertEqual(updated_items[0]['type'], 'document')
		self.assertEqual(updated_items[0]['id'], str(self.document.id))
		self.assertEqual(updated_items[0]['data']['title'], 'Updated Doc Title')

	def test_partial_save_creates_section(self):
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'section',
					'op': 'create',
					'data': {
						'title': 'Brand New Section',
						'section_type': 'clause',
						'order': 1,
					}
				}
			]
		}

		before_count = Section.objects.filter(document=self.document).count()
		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)

		after_count = Section.objects.filter(document=self.document).count()
		self.assertEqual(after_count, before_count + 1, 'Exactly one section should be created')

		updated_items = response.data['updated']
		self.assertEqual(len(updated_items), 1)
		self.assertEqual(updated_items[0]['type'], 'section')
		self.assertIn('id', updated_items[0])
		self.assertEqual(updated_items[0]['data']['title'], 'Brand New Section')

	def test_partial_save_deletes_section(self):
		extra_section = Section.objects.create(
			document=self.document,
			title='To Be Deleted',
			content_text='',
			order=1,
			depth_level=0,
			modified_by=self.user,
		)
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'section',
					'op': 'delete',
					'id': str(extra_section.id),
				}
			]
		}

		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)

		deleted_items = response.data['deleted']
		self.assertEqual(len(deleted_items), 1)
		self.assertEqual(str(deleted_items[0]['id']), str(extra_section.id))
		self.assertFalse(Section.objects.filter(id=extra_section.id).exists())

	def test_partial_save_creates_paragraph(self):
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'paragraph',
					'op': 'create',
					'data': {
						'section_id': str(self.section.id),
						'content': 'New paragraph content',
						'order': 1,
					}
				}
			]
		}

		before_count = Paragraph.objects.filter(section=self.section).count()
		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 200)

		after_count = Paragraph.objects.filter(section=self.section).count()
		self.assertEqual(after_count, before_count + 1, 'Exactly one paragraph should be created')

		updated_items = response.data['updated']
		self.assertEqual(len(updated_items), 1)
		self.assertEqual(updated_items[0]['type'], 'paragraph')
		self.assertIn('id', updated_items[0])

	def test_partial_save_document_create_rejected(self):
		"""document type does not support op=create."""
		url = f'/api/documents/{self.document.id}/partial-save/'
		payload = {
			'changes': [
				{
					'type': 'document',
					'op': 'create',
					'data': {'title': 'Should Fail'},
				}
			]
		}

		response = self.client.post(url, payload, format='json')
		self.assertEqual(response.status_code, 400)


class HeaderPdfSettingsTests(TestCase):
	def setUp(self):
		self.user = User.objects.create_user(username='header-user', password='pass1234')
		self.client = APIClient()
		self.client.force_authenticate(user=self.user)

		self.document = Document.objects.create(
			raw_text='Header PDF test',
			current_text='Header PDF test',
			title='Header PDF Doc',
			created_by=self.user
		)

		pdf_bytes = (
			b"%PDF-1.4\n"
			b"1 0 obj<<>>endobj\n"
			b"xref\n0 1\n0000000000 65535 f\n"
			b"trailer<<>>\n%%EOF"
		)
		self.header_pdf = DocumentFile.objects.create(
			file=SimpleUploadedFile("letterhead.pdf", pdf_bytes, content_type="application/pdf"),
			name="Letterhead",
			file_type="pdf",
			access_level="user",
			uploaded_by=self.user,
		)

	def test_header_pdf_settings_saved(self):
		header_template = HeaderFooterTemplate.objects.create(
			name='Default Header',
			template_type='header',
			config={'text': {'left': 'Sample'}, 'style': {'height': '40px'}},
			created_by=self.user,
		)
		self.document.header_template = header_template
		self.document.header_config = {'text': {'left': 'Override'}}
		self.document.save(update_fields=['header_template', 'header_config'])

		url = f'/api/documents/{self.document.id}/header-footer/'
		payload = {
			'header_pdf': {
				'file_id': str(self.header_pdf.id),
				'height': '120mm',
				'page': 1,
				'show_on_first_page': True,
				'show_on_all_pages': False,
			}
		}

		response = self.client.patch(url, payload, format='json')
		self.assertEqual(response.status_code, 200)
		self.document.refresh_from_db()
		processing_settings = self.document.custom_metadata.get('processing_settings', {})
		self.assertIn('header_pdf', processing_settings)
		self.assertEqual(
			processing_settings['header_pdf']['file_id'],
			str(self.header_pdf.id)
		)
		self.assertIsNone(self.document.header_template)
		self.assertEqual(self.document.header_config, {})
