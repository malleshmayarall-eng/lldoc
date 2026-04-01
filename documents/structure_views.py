from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.db import models
from django.http import FileResponse
from user_management.models import OrganizationDocumentSettings
from .models import (
    Document, Section, Paragraph, Sentence, Table, ImageComponent, 
    DocumentImage, DocumentFile, DocumentFileComponent,
    HeaderFooterPDF, ParagraphHistory
)
from .pdf_render import safe_render_pdf_to_html
from .serializers import (
    SectionSerializer,
    ParagraphSerializer,
    SentenceSerializer,
    TableSerializer,
    TableCreateSerializer,
    ImageComponentSerializer,
    ImageComponentCreateSerializer,
    DocumentFileSerializer,
    DocumentFileUploadSerializer,
    DocumentFileComponentSerializer,
    DocumentFileComponentCreateSerializer,
    HeaderFooterPDFSerializer,
    HeaderFooterPDFCreateSerializer,
    HeaderFooterPDFUpdateSerializer,
    ParagraphHistorySerializer,
)


class SectionViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Section CRUD operations.
    """
    serializer_class = SectionSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        document_id = self.kwargs.get('document_id') or self.request.query_params.get('document')
        if document_id:
            return Section.objects.filter(document_id=document_id).order_by('order')
        return Section.objects.all()

    def create(self, request, *args, **kwargs):
        """
        Create a section by passing document id in payload.

        Example payload:
        {
            "document": "<doc-uuid>",
            "title": "Section Name",
            "content_text": "",
            "order": 9,
            "depth_level": 1,
            "section_type": "body",
            "metadata": [],
            "parent": null
        }
        """
        data = request.data.copy()
        document_id = self.kwargs.get('document_id')
        if document_id and not data.get('document'):
            data['document'] = document_id
        if 'content' in data and 'content_text' not in data:
            data['content_text'] = data.get('content')

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
    
    def perform_create(self, serializer):
        serializer.save(modified_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(modified_by=self.request.user)
    
    @action(detail=True, methods=['post'], url_path='reorder')
    def reorder(self, request, pk=None):
        """
        Move section to new position within same parent.
        
        Request body:
        {
            "order": 3
        }
        """
        section = self.get_object()
        new_order = request.data.get('order')
        
        if new_order is None:
            return Response(
                {'error': 'order field required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            result = section.reorder(int(new_order), user=request.user)
            return Response(result)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='move-to-parent')
    def move_to_parent(self, request, pk=None):
        """
        Move section to different parent (or root level).
        Converts to subsection or promotes to main section.
        
        Request body:
        {
            "parent_id": "section-uuid" or null,
            "order": 2  (optional - defaults to end)
        }
        """
        section = self.get_object()
        parent_id = request.data.get('parent_id')
        new_order = request.data.get('order')
        
        # Get parent section if provided
        new_parent = None
        if parent_id:
            try:
                new_parent = Section.objects.get(id=parent_id)
                
                # Validate same document
                if new_parent.document_id != section.document_id:
                    return Response(
                        {'error': 'Cannot move section to different document'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                
                # Prevent circular reference
                if new_parent.id == section.id:
                    return Response(
                        {'error': 'Section cannot be its own parent'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                
                # Check if new_parent is a child of section
                ancestor = new_parent.parent
                while ancestor:
                    if ancestor.id == section.id:
                        return Response(
                            {'error': 'Cannot move section under its own descendant'},
                            status=status.HTTP_400_BAD_REQUEST
                        )
                    ancestor = ancestor.parent
                
            except Section.DoesNotExist:
                return Response(
                    {'error': f'Parent section {parent_id} not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
        
        try:
            result = section.move_to_parent(
                new_parent,
                new_order=int(new_order) if new_order is not None else None,
                user=request.user
            )
            return Response(result)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'], url_path='bulk-reorder')
    def bulk_reorder(self, request):
        """
        Reorder multiple sections at once.
        
        Request body:
        {
            "document_id": "doc-uuid",
            "parent_id": "section-uuid" or null,
            "sections": [
                {"id": "section-1", "order": 0},
                {"id": "section-2", "order": 1},
                {"id": "section-3", "order": 2}
            ]
        }
        """
        from django.db import transaction
        
        document_id = request.data.get('document_id')
        parent_id = request.data.get('parent_id')
        sections_data = request.data.get('sections', [])
        
        if not document_id:
            return Response(
                {'error': 'document_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not sections_data:
            return Response(
                {'error': 'sections array required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                updated_count = 0
                for section_data in sections_data:
                    section_id = section_data.get('id')
                    new_order = section_data.get('order')
                    
                    if section_id is None or new_order is None:
                        continue
                    
                    try:
                        section = Section.objects.get(
                            id=section_id,
                            document_id=document_id
                        )
                        section.order = int(new_order)
                        section.save(update_fields=['order'])
                        updated_count += 1
                    except Section.DoesNotExist:
                        pass
                
                # Normalize orders to remove gaps
                if parent_id:
                    parent = Section.objects.get(id=parent_id)
                    Section.normalize_orders(
                        Document.objects.get(id=document_id),
                        parent=parent
                    )
                else:
                    Section.normalize_orders(
                        Document.objects.get(id=document_id),
                        parent=None
                    )
                
                return Response({
                    'status': 'success',
                    'updated': updated_count
                })
                
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'], url_path='normalize-orders')
    def normalize_orders(self, request):
        """
        Normalize section orders (0, 1, 2, 3...) to fix gaps.
        
        Request body:
        {
            "document_id": "doc-uuid",
            "parent_id": "section-uuid" or null
        }
        """
        document_id = request.data.get('document_id')
        parent_id = request.data.get('parent_id')
        
        if not document_id:
            return Response(
                {'error': 'document_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            document = Document.objects.get(id=document_id)
            parent = Section.objects.get(id=parent_id) if parent_id else None
            
            count = Section.normalize_orders(document, parent=parent)
            
            return Response({
                'status': 'success',
                'normalized_count': count
            })
        except Document.DoesNotExist:
            return Response(
                {'error': 'Document not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Section.DoesNotExist:
            return Response(
                {'error': 'Parent section not found'},
                status=status.HTTP_404_NOT_FOUND
            )


class ParagraphViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Paragraph CRUD operations.
    Supports both standalone and nested routes:
    - /api/documents/paragraphs/?section={id}
    - /api/documents/sections/{section_pk}/paragraphs/
    """
    serializer_class = ParagraphSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        # Check for nested route parameter
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            return Paragraph.objects.filter(section_id=section_pk).order_by('order')
        
        # Check for query parameter
        section_id = self.request.query_params.get('section')
        if section_id:
            return Paragraph.objects.filter(section_id=section_id).order_by('order')
        
        return Paragraph.objects.all()
    
    def perform_create(self, serializer):
        # If created via nested route, set the section automatically
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            paragraph = serializer.save(section_id=section_pk, modified_by=self.request.user)
        else:
            paragraph = serializer.save(modified_by=self.request.user)
        # Record creation in history
        ParagraphHistory.record(paragraph, 'created', self.request.user)
    
    def perform_update(self, serializer):
        # Capture content *before* the save for diff
        instance = self.get_object()
        previous_content = instance.get_effective_content() or ''
        paragraph = serializer.save(modified_by=self.request.user)
        # Record edit in history
        ParagraphHistory.record(paragraph, 'edited', self.request.user, previous_content=previous_content)
    
    @action(detail=True, methods=['post'], url_path='reorder')
    def reorder(self, request, pk=None, section_pk=None):
        """
        Move paragraph to new position within same section.
        
        Request body:
        {
            "order": 2
        }
        """
        paragraph = self.get_object()
        new_order = request.data.get('order')
        
        if new_order is None:
            return Response(
                {'error': 'order field required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            result = paragraph.reorder(int(new_order), user=request.user)
            return Response(result)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='move-to-section')
    def move_to_section(self, request, pk=None, section_pk=None):
        """
        Move paragraph to different section.
        
        Request body:
        {
            "section_id": "section-uuid",
            "order": 1  (optional - defaults to end)
        }
        """
        paragraph = self.get_object()
        section_id = request.data.get('section_id')
        new_order = request.data.get('order')
        
        if not section_id:
            return Response(
                {'error': 'section_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get target section
        try:
            new_section = Section.objects.get(id=section_id)
            
            # Validate same document
            if new_section.document_id != paragraph.section.document_id:
                return Response(
                    {'error': 'Cannot move paragraph to different document'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
        except Section.DoesNotExist:
            return Response(
                {'error': f'Section {section_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        try:
            result = paragraph.move_to_section(
                new_section,
                new_order=int(new_order) if new_order is not None else None,
                user=request.user
            )
            return Response(result)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'], url_path='bulk-reorder')
    def bulk_reorder(self, request, section_pk=None):
        """
        Reorder multiple paragraphs at once.
        
        Request body:
        {
            "section_id": "section-uuid",
            "paragraphs": [
                {"id": "para-1", "order": 0},
                {"id": "para-2", "order": 1},
                {"id": "para-3", "order": 2}
            ]
        }
        """
        from django.db import transaction
        
        section_id = section_pk or request.data.get('section_id')
        paragraphs_data = request.data.get('paragraphs', [])
        
        if not section_id:
            return Response(
                {'error': 'section_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not paragraphs_data:
            return Response(
                {'error': 'paragraphs array required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            section = Section.objects.get(id=section_id)
            
            with transaction.atomic():
                updated_count = 0
                for para_data in paragraphs_data:
                    para_id = para_data.get('id')
                    new_order = para_data.get('order')
                    
                    if para_id is None or new_order is None:
                        continue
                    
                    try:
                        paragraph = Paragraph.objects.get(
                            id=para_id,
                            section=section
                        )
                        paragraph.order = int(new_order)
                        paragraph.save(update_fields=['order'])
                        updated_count += 1
                    except Paragraph.DoesNotExist:
                        pass
                
                # Normalize orders to remove gaps
                Paragraph.normalize_orders(section)
                
                return Response({
                    'status': 'success',
                    'updated': updated_count
                })
                
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'], url_path='normalize-orders')
    def normalize_orders(self, request, section_pk=None):
        """
        Normalize paragraph orders (0, 1, 2, 3...) to fix gaps.
        
        Request body:
        {
            "section_id": "section-uuid"
        }
        """
        section_id = section_pk or request.data.get('section_id')
        
        if not section_id:
            return Response(
                {'error': 'section_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            section = Section.objects.get(id=section_id)
            count = Paragraph.normalize_orders(section)
            
            return Response({
                'status': 'success',
                'normalized_count': count
            })
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )


class SentenceViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Sentence CRUD operations.
    Supports both standalone and nested routes:
    - /api/documents/sentences/?paragraph={id}
    - /api/documents/sections/{section_pk}/paragraphs/{paragraph_pk}/sentences/
    """
    serializer_class = SentenceSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        # Check for nested route parameter
        paragraph_pk = self.kwargs.get('paragraph_pk')
        if paragraph_pk:
            return Sentence.objects.filter(paragraph_id=paragraph_pk).order_by('order')
        
        # Check for query parameter
        paragraph_id = self.request.query_params.get('paragraph')
        if paragraph_id:
            return Sentence.objects.filter(paragraph_id=paragraph_id).order_by('order')
        
        return Sentence.objects.all()
    
    def perform_create(self, serializer):
        # If created via nested route, set the paragraph automatically
        paragraph_pk = self.kwargs.get('paragraph_pk')
        if paragraph_pk:
            serializer.save(paragraph_id=paragraph_pk)
        else:
            serializer.save()
    
    def perform_update(self, serializer):
        serializer.save()


class TableViewSet(viewsets.ModelViewSet):
    """
    API endpoints for Table CRUD operations.
    Supports both standalone and nested routes:
    - /api/documents/tables/?section={id}
    - /api/documents/sections/{section_pk}/tables/
    
    Tables can have up to 64 columns and support structured data storage.
    """
    serializer_class = TableSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        # Check for nested route parameter
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            return Table.objects.filter(section_id=section_pk).order_by('order')
        
        # Check for query parameter
        section_id = self.request.query_params.get('section')
        if section_id:
            return Table.objects.filter(section_id=section_id).order_by('order')
        
        return Table.objects.all()
    
    def perform_create(self, serializer):
        # If created via nested route, set the section automatically
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            serializer.save(section_id=section_pk, modified_by=self.request.user)
        else:
            serializer.save(modified_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(modified_by=self.request.user)
    
    @action(detail=False, methods=['post'], url_path='create-initialized')
    def create_initialized(self, request):
        """
        Create and initialize a new table with structure.
        
        Request body:
        {
            "section_id": "s1",
            "title": "Pricing Table",
            "description": "Product pricing breakdown",
            "num_columns": 3,
            "num_rows": 5,
            "column_labels": ["Product", "Price", "Quantity"],
            "table_type": "pricing",
            "order": 0
        }
        """
        serializer = TableCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        data = serializer.validated_data
        
        # Get section
        section = get_object_or_404(Section, id=data['section_id'])
        
        # Determine order
        order = data.get('order')
        if order is None:
            from django.db.models import Max
            max_order = Table.objects.filter(section=section).aggregate(Max('order'))['order__max']
            order = (max_order or -1) + 1
        
        # Generate table ID
        import time
        timestamp = int(time.time() * 1000)
        table_id = f"{section.id}_t{timestamp}_{order}"
        
        # Create table
        table = Table.objects.create(
            id=table_id,
            section=section,
            title=data.get('title', ''),
            description=data.get('description', ''),
            table_type=data.get('table_type', 'data'),
            order=order,
            modified_by=request.user
        )
        
        # Initialize table structure
        result = table.initialize_table(
            num_columns=data.get('num_columns', 2),
            num_rows=data.get('num_rows', 1),
            column_labels=data.get('column_labels')
        )
        
        # Serialize and return
        output_serializer = TableSerializer(table)
        return Response({
            'table': output_serializer.data,
            'initialization': result
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='apply-config')
    def apply_config(self, request):
        """
        Bulk-apply table config options for a document.

        Request body:
        {
            "document_id": "doc-uuid",
            "table_config": {
                "style_preset": "clean",
                "overflow_mode": "split_columns",
                "split_column_count": 6
            }
        }
        """
        document_id = request.data.get('document_id')
        table_config = request.data.get('table_config') or {}

        if not document_id:
            return Response({'error': 'document_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(table_config, dict):
            return Response({'error': 'table_config must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        tables = Table.objects.filter(section__document_id=document_id)
        updated = 0
        for table in tables:
            current_config = table.table_config or {}
            if not isinstance(current_config, dict):
                current_config = {}
            current_config.update(table_config)
            table.table_config = current_config
            table.save(update_fields=['table_config', 'last_modified'])
            updated += 1

        try:
            document = Document.objects.get(id=document_id)
            custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
            processing_settings = custom_metadata.get('processing_settings')
            if not isinstance(processing_settings, dict):
                processing_settings = {}
            processing_settings['table_config'] = table_config
            custom_metadata['processing_settings'] = processing_settings
            document.custom_metadata = custom_metadata
            document.save(update_fields=['custom_metadata', 'updated_at'])
        except Document.DoesNotExist:
            pass

        try:
            organization = request.user.profile.organization
            settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                organization=organization
            )
            preferences = settings_obj.preferences if isinstance(settings_obj.preferences, dict) else {}
            processing_defaults = preferences.get('processing_defaults')
            if not isinstance(processing_defaults, dict):
                processing_defaults = {}
            processing_defaults['table_config'] = table_config
            preferences['processing_defaults'] = processing_defaults
            settings_obj.preferences = preferences
            settings_obj.save(update_fields=['preferences', 'updated_at'])
        except Exception:
            pass

        return Response({'updated': updated})
    
    @action(detail=True, methods=['post'], url_path='reorder')
    def reorder(self, request, pk=None):
        """
        Move table to new position within same section.
        
        Request body:
        {
            "order": 3
        }
        """
        table = self.get_object()
        new_order = request.data.get('order')
        
        if new_order is None:
            return Response(
                {'error': 'order field required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            result = table.reorder(new_order, user=request.user)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='move-to-section')
    def move_to_section(self, request, pk=None):
        """
        Move table to a different section.
        
        Request body:
        {
            "section_id": "s3",
            "order": 2  // optional
        }
        """
        table = self.get_object()
        section_id = request.data.get('section_id')
        new_order = request.data.get('order')
        
        if not section_id:
            return Response(
                {'error': 'section_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            new_section = Section.objects.get(id=section_id)
            result = table.move_to_section(new_section, new_order, user=request.user)
            return Response(result, status=status.HTTP_200_OK)
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='add-row')
    def add_row(self, request, pk=None):
        """
        Add a new row to the table.
        
        Request body:
        {
            "row_data": {"col1": "Value 1", "col2": "Value 2"},
            "position": 0  // optional, null = append to end
        }
        """
        table = self.get_object()
        row_data = request.data.get('row_data')
        position = request.data.get('position')
        
        try:
            new_row = table.add_row(row_data, position)
            serializer = TableSerializer(table)
            return Response({
                'table': serializer.data,
                'new_row': new_row
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='delete-row')
    def delete_row(self, request, pk=None):
        """
        Delete a row from the table.
        
        Request body:
        {
            "row_id": "r1"
        }
        """
        table = self.get_object()
        row_id = request.data.get('row_id')
        
        if not row_id:
            return Response(
                {'error': 'row_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            deleted = table.delete_row(row_id)
            if deleted:
                serializer = TableSerializer(table)
                return Response({
                    'table': serializer.data,
                    'deleted': True
                }, status=status.HTTP_200_OK)
            else:
                return Response(
                    {'error': 'Row not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='add-column')
    def add_column(self, request, pk=None):
        """
        Add a new column to the table.
        
        Request body:
        {
            "column_label": "New Column",
            "column_config": {"width": "150px", "align": "right", "type": "number"},
            "position": 1  // optional, null = append to end
        }
        """
        table = self.get_object()
        column_label = request.data.get('column_label', 'New Column')
        column_config = request.data.get('column_config')
        position = request.data.get('position')
        
        try:
            new_column = table.add_column(column_label, column_config, position)
            serializer = TableSerializer(table)
            return Response({
                'table': serializer.data,
                'new_column': new_column
            }, status=status.HTTP_200_OK)
        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='delete-column')
    def delete_column(self, request, pk=None):
        """
        Delete a column from the table.
        
        Request body:
        {
            "col_id": "col1"
        }
        """
        table = self.get_object()
        col_id = request.data.get('col_id')
        
        if not col_id:
            return Response(
                {'error': 'col_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            deleted = table.delete_column(col_id)
            if deleted:
                serializer = TableSerializer(table)
                return Response({
                    'table': serializer.data,
                    'deleted': True
                }, status=status.HTTP_200_OK)
            else:
                return Response(
                    {'error': 'Column not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
        except ValueError as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='update-cell')
    def update_cell(self, request, pk=None):
        """
        Update a specific cell value.
        
        Request body:
        {
            "row_id": "r1",
            "col_id": "col2",
            "value": "New Value"
        }
        """
        table = self.get_object()
        row_id = request.data.get('row_id')
        col_id = request.data.get('col_id')
        value = request.data.get('value')
        
        if not row_id or not col_id:
            return Response(
                {'error': 'row_id and col_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            updated = table.update_cell(row_id, col_id, value)
            if updated:
                serializer = TableSerializer(table)
                return Response({
                    'table': serializer.data,
                    'updated': True
                }, status=status.HTTP_200_OK)
            else:
                return Response(
                    {'error': 'Cell not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['get'], url_path='get-cell')
    def get_cell(self, request, pk=None):
        """
        Get a specific cell value.
        
        Query params:
        - row_id: Row identifier
        - col_id: Column identifier
        """
        table = self.get_object()
        row_id = request.query_params.get('row_id')
        col_id = request.query_params.get('col_id')
        
        if not row_id or not col_id:
            return Response(
                {'error': 'row_id and col_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            value = table.get_cell(row_id, col_id)
            return Response({
                'row_id': row_id,
                'col_id': col_id,
                'value': value
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class ImageComponentViewSet(viewsets.ModelViewSet):
    """
    API endpoints for ImageComponent CRUD operations.
    Images are uploaded to DocumentImage library, then referenced by ImageComponent.
    
    Workflow:
    1. Upload image to library (DocumentImage) via /api/documents/images/
    2. Create ImageComponent referencing the uploaded image
    3. Reuse same image in multiple locations by creating new ImageComponent with same image_reference
    
    Supports both standalone and nested routes:
    - /api/documents/image-components/?section={id}
    - /api/documents/sections/{section_pk}/image-components/
    """
    serializer_class = ImageComponentSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        # Check for nested route parameter
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            return ImageComponent.objects.filter(section_id=section_pk).order_by('order')
        
        # Check for query parameter
        section_id = self.request.query_params.get('section')
        if section_id:
            return ImageComponent.objects.filter(section_id=section_id).order_by('order')
        
        return ImageComponent.objects.all()
    
    def get_serializer_class(self):
        """Use create serializer for POST requests."""
        if self.action == 'create':
            return ImageComponentCreateSerializer
        return ImageComponentSerializer
    
    def perform_create(self, serializer):
        """Create image component with proper user tracking."""
        # If created via nested route, set the section automatically
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            serializer.save(
                section_id=section_pk, 
                created_by=self.request.user,
                modified_by=self.request.user
            )
        else:
            serializer.save(
                created_by=self.request.user,
                modified_by=self.request.user
            )
    
    def perform_update(self, serializer):
        """Update with user tracking."""
        serializer.save(modified_by=self.request.user)
    
    def create(self, request, *args, **kwargs):
        """
        Create a new image component referencing an existing DocumentImage.
        
        Request body:
        {
            "section_id": "section-uuid",
            "image_reference_id": "image-uuid",
            "caption": "Figure 1: System Architecture",
            "alt_text": "Architecture diagram",
            "title": "System Architecture",
            "figure_number": "Figure 1",
            "alignment": "center",
            "size_mode": "medium",
            "component_type": "diagram",
            "order": 2
        }
        """
        from django.db import models
        
        create_serializer = ImageComponentCreateSerializer(data=request.data)
        create_serializer.is_valid(raise_exception=True)
        
        # Extract data
        section_id = create_serializer.validated_data.pop('section_id')
        image_ref_id = create_serializer.validated_data.pop('image_reference_id')
        
        # Get objects
        try:
            section = Section.objects.get(id=section_id)
            image_ref = DocumentImage.objects.get(id=image_ref_id)
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except DocumentImage.DoesNotExist:
            return Response(
                {'error': 'Image not found in library'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Determine order
        order = create_serializer.validated_data.get('order')
        if order is None:
            # Append to end
            max_order = ImageComponent.objects.filter(
                section=section
            ).aggregate(models.Max('order'))['order__max']
            order = (max_order or -1) + 1
        
        # Generate ID
        import time
        timestamp = int(time.time() * 1000)
        component_id = f"{section_id}_img{timestamp}_{order}"
        
        # Create ImageComponent
        component_data = {
            'id': component_id,
            'section': section,
            'image_reference': image_ref,
            'order': order,
            'created_by': request.user,
            'modified_by': request.user,
            **create_serializer.validated_data
        }
        
        component = ImageComponent.objects.create(**component_data)
        
        # Mirror the referenced image to Attachment library (best-effort)
        if image_ref and image_ref.image:
            try:
                from attachments.models import Attachment

                org = getattr(image_ref, 'organization', None)
                if not org:
                    try:
                        org = request.user.profile.organization
                    except Exception:
                        pass

                Attachment.objects.create(
                    name=image_ref.name or 'Unnamed Image',
                    file_kind='image',
                    image_type=image_ref.image_type or 'picture',
                    file=image_ref.image,
                    scope=getattr(image_ref, 'scope', 'user') or 'user',
                    uploaded_by=request.user,
                    organization=org,
                    team=getattr(image_ref, 'team', None),
                    document=section.document if hasattr(section, 'document') else None,
                    file_size=image_ref.file_size,
                    mime_type=image_ref.mime_type,
                    width=image_ref.width,
                    height=image_ref.height,
                    tags=image_ref.tags or [],
                )
            except Exception:
                pass  # Non-critical — attachment mirror is best-effort

        # Return serialized response
        response_serializer = ImageComponentSerializer(component, context={'request': request})
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['post'], url_path='reorder')
    def reorder(self, request, pk=None):
        """
        Move image component to new position within same section.
        
        Request body:
        {
            "order": 3
        }
        """
        component = self.get_object()
        new_order = request.data.get('order')
        
        if new_order is None:
            return Response(
                {'error': 'order field required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            result = component.reorder(int(new_order), user=request.user)
            return Response(result)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='move-to-section')
    def move_to_section(self, request, pk=None):
        """
        Move image component to different section.
        
        Request body:
        {
            "section_id": "new-section-uuid",
            "order": 2  (optional - defaults to end)
        }
        """
        component = self.get_object()
        section_id = request.data.get('section_id')
        new_order = request.data.get('order')
        
        if not section_id:
            return Response(
                {'error': 'section_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            new_section = Section.objects.get(id=section_id)
            
            # Validate same document
            if new_section.document_id != component.section.document_id:
                return Response(
                    {'error': 'Cannot move component to different document'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            result = component.move_to_section(new_section, new_order, user=request.user)
            return Response(result)
            
        except Section.DoesNotExist:
            return Response(
                {'error': 'Target section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'], url_path='normalize-orders')
    def normalize_orders(self, request):
        """
        Normalize image component orders (0, 1, 2, 3...) to fix gaps.
        
        Request body:
        {
            "section_id": "section-uuid"
        }
        """
        section_id = request.data.get('section_id')
        
        if not section_id:
            return Response(
                {'error': 'section_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            section = Section.objects.get(id=section_id)
            count = ImageComponent.normalize_orders(section)
            
            return Response({
                'status': 'success',
                'normalized_count': count
            })
        except Section.DoesNotExist:
            return Response(
                {'error': 'Section not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=True, methods=['post'], url_path='toggle-visibility')
    def toggle_visibility(self, request, pk=None):
        """
        Toggle image component visibility without deleting it.
        
        Request body:
        {
            "is_visible": true/false
        }
        """
        component = self.get_object()
        is_visible = request.data.get('is_visible')
        
        if is_visible is None:
            # Toggle current state
            component.is_visible = not component.is_visible
        else:
            component.is_visible = bool(is_visible)
        
        component.modified_by = request.user
        component.edit_count += 1
        component.save()
        
        serializer = ImageComponentSerializer(component, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], url_path='by-image')
    def by_image(self, request):
        """
        Get all image components using a specific DocumentImage.
        
        Query params:
        - image_id: UUID of DocumentImage
        
        Returns: List of ImageComponents using this image
        """
        image_id = request.query_params.get('image_id')
        
        if not image_id:
            return Response(
                {'error': 'image_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            components = ImageComponent.objects.filter(
                image_reference_id=image_id
            ).order_by('section', 'order')
            
            serializer = ImageComponentSerializer(
                components, 
                many=True, 
                context={'request': request}
            )
            
            return Response({
                'image_id': image_id,
                'usage_count': components.count(),
                'components': serializer.data
            })
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], url_path='update-display')
    def update_display(self, request, pk=None):
        """
        Update display properties (sizing, alignment, borders, etc.)
        
        Request body:
        {
            "size_mode": "large",
            "alignment": "center",
            "show_border": true,
            "border_color": "#333333",
            "margin_top": 30,
            "margin_bottom": 30
        }
        """
        component = self.get_object()
        
        # Update allowed display fields
        allowed_fields = [
            'size_mode', 'alignment', 'custom_width_percent', 'custom_width_pixels',
            'custom_height_pixels', 'maintain_aspect_ratio', 'margin_top', 
            'margin_bottom', 'margin_left', 'margin_right', 'show_border', 
            'border_color', 'border_width', 'link_url'
        ]
        
        updated_fields = []
        for field in allowed_fields:
            if field in request.data:
                setattr(component, field, request.data[field])
                updated_fields.append(field)
        
        if updated_fields:
            component.modified_by = request.user
            component.edit_count += 1
            component.save()
        
        serializer = ImageComponentSerializer(component, context={'request': request})
        return Response({
            'component': serializer.data,
            'updated_fields': updated_fields
        })


# ============================================================================
# DOCUMENT FILE VIEWSETS
# ============================================================================

class DocumentFileViewSet(viewsets.ModelViewSet):
    """
    API endpoints for DocumentFile management.
    Handles file uploads, metadata, and access control.
    
    Features:
    - Upload files with metadata
    - List files by user/team/organization access level
    - Filter by file type, category, tags
    - Download tracking
    - Version management
    - Access control
    
    Endpoints:
    - POST /api/documents/files/ - Upload new file
    - GET /api/documents/files/ - List accessible files
    - GET /api/documents/files/{id}/ - Get file details
    - PATCH /api/documents/files/{id}/ - Update metadata
    - DELETE /api/documents/files/{id}/ - Delete file
    - POST /api/documents/files/{id}/download/ - Track download
    - GET /api/documents/files/my-library/ - User's uploaded files
    """
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        """Filter files based on access level and user permissions using scoped visibility."""
        user = self.request.user
        
        # Get query parameters
        file_type = self.request.query_params.get('file_type')
        category = self.request.query_params.get('category')
        access_level = self.request.query_params.get('access_level')
        search = self.request.query_params.get('search')
        is_active = self.request.query_params.get('is_active')
        
        # Base queryset with scoped access control
        queryset = DocumentFile.visible_to_user(user, file_type=file_type or None)
        
        # Apply filters
        if category:
            queryset = queryset.filter(category=category)
        
        if access_level:
            queryset = queryset.filter(access_level=access_level)
        
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Search in name, description, tags
        if search:
            queryset = queryset.filter(
                models.Q(name__icontains=search) |
                models.Q(description__icontains=search) |
                models.Q(original_filename__icontains=search) |
                models.Q(tags__contains=[search])
            )
        
        return queryset.order_by('-uploaded_at')
    
    def get_serializer_class(self):
        """Use upload serializer for POST requests."""
        if self.action == 'create':
            return DocumentFileUploadSerializer
        return DocumentFileSerializer
    
    def perform_create(self, serializer):
        """Create file with user tracking."""
        serializer.save(uploaded_by=self.request.user)
    
    def create(self, request, *args, **kwargs):
        """
        Upload a new document file.
        
        Request body (multipart/form-data):
        {
            "file": <file>,
            "name": "Contract Template",
            "description": "Standard service agreement template",
            "file_type": "pdf",
            "category": "template",
            "access_level": "team",
            "team": "team-uuid",
            "tags": ["legal", "template", "contract"],
            "metadata": {"author": "Legal Dept", ...},
            "is_confidential": false
        }
        """
        upload_serializer = DocumentFileUploadSerializer(
            data=request.data,
            context={'request': request}
        )
        upload_serializer.is_valid(raise_exception=True)
        
        # Create file
        document_file = upload_serializer.save()

        # Auto-set organization from user profile if not already set
        updated_fields = []
        if not document_file.organization:
            try:
                document_file.organization = request.user.profile.organization
                updated_fields.append('organization')
            except Exception:
                pass

        # Set team if access_level is team
        team_id = request.data.get('team')
        if document_file.access_level == 'team' and team_id and not document_file.team_id:
            document_file.team_id = team_id
            updated_fields.append('team')

        if updated_fields:
            document_file.save(update_fields=updated_fields)

        # Mirror to centralised Attachment library (best-effort)
        try:
            from attachments.models import Attachment
            # Map file_type to file_kind
            file_kind = 'document'
            if document_file.mime_type and document_file.mime_type.startswith('image/'):
                file_kind = 'image'

            Attachment.objects.create(
                name=document_file.name,
                file_kind=file_kind,
                file=document_file.file,
                scope={
                    'user': 'user',
                    'team': 'team',
                    'organization': 'organization',
                }.get(document_file.access_level, 'user'),
                uploaded_by=request.user,
                organization=document_file.organization,
                team=document_file.team,
                file_size=document_file.file_size,
                mime_type=document_file.mime_type,
                tags=document_file.tags or [],
                metadata={'source': 'document_file', 'document_file_id': str(document_file.id)},
            )
        except Exception:
            pass  # Non-critical — attachment mirror is best-effort
        
        # Return serialized response
        response_serializer = DocumentFileSerializer(
            document_file,
            context={'request': request}
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['post'], url_path='download')
    def track_download(self, request, pk=None):
        """
        Track file download.
        Called when user downloads the file.
        """
        file_obj = self.get_object()
        file_obj.increment_download_count()
        
        return Response({
            'message': 'Download tracked',
            'download_count': file_obj.download_count
        })
    
    @action(detail=False, methods=['get'], url_path='my-library')
    def my_library(self, request):
        """
        Get all files uploaded by the current user.
        """
        queryset = DocumentFile.objects.filter(
            uploaded_by=request.user,
            is_active=True
        ).order_by('-uploaded_at')
        
        # Apply filters
        file_type = request.query_params.get('file_type')
        if file_type:
            queryset = queryset.filter(file_type=file_type)
        
        category = request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)
        
        serializer = DocumentFileSerializer(
            queryset,
            many=True,
            context={'request': request}
        )
        return Response({
            'count': queryset.count(),
            'files': serializer.data
        })
    
    @action(detail=True, methods=['get'], url_path='usages')
    def get_usages(self, request, pk=None):
        """
        Get all places where this file is used.
        Returns list of DocumentFileComponent instances.
        """
        file_obj = self.get_object()
        components = file_obj.component_usages.all()
        
        serializer = DocumentFileComponentSerializer(
            components,
            many=True,
            context={'request': request}
        )
        return Response({
            'file_id': str(file_obj.id),
            'file_name': file_obj.name,
            'usage_count': components.count(),
            'usages': serializer.data
        })

    @action(detail=True, methods=['get'], url_path='pdf-layers')
    def pdf_layers(self, request, pk=None):
        """
        List available PDF render layers for an accessible file.

        Response:
        {
            "file_id": "uuid",
            "layers": ["original", "text", "images"],
            "default_layer": "images"
        }
        """
        file_obj = self.get_object()
        if file_obj.file_type != 'pdf':
            return Response(
                {'error': 'File is not a PDF'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return Response({
            'file_id': str(file_obj.id),
            'layers': ['original', 'text', 'images'],
            'default_layer': 'images'
        })

    @action(detail=True, methods=['get'], url_path='pdf-layer')
    def pdf_layer(self, request, pk=None):
        """
        Render a PDF as a specific layer for authorized users.

        Query params:
        - layer: original | text | images | auto (default: images)
        """
        file_obj = self.get_object()
        if file_obj.file_type != 'pdf':
            return Response(
                {'error': 'File is not a PDF'},
                status=status.HTTP_400_BAD_REQUEST
            )

        layer = request.query_params.get('layer', 'images').lower()
        page_range = request.query_params.get('page_range')
        if layer == 'original':
            filename = file_obj.original_filename or f"{file_obj.name or 'document'}.pdf"
            response = FileResponse(
                file_obj.file.open('rb'),
                content_type='application/pdf'
            )
            response['Content-Disposition'] = f'inline; filename="{filename}"'
            return response

        render_mode = 'auto'
        if layer in {'text', 'images', 'auto'}:
            render_mode = layer

        html = safe_render_pdf_to_html(
            file_obj.file.path,
            render_mode=render_mode,
            page_range=page_range
        )
        if not html:
            return Response(
                {'error': 'Unable to render PDF layer'},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        return Response({
            'file_id': str(file_obj.id),
            'layer': layer,
            'html': html
        })
    
    @action(detail=False, methods=['get'], url_path='stats')
    def file_stats(self, request):
        """
        Get statistics about user's files.
        """
        user = request.user
        queryset = DocumentFile.objects.filter(uploaded_by=user, is_active=True)
        
        # Count by file type
        type_counts = queryset.values('file_type').annotate(
            count=models.Count('id')
        ).order_by('-count')
        
        # Count by category
        category_counts = queryset.values('category').annotate(
            count=models.Count('id')
        ).order_by('-count')
        
        # Total storage used
        total_size = queryset.aggregate(
            total=models.Sum('file_size')
        )['total'] or 0
        
        return Response({
            'total_files': queryset.count(),
            'total_size_bytes': total_size,
            'total_size_display': self._format_size(total_size),
            'by_file_type': list(type_counts),
            'by_category': list(category_counts),
            'most_used': list(queryset.order_by('-usage_count')[:5].values(
                'id', 'name', 'usage_count', 'file_type'
            )),
            'most_downloaded': list(queryset.order_by('-download_count')[:5].values(
                'id', 'name', 'download_count', 'file_type'
            ))
        })
    
    def _format_size(self, size_bytes):
        """Format file size to human readable."""
        if not size_bytes:
            return "0 B"
        
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} PB"


class DocumentFileComponentViewSet(viewsets.ModelViewSet):
    @action(detail=False, methods=['post'], url_path='apply-config')
    def apply_config(self, request):
        """
        Bulk-apply file component config options for a document.

        Request body:
        {
            "document_id": "doc-uuid",
            "file_config": {
                "width_percent": 80,
                "page_range": "1-2,4",
                "show_caption_metadata": true,
                "show_border": true
            }
        }
        """
        document_id = request.data.get('document_id')
        file_config = request.data.get('file_config') or {}

        if not document_id:
            return Response({'error': 'document_id required'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(file_config, dict):
            return Response({'error': 'file_config must be an object'}, status=status.HTTP_400_BAD_REQUEST)

        width_percent = file_config.get('width_percent')
        page_range = file_config.get('page_range')
        show_caption_metadata = file_config.get('show_caption_metadata')
        show_border = file_config.get('show_border')

        components = DocumentFileComponent.objects.filter(section__document_id=document_id)
        updated = 0
        for component in components:
            if width_percent is not None:
                component.width_percent = width_percent
            if page_range is not None:
                component.page_range = page_range
            if show_caption_metadata is not None:
                component.show_filename = bool(show_caption_metadata)
                component.show_file_type = bool(show_caption_metadata)
                component.show_file_size = bool(show_caption_metadata)

            metadata = component.custom_metadata or {}
            if not isinstance(metadata, dict):
                metadata = {}
            if show_border is not None:
                metadata['show_border'] = bool(show_border)
            if show_caption_metadata is not None:
                metadata['show_caption_metadata'] = bool(show_caption_metadata)
            component.custom_metadata = metadata

            component.save(update_fields=[
                'width_percent', 'page_range', 'show_filename', 'show_file_type',
                'show_file_size', 'custom_metadata', 'last_modified'
            ])
            updated += 1

        try:
            document = Document.objects.get(id=document_id)
            custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
            processing_settings = custom_metadata.get('processing_settings')
            if not isinstance(processing_settings, dict):
                processing_settings = {}
            processing_settings['file_config'] = file_config
            custom_metadata['processing_settings'] = processing_settings
            document.custom_metadata = custom_metadata
            document.save(update_fields=['custom_metadata', 'updated_at'])
        except Document.DoesNotExist:
            pass

        try:
            organization = request.user.profile.organization
            settings_obj, _ = OrganizationDocumentSettings.objects.get_or_create(
                organization=organization
            )
            preferences = settings_obj.preferences if isinstance(settings_obj.preferences, dict) else {}
            processing_defaults = preferences.get('processing_defaults')
            if not isinstance(processing_defaults, dict):
                processing_defaults = {}
            processing_defaults['file_config'] = file_config
            preferences['processing_defaults'] = processing_defaults
            settings_obj.preferences = preferences
            settings_obj.save(update_fields=['preferences', 'updated_at'])
        except Exception:
            pass

        return Response({'updated': updated})
    """
    API endpoints for DocumentFileComponent CRUD operations.
    Files are uploaded to DocumentFile library, then referenced by DocumentFileComponent.
    
    Workflow:
    1. Upload file to library (DocumentFile) via /api/documents/files/
    2. Create DocumentFileComponent referencing the uploaded file
    3. Reuse same file in multiple locations by creating new components with same file_reference
    
    Supports both standalone and nested routes:
    - /api/documents/file-components/?section={id}
    - /api/documents/sections/{section_pk}/file-components/
    """
    serializer_class = DocumentFileComponentSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        # Check for nested route parameter
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            return DocumentFileComponent.objects.filter(section_id=section_pk).order_by('order')
        
        # Check for query parameter
        section_id = self.request.query_params.get('section')
        if section_id:
            return DocumentFileComponent.objects.filter(section_id=section_id).order_by('order')
        
        return DocumentFileComponent.objects.all()
    
    def get_serializer_class(self):
        """Use create serializer for POST requests."""
        if self.action == 'create':
            return DocumentFileComponentCreateSerializer
        return DocumentFileComponentSerializer
    
    def perform_create(self, serializer):
        """Create file component with proper user tracking."""
        section_pk = self.kwargs.get('section_pk')
        if section_pk:
            serializer.save(
                section_id=section_pk,
                created_by=self.request.user,
                modified_by=self.request.user
            )
        else:
            serializer.save(
                created_by=self.request.user,
                modified_by=self.request.user
            )
    
    def perform_update(self, serializer):
        """Update with user tracking."""
        serializer.save(modified_by=self.request.user)
    
    def create(self, request, *args, **kwargs):
        """
        Create a new file component referencing an existing DocumentFile.
        
        Request body:
        {
            "section_id": "section-uuid",
            "file_reference_id": "file-uuid",
            "label": "Exhibit A: Service Agreement",
            "description": "Standard service agreement template",
            "reference_number": "Exhibit A",
            "display_mode": "link",
            "alignment": "left",
            "order": 2,
            "show_download_button": true
        }
        """
        create_serializer = DocumentFileComponentCreateSerializer(
            data=request.data,
            context={'request': request}
        )
        create_serializer.is_valid(raise_exception=True)
        
        # Create component
        component = create_serializer.save()
        
        # Return serialized response
        response_serializer = DocumentFileComponentSerializer(
            component,
            context={'request': request}
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['post'], url_path='reorder')
    def reorder(self, request, pk=None):
        """
        Move file component to new position within same section.
        
        Request body:
        {
            "order": 3
        }
        """
        component = self.get_object()
        new_order = request.data.get('order')
        
        if new_order is None:
            return Response(
                {'error': 'order field is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        component.order = new_order
        component.modified_by = request.user
        component.save()
        
        serializer = DocumentFileComponentSerializer(component, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['patch'], url_path='update-display')
    def update_display(self, request, pk=None):
        """
        Update display properties of file component.
        
        Request body:
        {
            "display_mode": "embed",
            "alignment": "center",
            "show_download_button": false,
            "width_percent": 80
        }
        """
        component = self.get_object()
        
        # Update allowed display fields
        allowed_fields = [
            'display_mode', 'alignment', 'width_percent', 'height_pixels',
            'margin_top', 'margin_bottom', 'show_filename', 'show_file_size',
            'show_file_type', 'show_download_button', 'show_preview',
            'open_in_new_tab', 'label', 'description', 'reference_number',
            'page_range'
        ]
        
        updated_fields = []
        for field in allowed_fields:
            if field in request.data:
                setattr(component, field, request.data[field])
                updated_fields.append(field)
        
        if updated_fields:
            component.modified_by = request.user
            component.edit_count += 1
            component.save()
        
        serializer = DocumentFileComponentSerializer(component, context={'request': request})
        return Response({
            'component': serializer.data,
            'updated_fields': updated_fields
        })


# ═══════════════════════════════════════════════════════════════════════════════
# Header / Footer PDF — manual selection & crop
# ═══════════════════════════════════════════════════════════════════════════════

class HeaderFooterPDFViewSet(viewsets.ModelViewSet):
    """
    CRUD + helper actions for manually-selected header/footer PDF regions.

    Workflow
    -------
    1. Upload source PDF  →  ``POST /api/documents/files/`` (existing endpoint)
    2. Preview a page     →  ``GET  .../header-footer-pdfs/preview/?source_file_id=<id>&page=1``
    3. Auto-detect hint   →  ``GET  .../header-footer-pdfs/auto-detect/?source_file_id=<id>&page=1``
    4. Create (crop)      →  ``POST .../header-footer-pdfs/``
    5. Re-crop / update   →  ``PATCH .../header-footer-pdfs/<id>/``
    6. List user's H/F    →  ``GET  .../header-footer-pdfs/``
    7. Retrieve one       →  ``GET  .../header-footer-pdfs/<id>/``
    8. Delete             →  ``DELETE .../header-footer-pdfs/<id>/``
    9. Apply to document  →  ``POST .../header-footer-pdfs/<id>/apply/``

    Endpoints
    ---------
    POST   /api/documents/header-footer-pdfs/                – Create (crop region)
    GET    /api/documents/header-footer-pdfs/                – List
    GET    /api/documents/header-footer-pdfs/<id>/           – Retrieve
    PATCH  /api/documents/header-footer-pdfs/<id>/           – Update / re-crop
    DELETE /api/documents/header-footer-pdfs/<id>/           – Soft-delete
    GET    /api/documents/header-footer-pdfs/preview/        – Page preview PNG
    GET    /api/documents/header-footer-pdfs/auto-detect/    – Auto-detect heights
    POST   /api/documents/header-footer-pdfs/<id>/apply/     – Apply to document
    GET    /api/documents/header-footer-pdfs/my-library/     – User's own items
    """
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = HeaderFooterPDF.objects.filter(
            models.Q(created_by=user) |
            models.Q(access_level='team') |
            models.Q(access_level='organization')
        ).filter(is_active=True)

        region_type = self.request.query_params.get('region_type')
        if region_type in ('header', 'footer'):
            queryset = queryset.filter(region_type=region_type)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                models.Q(name__icontains=search) |
                models.Q(description__icontains=search)
            )

        return queryset.order_by('-created_at')

    def get_serializer_class(self):
        if self.action == 'create':
            return HeaderFooterPDFCreateSerializer
        if self.action in ('partial_update', 'update'):
            return HeaderFooterPDFUpdateSerializer
        return HeaderFooterPDFSerializer

    # ── CREATE ──────────────────────────────────────────────────────────
    def create(self, request, *args, **kwargs):
        """
        Crop a region from a source PDF and save as a header/footer.

        Request body (JSON)::

            {
                "source_file_id": "uuid-of-uploaded-pdf",
                "region_type": "header",
                "name": "Corporate Letterhead Header",
                "page": 1,
                "crop_top_offset": 0,
                "crop_height": 120,
                "access_level": "team"
            }

        Or with auto-detection::

            {
                "source_file_id": "uuid-of-uploaded-pdf",
                "region_type": "header",
                "name": "Corporate Letterhead Header",
                "use_auto_detect": true
            }
        """
        serializer = HeaderFooterPDFCreateSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(
            HeaderFooterPDFSerializer(obj, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ── UPDATE (re-crop) ───────────────────────────────────────────────
    def partial_update(self, request, *args, **kwargs):
        """
        Update metadata or re-crop with new coordinates.

        Request body (JSON)::

            {
                "crop_top_offset": 10,
                "crop_height": 100
            }
        """
        instance = self.get_object()
        serializer = HeaderFooterPDFUpdateSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        obj = serializer.update(instance, serializer.validated_data)
        return Response(
            HeaderFooterPDFSerializer(obj, context={'request': request}).data,
        )

    # ── DELETE (soft) ──────────────────────────────────────────────────
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── PREVIEW: render a page as PNG ──────────────────────────────────
    @action(detail=False, methods=['get'], url_path='preview')
    def preview(self, request):
        """
        Render a page from a source PDF as a PNG image for the selection UI.

        Query params:
            source_file_id  – UUID of the DocumentFile
            page            – 1-based page number (default 1)
            dpi             – render resolution (default 150)

        Returns PNG image (Content-Type: image/png).
        """
        from django.http import HttpResponse

        source_file_id = request.query_params.get('source_file_id')
        if not source_file_id:
            return Response({'error': 'source_file_id is required'}, status=400)

        try:
            doc_file = DocumentFile.objects.get(id=source_file_id, is_active=True)
        except DocumentFile.DoesNotExist:
            return Response({'error': 'Source file not found'}, status=404)

        if not doc_file.can_access(request.user):
            return Response({'error': 'No access'}, status=403)
        if doc_file.file_type != 'pdf':
            return Response({'error': 'Source file must be a PDF'}, status=400)

        page = int(request.query_params.get('page', 1))
        dpi = int(request.query_params.get('dpi', 150))

        from exporter.pdf_system import render_pdf_page_preview, get_pdf_page_info

        png_bytes = render_pdf_page_preview(doc_file.file.path, page=page, dpi=dpi)
        if not png_bytes:
            return Response({'error': 'Failed to render page preview'}, status=500)

        page_info = get_pdf_page_info(doc_file.file.path, page=page) or {}

        response = HttpResponse(png_bytes, content_type='image/png')
        response['X-Page-Width-Pts'] = str(page_info.get('width_pts', 0))
        response['X-Page-Height-Pts'] = str(page_info.get('height_pts', 0))
        response['X-Page-Count'] = str(page_info.get('page_count', 0))
        response['X-Page-Number'] = str(page_info.get('page_number', 1))
        response['Access-Control-Expose-Headers'] = (
            'X-Page-Width-Pts, X-Page-Height-Pts, X-Page-Count, X-Page-Number'
        )
        return response

    # ── PAGE INFO (JSON) ───────────────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='page-info')
    def page_info(self, request):
        """
        Return JSON metadata about a source PDF page (dimensions, page count).

        Query params:
            source_file_id  – UUID of the DocumentFile
            page            – 1-based page number (default 1)
        """
        source_file_id = request.query_params.get('source_file_id')
        if not source_file_id:
            return Response({'error': 'source_file_id is required'}, status=400)

        try:
            doc_file = DocumentFile.objects.get(id=source_file_id, is_active=True)
        except DocumentFile.DoesNotExist:
            return Response({'error': 'Source file not found'}, status=404)

        if not doc_file.can_access(request.user):
            return Response({'error': 'No access'}, status=403)

        page = int(request.query_params.get('page', 1))

        from exporter.pdf_system import get_pdf_page_info
        info = get_pdf_page_info(doc_file.file.path, page=page)
        if not info:
            return Response({'error': 'Failed to read page info'}, status=500)

        return Response(info)

    # ── AUTO-DETECT suggestion ─────────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='auto-detect')
    def auto_detect(self, request):
        """
        Run auto-detection on a source PDF and return suggested crop coordinates.

        Query params:
            source_file_id  – UUID of the DocumentFile
            page            – 1-based page number (default 1)

        Returns::

            {
                "header": {
                    "crop_top_offset": 0,
                    "crop_height": 85,
                    "region_height": 85
                },
                "footer": {
                    "crop_top_offset": 756,
                    "crop_height": 85,
                    "region_height": 85
                },
                "page_width_pts": 595.28,
                "page_height_pts": 841.89
            }
        """
        source_file_id = request.query_params.get('source_file_id')
        if not source_file_id:
            return Response({'error': 'source_file_id is required'}, status=400)

        try:
            doc_file = DocumentFile.objects.get(id=source_file_id, is_active=True)
        except DocumentFile.DoesNotExist:
            return Response({'error': 'Source file not found'}, status=404)

        if not doc_file.can_access(request.user):
            return Response({'error': 'No access'}, status=403)

        page = int(request.query_params.get('page', 1))

        from exporter.pdf_system import detect_pdf_header_footer_heights, get_pdf_page_info

        page_info = get_pdf_page_info(doc_file.file.path, page=page) or {}
        header_h, footer_h = detect_pdf_header_footer_heights(doc_file.file.path, page=page)

        page_height = page_info.get('height_pts', 841.89)

        result = {
            'header': {
                'crop_top_offset': 0.0,
                'crop_height': round(header_h, 1),
                'region_height': round(header_h, 1),
            } if header_h > 0 else None,
            'footer': {
                'crop_top_offset': round(page_height - footer_h, 1),
                'crop_height': round(footer_h, 1),
                'region_height': round(footer_h, 1),
            } if footer_h > 0 else None,
            'page_width_pts': page_info.get('width_pts', 595.28),
            'page_height_pts': page_height,
            'page_count': page_info.get('page_count', 1),
        }
        return Response(result)

    # ── APPLY to a document ────────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='apply')
    def apply_to_document(self, request, pk=None):
        """
        Apply this header/footer PDF to a document's processing_settings.

        Request body::

            {
                "document_id": "uuid-of-document",
                "show_on_first_page": true,
                "show_on_all_pages": true,
                "show_pages": []
            }

        This sets ``processing_settings.header_pdf`` or ``processing_settings.footer_pdf``
        on the target document and clears any conflicting text-based template.
        """
        hf_obj = self.get_object()
        document_id = request.data.get('document_id')
        if not document_id:
            return Response({'error': 'document_id is required'}, status=400)

        try:
            document = Document.objects.get(id=document_id)
        except Document.DoesNotExist:
            return Response({'error': 'Document not found'}, status=404)

        # Build the config dict (same schema the header-footer endpoint expects)
        config = {
            'file_id': str(hf_obj.id),
            'source_file_id': str(hf_obj.source_file_id) if hf_obj.source_file_id else None,
            'height': hf_obj.region_height,
            'page': hf_obj.source_page,
            'crop_top_offset': hf_obj.crop_top_offset,
            'crop_height': hf_obj.crop_height,
            'show_on_first_page': request.data.get('show_on_first_page', True),
            'show_on_all_pages': request.data.get('show_on_all_pages', True),
            'show_pages': request.data.get('show_pages', []),
            'name': hf_obj.name,
            'auto_detected': hf_obj.auto_detected,
        }

        # Save into document processing_settings
        custom_metadata = document.custom_metadata if isinstance(document.custom_metadata, dict) else {}
        processing_settings = custom_metadata.get('processing_settings')
        if not isinstance(processing_settings, dict):
            processing_settings = {}

        settings_key = 'header_pdf' if hf_obj.region_type == 'header' else 'footer_pdf'
        processing_settings[settings_key] = config
        custom_metadata['processing_settings'] = processing_settings
        document.custom_metadata = custom_metadata
        document.save(update_fields=['custom_metadata', 'updated_at'])

        # Clear conflicting text-based template
        if hf_obj.region_type == 'header' and document.header_template_id:
            document.set_header_template(None, user=request.user)
        elif hf_obj.region_type == 'footer' and document.footer_template_id:
            document.set_footer_template(None, user=request.user)

        return Response({
            'message': f'{hf_obj.get_region_type_display()} applied to document',
            'document_id': str(document.id),
            'settings_key': settings_key,
            'config': config,
        })

    # ── MY LIBRARY ─────────────────────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='my-library')
    def my_library(self, request):
        """List all header/footer PDFs created by the current user."""
        queryset = HeaderFooterPDF.objects.filter(
            created_by=request.user,
            is_active=True,
        ).order_by('-created_at')

        region_type = request.query_params.get('region_type')
        if region_type in ('header', 'footer'):
            queryset = queryset.filter(region_type=region_type)

        serializer = HeaderFooterPDFSerializer(
            queryset, many=True, context={'request': request},
        )
        return Response({
            'count': queryset.count(),
            'results': serializer.data,
        })


# ─────────────────────────────────────────────────────────────────────
# Paragraph History
# ─────────────────────────────────────────────────────────────────────

class ParagraphHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only timeline of paragraph edits.

    Routes
    ──────
    GET  /api/documents/paragraph-history/?paragraph={uuid}   — timeline
    GET  /api/documents/paragraph-history/{uuid}/              — single entry
    POST /api/documents/paragraph-history/{uuid}/restore/      — revert paragraph
    """
    serializer_class = ParagraphHistorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = ParagraphHistory.objects.select_related('changed_by')
        paragraph_id = self.request.query_params.get('paragraph')
        if paragraph_id:
            qs = qs.filter(paragraph_id=paragraph_id)
        return qs.order_by('-created_at')

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        """
        Restore a paragraph to the state captured in this history entry.

        POST /api/documents/paragraph-history/{history_id}/restore/
        Response: the updated Paragraph + a new 'restored' history entry.
        """
        history_entry = self.get_object()
        paragraph = history_entry.paragraph

        # Capture current content before restoring
        previous_content = paragraph.get_effective_content() or ''

        # Apply the snapshot
        paragraph.edited_text = history_entry.content_snapshot
        paragraph.has_edits = True
        paragraph.modified_by = request.user
        # Restore metadata if present
        meta = history_entry.metadata_snapshot or {}
        if meta.get('topic'):
            paragraph.topic = meta['topic']
        if meta.get('paragraph_type'):
            paragraph.paragraph_type = meta['paragraph_type']
        paragraph.save()

        # Record the restore action
        summary = f"Restored to version from {history_entry.created_at.strftime('%b %d, %Y %H:%M')}"
        ParagraphHistory.record(
            paragraph, 'restored', request.user,
            previous_content=previous_content,
            summary=summary,
        )

        return Response({
            'status': 'restored',
            'paragraph': ParagraphSerializer(paragraph).data,
        })


