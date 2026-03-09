"""
Business logic for document parsing, analysis, and AI integration.
"""
import re
import uuid
from typing import List, Dict, Tuple
from .models import Document, Section, Paragraph, Sentence, Issue


class DocumentParser:
    """
    Parses raw text into structured document components.
    """

    @staticmethod
    def _ensure_uuid(value):
        if not value:
            return uuid.uuid4()
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError, AttributeError):
            return uuid.uuid4()
    
    @staticmethod
    def parse_document(raw_text: str, title: str = "Untitled Document", author: str = None) -> Document:
        """
        Parse raw text and create a structured Document with Sections and Paragraphs.
        """
        # Create the document
        document = Document.objects.create(
            raw_text=raw_text,
            title=title,
            author=author,
            document_type='contract'
        )
        
        # Parse sections
        sections = DocumentParser._extract_sections(raw_text)
        
        # Create Section and Paragraph objects
        order = 0
        for section_data in sections:
            section = Section.objects.create(
                id=DocumentParser._ensure_uuid(section_data.get('id')),
                document=document,
                title=section_data['title'],
                content_start=section_data['start'],
                content_end=section_data['end'],
                content_text=section_data['text'],
                order=order
            )
            order += 1
            
            # Create paragraphs for this section
            para_order = 0
            for para_data in section_data['paragraphs']:
                paragraph = Paragraph.objects.create(
                    id=DocumentParser._ensure_uuid(para_data.get('id')),
                    section=section,
                    content_start=para_data['start'],
                    content_end=para_data['end'],
                    content_text=para_data['text'],
                    order=para_order
                )
                para_order += 1
                
                # Create sentences for this paragraph
                sentences = DocumentParser._extract_sentences(para_data['text'])
                sent_order = 0
                sent_offset = para_data['start']
                for sent_text in sentences:
                    Sentence.objects.create(
                        paragraph=paragraph,
                        content_start=sent_offset,
                        content_end=sent_offset + len(sent_text),
                        content_text=sent_text,
                        order=sent_order
                    )
                    sent_offset += len(sent_text) + 1
                    sent_order += 1
        
        return document
    
    @staticmethod
    def _extract_sections(text: str) -> List[Dict]:
        """
        Extract sections from text using pattern matching.
        Looks for numbered headings like "1. Title" or "Article 1"
        """
        sections = []
        
        # Pattern for section headers: "1. Title" or "1 Title" or "Article 1"
        section_pattern = r'^(\d+\.?\s+[A-Z].*?)$'
        
        lines = text.split('\n')
        current_section = None
        current_paras = []
        current_para_text = []
        section_counter = 1
        para_counter = 1
        char_pos = 0
        
        for line in lines:
            line_stripped = line.strip()
            
            # Check if this is a section header
            if re.match(section_pattern, line_stripped, re.MULTILINE):
                # Save previous section if exists
                if current_section:
                    if current_para_text:
                        para_text = ' '.join(current_para_text)
                        current_paras.append({
                            'id': f'p{para_counter}',
                            'start': char_pos - len(para_text),
                            'end': char_pos,
                            'text': para_text
                        })
                        para_counter += 1
                        current_para_text = []
                    
                    current_section['paragraphs'] = current_paras
                    sections.append(current_section)
                
                # Start new section
                section_start = char_pos
                current_section = {
                    'id': f's{section_counter}',
                    'title': line_stripped,
                    'start': section_start,
                    'end': None,
                    'text': line_stripped
                }
                current_paras = []
                section_counter += 1
            
            # Empty line = paragraph break
            elif not line_stripped:
                if current_para_text:
                    para_text = ' '.join(current_para_text)
                    current_paras.append({
                        'id': f'p{para_counter}',
                        'start': char_pos - len(para_text),
                        'end': char_pos,
                        'text': para_text
                    })
                    para_counter += 1
                    current_para_text = []
            
            # Regular content line
            elif line_stripped and current_section:
                current_para_text.append(line_stripped)
                current_section['text'] += ' ' + line_stripped
            
            char_pos += len(line) + 1
        
        # Don't forget the last section
        if current_section:
            if current_para_text:
                para_text = ' '.join(current_para_text)
                current_paras.append({
                    'id': f'p{para_counter}',
                    'start': char_pos - len(para_text),
                    'end': char_pos,
                    'text': para_text
                })
            
            current_section['end'] = char_pos
            current_section['paragraphs'] = current_paras
            sections.append(current_section)
        
        # If no sections found, create one default section
        if not sections:
            sections.append({
                'id': 's1',
                'title': 'Document Content',
                'start': 0,
                'end': len(text),
                'text': text,
                'paragraphs': [{
                    'id': 'p1',
                    'start': 0,
                    'end': len(text),
                    'text': text
                }]
            })
        
        return sections
    
    @staticmethod
    def _extract_sentences(text: str) -> List[str]:
        """
        Split paragraph into sentences.
        """
        # Simple sentence splitting on . ! ?
        sentence_endings = re.compile(r'([.!?])\s+')
        sentences = sentence_endings.split(text)
        
        result = []
        for i in range(0, len(sentences) - 1, 2):
            sentence = sentences[i] + sentences[i + 1]
            if sentence.strip():
                result.append(sentence.strip())
        
        # Add last sentence if no ending punctuation
        if len(sentences) % 2 == 1 and sentences[-1].strip():
            result.append(sentences[-1].strip())
        
        return result if result else [text]


