"""
CLM Tests — Simplified Workflow System
=======================================
Tests for models, node executor, and API endpoints.
"""
import json
import uuid
from unittest.mock import patch, MagicMock

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient, APITestCase

from user_management.models import Organization, Role, UserProfile

from .models import NodeConnection, Workflow, WorkflowDocument, WorkflowNode
from .node_executor import _eval_condition, execute_workflow


class CLMTestMixin:
    """Common setup for CLM tests."""

    def setUp(self):
        self.org = Organization.objects.create(name='Test Org')
        self.role = Role.objects.create(
            name='editor', display_name='Editor', role_type='editor',
        )
        self.user = User.objects.create_user(username='testuser', password='pass')
        UserProfile.objects.create(
            user=self.user, organization=self.org, role=self.role,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)


# ---------------------------------------------------------------------------
# Model Tests
# ---------------------------------------------------------------------------

class WorkflowModelTest(CLMTestMixin, TestCase):

    def test_create_workflow(self):
        wf = Workflow.objects.create(
            organization=self.org, name='Test WF', created_by=self.user,
        )
        self.assertEqual(str(wf), 'Test WF')
        self.assertTrue(wf.is_active)

    def test_rebuild_extraction_template(self):
        wf = Workflow.objects.create(
            organization=self.org, name='Template WF',
        )
        WorkflowNode.objects.create(
            workflow=wf, node_type='rule', label='Rule 1',
            config={
                'boolean_operator': 'AND',
                'conditions': [
                    {'field': 'contract_value', 'operator': 'gt', 'value': '50000'},
                    {'field': 'jurisdiction', 'operator': 'contains', 'value': 'US'},
                ],
            },
        )
        WorkflowNode.objects.create(
            workflow=wf, node_type='rule', label='Rule 2',
            config={
                'conditions': [
                    {'field': 'vendor_name', 'operator': 'eq', 'value': 'Acme'},
                ],
            },
        )
        template, changed_fields = wf.rebuild_extraction_template()
        self.assertEqual(
            template,
            {'contract_value': '', 'jurisdiction': '', 'vendor_name': ''},
        )

    def test_node_connection_unique(self):
        wf = Workflow.objects.create(organization=self.org, name='WF')
        n1 = WorkflowNode.objects.create(workflow=wf, node_type='input')
        n2 = WorkflowNode.objects.create(workflow=wf, node_type='output')
        NodeConnection.objects.create(
            workflow=wf, source_node=n1, target_node=n2,
        )
        with self.assertRaises(Exception):
            NodeConnection.objects.create(
                workflow=wf, source_node=n1, target_node=n2,
            )


# ---------------------------------------------------------------------------
# Condition Evaluation Tests
# ---------------------------------------------------------------------------

class ConditionEvalTest(TestCase):

    def test_eq(self):
        self.assertTrue(_eval_condition({'name': 'Acme'}, 'name', 'eq', 'acme'))

    def test_gt_numeric(self):
        self.assertTrue(_eval_condition({'value': '100000'}, 'value', 'gt', '50000'))

    def test_lt_numeric(self):
        self.assertTrue(_eval_condition({'value': '10'}, 'value', 'lt', '50'))

    def test_contains(self):
        self.assertTrue(_eval_condition(
            {'jurisdiction': 'United States'}, 'jurisdiction', 'contains', 'united',
        ))

    def test_not_contains(self):
        self.assertTrue(_eval_condition(
            {'jurisdiction': 'UK'}, 'jurisdiction', 'not_contains', 'US',
        ))

    def test_missing_field(self):
        self.assertFalse(_eval_condition({}, 'missing', 'eq', 'x'))

    def test_nested_field(self):
        self.assertTrue(_eval_condition(
            {'clause': {'type': 'indemnity'}}, 'clause.type', 'eq', 'indemnity',
        ))


# ---------------------------------------------------------------------------
# API Tests
# ---------------------------------------------------------------------------

