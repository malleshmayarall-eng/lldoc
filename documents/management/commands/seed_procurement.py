"""
Management command to seed procurement domain data for an organisation.

Creates:
  • 10 Quick-LaTeX document templates (PO, RFP, Vendor Agreement, etc.)
  • 4 CLM workflow templates (PO Approval, Vendor Onboarding, etc.)
  • Sets the organisation domain to "procurement"

Usage:
    python manage.py seed_procurement                     # uses first org
    python manage.py seed_procurement --org <uuid>        # specific org
    python manage.py seed_procurement --org <uuid> --clean  # delete existing seeds first
"""

import uuid as _uuid

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from documents.models import Document, Section, LatexCode
from documents.procurement.templates import DOCUMENT_TEMPLATES
from documents.procurement.workflows import WORKFLOW_TEMPLATES
from user_management.models import Organization


class Command(BaseCommand):
    help = 'Seed procurement document templates and CLM workflow templates'

    def add_arguments(self, parser):
        parser.add_argument(
            '--org', type=str, default=None,
            help='Organization UUID. Defaults to the first active org.',
        )
        parser.add_argument(
            '--clean', action='store_true',
            help='Delete existing procurement seed data before re-creating.',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        org = self._resolve_org(options['org'])
        self.stdout.write(f'Organization: {org.name} ({org.id})')

        if options['clean']:
            self._clean(org)

        # ── Seed document templates ──────────────────────────────────
        self.stdout.write(self.style.SUCCESS('\n📄 Creating document templates…'))
        docs_created = 0
        for tpl in DOCUMENT_TEMPLATES:
            doc = self._create_quick_latex_doc(org, tpl)
            docs_created += 1
            self.stdout.write(f'  ✓ {tpl["title"]} → {doc.id}')

        # ── Seed CLM workflow templates ──────────────────────────────
        self.stdout.write(self.style.SUCCESS('\n⚙️  Creating CLM workflow templates…'))
        wf_created = 0
        for wf_tpl in WORKFLOW_TEMPLATES:
            wf = self._create_workflow(org, wf_tpl)
            wf_created += 1
            self.stdout.write(f'  ✓ {wf_tpl["name"]} → {wf.id}')

        # ── Set domain ───────────────────────────────────────────────
        org.domain = 'procurement'
        org.save(update_fields=['domain', 'updated_at'])

        # ── Summary ──────────────────────────────────────────────────
        self.stdout.write(self.style.SUCCESS(
            f'\n✅ Done!  {docs_created} templates, {wf_created} workflows '
            f'seeded for "{org.name}". Domain set to "procurement".'
        ))

    # ── helpers ──────────────────────────────────────────────────────

    def _resolve_org(self, org_id):
        if org_id:
            try:
                return Organization.objects.get(id=org_id)
            except Organization.DoesNotExist:
                raise CommandError(f'Organization {org_id} not found.')
        org = Organization.objects.filter(is_active=True).first()
        if not org:
            raise CommandError('No active organisation found. Create one first.')
        return org

    def _clean(self, org):
        """Delete previously seeded procurement data."""
        from clm.models import Workflow
        count, _ = Document.objects.filter(
            created_by=None,
            document_mode='quick_latex',
            custom_metadata__procurement_seed=True,
        ).delete()
        self.stdout.write(f'  🗑  Deleted {count} seed documents')

        count, _ = Workflow.objects.filter(
            organization=org,
            description__contains='[procurement-seed]',
        ).delete()
        self.stdout.write(f'  🗑  Deleted {count} seed workflows')

    def _create_quick_latex_doc(self, org, tpl):
        """Create a quick-latex Document with one Section and one LatexCode block."""
        doc = Document(
            title=tpl['title'],
            document_type=tpl['document_type'],
            category=tpl.get('category', tpl['document_type']),
            raw_text='',
            current_text='',
            is_latex_code=True,
            latex_code=tpl['latex_code'].strip(),
            document_mode='quick_latex',
            status='template',
            document_metadata=tpl.get('metadata_defaults', {}),
            custom_metadata={
                'procurement_seed': True,
                'template_key': tpl['key'],
                'template_description': tpl.get('description', ''),
            },
        )
        doc.save()

        section = Section.objects.create(
            document=doc,
            title=tpl['title'],
            order=0,
        )

        LatexCode.objects.create(
            section=section,
            latex_code=tpl['latex_code'].strip(),
            code_type='latex',
            order=0,
        )

        return doc

    def _create_workflow(self, org, wf_tpl):
        """Create a CLM Workflow with nodes and connections."""
        from clm.models import Workflow, WorkflowNode, NodeConnection

        wf = Workflow.objects.create(
            organization=org,
            name=wf_tpl['name'],
            description=f"{wf_tpl['description']} [procurement-seed]",
            is_active=True,
        )

        # Create nodes — map template ids to real UUIDs
        id_map = {}
        for node_def in wf_tpl['nodes']:
            node = WorkflowNode.objects.create(
                workflow=wf,
                node_type=node_def['node_type'],
                label=node_def['label'],
                position_x=node_def['position_x'],
                position_y=node_def['position_y'],
                config=node_def.get('config', {}),
            )
            id_map[node_def['id']] = node

        # Create connections
        for conn_def in wf_tpl['connections']:
            NodeConnection.objects.create(
                workflow=wf,
                source_node=id_map[conn_def['source']],
                target_node=id_map[conn_def['target']],
                source_handle=conn_def.get('handle', ''),
            )

        # Rebuild extraction template from rule nodes
        wf.rebuild_extraction_template()
        wf.compute_nodes_config_hash(save=True)

        return wf