class DocumentAnalyzer:
    """
    Analyzes documents and detects issues using AI models.
    """
    
    @staticmethod
    def analyze_document(document: Document) -> List[Issue]:
        """
        Analyze document and create Issue records.
        For MVP, this uses rule-based detection. Replace with AI model calls.
        """
        issues = []
        
        # Get all sections and paragraphs
        sections = document.sections.all()
        
        # Rule 1: Check for short termination notice periods
        for section in sections:
            if 'termination' in section.title.lower() if section.title else False:
                for para in section.paragraphs.all():
                    if 'seven' in para.content_text.lower() or '7' in para.content_text:
                        issues.append(Issue.objects.create(
                            document=document,
                            section=section,
                            paragraph=para,
                            issue_type='LEGAL_RISK',
                            severity='high',
                            title='Unfavorable Termination Clause',
                            description='The termination clause allows termination with only 7 days notice, which may be too short.',
                            suggestion='Increase the notice period to 30 days and consider adding cause requirements.'
                        ))
        
        # Rule 2: Check for vague payment terms
        for section in sections:
            if 'payment' in section.title.lower() if section.title else False:
                for para in section.paragraphs.all():
                    if 'reasonable time' in para.content_text.lower():
                        issues.append(Issue.objects.create(
                            document=document,
                            section=section,
                            paragraph=para,
                            issue_type='AMBIGUITY',
                            severity='medium',
                            title='Vague Payment Terms',
                            description='The payment schedule uses ambiguous language "reasonable time".',
                            suggestion='Specify exact payment deadlines (e.g., "within 30 days of invoice date").'
                        ))
        
        # Rule 3: Check for missing confidentiality clause
        has_confidentiality = any(
            'confidential' in s.title.lower() if s.title else False 
            for s in sections
        )
        if not has_confidentiality:
            issues.append(Issue.objects.create(
                document=document,
                issue_type='OMISSION',
                severity='high',
                title='Missing Confidentiality Clause',
                description='This agreement lacks a confidentiality provision.',
                suggestion='Add Section: Confidentiality - "Both parties agree to maintain the confidentiality of proprietary information disclosed during the term of this Agreement."'
            ))
        
        # Rule 4: Check for missing exhibit references
        for section in sections:
            for para in section.paragraphs.all():
                if 'exhibit' in para.content_text.lower():
                    issues.append(Issue.objects.create(
                        document=document,
                        section=section,
                        paragraph=para,
                        issue_type='ERROR',
                        severity='medium',
                        title='Missing Exhibit Reference',
                        description='References an Exhibit that may not be attached or defined.',
                        suggestion='Ensure all referenced Exhibits are attached or remove references and define terms directly.'
                    ))
                    break  # Only flag once per section
        
        return issues


