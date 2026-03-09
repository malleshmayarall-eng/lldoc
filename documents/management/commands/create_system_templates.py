"""
Management command to load universal system header/footer templates from JSON files.
These templates follow industry best practices and cover common document use cases.

Templates directory: documents/system_templates/header_footer
Run: python manage.py create_system_templates
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from documents.models import HeaderFooterTemplate


class Command(BaseCommand):
    help = 'Creates universal system header/footer templates accessible to all users'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Creating system header/footer templates...'))

        templates_dir = Path(__file__).resolve().parents[2] / "system_templates" / "header_footer"
        if not templates_dir.exists():
            self.stdout.write(self.style.ERROR(f"Templates directory not found: {templates_dir}"))
            return

        template_files = sorted(templates_dir.glob("*.json"))
        if not template_files:
            self.stdout.write(self.style.ERROR("No template files found."))
            return

        # Delete existing system templates to avoid duplicates
        HeaderFooterTemplate.objects.filter(is_system=True).delete()

        templates_created = 0
        template_names = []
        for template_file in template_files:
            try:
                data = json.loads(template_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                self.stdout.write(self.style.ERROR(f"Invalid JSON in {template_file.name}: {exc}"))
                continue

            name = data.get("name")
            template_type = data.get("template_type")
            config = data.get("config")
            if not name or template_type not in {"header", "footer"} or not isinstance(config, dict):
                self.stdout.write(self.style.ERROR(f"Skipping {template_file.name}: missing required fields"))
                continue

            template = HeaderFooterTemplate.objects.create(
                name=name,
                description=data.get("description") or "",
                template_type=template_type,
                is_system=True,
                is_public=True,
                category=data.get("category"),
                tags=data.get("tags", []),
                config=config,
            )
            templates_created += 1
            template_names.append(template.name)
            self.stdout.write(f"  ✓ Created: {template.name}")

        # ===== SUMMARY =====
        self.stdout.write(self.style.SUCCESS(f"\n✅ Successfully created {templates_created} system templates!"))
        if template_names:
            self.stdout.write("\nTemplates created:")
            for template_name in template_names:
                self.stdout.write(f"  - {template_name}")
        self.stdout.write("\nAll templates are:")
        self.stdout.write("  ✓ Marked as system templates (cannot be deleted)")
        self.stdout.write("  ✓ Public (accessible to all users)")
        self.stdout.write("  ✓ Follow industry best practices")
        self.stdout.write("  ✓ Support dynamic placeholders")
        self.stdout.write("\nSupported placeholders:")
        self.stdout.write("  - {company_name}, {company_address}, {company_phone}, {company_email}")
        self.stdout.write("  - {company_website}, {document_title}, {document_type}")
        self.stdout.write("  - {status}, {version}, {reference_number}")
        self.stdout.write("  - {date}, {year}, {revision_date}")
        self.stdout.write("  - {page}, {total}, {file_path}")
        self.stdout.write("  - {author}, {created_by}")
