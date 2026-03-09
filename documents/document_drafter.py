"""
Document Drafting Service
Leverages the established document structure to make drafting easier.
"""
from typing import Dict, List, Optional
from datetime import datetime, date
from django.contrib.auth.models import User
from .models import Document, Section, Paragraph, Sentence


class DocumentTemplate:
    """Base template structure for legal documents"""
    
    # Common legal document templates
    # Placeholders use [[lowercase_name]] format — the document editor's native
    # placeholder system renders these as inline chips that link to metadata.
    TEMPLATES = {
        'service_agreement': {
            'title': 'Service Agreement',
            'document_type': 'contract',
            'category': 'contract',
            'sections': [
                {'title': 'Parties', 'content': 'This Agreement is entered into between [[service_provider]] ("Provider") and [[client_name]] ("Client").'},
                {'title': 'Services', 'content': 'Provider agrees to provide the following services: [[services_description]]'},
                {'title': 'Term', 'content': 'This Agreement shall commence on [[start_date]] and continue for [[term_length]].'},
                {'title': 'Compensation', 'content': 'Client agrees to pay Provider [[amount]] [[currency]] for the services rendered.'},
                {'title': 'Payment Terms', 'content': 'Payment shall be made [[payment_schedule]] within [[due_days]] days of invoice.'},
                {'title': 'Termination', 'content': 'Either party may terminate this Agreement with [[notice_period]] written notice.'},
                {'title': 'Confidentiality', 'content': 'Both parties agree to maintain confidentiality of proprietary information for [[confidentiality_period]].'},
                {'title': 'Governing Law', 'content': 'This Agreement shall be governed by the laws of [[governing_law]].'},
            ]
        },
        'nda': {
            'title': 'Non-Disclosure Agreement',
            'document_type': 'nda',
            'category': 'nda',
            'sections': [
                {'title': 'Parties', 'content': 'This Non-Disclosure Agreement ("Agreement") is entered into by and between [[disclosing_party]] and [[receiving_party]].'},
                {'title': 'Definition of Confidential Information', 'content': 'Confidential Information includes all information disclosed by either party that is marked as confidential or should reasonably be considered confidential.'},
                {'title': 'Obligations', 'content': 'The receiving party agrees to: (a) maintain confidentiality, (b) not disclose to third parties, (c) use only for authorized purposes.'},
                {'title': 'Term', 'content': 'This Agreement shall remain in effect for [[confidentiality_period]] from the date of disclosure.'},
                {'title': 'Exceptions', 'content': 'Confidential Information does not include information that: (a) is publicly available, (b) was known prior to disclosure, (c) is independently developed.'},
                {'title': 'Return of Materials', 'content': 'Upon termination, all confidential materials shall be returned or destroyed.'},
                {'title': 'Remedies', 'content': 'The parties acknowledge that breach may cause irreparable harm and agree to equitable relief.'},
                {'title': 'Governing Law', 'content': 'This Agreement shall be governed by the laws of [[governing_law]].'},
            ]
        },
        'employment_contract': {
            'title': 'Employment Agreement',
            'document_type': 'contract',
            'category': 'contract',
            'sections': [
                {'title': 'Parties', 'content': 'This Employment Agreement is between [[company_name]] ("Employer") and [[employee_name]] ("Employee").'},
                {'title': 'Position and Duties', 'content': 'Employee shall serve as [[job_title]] and perform duties as assigned.'},
                {'title': 'Compensation', 'content': 'Employee shall receive an annual salary of [[salary_amount]] [[currency]], payable [[payment_frequency]].'},
                {'title': 'Benefits', 'content': 'Employee is entitled to: [[benefits_list]]'},
                {'title': 'Working Hours', 'content': 'Standard working hours are [[hours_per_week]] hours per week.'},
                {'title': 'Vacation and Leave', 'content': 'Employee is entitled to [[vacation_days]] days of paid vacation annually.'},
                {'title': 'Confidentiality', 'content': 'Employee agrees to maintain confidentiality of all proprietary information.'},
                {'title': 'Intellectual Property', 'content': 'All work product created during employment belongs to Employer.'},
                {'title': 'Termination', 'content': 'Employment may be terminated by either party with [[notice_period]] notice.'},
                {'title': 'Governing Law', 'content': 'This Agreement shall be governed by the laws of [[governing_law]].'},
            ]
        },
        'lease_agreement': {
            'title': 'Lease Agreement',
            'document_type': 'contract',
            'category': 'contract',
            'sections': [
                {'title': 'Parties', 'content': 'This Lease Agreement is between [[landlord_name]] ("Landlord") and [[tenant_name]] ("Tenant").'},
                {'title': 'Property', 'content': 'Landlord agrees to lease the property located at [[property_address]].'},
                {'title': 'Term', 'content': 'The lease term begins on [[start_date]] and ends on [[end_date]].'},
                {'title': 'Rent', 'content': 'Tenant agrees to pay monthly rent of [[rent_amount]] [[currency]] due on the [[due_day]] of each month.'},
                {'title': 'Security Deposit', 'content': 'Tenant shall pay a security deposit of [[deposit_amount]] [[currency]].'},
                {'title': 'Use of Property', 'content': 'The property shall be used exclusively for residential purposes.'},
                {'title': 'Maintenance and Repairs', 'content': 'Landlord is responsible for major repairs; Tenant is responsible for routine maintenance.'},
                {'title': 'Utilities', 'content': 'Tenant is responsible for: [[utilities_list]]'},
                {'title': 'Termination', 'content': 'Either party may terminate with [[notice_period]] written notice.'},
                {'title': 'Governing Law', 'content': 'This Agreement shall be governed by the laws of [[governing_law]].'},
            ]
        },
        'licensing_agreement': {
            'title': 'License Agreement',
            'document_type': 'license',
            'category': 'license',
            'sections': [
                {'title': 'Parties', 'content': 'This License Agreement is between [[licensor_name]] ("Licensor") and [[licensee_name]] ("Licensee").'},
                {'title': 'Grant of License', 'content': 'Licensor grants Licensee a [[license_type]] license to use [[licensed_property]].'},
                {'title': 'Scope of Use', 'content': 'Licensee may use the licensed property for: [[permitted_uses]]'},
                {'title': 'Restrictions', 'content': 'Licensee shall not: (a) modify, (b) redistribute, (c) reverse engineer the licensed property.'},
                {'title': 'License Fee', 'content': 'Licensee agrees to pay [[license_fee]] [[currency]] [[payment_schedule]].'},
                {'title': 'Term', 'content': 'This license is effective from [[start_date]] and continues for [[term_length]].'},
                {'title': 'Intellectual Property', 'content': 'All rights, title, and interest remain with Licensor.'},
                {'title': 'Warranties', 'content': 'Licensor warrants that it has the right to grant this license.'},
                {'title': 'Termination', 'content': 'License may be terminated upon [[termination_conditions]].'},
                {'title': 'Governing Law', 'content': 'This Agreement shall be governed by the laws of [[governing_law]].'},
            ]
        }
    }


