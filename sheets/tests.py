from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from user_management.models import Organization, UserProfile
from .models import Sheet, SheetRow, SheetCell, FormulaEngine

User = get_user_model()


class SheetsTestMixin:
    def setUp(self):
        self.org = Organization.objects.create(name='Test Org')
        self.user = User.objects.create_user(username='testuser', password='testpass')
        self.profile = UserProfile.objects.create(user=self.user, organization=self.org)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)


class SheetModelTests(SheetsTestMixin, TestCase):
    def test_create_sheet(self):
        sheet = Sheet.objects.create(
            organization=self.org,
            created_by=self.user,
            title='Test Sheet',
        )
        sheet.ensure_columns(3)
        self.assertEqual(len(sheet.columns), 3)
        self.assertEqual(sheet.columns[0]['label'], 'A')
        self.assertEqual(sheet.columns[1]['label'], 'B')
        self.assertEqual(sheet.columns[2]['label'], 'C')

    def test_formula_sum(self):
        sheet = Sheet.objects.create(
            organization=self.org,
            created_by=self.user,
            title='Formula Test',
        )
        sheet.ensure_columns(2)
        sheet.save()

        for i in range(3):
            row = SheetRow.objects.create(sheet=sheet, order=i)
            SheetCell.objects.create(row=row, column_key='col_0', raw_value=str((i + 1) * 10))

        # Add SUM formula
        row3 = SheetRow.objects.create(sheet=sheet, order=3)
        SheetCell.objects.create(row=row3, column_key='col_0', raw_value='=SUM(A1:A3)')

        engine = FormulaEngine(sheet)
        result = engine.evaluate('=SUM(A1:A3)', 'A', 4)
        self.assertEqual(result, 60.0)

    def test_formula_if(self):
        sheet = Sheet.objects.create(
            organization=self.org,
            created_by=self.user,
            title='IF Test',
        )
        sheet.ensure_columns(2)
        sheet.save()

        row = SheetRow.objects.create(sheet=sheet, order=0)
        SheetCell.objects.create(row=row, column_key='col_0', raw_value='100')

        engine = FormulaEngine(sheet)
        result = engine.evaluate('=IF(A1>50,"High","Low")', 'B', 1)
        self.assertEqual(result, 'High')


class SheetAPITests(SheetsTestMixin, TestCase):
    def test_create_sheet_api(self):
        response = self.client.post('/api/sheets/', {
            'title': 'My Sheet',
            'col_count': 4,
            'row_count': 5,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['title'], 'My Sheet')

    def test_list_sheets(self):
        Sheet.objects.create(organization=self.org, created_by=self.user, title='Sheet 1')
        Sheet.objects.create(organization=self.org, created_by=self.user, title='Sheet 2')
        response = self.client.get('/api/sheets/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)

    def test_bulk_update(self):
        response = self.client.post('/api/sheets/', {
            'title': 'Bulk Test',
            'col_count': 3,
            'row_count': 3,
        }, format='json')
        sheet_id = response.data['id']

        response = self.client.post(f'/api/sheets/{sheet_id}/bulk-update/', {
            'cells': [
                {'row_order': 0, 'column_key': 'col_0', 'raw_value': '10'},
                {'row_order': 1, 'column_key': 'col_0', 'raw_value': '20'},
                {'row_order': 2, 'column_key': 'col_0', 'raw_value': '=SUM(A1:A2)'},
            ]
        }, format='json')
        self.assertEqual(response.status_code, 200)

    def test_ai_generate(self):
        response = self.client.post('/api/sheets/ai-generate/', {
            'prompt': 'Create a budget tracker',
            'row_count': 5,
            'col_count': 4,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['title'], 'Budget Tracker')