class WorkflowAPITest(CLMTestMixin, APITestCase):

    def test_create_workflow(self):
        resp = self.client.post('/api/clm/workflows/', {
            'name': 'New WF',
            'description': 'Test',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['name'], 'New WF')

    def test_list_workflows(self):
        Workflow.objects.create(organization=self.org, name='WF1')
        Workflow.objects.create(organization=self.org, name='WF2')
        resp = self.client.get('/api/clm/workflows/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_create_node(self):
        wf = Workflow.objects.create(organization=self.org, name='WF')
        resp = self.client.post('/api/clm/nodes/', {
            'workflow': str(wf.id),
            'node_type': 'input',
            'label': 'Upload',
            'position_x': 100,
            'position_y': 200,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['node_type'], 'input')

    def test_create_rule_node_rebuilds_template(self):
        wf = Workflow.objects.create(organization=self.org, name='WF')
        self.client.post('/api/clm/nodes/', {
            'workflow': str(wf.id),
            'node_type': 'rule',
            'label': 'Filter',
            'config': {
                'boolean_operator': 'AND',
                'conditions': [
                    {'field': 'amount', 'operator': 'gt', 'value': '1000'},
                ],
            },
        }, format='json')
        wf.refresh_from_db()
        self.assertIn('amount', wf.extraction_template)

    def test_create_connection(self):
        wf = Workflow.objects.create(organization=self.org, name='WF')
        n1 = WorkflowNode.objects.create(workflow=wf, node_type='input')
        n2 = WorkflowNode.objects.create(workflow=wf, node_type='output')
        resp = self.client.post('/api/clm/connections/', {
            'workflow': str(wf.id),
            'source_node': str(n1.id),
            'target_node': str(n2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_duplicate_workflow(self):
        wf = Workflow.objects.create(organization=self.org, name='Original')
        WorkflowNode.objects.create(workflow=wf, node_type='input')
        resp = self.client.post(f'/api/clm/workflows/{wf.id}/duplicate/')
        self.assertEqual(resp.status_code, 201)
        self.assertIn('(Copy)', resp.data['name'])

    def test_rebuild_template_action(self):
        wf = Workflow.objects.create(organization=self.org, name='WF')
        WorkflowNode.objects.create(
            workflow=wf, node_type='rule',
            config={'conditions': [{'field': 'price', 'operator': 'gt', 'value': '0'}]},
        )
        resp = self.client.post(f'/api/clm/workflows/{wf.id}/rebuild-template/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('price', resp.data['extraction_template'])


# ---------------------------------------------------------------------------
# Executor Tests
# ---------------------------------------------------------------------------

class WorkflowExecutorTest(CLMTestMixin, TestCase):

    def _build_workflow(self):
        """Create a simple Input → Rule → Output workflow."""
        wf = Workflow.objects.create(
            organization=self.org, name='Exec WF',
        )
        inp = WorkflowNode.objects.create(
            workflow=wf, node_type='input', label='Input',
        )
        rule = WorkflowNode.objects.create(
            workflow=wf, node_type='rule', label='Filter',
            config={
                'boolean_operator': 'AND',
                'conditions': [
                    {'field': 'amount', 'operator': 'gt', 'value': '50000'},
                ],
            },
        )
        out = WorkflowNode.objects.create(
            workflow=wf, node_type='output', label='Results',
        )
        NodeConnection.objects.create(
            workflow=wf, source_node=inp, target_node=rule,
        )
        NodeConnection.objects.create(
            workflow=wf, source_node=rule, target_node=out,
        )
        wf.rebuild_extraction_template()
        return wf

    def test_execute_filters_documents(self):
        wf = self._build_workflow()

        # Create documents with extraction completed
        doc1 = WorkflowDocument.objects.create(
            workflow=wf, organization=self.org, title='Big Contract',
            file=SimpleUploadedFile('big.pdf', b'content'),
            extracted_metadata={'amount': '100000'},
            extraction_status='completed',
        )
        doc2 = WorkflowDocument.objects.create(
            workflow=wf, organization=self.org, title='Small Contract',
            file=SimpleUploadedFile('small.pdf', b'content'),
            extracted_metadata={'amount': '5000'},
            extraction_status='completed',
        )

        result = execute_workflow(wf)

        # Output should only contain doc1
        output_ids = [
            r['document_ids']
            for r in result['node_results']
            if r['node_type'] == 'output'
        ][0]
        self.assertEqual(len(output_ids), 1)
        self.assertEqual(output_ids[0], str(doc1.id))

    def test_execute_empty_workflow(self):
        wf = Workflow.objects.create(organization=self.org, name='Empty')
        result = execute_workflow(wf)
        self.assertEqual(result['node_results'], [])