class DocumentDrafter:
    """
    Service for creating structured legal documents using templates and AI assistance.
    """
    
    @staticmethod
    def create_from_template(
        template_name: str,
        user: User,
        metadata: Optional[Dict] = None,
        replacements: Optional[Dict] = None
    ) -> Document:
        """
        Create a new document from a template with metadata and variable replacements.
        
        Args:
            template_name: Name of the template (e.g., 'service_agreement', 'nda')
            user: User creating the document
            metadata: Dictionary of document metadata (parties, dates, amounts, etc.)
            replacements: Dictionary of placeholder replacements
            
        Returns:
            Created Document object with full structure
        """
        if template_name not in DocumentTemplate.TEMPLATES:
            raise ValueError(f"Template '{template_name}' not found")
        
        template = DocumentTemplate.TEMPLATES[template_name]
        metadata = metadata or {}
        replacements = replacements or {}
        
        # Create the document with metadata
        # Build document_metadata for fields not on the model directly
        doc_metadata = metadata.get('document_metadata', {})
        if metadata.get('contract_value'):
            doc_metadata.setdefault('financial', {})['contract_value'] = metadata['contract_value']
        if metadata.get('currency'):
            doc_metadata.setdefault('financial', {})['currency'] = metadata['currency']
        if metadata.get('payment_terms'):
            doc_metadata.setdefault('financial', {})['payment_terms'] = metadata['payment_terms']
        if metadata.get('notice_period'):
            doc_metadata.setdefault('terms', {})['notice_period'] = metadata['notice_period']
        if metadata.get('confidentiality_period'):
            doc_metadata.setdefault('terms', {})['confidentiality_period'] = metadata['confidentiality_period']
        if metadata.get('nda_type'):
            doc_metadata.setdefault('terms', {})['nda_type'] = metadata['nda_type']

        document = Document.objects.create(
            title=metadata.get('title', template['title']),
            document_type=template['document_type'],
            category=template['category'],
            created_by=user,
            last_modified_by=user,
            status='draft',
            is_draft=True,
            author=metadata.get('author', user.get_full_name() or user.username),
            
            # Parties
            parties=metadata.get('parties', []),
            signatories=metadata.get('signatories', []),
            
            # Dates
            effective_date=metadata.get('effective_date'),
            expiration_date=metadata.get('expiration_date'),
            
            # Legal
            governing_law=metadata.get('governing_law'),
            term_length=metadata.get('term_length'),
            
            # Other
            jurisdiction=metadata.get('jurisdiction'),
            document_metadata=doc_metadata,
            custom_metadata=metadata.get('custom_metadata', {})
        )
        
        # Build full document text and create structure
        full_text_parts = []
        char_position = 0
        
        for order, section_template in enumerate(template['sections']):
            # Apply replacements to section content
            # Placeholders are [[lowercase_name]] format
            section_content = section_template['content']
            for key, value in replacements.items():
                section_content = section_content.replace(f'[[{key.lower()}]]', str(value))
            
            section_title = section_template['title']
            section_full_text = f"{order + 1}. {section_title}\n\n{section_content}\n\n"
            
            # Create Section (let Django auto-generate UUID)
            section = Section.objects.create(
                document=document,
                title=section_title,
                content_start=char_position,
                content_end=char_position + len(section_full_text),
                content_text=section_full_text,
                order=order,
                depth_level=1
            )
            
            # Create Paragraph (let Django auto-generate UUID)
            para_start = char_position + len(f"{order + 1}. {section_title}\n\n")
            paragraph = Paragraph.objects.create(
                section=section,
                content_start=para_start,
                content_end=para_start + len(section_content),
                content_text=section_content,
                order=0
            )
            
            # Create Sentences
            sentences = DocumentDrafter._split_into_sentences(section_content)
            sent_position = para_start
            for sent_order, sentence_text in enumerate(sentences):
                Sentence.objects.create(
                    paragraph=paragraph,
                    content_start=sent_position,
                    content_end=sent_position + len(sentence_text),
                    content_text=sentence_text,
                    order=sent_order
                )
                sent_position += len(sentence_text) + 1
            
            full_text_parts.append(section_full_text)
            char_position += len(section_full_text)
        
        # Update document with full text
        document.raw_text = ''.join(full_text_parts)
        document.current_text = document.raw_text
        document.save()
        
        return document
    
    @staticmethod
    def create_structured_document(
        user: User,
        title: str,
        sections_data: List[Dict],
        metadata: Optional[Dict] = None
    ) -> Document:
        """
        Create a fully structured document from custom sections.
        
        Args:
            user: User creating the document
            title: Document title
            sections_data: List of section dictionaries with 'title' and 'content'
            metadata: Optional document metadata
            
        Returns:
            Created Document object
        """
        metadata = metadata or {}
        
        # Create document
        document = Document.objects.create(
            title=title,
            document_type=metadata.get('document_type', 'contract'),
            category=metadata.get('category', 'contract'),
            created_by=user,
            last_modified_by=user,
            status='draft',
            is_draft=True,
            author=metadata.get('author', user.get_full_name() or user.username),
            
            # Apply metadata
            parties=metadata.get('parties', []),
            signatories=metadata.get('signatories', []),
            effective_date=metadata.get('effective_date'),
            expiration_date=metadata.get('expiration_date'),
            contract_value=metadata.get('contract_value'),
            currency=metadata.get('currency', 'USD'),
            governing_law=metadata.get('governing_law'),
            jurisdiction=metadata.get('jurisdiction'),
            custom_metadata=metadata.get('custom_metadata', {})
        )
        
        # Build structured content
        full_text_parts = []
        char_position = 0
        
        for order, section_data in enumerate(sections_data):
            section_title = section_data.get('title', f'Section {order + 1}')
            section_content = section_data.get('content', '')
            paragraphs_data = section_data.get('paragraphs', [section_content])
            
            section_full_text = f"{order + 1}. {section_title}\n\n"
            section_start = char_position
            char_position += len(section_full_text)
            
            # Create Section (let Django auto-generate UUID)
            section = Section.objects.create(
                document=document,
                title=section_title,
                content_start=section_start,
                content_end=0,  # Will update after paragraphs
                content_text='',  # Will update after paragraphs
                order=order,
                depth_level=1
            )
            
            # Create Paragraphs
            section_text_parts = [f"{order + 1}. {section_title}\n\n"]
            
            for para_order, para_text in enumerate(paragraphs_data):
                if isinstance(para_text, dict):
                    para_content = para_text.get('content', '')
                else:
                    para_content = para_text
                
                # Create Paragraph (let Django auto-generate UUID)
                para_start = char_position
                paragraph = Paragraph.objects.create(
                    section=section,
                    content_start=para_start,
                    content_end=para_start + len(para_content),
                    content_text=para_content,
                    order=para_order
                )
                
                # Create Sentences
                sentences = DocumentDrafter._split_into_sentences(para_content)
                sent_position = para_start
                for sent_order, sentence_text in enumerate(sentences):
                    Sentence.objects.create(
                        paragraph=paragraph,
                        content_start=sent_position,
                        content_end=sent_position + len(sentence_text),
                        content_text=sentence_text,
                        order=sent_order
                    )
                    sent_position += len(sentence_text) + 1
                
                section_text_parts.append(para_content + '\n\n')
                char_position += len(para_content) + 2
            
            # Update section with complete text
            section_full = ''.join(section_text_parts)
            section.content_text = section_full
            section.content_end = char_position
            section.save()
            
            full_text_parts.append(section_full)
        
        # Update document with full text
        document.raw_text = ''.join(full_text_parts)
        document.current_text = document.raw_text
        document.save()
        
        return document
    
    @staticmethod
    def _split_into_sentences(text: str) -> List[str]:
        """Split text into sentences using simple rules."""
        import re
        # Simple sentence splitting (can be enhanced)
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        return [s for s in sentences if s]
    
    @staticmethod
    def get_available_templates() -> List[Dict]:
        """Get list of available document templates."""
        return [
            {
                'key': key,
                'name': key,
                'title': value['title'],
                'type': value['document_type'],
                'category': value['category'],
                'sections_count': len(value['sections']),
                'sections': [
                    {'title': s['title'], 'preview': s['content'][:120]}
                    for s in value['sections']
                ],
            }
            for key, value in DocumentTemplate.TEMPLATES.items()
        ]
    
    @staticmethod
    def get_template_placeholders(template_name: str) -> List[str]:
        """Get list of placeholders in a template."""
        if template_name not in DocumentTemplate.TEMPLATES:
            return []
        
        template = DocumentTemplate.TEMPLATES[template_name]
        placeholders = set()
        
        import re
        for section in template['sections']:
            matches = re.findall(r'\[\[([a-z_]+)\]\]', section['content'])
            placeholders.update(matches)
        
        return sorted(list(placeholders))
