"""
Management command to rebuild component indexes for all documents.

Usage:
    python manage.py rebuild_component_indexes
    python manage.py rebuild_component_indexes --document-id <uuid>
    python manage.py rebuild_component_indexes --dry-run
"""

from django.core.management.base import BaseCommand
from django.db import models
from documents.models import Document, Paragraph, Table, ImageComponent


class Command(BaseCommand):
    help = 'Rebuild component indexes (section_ids, table_ids, etc.) for all documents'

    def add_arguments(self, parser):
        parser.add_argument(
            '--document-id',
            type=str,
            help='Rebuild indexes for a specific document by ID',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be done without making changes',
        )

    def handle(self, *args, **options):
        document_id = options.get('document_id')
        dry_run = options.get('dry_run')

        if document_id:
            # Rebuild single document
            try:
                doc = Document.objects.get(id=document_id)
                documents = [doc]
                self.stdout.write(f"Rebuilding indexes for document: {doc.title}")
            except Document.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Document {document_id} not found"))
                return
        else:
            # Rebuild all documents
            documents = Document.objects.all()
            self.stdout.write(f"Rebuilding indexes for {documents.count()} documents...")

        total_components = 0
        errors = 0

        for doc in documents:
            try:
                if dry_run:
                    # Just show what would be indexed
                    sections_count = doc.sections.count()
                    paragraphs_count = Paragraph.objects.filter(section__document=doc).count()
                    tables_count = Table.objects.filter(
                        models.Q(section__document=doc) | models.Q(document=doc, section__isnull=True)
                    ).count()
                    images_count = ImageComponent.objects.filter(section__document=doc).count()
                    files_count = 0  # FileComponent not implemented yet
                    
                    self.stdout.write(
                        f"  {doc.title}: "
                        f"{sections_count} sections, "
                        f"{paragraphs_count} paragraphs, "
                        f"{tables_count} tables, "
                        f"{images_count} images, "
                        f"{files_count} files"
                    )
                    total_components += (sections_count + paragraphs_count + tables_count + 
                                       images_count + files_count)
                else:
                    # Actually rebuild
                    summary = doc.rebuild_component_indexes()
                    total_components += summary['total_components']
                    
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"✓ {doc.title}: "
                            f"{summary['sections']} sections, "
                            f"{summary['paragraphs']} paragraphs, "
                            f"{summary['tables']} tables, "
                            f"{summary['images']} images, "
                            f"{summary['files']} files"
                        )
                    )
                    
            except Exception as e:
                errors += 1
                self.stderr.write(
                    self.style.ERROR(f"✗ Error rebuilding {doc.title}: {str(e)}")
                )

        # Summary
        self.stdout.write("\n" + "="*60)
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"DRY RUN: Would index {total_components} total components "
                    f"across {len(documents)} documents"
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"✓ Successfully rebuilt indexes for {len(documents) - errors} documents\n"
                    f"  Total components indexed: {total_components}\n"
                    f"  Errors: {errors}"
                )
            )
