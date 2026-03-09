"""
Tests for the doc_create CLM workflow node
==========================================
Covers:
  • template mode      — DocumentDrafter.create_from_template
  • duplicate mode     — _deep_clone_document
  • quick_latex mode   — _clone_quick_latex + new quick-latex
  • structured mode    — DocumentDrafter.create_structured_document
  • serializer config validation
  • API endpoint (doc-create-results)
  • executor skip / fail paths
  • rebuild_extraction_template collects doc_create field_mappings
"""
import uuid

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient, APITestCase

from documents.models import Document, Section, LatexCode
from user_management.models import Organization, Role, UserProfile

from .document_creator_executor import execute_doc_create_node
from .models import (
    DocumentCreationResult,
    NodeConnection,
    Workflow,
    WorkflowDocument,
    WorkflowNode,
)


class DocCreateTestMixin:
    """Common setup for doc_create tests."""

    def setUp(self):
        self.org = Organization.objects.create(name='Test Org')
        self.role = Role.objects.create(
            name='editor', display_name='Editor', role_type='editor',
        )
        self.user = User.objects.create_user(
            username='doctest', password='pass', first_name='Doc', last_name='User',
        )
        UserProfile.objects.create(
            user=self.user, organization=self.org, role=self.role,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Create a workflow with input → doc_create → output
        self.wf = Workflow.objects.create(
            organization=self.org, name='Doc Create WF', created_by=self.user,
        )
        self.input_node = WorkflowNode.objects.create(
            workflow=self.wf, node_type='input', label='Input',
        )
        self.output_node = WorkflowNode.objects.create(
            workflow=self.wf, node_type='output', label='Output',
        )

    def _make_clm_doc(self, title='Test PDF', metadata=None):
        return WorkflowDocument.objects.create(
            workflow=self.wf,
            organization=self.org,
            title=title,
            file=SimpleUploadedFile(f'{title}.pdf', b'fake-pdf-content'),
            extracted_metadata=metadata or {},
            extraction_status='completed',
        )


# ---------------------------------------------------------------------------
# Executor Tests — Template Mode
# ---------------------------------------------------------------------------

class DocCreateTemplateTest(DocCreateTestMixin, TestCase):

    def test_template_mode_creates_document(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Create NDA',
            config={
                'creation_mode': 'template',
                'template_name': 'nda',
                'field_mappings': [
                    {'source_field': 'party_a', 'target_field': 'disclosing_party'},
                    {'source_field': 'party_b', 'target_field': 'receiving_party'},
                    {'source_field': 'law', 'target_field': 'governing_law'},
                ],
            },
        )
        doc = self._make_clm_doc('Contract A', {
            'party_a': 'Acme Corp',
            'party_b': 'Beta Inc',
            'law': 'California',
        })

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['created'], 1)
        self.assertEqual(result['skipped'], 0)
        self.assertEqual(result['failed'], 0)
        self.assertEqual(len(result['created_document_ids']), 1)

        # Verify DocumentCreationResult record
        dcr = DocumentCreationResult.objects.get(node=node, source_clm_document=doc)
        self.assertEqual(dcr.status, 'created')
        self.assertEqual(dcr.creation_mode, 'template')
        self.assertIsNotNone(dcr.created_document)
        self.assertEqual(dcr.created_document.document_type, 'nda')

    def test_template_mode_multiple_documents(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Create Contracts',
            config={
                'creation_mode': 'template',
                'template_name': 'service_agreement',
                'field_mappings': [
                    {'source_field': 'title', 'target_field': 'title'},
                ],
            },
        )
        doc1 = self._make_clm_doc('Doc 1', {'title': 'Agreement 1'})
        doc2 = self._make_clm_doc('Doc 2', {'title': 'Agreement 2'})

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[doc1.id, doc2.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['created'], 2)
        self.assertEqual(DocumentCreationResult.objects.filter(node=node).count(), 2)


# ---------------------------------------------------------------------------
# Executor Tests — Duplicate Mode
# ---------------------------------------------------------------------------