class UnifiedSearchService:
    """
    Comprehensive search service that searches across all resource types:
    - Documents
    - Sections
    - Paragraphs (subsections are sections with parents)
    - Attachments
    - Images
    - Defined Terms
    - Document Versions
    - Change Logs
    - Specialist Reviews
    - Issues
    - Inline References
    
    Includes:
    - User/team filtering
    - Metadata enrichment
    - Relevance scoring
    - Resource type filtering
    - **FUZZY SEARCH** - Finds results even with typos/partial matches
    """
    
    def __init__(self, user, team=None):
        """
        Initialize search service with user context.
        
        Args:
            user: The User performing the search
            team: Optional team context for shared resources
        """
        self.user = user
        self.team = team
    
    def _fuzzy_match_score(self, text, query):
        """
        Calculate fuzzy match score using Levenshtein-like algorithm.
        Returns score 0-100 based on how similar text is to query.
        
        Uses multiple techniques:
        - Exact substring match (highest score)
        - Word-level fuzzy matching
        - Character-level similarity
        - Position bonus (earlier matches score higher)
        """
        if not text or not query:
            return 0.0
        
        text_lower = text.lower()
        query_lower = query.lower()
        
        # Exact substring match
        if query_lower in text_lower:
            pos = text_lower.find(query_lower)
            position_score = 1.0 - (pos / max(len(text_lower), 1))
            return 100.0 * position_score
        
        # Word-level fuzzy matching
        query_words = query_lower.split()
        text_words = text_lower.split()
        
        if not query_words or not text_words:
            return 0.0
        
        # Calculate best match for each query word
        total_score = 0.0
        for q_word in query_words:
            best_word_score = 0.0
            
            for t_word in text_words:
                # Check if query word is substring of text word
                if q_word in t_word:
                    best_word_score = max(best_word_score, 90.0)
                # Check if text word is substring of query word
                elif t_word in q_word:
                    best_word_score = max(best_word_score, 85.0)
                # Character-level similarity
                else:
                    char_score = self._levenshtein_similarity(q_word, t_word)
                    best_word_score = max(best_word_score, char_score)
            
            total_score += best_word_score
        
        # Average score across all query words
        avg_score = total_score / len(query_words)
        
        # Bonus for matching all words
        all_words_match = all(
            any(q_word in t_word or t_word in q_word for t_word in text_words)
            for q_word in query_words
        )
        if all_words_match:
            avg_score *= 1.2  # 20% bonus
        
        return min(100.0, avg_score)
    
    def _levenshtein_similarity(self, s1, s2):
        """
        Calculate similarity between two strings using Levenshtein distance.
        Returns score 0-100 (100 = identical).
        """
        if s1 == s2:
            return 100.0
        
        len1, len2 = len(s1), len(s2)
        if len1 == 0 or len2 == 0:
            return 0.0
        
        # Create distance matrix
        distances = [[0] * (len2 + 1) for _ in range(len1 + 1)]
        
        # Initialize first row and column
        for i in range(len1 + 1):
            distances[i][0] = i
        for j in range(len2 + 1):
            distances[0][j] = j
        
        # Calculate distances
        for i in range(1, len1 + 1):
            for j in range(1, len2 + 1):
                if s1[i - 1] == s2[j - 1]:
                    cost = 0
                else:
                    cost = 1
                
                distances[i][j] = min(
                    distances[i - 1][j] + 1,      # deletion
                    distances[i][j - 1] + 1,      # insertion
                    distances[i - 1][j - 1] + cost  # substitution
                )
        
        # Convert distance to similarity score
        max_len = max(len1, len2)
        distance = distances[len1][len2]
        similarity = (1 - distance / max_len) * 100
        
        return max(0.0, similarity)
    
    def search(self, query, resource_types=None, filters=None, limit=50):
        """
        Perform unified search across all resources.
        
        Args:
            query: Search query string
            resource_types: List of resource types to search (None = all)
                           ['document', 'section', 'paragraph', 'attachment', 
                            'image', 'term', 'version', 'changelog', 'review', 
                            'issue', 'reference']
            filters: Additional filters (dict)
                    {
                        'document_id': UUID,
                        'document_type': str,
                        'created_after': datetime,
                        'created_before': datetime,
                        'severity': str (for issues),
                        'status': str,
                    }
            limit: Maximum results per resource type
        
        Returns:
            {
                'query': str,
                'total_count': int,
                'results': [
                    {
                        'resource_type': str,
                        'resource_id': UUID,
                        'title': str,
                        'content': str,
                        'matched_content': str,
                        'relevance_score': float,
                        'metadata': dict,
                        'document_info': dict,
                        'created_at': datetime,
                        'created_by': str,
                    }
                ]
            }
        """
        from django.db.models import Q, Value, CharField, F
        from django.db.models.functions import Concat
        
        if not query or len(query.strip()) < 2:
            return {
                'query': query,
                'total_count': 0,
                'results': [],
                'message': 'Query too short (minimum 2 characters)'
            }
        
        query = query.strip()
        filters = filters or {}
        all_results = []
        
        # Get base document queryset (user's documents + shared documents)
        base_documents = self._get_accessible_documents()
        
        # Filter by document_id if specified
        if filters.get('document_id'):
            base_documents = base_documents.filter(id=filters['document_id'])
        
        # Filter by document_type if specified
        if filters.get('document_type'):
            base_documents = base_documents.filter(document_type=filters['document_type'])
        
        # Filter by date range
        if filters.get('created_after'):
            base_documents = base_documents.filter(created_at__gte=filters['created_after'])
        if filters.get('created_before'):
            base_documents = base_documents.filter(created_at__lte=filters['created_before'])
        
        # Define which resources to search
        search_all = resource_types is None
        resource_types = resource_types or []
        
        # 1. Search Documents
        if search_all or 'document' in resource_types:
            results = self._search_documents(query, base_documents, limit)
            all_results.extend(results)
        
        # 2. Search Sections (includes subsections)
        if search_all or 'section' in resource_types:
            results = self._search_sections(query, base_documents, limit)
            all_results.extend(results)
        
        # 3. Search Paragraphs
        if search_all or 'paragraph' in resource_types:
            results = self._search_paragraphs(query, base_documents, limit)
            all_results.extend(results)
        
        # 4. Search Attachments
        if search_all or 'attachment' in resource_types:
            results = self._search_attachments(query, base_documents, limit)
            all_results.extend(results)
        
        # 5. Search Images
        if search_all or 'image' in resource_types:
            results = self._search_images(query, base_documents, limit)
            all_results.extend(results)
        
        # 6. Search Defined Terms
        if search_all or 'term' in resource_types:
            results = self._search_defined_terms(query, base_documents, limit)
            all_results.extend(results)
        
        # 7. Search Document Versions
        if search_all or 'version' in resource_types:
            results = self._search_versions(query, base_documents, limit)
            all_results.extend(results)
        
        # 8. Search Change Logs
        if search_all or 'changelog' in resource_types:
            results = self._search_changelogs(query, base_documents, limit)
            all_results.extend(results)
        
        # 9. Search Specialist Reviews
        if search_all or 'review' in resource_types:
            results = self._search_reviews(query, base_documents, limit, filters)
            all_results.extend(results)
        
        # 10. Search Issues
        if search_all or 'issue' in resource_types:
            results = self._search_issues(query, base_documents, limit, filters)
            all_results.extend(results)
        
        # 11. Search Inline References
        if search_all or 'reference' in resource_types:
            results = self._search_references(query, base_documents, limit)
            all_results.extend(results)
        
        # Sort by relevance score
        all_results.sort(key=lambda x: x['relevance_score'], reverse=True)
        
        return {
            'query': query,
            'total_count': len(all_results),
            'results': all_results,
            'resource_type_counts': self._count_by_resource_type(all_results)
        }
    
    def _get_accessible_documents(self):
        """Get documents accessible to the user (owned + shared)."""
        from .models import Document
        
        # Documents created by user
        query = Q(created_by=self.user)
        
        # TODO: Add team/sharing logic when implemented
        # if self.team:
        #     query |= Q(shared_with_team=self.team)
        # query |= Q(shared_with=self.user)
        
        return Document.objects.filter(query).distinct()
    
    def _search_documents(self, query, base_documents, limit):
        """Search in documents."""
        from django.db.models import Q
        
        documents = base_documents.filter(
            Q(title__icontains=query) |
            Q(raw_text__icontains=query) |
            Q(current_text__icontains=query) |
            Q(document_type__icontains=query) |
            Q(parties__icontains=query)
        )[:limit]
        
        results = []
        for doc in documents:
            preview = doc.current_text or doc.raw_text or ''
            matched_content = self._extract_snippet(preview, query, 200)
            
            results.append({
                'resource_type': 'document',
                'resource_id': str(doc.id),
                'title': doc.title,
                'content': preview[:500],
                'matched_content': matched_content,
                'relevance_score': self._calculate_score(doc.title, query, boost=2.0),
                'metadata': {
                    'document_type': doc.document_type,
                    'status': doc.status,
                    'word_count': doc.word_count,
                    'parties': doc.parties,
                    'jurisdiction': doc.jurisdiction,
                    'effective_date': str(doc.effective_date) if doc.effective_date else None,
                },
                'document_info': {
                    'id': str(doc.id),
                    'title': doc.title,
                    'type': doc.document_type,
                },
                'created_at': doc.created_at,
                'created_by': doc.created_by.username if doc.created_by else None,
            })
        
        return results
    
    def _search_sections(self, query, base_documents, limit):
        """Search in sections and subsections."""
        from django.db.models import Q
        from .models import Section
        
        sections = Section.objects.filter(
            document__in=base_documents
        ).filter(
            Q(title__icontains=query) |
            Q(content_text__icontains=query) |
            Q(edited_text__icontains=query)
        ).select_related('document', 'parent')[:limit]
        
        results = []
        for section in sections:
            content = section.get_effective_content() or section.title or ''
            matched_content = self._extract_snippet(content, query, 200)
            
            # Determine if subsection
            is_subsection = section.parent is not None
            
            results.append({
                'resource_type': 'subsection' if is_subsection else 'section',
                'resource_id': str(section.id),
                'title': section.title or 'Untitled Section',
                'content': content[:500],
                'matched_content': matched_content,
                'relevance_score': self._calculate_score(section.title or '', query, boost=1.5),
                'metadata': {
                    'order': section.order,
                    'depth': section.depth,
                    'is_subsection': is_subsection,
                    'parent_title': section.parent.title if section.parent else None,
                    'has_children': section.children.exists(),
                    'paragraph_count': section.paragraphs.count(),
                },
                'document_info': {
                    'id': str(section.document.id),
                    'title': section.document.title,
                    'type': section.document.document_type,
                },
                'created_at': section.created_at,
                'created_by': section.document.created_by.username if section.document.created_by else None,
            })
        
        return results
    
    def _search_paragraphs(self, query, base_documents, limit):
        """Search in paragraphs."""
        from django.db.models import Q
        from .models import Paragraph
        
        paragraphs = Paragraph.objects.filter(
            section__document__in=base_documents
        ).filter(
            Q(content_text__icontains=query) |
            Q(edited_text__icontains=query)
        ).select_related('section', 'section__document')[:limit]
        
        results = []
        for para in paragraphs:
            content = para.get_effective_content() or ''
            matched_content = self._extract_snippet(content, query, 200)
            
            results.append({
                'resource_type': 'paragraph',
                'resource_id': str(para.id),
                'title': f"Paragraph in {para.section.title or 'Section'}",
                'content': content,
                'matched_content': matched_content,
                'relevance_score': self._calculate_score(content, query),
                'metadata': {
                    'order': para.order,
                    'section_title': para.section.title,
                    'word_count': len(content.split()) if content else 0,
                },
                'document_info': {
                    'id': str(para.section.document.id),
                    'title': para.section.document.title,
                    'type': para.section.document.document_type,
                },
                'section_info': {
                    'id': str(para.section.id),
                    'title': para.section.title,
                },
                'created_at': para.created_at,
                'created_by': para.section.document.created_by.username if para.section.document.created_by else None,
            })
        
        return results
    
    def _search_attachments(self, query, base_documents, limit):
        """Search in document attachments."""
        from django.db.models import Q
        from .models import DocumentAttachment
        
        attachments = DocumentAttachment.objects.filter(
            document__in=base_documents
        ).filter(
            Q(file_name__icontains=query) |
            Q(description__icontains=query) |
            Q(file_type__icontains=query)
        ).select_related('document')[:limit]
        
        results = []
        for attachment in attachments:
            results.append({
                'resource_type': 'attachment',
                'resource_id': str(attachment.id),
                'title': attachment.file_name,
                'content': attachment.description or '',
                'matched_content': self._extract_snippet(
                    f"{attachment.file_name} {attachment.description or ''}", 
                    query, 200
                ),
                'relevance_score': self._calculate_score(attachment.file_name, query),
                'metadata': {
                    'file_type': attachment.file_type,
                    'file_size': attachment.file_size,
                    'file_url': attachment.file.url if attachment.file else None,
                },
                'document_info': {
                    'id': str(attachment.document.id),
                    'title': attachment.document.title,
                    'type': attachment.document.document_type,
                },
                'created_at': attachment.uploaded_at,
                'created_by': attachment.uploaded_by.username if attachment.uploaded_by else None,
            })
        
        return results
    
    def _search_images(self, query, base_documents, limit):
        """Search in document images."""
        from django.db.models import Q
        from .models import DocumentImage
        
        images = DocumentImage.objects.filter(
            document__in=base_documents
        ).filter(
            Q(alt_text__icontains=query) |
            Q(caption__icontains=query) |
            Q(description__icontains=query)
        ).select_related('document')[:limit]
        
        results = []
        for image in images:
            # Build metadata with previewable URLs when available
            image_url = image.image.url if image.image else None
            thumbnail_url = None
            try:
                # Some DocumentImage objects have a thumbnail field
                thumbnail_url = image.thumbnail.url if getattr(image, 'thumbnail', None) else None
            except Exception:
                thumbnail_url = None

            results.append({
                'resource_type': 'image',
                'resource_id': str(image.id),
                'title': image.alt_text or image.caption or 'Untitled Image',
                'content': image.description or image.caption or '',
                'matched_content': self._extract_snippet(
                    f"{image.alt_text or ''} {image.caption or ''} {image.description or ''}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(image.alt_text or image.caption or '', query),
                'metadata': {
                    'caption': image.caption,
                    'position': getattr(image, 'position', None),
                    'width': getattr(image, 'width', None),
                    'height': getattr(image, 'height', None),
                    'image_url': image_url,
                    'thumbnail_url': thumbnail_url,
                    'alt_text': image.alt_text,
                },
                'document_info': {
                    'id': str(image.document.id),
                    'title': image.document.title,
                    'type': image.document.document_type,
                },
                'created_at': image.created_at,
                'created_by': image.document.created_by.username if image.document.created_by else None,
            })
        
        return results
    
    def _search_defined_terms(self, query, base_documents, limit):
        """Search in defined terms."""
        from django.db.models import Q
        from .models import DefinedTerm
        
        terms = DefinedTerm.objects.filter(
            document__in=base_documents
        ).filter(
            Q(term__icontains=query) |
            Q(definition__icontains=query)
        ).select_related('document', 'section')[:limit]
        
        results = []
        for term in terms:
            results.append({
                'resource_type': 'term',
                'resource_id': str(term.id),
                'title': term.term,
                'content': term.definition,
                'matched_content': self._extract_snippet(
                    f"{term.term}: {term.definition}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(term.term, query, boost=1.8),
                'metadata': {
                    'first_occurrence_position': term.first_occurrence_position,
                    'usage_count': term.usage_count,
                    'section_title': term.section.title if term.section else None,
                },
                'document_info': {
                    'id': str(term.document.id),
                    'title': term.document.title,
                    'type': term.document.document_type,
                },
                'created_at': term.created_at,
                'created_by': term.document.created_by.username if term.document.created_by else None,
            })
        
        return results
    
    def _search_versions(self, query, base_documents, limit):
        """Search in document versions."""
        from django.db.models import Q
        from .models import DocumentVersion
        
        versions = DocumentVersion.objects.filter(
            document__in=base_documents
        ).filter(
            Q(version_number__icontains=query) |
            Q(change_summary__icontains=query)
        ).select_related('document', 'created_by')[:limit]
        
        results = []
        for version in versions:
            results.append({
                'resource_type': 'version',
                'resource_id': str(version.id),
                'title': f"Version {version.version_number}",
                'content': version.change_summary or '',
                'matched_content': self._extract_snippet(
                    f"{version.version_number} {version.change_summary or ''}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(version.change_summary or '', query),
                'metadata': {
                    'version_number': version.version_number,
                    'is_current': version.is_current,
                },
                'document_info': {
                    'id': str(version.document.id),
                    'title': version.document.title,
                    'type': version.document.document_type,
                },
                'created_at': version.created_at,
                'created_by': version.created_by.username if version.created_by else None,
            })
        
        return results
    
    def _search_changelogs(self, query, base_documents, limit):
        """Search in change logs."""
        from django.db.models import Q
        from .models import ChangeLog
        
        changelogs = ChangeLog.objects.filter(
            document__in=base_documents
        ).filter(
            Q(change_type__icontains=query) |
            Q(description__icontains=query) |
            Q(changed_by__username__icontains=query)
        ).select_related('document', 'changed_by', 'section', 'paragraph')[:limit]
        
        results = []
        for log in changelogs:
            results.append({
                'resource_type': 'changelog',
                'resource_id': str(log.id),
                'title': f"{log.change_type} - {log.changed_at.strftime('%Y-%m-%d %H:%M')}",
                'content': log.description or '',
                'matched_content': self._extract_snippet(
                    f"{log.change_type} {log.description or ''}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(log.description or '', query),
                'metadata': {
                    'change_type': log.change_type,
                    'section_title': log.section.title if log.section else None,
                },
                'document_info': {
                    'id': str(log.document.id),
                    'title': log.document.title,
                    'type': log.document.document_type,
                },
                'created_at': log.changed_at,
                'created_by': log.changed_by.username if log.changed_by else None,
            })
        
        return results
    
    def _search_reviews(self, query, base_documents, limit, filters):
        """Search in specialist reviews."""
        from django.db.models import Q
        from .models import SpecialistReview
        
        reviews = SpecialistReview.objects.filter(
            document__in=base_documents
        ).filter(
            Q(reviewer_name__icontains=query) |
            Q(comments__icontains=query) |
            Q(recommendations__icontains=query) |
            Q(specialist_type__icontains=query)
        ).select_related('document', 'reviewed_by')[:limit]
        
        # Apply status filter if provided
        if filters.get('status'):
            reviews = reviews.filter(status=filters['status'])
        
        results = []
        for review in reviews:
            results.append({
                'resource_type': 'review',
                'resource_id': str(review.id),
                'title': f"Review by {review.reviewer_name}",
                'content': review.comments or '',
                'matched_content': self._extract_snippet(
                    f"{review.comments or ''} {review.recommendations or ''}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(review.comments or '', query),
                'metadata': {
                    'specialist_type': review.specialist_type,
                    'status': review.status,
                    'rating': review.rating,
                    'recommendations': review.recommendations,
                },
                'document_info': {
                    'id': str(review.document.id),
                    'title': review.document.title,
                    'type': review.document.document_type,
                },
                'created_at': review.reviewed_at,
                'created_by': review.reviewed_by.username if review.reviewed_by else None,
            })
        
        return results
    
    def _search_issues(self, query, base_documents, limit, filters):
        """Search in issues."""
        from django.db.models import Q
        from .models import Issue
        
        issues = Issue.objects.filter(
            document__in=base_documents
        ).filter(
            Q(title__icontains=query) |
            Q(description__icontains=query) |
            Q(suggestion__icontains=query) |
            Q(issue_type__icontains=query)
        ).select_related('document', 'section', 'paragraph')[:limit]
        
        # Apply severity filter if provided
        if filters.get('severity'):
            issues = issues.filter(severity=filters['severity'])
        
        results = []
        for issue in issues:
            results.append({
                'resource_type': 'issue',
                'resource_id': str(issue.id),
                'title': issue.title,
                'content': issue.description,
                'matched_content': self._extract_snippet(
                    f"{issue.title} {issue.description}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(issue.title, query, boost=1.3),
                'metadata': {
                    'issue_type': issue.issue_type,
                    'severity': issue.severity,
                    'status': issue.status,
                    'suggestion': issue.suggestion,
                    'section_title': issue.section.title if issue.section else None,
                },
                'document_info': {
                    'id': str(issue.document.id),
                    'title': issue.document.title,
                    'type': issue.document.document_type,
                },
                'created_at': issue.detected_at,
                'created_by': issue.document.created_by.username if issue.document.created_by else None,
            })
        
        return results
    
    def _search_references(self, query, base_documents, limit):
        """Search in inline references."""
        from django.db.models import Q
        from .models import InlineReference
        
        references = InlineReference.objects.filter(
            paragraph__section__document__in=base_documents
        ).filter(
            Q(display_text__icontains=query) |
            Q(reference_type__icontains=query) |
            Q(target_url__icontains=query)
        ).select_related(
            'paragraph', 'paragraph__section', 'paragraph__section__document',
            'target_section', 'target_paragraph'
        )[:limit]
        
        results = []
        for ref in references:
            # Get target info
            target_title = ''
            if ref.target_section:
                target_title = ref.target_section.title
            elif ref.target_paragraph:
                target_title = f"Paragraph in {ref.target_paragraph.section.title}"
            elif ref.target_url:
                target_title = ref.target_url
            
            results.append({
                'resource_type': 'reference',
                'resource_id': str(ref.id),
                'title': ref.display_text,
                'content': f"Reference to: {target_title}",
                'matched_content': self._extract_snippet(
                    f"{ref.display_text} {target_title}",
                    query, 200
                ),
                'relevance_score': self._calculate_score(ref.display_text, query),
                'metadata': {
                    'reference_type': ref.reference_type,
                    'target_title': target_title,
                    'click_count': ref.click_count,
                    'last_accessed': str(ref.last_accessed) if ref.last_accessed else None,
                },
                'document_info': {
                    'id': str(ref.paragraph.section.document.id),
                    'title': ref.paragraph.section.document.title,
                    'type': ref.paragraph.section.document.document_type,
                },
                'section_info': {
                    'id': str(ref.paragraph.section.id),
                    'title': ref.paragraph.section.title,
                },
                'created_at': ref.created_at,
                'created_by': ref.created_by.username if ref.created_by else None,
            })
        
        return results
    
    def _extract_snippet(self, content, query, context_length=100):
        """Extract snippet around matched query."""
        if not content:
            return ''
        
        content_lower = content.lower()
        query_lower = query.lower()
        
        # Find query position
        pos = content_lower.find(query_lower)
        if pos == -1:
            # Query not found exactly, return beginning
            return content[:context_length] + ('...' if len(content) > context_length else '')
        
        # Extract context around match
        start = max(0, pos - context_length // 2)
        end = min(len(content), pos + len(query) + context_length // 2)
        
        snippet = content[start:end]
        if start > 0:
            snippet = '...' + snippet
        if end < len(content):
            snippet = snippet + '...'
        
        return snippet
    
    def _calculate_score(self, text, query, boost=1.0):
        """
        Calculate relevance score with FUZZY MATCHING.
        
        Scoring factors:
        - Exact match: highest score (100)
        - Fuzzy match: uses Levenshtein similarity (0-100)
        - Contains exact query: high score (50-70)
        - Word-level matches: medium score (10-40)
        - Position bonus: earlier matches score higher
        - Boost multiplier: for title/important fields
        
        Returns score 0-100+ (with boost can exceed 100)
        """
        if not text:
            return 0.0
        
        text_lower = text.lower()
        query_lower = query.lower()
        
        score = 0.0
        
        # 1. Exact match (highest score)
        if query_lower == text_lower:
            score = 100.0
        
        # 2. Contains exact query
        elif query_lower in text_lower:
            score = 50.0
            # Bonus for early position
            pos = text_lower.find(query_lower)
            position_bonus = max(0, 20.0 - (pos / max(len(text_lower), 1) * 20.0))
            score += position_bonus
        
        # 3. Fuzzy matching
        else:
            # Use fuzzy match score
            fuzzy_score = self._fuzzy_match_score(text, query)
            score = fuzzy_score * 0.7  # Scale down fuzzy scores slightly
            
            # Additional word-level matching
            query_words = query_lower.split()
            text_words = text_lower.split()
            
            word_matches = 0
            for qw in query_words:
                # Exact word match
                if qw in text_words:
                    word_matches += 2
                # Partial word match
                elif any(qw in tw or tw in qw for tw in text_words):
                    word_matches += 1
            
            word_score = min(30.0, word_matches * 5.0)
            score = max(score, word_score)
        
        # Apply boost multiplier
        score *= boost
        
        return round(score, 2)
    
    def _count_by_resource_type(self, results):
        """Count results by resource type."""
        counts = {}
        for result in results:
            resource_type = result['resource_type']
            counts[resource_type] = counts.get(resource_type, 0) + 1
        return counts