class DocCreateDuplicateTest(DocCreateTestMixin, TestCase):

    def test_duplicate_mode_clones_document(self):
        # Create a source editor document to duplicate
        source_doc = Document.objects.create(
            title='Template Contract',
            document_type='contract',
            category='contract',
            created_by=self.user,
            status='draft',
        )
        Section.objects.create(
            document=source_doc,
            title='Parties',
            content_text='This is the parties section.',
            order=0,
            depth_level=1,
        )

        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Duplicate',
            config={
                'creation_mode': 'duplicate',
                'source_document_id': str(source_doc.id),
                'field_mappings': [
                    {'source_field': 'new_title', 'target_field': 'title'},
                ],
            },
        )
        clm_doc = self._make_clm_doc('Source PDF', {'new_title': 'Cloned Contract'})

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['created'], 1)
        dcr = DocumentCreationResult.objects.get(node=node)
        self.assertEqual(dcr.created_document.title, 'Cloned Contract')
        # Verify structure was cloned
        self.assertTrue(dcr.created_document.sections.exists())

    def test_duplicate_missing_source_fails(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Bad Duplicate',
            config={
                'creation_mode': 'duplicate',
                'source_document_id': str(uuid.uuid4()),  # nonexistent
                'field_mappings': [],
            },
        )
        clm_doc = self._make_clm_doc('Some PDF')

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['created'], 0)


# ---------------------------------------------------------------------------
# Executor Tests — Quick LaTeX Mode
# ---------------------------------------------------------------------------

class DocCreateQuickLatexTest(DocCreateTestMixin, TestCase):

    def test_quick_latex_new_document(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='New LaTeX',
            config={
                'creation_mode': 'quick_latex',
                'latex_code': r'\documentclass{article}\begin{document}Hello\end{document}',
                'topic': 'test document',
                'field_mappings': [
                    {'source_field': 'doc_title', 'target_field': 'title'},
                ],
            },
        )
        clm_doc = self._make_clm_doc('LaTeX Source', {'doc_title': 'My LaTeX Doc'})

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['created'], 1)
        dcr = DocumentCreationResult.objects.get(node=node)
        editor_doc = dcr.created_document
        self.assertEqual(editor_doc.document_mode, 'quick_latex')
        self.assertTrue(editor_doc.is_latex_code)
        self.assertEqual(editor_doc.title, 'My LaTeX Doc')

    def test_quick_latex_clone_existing(self):
        # Create source quick-latex doc
        source = Document.objects.create(
            title='LaTeX Template',
            document_mode='quick_latex',
            is_latex_code=True,
            latex_code=r'\documentclass{article}',
            created_by=self.user,
            status='draft',
        )
        section = Section.objects.create(
            document=source, title='LaTeX Template', content_text='',
            section_type='body', order=0, depth_level=1,
        )
        LatexCode.objects.create(
            section=section,
            latex_code=r'\documentclass{article}\begin{document}Template\end{document}',
            code_type='latex', order=0,
        )

        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Clone LaTeX',
            config={
                'creation_mode': 'quick_latex',
                'source_document_id': str(source.id),
                'field_mappings': [],
            },
        )
        clm_doc = self._make_clm_doc('PDF for LaTeX')

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['created'], 1)
        dcr = DocumentCreationResult.objects.get(node=node)
        self.assertEqual(dcr.created_document.document_mode, 'quick_latex')


# ---------------------------------------------------------------------------
# Executor Tests — Skip / Fail Paths
# ---------------------------------------------------------------------------

class DocCreateEdgeCaseTest(DocCreateTestMixin, TestCase):

    def test_missing_required_fields_skipped(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Strict Node',
            config={
                'creation_mode': 'template',
                'template_name': 'nda',
                'field_mappings': [
                    {'source_field': 'party_name', 'target_field': 'disclosing_party'},
                ],
                'required_fields': ['party_name'],
            },
        )
        # CLM doc WITHOUT the required field
        clm_doc = self._make_clm_doc('Empty PDF', {'other_field': 'value'})

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['skipped'], 1)
        self.assertEqual(result['created'], 0)
        dcr = DocumentCreationResult.objects.get(node=node)
        self.assertEqual(dcr.status, 'skipped')
        self.assertIn('party_name', dcr.missing_fields)

    def test_unknown_creation_mode_returns_error(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Bad Mode',
            config={'creation_mode': 'nonexistent_mode'},
        )
        clm_doc = self._make_clm_doc('PDF')

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        self.assertEqual(result['status'], 'failed')
        self.assertIn('error', result)

    def test_empty_incoming_ids(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='No Docs',
            config={'creation_mode': 'template', 'template_name': 'nda'},
        )

        result = execute_doc_create_node(
            node=node,
            incoming_document_ids=[],
            triggered_by=self.user,
        )

        self.assertEqual(result['created'], 0)
        self.assertEqual(result['total'], 0)


# ---------------------------------------------------------------------------
# Model Tests — rebuild_extraction_template
# ---------------------------------------------------------------------------

class DocCreateTemplateRebuildTest(DocCreateTestMixin, TestCase):

    def test_rebuild_collects_doc_create_source_fields(self):
        WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Creator',
            config={
                'creation_mode': 'template',
                'field_mappings': [
                    {'source_field': 'vendor_name', 'target_field': 'title'},
                    {'source_field': 'contract_amount', 'target_field': 'contract_value'},
                ],
            },
        )
        template, changed = self.wf.rebuild_extraction_template()

        self.assertIn('vendor_name', template)
        self.assertIn('contract_amount', template)


# ---------------------------------------------------------------------------
# Serializer Validation Tests
# ---------------------------------------------------------------------------

class DocCreateSerializerTest(DocCreateTestMixin, APITestCase):

    def test_create_doc_create_node_valid(self):
        resp = self.client.post('/api/clm/nodes/', {
            'workflow': str(self.wf.id),
            'node_type': 'doc_create',
            'label': 'Creator',
            'position_x': 400,
            'position_y': 200,
            'config': {
                'creation_mode': 'template',
                'template_name': 'nda',
                'field_mappings': [
                    {'source_field': 'party_a'},
                ],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['node_type'], 'doc_create')

    def test_invalid_creation_mode_rejected(self):
        resp = self.client.post('/api/clm/nodes/', {
            'workflow': str(self.wf.id),
            'node_type': 'doc_create',
            'label': 'Bad',
            'config': {
                'creation_mode': 'invalid_mode',
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_duplicate_mode_requires_source_document_id(self):
        resp = self.client.post('/api/clm/nodes/', {
            'workflow': str(self.wf.id),
            'node_type': 'doc_create',
            'label': 'Dup',
            'config': {
                'creation_mode': 'duplicate',
                'field_mappings': [],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_structured_mode_requires_sections(self):
        resp = self.client.post('/api/clm/nodes/', {
            'workflow': str(self.wf.id),
            'node_type': 'doc_create',
            'label': 'Struct',
            'config': {
                'creation_mode': 'structured',
                'field_mappings': [],
            },
        }, format='json')
        self.assertEqual(resp.status_code, 400)


# ---------------------------------------------------------------------------
# API Endpoint Tests
# ---------------------------------------------------------------------------

class DocCreateAPITest(DocCreateTestMixin, APITestCase):

    def test_doc_create_results_endpoint(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Creator',
            config={
                'creation_mode': 'template',
                'template_name': 'nda',
                'field_mappings': [],
            },
        )
        clm_doc = self._make_clm_doc('PDF for API test')

        # Execute to create results
        execute_doc_create_node(
            node=node,
            incoming_document_ids=[clm_doc.id],
            triggered_by=self.user,
        )

        resp = self.client.get(f'/api/clm/workflows/{self.wf.id}/doc-create-results/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['status'], 'created')

    def test_doc_create_results_filter_by_status(self):
        node = WorkflowNode.objects.create(
            workflow=self.wf,
            node_type='doc_create',
            label='Creator',
            config={
                'creation_mode': 'template',
                'template_name': 'nda',
                'field_mappings': [{'source_field': 'x'}],
                'required_fields': ['x'],
            },
        )
        doc_ok = self._make_clm_doc('Good', {'x': 'value'})
        doc_bad = self._make_clm_doc('Bad', {})

        execute_doc_create_node(
            node=node,
            incoming_document_ids=[doc_ok.id, doc_bad.id],
            triggered_by=self.user,
        )

        resp = self.client.get(
            f'/api/clm/workflows/{self.wf.id}/doc-create-results/?status=created',
        )
        self.assertEqual(resp.data['count'], 1)

        resp_skip = self.client.get(
            f'/api/clm/workflows/{self.wf.id}/doc-create-results/?status=skipped',
        )
        self.assertEqual(resp_skip.data['count'], 1)
