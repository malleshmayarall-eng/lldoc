from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from typing import cast, Dict, Any, Tuple, List, Optional
from django.shortcuts import get_object_or_404
import os
import re

from .models import AIInteraction, DocumentAnalysisRun
from .serializers import (
	AIInteractionSerializer,
	DocumentAnalysisRunSerializer,
	AITextIngestSerializer,
	ParagraphPlaceholderUpdateSerializer,
	ParagraphAIReviewApplySerializer,
	ParagraphAIResultSerializer,
)
from documents.models import Document, DocumentScore, Paragraph, ParagraphAIResult
from documents.serializers import DocumentSerializer, DocumentScoreSerializer
from .gemini_ingest import generate_document_from_text, call_gemini
from .paragraph_ai.views import _compute_paragraph_ai_review
from .document_scoring import evaluate_document, evaluate_document_with_reasoning
from sharing.permissions import IsOwnerOrSharedWith


PLACEHOLDER_REGEX = re.compile(r'\[\[([a-zA-Z0-9_]+)\]\]')


def _get_document_ai_context(document, service_name: str = '') -> str:
	"""Fetch the effective AI context string for a document (system prompt, ai_focus, mode).
	If service_name is provided, uses the per-service system prompt instead of the global one."""
	try:
		from .models import DocumentAIConfig
		ai_cfg = DocumentAIConfig.get_or_create_for_document(document)
		return ai_cfg.get_document_ai_context(service_name=service_name)
	except Exception:
		return ''


def _deep_merge_dicts(base: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
	result = dict(base)
	for key, value in (incoming or {}).items():
		if isinstance(value, dict) and isinstance(result.get(key), dict):
			result[key] = _deep_merge_dicts(result.get(key, {}), value)
		else:
			result[key] = value
	return result


def _flatten_dict(data: Dict[str, Any], parent_key: str = '', sep: str = '.') -> Dict[str, Any]:
	items: Dict[str, Any] = {}
	for key, value in (data or {}).items():
		new_key = f"{parent_key}{sep}{key}" if parent_key else str(key)
		if isinstance(value, dict):
			items.update(_flatten_dict(value, new_key, sep=sep))
		else:
			items[new_key] = value
	return items


def _normalize_placeholder_key(key: str) -> str:
	base = key.split('.')[-1]
	base = re.sub(r'[^A-Za-z0-9]+', '_', base).strip('_')
	return base.lower()


def _build_placeholder_map(flat_metadata: Dict[str, Any]) -> Dict[str, str]:
	placeholder_map: Dict[str, str] = {}
	for key, value in (flat_metadata or {}).items():
		if value is None:
			continue
		if isinstance(value, dict):
			continue
		if isinstance(value, list):
			if all(isinstance(item, (str, int, float)) for item in value):
				value = ', '.join([str(item) for item in value])
			else:
				continue
		placeholder_key = _normalize_placeholder_key(str(key))
		placeholder_map[placeholder_key] = str(value)
	return placeholder_map


def _normalize_grammar(text: str) -> Tuple[str, bool]:
	if not text or not isinstance(text, str):
		return text, False
	if re.search(r'<[^>]+>', text):
		return text, False
	original = text
	corrected = re.sub(r'\s+', ' ', text).strip()
	corrected = re.sub(r'\s+([,.;:!?])', r'\1', corrected)
	corrected = re.sub(r'([,.;:!?])([A-Za-z])', r'\1 \2', corrected)
	if corrected and corrected[0].islower():
		corrected = corrected[0].upper() + corrected[1:]
	return corrected, corrected != original


def _apply_placeholders_to_text(text: str, placeholder_map: Dict[str, str]) -> Tuple[str, set]:
	processed = text
	detected = set()
	for placeholder, value in (placeholder_map or {}).items():
		if not value:
			continue
		if value in processed:
			processed = processed.replace(value, f'[[{placeholder}]]')
			detected.add(placeholder)
	detected.update(set(PLACEHOLDER_REGEX.findall(processed or '')))
	return processed, detected


def _resolve_placeholders_in_text(text: str, placeholder_map: Dict[str, str], overrides: Dict[str, str]) -> str:
	resolved = text
	if not isinstance(resolved, str):
		return resolved
	combined = dict(placeholder_map or {})
	for key, value in (overrides or {}).items():
		combined[str(key).lower()] = str(value)
	for placeholder, value in combined.items():
		resolved = resolved.replace(f'[[{placeholder}]]', value)
	return resolved


def _get_version_number(request, document: Document) -> Tuple[Optional[int], Optional[Response]]:
	version_raw = request.query_params.get('version_number')
	if not version_raw:
		return document.version_number, None
	try:
		return int(version_raw), None
	except (TypeError, ValueError):
		return None, Response(
			{'status': 'error', 'message': 'Invalid version_number.'},
			status=status.HTTP_400_BAD_REQUEST,
		)




class AIInteractionViewSet(viewsets.ModelViewSet):
	serializer_class = AIInteractionSerializer
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		queryset = AIInteraction.objects.all()
		document_id = self.request.query_params.get('document')
		if document_id:
			queryset = queryset.filter(document_id=document_id)
		return queryset

	def perform_create(self, serializer):
		serializer.save(requested_by=self.request.user)


class DocumentAnalysisRunViewSet(viewsets.ModelViewSet):
	serializer_class = DocumentAnalysisRunSerializer
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		queryset = DocumentAnalysisRun.objects.all()
		document_id = self.request.query_params.get('document')
		if document_id:
			queryset = queryset.filter(document_id=document_id)
		return queryset

	def perform_create(self, serializer):
		serializer.save(requested_by=self.request.user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def analyze_text(request):
	"""
	Analyse free-form text with AI and return extracted metadata **without**
	creating a document.  The frontend uses this to pre-fill the "Create
	Document" form so the user can review / edit before committing.

	Request body:
	{
		"text": "..."
	}

	Returns:
	{
		"status": "ok",
		"metadata": {
			"title": "...",
			"document_type": "...",
			"category": "...",
			"jurisdiction": "...",
			"governing_law": "...",
			"author": "...",
			"parties": [...],
			"effective_date": "...",
			"expiration_date": "...",
			"reference_number": "...",
			"term_length": "...",
			"custom_metadata": {...}
		}
	}
	"""
	serializer = AITextIngestSerializer(data=request.data)
	serializer.is_valid(raise_exception=True)
	data = cast(Dict[str, Any], serializer.validated_data)

	raw_text = data.get('text')
	if not raw_text:
		return Response(
			{'status': 'error', 'message': 'Text is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	result = generate_document_from_text(
		raw_text=raw_text or '',
		create_in_db=False,
	)

	structure = result.get('structure')
	if not structure:
		return Response(
			{
				'status': 'error',
				'message': 'AI could not extract metadata from the provided text.',
				'raw_response': result.get('llm_response'),
			},
			status=status.HTTP_400_BAD_REQUEST,
		)

	# Build a flat metadata dict from the parsed structure for the frontend
	metadata = {
		'title': structure.get('title') or '',
		'author': structure.get('author') or '',
		'document_type': structure.get('document_type') or 'contract',
		'category': structure.get('category') or 'contract',
		'jurisdiction': structure.get('jurisdiction') or '',
		'governing_law': structure.get('governing_law') or '',
		'reference_number': structure.get('reference_number') or '',
		'project_name': structure.get('project_name') or '',
		'effective_date': structure.get('effective_date') or '',
		'expiration_date': structure.get('expiration_date') or '',
		'execution_date': structure.get('execution_date') or '',
		'term_length': structure.get('term_length') or '',
		'auto_renewal': structure.get('auto_renewal') or False,
		'parties': structure.get('parties') or [],
		'signatories': structure.get('signatories') or [],
		'document_metadata': structure.get('document_metadata') or {},
		'custom_metadata': structure.get('custom_metadata') or {},
		'sections_count': len(structure.get('sections') or []),
	}

	return Response(
		{'status': 'ok', 'metadata': metadata},
		status=status.HTTP_200_OK,
	)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_setup_questions(request):
	"""
	POST /api/ai/document-questions/
	AI generates smart, context-aware questions for a specific document type/template.
	The questions are tailored to what metadata matters for that document.

	Request body:
	{
		"document_type": "contract",       // required
		"template_name": "service_agreement",  // optional
		"context": "consulting engagement"     // optional extra context
	}

	Returns:
	{
		"status": "ok",
		"questions": [
			{
				"id": "q1",
				"field": "title",
				"question": "What would you like to name this agreement?",
				"type": "text",
				"placeholder": "e.g. Master Service Agreement",
				"required": true,
				"group": "basics"
			},
			...
		]
	}
	"""
	doc_type = (request.data or {}).get('document_type', '').strip()
	template_name = (request.data or {}).get('template_name', '').strip()
	context_hint = (request.data or {}).get('context', '').strip()

	if not doc_type:
		return Response(
			{'status': 'error', 'message': 'document_type is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	# Build a prompt for Gemini to generate questions
	type_label = doc_type.replace('_', ' ').title()
	template_clause = f' using the "{template_name}" template' if template_name else ''
	context_clause = f'\nAdditional context from user: {context_hint}' if context_hint else ''

	prompt_text = (
		f"You are an expert legal document setup assistant. The user wants to create a "
		f"{type_label}{template_clause}.{context_clause}\n\n"
		f"Generate a JSON array of 6-10 smart questions to collect the most important information "
		f"for this document type. Each question should collect a specific piece of metadata that "
		f"matters for a {type_label}.\n\n"
		f"RULES:\n"
		f"- Questions should be natural, conversational, and specific to {type_label} documents\n"
		f"- Include questions for: parties involved, key dates, financial terms (if applicable), "
		f"jurisdiction/governing law, and any type-specific details\n"
		f"- Order questions from most important to least important\n"
		f"- Each question object must have these fields:\n"
		f'  - "id": unique string like "q1", "q2", etc.\n'
		f'  - "field": the metadata field this maps to (e.g. "title", "parties", "effective_date", '
		f'"governing_law", "jurisdiction", "term_length", "contract_value", "confidentiality_period", '
		f'"notice_period", "custom_field_name", etc.)\n'
		f'  - "question": natural language question\n'
		f'  - "type": one of "text", "date", "parties", "select", "number"\n'
		f'  - "placeholder": example answer\n'
		f'  - "required": boolean (true for the most critical 3-4 questions)\n'
		f'  - "group": one of "basics", "parties", "dates", "legal", "financial", "details"\n'
		f'  - "options": array of {{value, label}} only if type is "select"\n\n'
		f"Return ONLY a JSON array. No prose, no markdown fences.\n"
	)

	system_prompt = (
		"You are a legal document setup question generator. "
		"Return ONLY a valid JSON array of question objects. "
		"No markdown, no prose, no code fences. Just the raw JSON array."
	)

	try:
		result = generate_document_from_text(
			raw_text=prompt_text,
			system_prompt=system_prompt,
			create_in_db=False,
		)

		# The AI may return questions as the structure or as raw text
		# Try to parse from structure first, then from raw response
		import json as json_module

		questions = None
		structure = result.get('structure')

		# If structure is a list, it's already our questions
		if isinstance(structure, list):
			questions = structure
		elif isinstance(structure, dict):
			# Might be wrapped in a key
			questions = structure.get('questions') or structure.get('data')
			if not questions and isinstance(structure, dict):
				# Last resort: the structure itself might have question-like keys
				questions = None

		# If still no questions, try parsing from raw LLM response
		if not questions:
			raw_resp = result.get('llm_response')
			if raw_resp and isinstance(raw_resp, dict):
				# Try to extract text from Gemini response
				candidates = raw_resp.get('candidates', [])
				if candidates:
					parts = candidates[0].get('content', {}).get('parts', [])
					for part in parts:
						text = part.get('text', '')
						if text:
							# Try to parse JSON from the text
							text = text.strip()
							if text.startswith('```'):
								text = text.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
							try:
								questions = json_module.loads(text)
								break
							except (json_module.JSONDecodeError, ValueError):
								pass

		if not questions or not isinstance(questions, list):
			# Fallback: return smart defaults based on document type
			questions = _get_fallback_questions(doc_type, template_name)

		return Response(
			{'status': 'ok', 'questions': questions},
			status=status.HTTP_200_OK,
		)

	except Exception:
		# On any AI failure, return intelligent fallback questions
		questions = _get_fallback_questions(doc_type, template_name)
		return Response(
			{'status': 'ok', 'questions': questions, 'fallback': True},
			status=status.HTTP_200_OK,
		)


def _get_fallback_questions(doc_type, template_name=''):
	"""
	Return intelligent default questions when AI is unavailable.
	Questions are tailored per document type.
	"""
	base_questions = [
		{
			'id': 'q1', 'field': 'title', 'question': 'What would you like to name this document?',
			'type': 'text', 'placeholder': 'e.g. Service Agreement — Project Alpha',
			'required': True, 'group': 'basics'
		},
		{
			'id': 'q2', 'field': 'parties', 'question': 'Who are the parties involved?',
			'type': 'parties', 'placeholder': 'Add party names and roles',
			'required': True, 'group': 'parties'
		},
	]

	type_questions = {
		'contract': [
			{'id': 'q3', 'field': 'effective_date', 'question': 'When should this contract take effect?', 'type': 'date', 'placeholder': '', 'required': True, 'group': 'dates'},
			{'id': 'q4', 'field': 'term_length', 'question': 'How long should this contract last?', 'type': 'text', 'placeholder': 'e.g. 12 months, 2 years', 'required': False, 'group': 'dates'},
			{'id': 'q5', 'field': 'contract_value', 'question': 'What is the total contract value?', 'type': 'text', 'placeholder': 'e.g. $50,000 USD', 'required': False, 'group': 'financial'},
			{'id': 'q6', 'field': 'governing_law', 'question': 'Which state or country\'s law governs this contract?', 'type': 'text', 'placeholder': 'e.g. State of California', 'required': True, 'group': 'legal'},
			{'id': 'q7', 'field': 'jurisdiction', 'question': 'What is the legal jurisdiction?', 'type': 'text', 'placeholder': 'e.g. US-California', 'required': False, 'group': 'legal'},
			{'id': 'q8', 'field': 'payment_terms', 'question': 'What are the payment terms?', 'type': 'text', 'placeholder': 'e.g. Net 30 days from invoice', 'required': False, 'group': 'financial'},
		],
		'nda': [
			{'id': 'q3', 'field': 'effective_date', 'question': 'When does this NDA take effect?', 'type': 'date', 'placeholder': '', 'required': True, 'group': 'dates'},
			{'id': 'q4', 'field': 'confidentiality_period', 'question': 'How long should confidentiality obligations last?', 'type': 'text', 'placeholder': 'e.g. 3 years, 5 years', 'required': True, 'group': 'dates'},
			{'id': 'q5', 'field': 'nda_type', 'question': 'Is this a mutual or one-way NDA?', 'type': 'select', 'placeholder': '', 'required': True, 'group': 'details',
			 'options': [{'value': 'mutual', 'label': 'Mutual (both parties)'}, {'value': 'one_way', 'label': 'One-way (one discloser)'}]},
			{'id': 'q6', 'field': 'governing_law', 'question': 'Which jurisdiction\'s law governs this NDA?', 'type': 'text', 'placeholder': 'e.g. State of Delaware', 'required': True, 'group': 'legal'},
			{'id': 'q7', 'field': 'purpose', 'question': 'What is the purpose of sharing confidential information?', 'type': 'text', 'placeholder': 'e.g. Evaluating a potential business partnership', 'required': False, 'group': 'details'},
		],
		'license': [
			{'id': 'q3', 'field': 'licensed_property', 'question': 'What is being licensed?', 'type': 'text', 'placeholder': 'e.g. Software platform, Patent #12345', 'required': True, 'group': 'details'},
			{'id': 'q4', 'field': 'license_type', 'question': 'What type of license is this?', 'type': 'select', 'placeholder': '', 'required': True, 'group': 'details',
			 'options': [{'value': 'exclusive', 'label': 'Exclusive'}, {'value': 'non_exclusive', 'label': 'Non-exclusive'}, {'value': 'sole', 'label': 'Sole'}]},
			{'id': 'q5', 'field': 'effective_date', 'question': 'When does the license start?', 'type': 'date', 'placeholder': '', 'required': True, 'group': 'dates'},
			{'id': 'q6', 'field': 'license_fee', 'question': 'What is the license fee?', 'type': 'text', 'placeholder': 'e.g. $10,000/year', 'required': False, 'group': 'financial'},
			{'id': 'q7', 'field': 'governing_law', 'question': 'Which law governs this license?', 'type': 'text', 'placeholder': 'e.g. State of New York', 'required': True, 'group': 'legal'},
		],
		'policy': [
			{'id': 'q3', 'field': 'effective_date', 'question': 'When does this policy take effect?', 'type': 'date', 'placeholder': '', 'required': True, 'group': 'dates'},
			{'id': 'q4', 'field': 'department', 'question': 'Which department or team does this policy apply to?', 'type': 'text', 'placeholder': 'e.g. All employees, Engineering team', 'required': False, 'group': 'details'},
			{'id': 'q5', 'field': 'review_frequency', 'question': 'How often should this policy be reviewed?', 'type': 'text', 'placeholder': 'e.g. Annually, Every 6 months', 'required': False, 'group': 'details'},
			{'id': 'q6', 'field': 'jurisdiction', 'question': 'What jurisdiction does this policy apply to?', 'type': 'text', 'placeholder': 'e.g. United States', 'required': False, 'group': 'legal'},
		],
	}

	# Merge base with type-specific
	specific = type_questions.get(doc_type, type_questions.get('contract', []))
	return base_questions + specific


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def generate_from_prompt(request):
	"""
	Generate a complete legal document from a brief natural-language description.
	Uses the same Gemini pipeline as ingest_text but with a custom system prompt
	that instructs the AI to **draft** content rather than merely parse existing text.

	Request body:
	{
		"prompt": "A consulting services agreement between Acme Corp and ...",
		"document_type": "contract"   // optional hint
	}

	Returns the created document (same shape as ingest_text).
	"""
	prompt = (request.data or {}).get('prompt', '').strip()
	doc_type_hint = (request.data or {}).get('document_type', '')
	if not prompt:
		return Response(
			{'status': 'error', 'message': 'A prompt describing the document is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	# Build a synthetic "raw text" that the LLM will treat as instructions
	type_clause = f' The document type should be "{doc_type_hint}".' if doc_type_hint else ''

	# If a document type is provided, look up the preset's system prompt for
	# type-aligned generation
	preset_context = ''
	if doc_type_hint:
		try:
			from .models import DocumentTypeAIPreset
			preset = DocumentTypeAIPreset.objects.get(document_type=doc_type_hint)
			parts = []
			parts.append(f'DOCUMENT TYPE: {doc_type_hint}')
			if preset.system_prompt:
				parts.append(f'SYSTEM INSTRUCTIONS:\n{preset.system_prompt}')
			if preset.ai_focus:
				parts.append(f'AI FOCUS:\n{preset.ai_focus}')
			preset_context = (
				'--- DOCUMENT AI CONTEXT ---\n'
				+ '\n\n'.join(parts)
				+ '\n--- END DOCUMENT AI CONTEXT ---\n\n'
			)
		except Exception:
			pass

	user_text = (
		f"{preset_context}"
		f"IMPORTANT: The following is NOT existing document text to parse. It is a DESCRIPTION "
		f"of a document the user wants you to DRAFT from scratch.{type_clause}\n\n"
		f"User's request:\n{prompt}\n\n"
		f"Please generate a complete, professional legal document with full section content, "
		f"realistic placeholder values where specific details are unknown (use [PLACEHOLDER_NAME] format), "
		f"and thorough metadata. Make the document comprehensive and ready to customize."
	)

	result = generate_document_from_text(
		raw_text=user_text,
		create_in_db=True,
		created_by=request.user,
	)

	structure = result.get('structure')
	if not structure or not result.get('db_result'):
		return Response(
			{
				'status': 'error',
				'message': 'AI could not generate a document from the provided description.',
				'raw_response': result.get('llm_response'),
			},
			status=status.HTTP_400_BAD_REQUEST,
		)

	document_id = result['db_result'].get('document_id')
	document = None
	if document_id:
		document = Document.objects.filter(id=document_id).first()

	if not document:
		return Response(
			{'status': 'error', 'message': 'Document was not created successfully.'},
			status=status.HTTP_500_INTERNAL_SERVER_ERROR,
		)

	return Response(
		{'status': 'created', 'document': DocumentSerializer(document).data},
		status=status.HTTP_201_CREATED,
	)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ingest_text(request):
	"""
	Ingest free-form text and convert it into a structured document.

	Request body:
	{
		"text": "..."
	}
	"""
	serializer = AITextIngestSerializer(data=request.data)
	serializer.is_valid(raise_exception=True)
	data = cast(Dict[str, Any], serializer.validated_data)

	raw_text = data.get('text')
	if not raw_text:
		return Response(
			{
				'status': 'error',
				'message': 'Text is required.',
			},
			status=status.HTTP_400_BAD_REQUEST,
		)

	result = generate_document_from_text(
		raw_text=raw_text or '',
		create_in_db=True,
		created_by=request.user,
	)

	structure = result.get('structure')
	if not structure or not result.get('db_result'):
		return Response(
			{
				'status': 'error',
				'message': 'Gemini did not return a valid document structure.',
				'raw_response': result.get('llm_response'),
			},
			status=status.HTTP_400_BAD_REQUEST,
		)

	document_id = result['db_result'].get('document_id')
	document = None
	if document_id:
		document = Document.objects.filter(id=document_id).first()

	if not document:
		return Response(
			{
				'status': 'error',
				'message': 'Document was not created successfully.',
			},
			status=status.HTTP_500_INTERNAL_SERVER_ERROR,
		)

	return Response(
		{
			'status': 'created',
			'document': DocumentSerializer(document).data,
		},
		status=status.HTTP_201_CREATED,
	)


@api_view(['POST', 'GET'])
@permission_classes([IsAuthenticated])
def score_document(request, pk):
	"""POST: run LLM scoring for the document and persist results.
	   GET: return latest saved score for document `pk`.
	"""
	# Fetch document
	try:
		document = Document.objects.get(id=pk)
	except Document.DoesNotExist:
		return Response({'status': 'error', 'message': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

	# Check if document_scoring is enabled for this document
	try:
		from .models import DocumentAIConfig
		ai_cfg = DocumentAIConfig.get_or_create_for_document(document)
		if not ai_cfg.is_service_enabled('document_scoring'):
			return Response(
				{'status': 'disabled', 'message': 'Document scoring is disabled for this document.', 'service': 'document_scoring'},
				status=status.HTTP_200_OK,
			)
	except Exception:
		pass

	if request.method == 'GET':
		latest = DocumentScore.objects.filter(document=document).order_by('-analysis_timestamp').first()
		if not latest:
			return Response({'status': 'not_found', 'message': 'No score found for this document.'}, status=status.HTTP_404_NOT_FOUND)
		include_raw = request.query_params.get('raw', 'false').lower() == 'true'
		serializer = DocumentScoreSerializer(latest, context={'include_raw': include_raw})
		return Response({'status': 'ok', 'score': serializer.data}, status=status.HTTP_200_OK)

	# POST - run evaluation
	document_override = request.data.get('document_override') if isinstance(request.data, dict) else None
	# Fetch document AI context (system prompt, ai_focus, mode from config)
	document_context = _get_document_ai_context(document, service_name='document_scoring')
	score_obj, parsed, raw_resp = evaluate_document(
		document=document,
		created_by=request.user,
		document_override=document_override,
		document_context=document_context,
	)
	include_raw = request.query_params.get('raw', 'false').lower() == 'true'
	serializer = DocumentScoreSerializer(score_obj, context={'include_raw': include_raw})
	payload = {'status': 'scored', 'score': serializer.data}
	if include_raw:
		payload['llm_parsed'] = parsed
		payload['llm_raw_response'] = raw_resp
	return Response(payload, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def score_document_with_reasoning(request, pk):
	"""POST: run two-step evaluation (reasoning then scoring) and persist results."""
	try:
		document = Document.objects.get(id=pk)
	except Document.DoesNotExist:
		return Response({'status': 'error', 'message': 'Document not found.'}, status=status.HTTP_404_NOT_FOUND)

	# Check if document_scoring is enabled for this document
	try:
		from .models import DocumentAIConfig
		ai_cfg = DocumentAIConfig.get_or_create_for_document(document)
		if not ai_cfg.is_service_enabled('document_scoring'):
			return Response(
				{'status': 'disabled', 'message': 'Document scoring is disabled for this document.', 'service': 'document_scoring'},
				status=status.HTTP_200_OK,
			)
	except Exception:
		pass

	document_override = request.data.get('document_override') if isinstance(request.data, dict) else None
	document_context = _get_document_ai_context(document, service_name='document_scoring')
	score_obj, parsed, raw_resp = evaluate_document_with_reasoning(
		document=document,
		created_by=request.user,
		document_override=document_override,
		document_context=document_context,
	)
	include_raw = request.query_params.get('raw', 'false').lower() == 'true'
	serializer = DocumentScoreSerializer(score_obj, context={'include_raw': include_raw})
	payload = {'status': 'scored', 'score': serializer.data, 'reasoning': score_obj.score_rationale}
	if include_raw:
		payload['llm_parsed'] = parsed
		payload['llm_raw_response'] = raw_resp
	return Response(payload, status=status.HTTP_201_CREATED)




@api_view(['GET'])
@permission_classes([IsAuthenticated])
def paragraph_ai_results(request, pk):
	paragraph = get_object_or_404(Paragraph, pk=pk)
	if not paragraph.section or not paragraph.section.document:
		return Response(
			{'status': 'error', 'message': 'Paragraph is not linked to a document.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	document = paragraph.section.document
	permission = IsOwnerOrSharedWith()
	if not permission.has_object_permission(request, None, document):
		return Response(
			{'status': 'forbidden', 'message': 'Access denied.'},
			status=status.HTTP_403_FORBIDDEN,
		)

	version_number, error_response = _get_version_number(request, document)
	if error_response:
		return error_response
	if version_number is None:
		return Response(
			{'status': 'error', 'message': 'Version number is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)
	current_version_number = cast(int, version_number)

	result = (
		ParagraphAIResult.objects.filter(
			paragraph=paragraph,
			document=document,
			document_version_number=version_number,
			is_latest_for_version=True,
		)
		.order_by('-analysis_timestamp')
		.first()
	)
	if not result:
		return Response(
			{'status': 'not_found', 'message': 'No AI result found for this paragraph/version.'},
			status=status.HTTP_404_NOT_FOUND,
		)

	serializer = ParagraphAIResultSerializer(result)
	return Response(
		{'status': 'ok', 'result': serializer.data, 'version_number': version_number},
		status=status.HTTP_200_OK,
	)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_paragraph_ai_results(request, pk):
	document = get_object_or_404(Document, pk=pk)
	permission = IsOwnerOrSharedWith()
	if not permission.has_object_permission(request, None, document):
		return Response(
			{'status': 'forbidden', 'message': 'Access denied.'},
			status=status.HTTP_403_FORBIDDEN,
		)

	version_number, error_response = _get_version_number(request, document)
	if error_response:
		return error_response
	if version_number is None:
		return Response(
			{'status': 'error', 'message': 'Version number is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)
	current_version_number = cast(int, version_number)

	paragraph_ids = request.query_params.getlist('paragraph_id')
	if current_version_number != document.version_number:
		results = ParagraphAIResult.objects.filter(
			document=document,
			document_version_number=current_version_number,
			is_latest_for_version=True,
		)
		if paragraph_ids:
			results = results.filter(paragraph_id__in=paragraph_ids)

		serializer = ParagraphAIResultSerializer(results, many=True)
		return Response(
			{'status': 'ok', 'results': serializer.data, 'version_number': current_version_number},
			status=status.HTTP_200_OK,
		)

	paragraphs = Paragraph.objects.filter(section__document=document).order_by('order')
	if paragraph_ids:
		paragraphs = paragraphs.filter(id__in=paragraph_ids)

	results = []
	updated_count = 0
	skipped_count = 0
	for paragraph in paragraphs:
		if paragraph.needs_ai_recheck(current_version_number):
			payload, error_response = _compute_paragraph_ai_review(paragraph, request.user)
			if error_response:
				return error_response
			ai_result_id = payload.get('paragraph_ai_result_id') if payload else None
			if ai_result_id:
				ai_result = ParagraphAIResult.objects.filter(id=ai_result_id).first()
				if ai_result:
					results.append(ai_result)
			updated_count += 1
		else:
			result = (
				ParagraphAIResult.objects.filter(
					paragraph=paragraph,
					document=document,
					document_version_number=current_version_number,
					is_latest_for_version=True,
				)
				.order_by('-analysis_timestamp')
				.first()
			)
			if result:
				results.append(result)
			skipped_count += 1

	serializer = ParagraphAIResultSerializer(results, many=True)
	return Response(
		{
			'status': 'ok',
			'results': serializer.data,
			'version_number': current_version_number,
			'updated_count': updated_count,
			'skipped_count': skipped_count,
		},
		status=status.HTTP_200_OK,
	)


# ---------------------------------------------------------------------------
# AI Chat — scoped to document / section / paragraph / table
# ---------------------------------------------------------------------------

def _collect_section_text(section, depth=0) -> str:
	"""Recursively collect text from a section and all its subsections."""
	indent = '  ' * depth
	parts = []
	title = section.title or 'Untitled Section'
	parts.append(f'{indent}## {title}')
	if section.content_text:
		parts.append(f'{indent}{section.content_text.strip()}')

	for para in section.paragraphs.all().order_by('order'):
		text = para.edited_text if para.has_edits else para.content_text
		if text:
			parts.append(f'{indent}{text.strip()}')

	for table in section.tables.all().order_by('order'):
		tbl_title = table.title or 'Table'
		parts.append(f'{indent}[Table: {tbl_title}]')
		headers = table.column_headers or []
		header_labels = [h.get('label', h.get('id', '')) for h in headers]
		if header_labels:
			parts.append(f'{indent}  | {" | ".join(header_labels)} |')
		for row in (table.table_data or []):
			cells = row.get('cells', {})
			row_vals = [str(cells.get(h.get('id', ''), '')) for h in headers]
			parts.append(f'{indent}  | {" | ".join(row_vals)} |')

	for child in section.children.all().order_by('order'):
		parts.append(_collect_section_text(child, depth + 1))

	return '\n'.join(parts)


def _extract_scoped_content(document, scope: str, scope_id: Optional[str] = None) -> Tuple[str, str]:
	"""
	Extract content for the given scope and return (context_text, scope_label).
	"""
	from documents.models import Section, Paragraph, Table

	if scope == 'document':
		parts = []
		parts.append(f'# {document.title or "Untitled Document"}')
		if document.document_type:
			parts.append(f'Type: {document.document_type}')
		root_sections = Section.objects.filter(document=document, parent__isnull=True).order_by('order')
		for sec in root_sections:
			parts.append(_collect_section_text(sec, depth=0))
		return '\n\n'.join(parts), f'Document: {document.title or "Untitled"}'

	if scope == 'section':
		section = Section.objects.filter(id=scope_id, document=document).first()
		if not section:
			return '', 'Unknown Section'
		text = _collect_section_text(section, depth=0)
		return text, f'Section: {section.title or "Untitled"}'

	if scope == 'paragraph':
		paragraph = Paragraph.objects.filter(id=scope_id).select_related('section').first()
		if not paragraph or (paragraph.section and paragraph.section.document_id != document.id):
			return '', 'Unknown Paragraph'
		text = paragraph.edited_text if paragraph.has_edits else paragraph.content_text
		section_title = paragraph.section.title if paragraph.section else 'Unknown'
		return (text or '').strip(), f'Paragraph in "{section_title}"'

	if scope == 'table':
		table = Table.objects.filter(id=scope_id).select_related('section').first()
		if not table or (table.section and table.section.document_id != document.id):
			return '', 'Unknown Table'
		parts = []
		tbl_title = table.title or 'Table'
		parts.append(f'[Table: {tbl_title}]')
		headers = table.column_headers or []
		# Headers can be dicts or plain strings
		header_labels = []
		header_ids = []
		for h in headers:
			if isinstance(h, dict):
				header_labels.append(h.get('label', h.get('id', '')))
				header_ids.append(h.get('id', h.get('label', '')))
			else:
				header_labels.append(str(h))
				header_ids.append(str(h))
		if header_labels:
			parts.append(f'| {" | ".join(header_labels)} |')
		for row in (table.table_data or []):
			if isinstance(row, dict):
				cells = row.get('cells', {})
				if isinstance(cells, dict):
					row_vals = [str(cells.get(hid, '')) for hid in header_ids]
				else:
					row_vals = [str(cells)]
			elif isinstance(row, (list, tuple)):
				row_vals = [str(v) for v in row]
			else:
				row_vals = [str(row)]
			parts.append(f'| {" | ".join(row_vals)} |')
		section_title = table.section.title if table.section else 'Unknown'
		return '\n'.join(parts), f'Table "{tbl_title}" in "{section_title}"'

	return '', 'Unknown Scope'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_chat(request):
	"""
	AI Chat endpoint — scoped to document / section / paragraph / table.

	Request body:
	{
		"document_id": "<uuid>",
		"scope": "document" | "section" | "paragraph" | "table",
		"scope_id": "<uuid or null>",  // required for section/paragraph/table
		"message": "user message",
		"conversation_history": [
			{"role": "user", "text": "..."},
			{"role": "assistant", "text": "..."}
		]
	}
	"""
	document_id = request.data.get('document_id')
	scope = request.data.get('scope', 'document')
	scope_id = request.data.get('scope_id')
	message = request.data.get('message', '').strip()
	conversation_history = request.data.get('conversation_history', [])

	if not document_id:
		return Response(
			{'status': 'error', 'message': 'document_id is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)
	if not message:
		return Response(
			{'status': 'error', 'message': 'message is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)
	if scope in ('section', 'paragraph', 'table') and not scope_id:
		return Response(
			{'status': 'error', 'message': f'scope_id is required for scope "{scope}".'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	document = get_object_or_404(Document, id=document_id)
	context_text, scope_label = _extract_scoped_content(document, scope, scope_id)

	if not context_text:
		return Response(
			{'status': 'error', 'message': 'Could not extract content for the given scope.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	# ── Hierarchical inference context ─────────────────────────────
	inference_context = ''
	try:
		from aiservices.inference.graph_traversal import get_hierarchical_context_for_scope
		inference_context = get_hierarchical_context_for_scope(
			document, scope, scope_id,
		)
	except Exception:
		pass  # degrade gracefully if inference not available

	# Fetch document AI context (type-specific system prompt, ai_focus, mode)
	document_ai_context = _get_document_ai_context(document, service_name='chat')

	# Build Gemini chat payload with multi-turn conversation
	inference_block = ''
	if inference_context:
		inference_block = (
			"\n\nDOCUMENT INTELLIGENCE (AI-generated analysis of the document structure):\n"
			f"{inference_context}\n"
			"--- END INTELLIGENCE ---\n\n"
		)

	system_prompt = (
		f"{document_ai_context}"
		"You are an expert legal document assistant embedded in a document editor. "
		"You help users understand, analyse, edit, and improve legal documents.\n\n"
		f"{inference_block}"
		"CONTEXT:\n"
		f"The user is chatting about this specific part of the document:\n"
		f"Scope: {scope_label}\n\n"
		f"--- DOCUMENT CONTENT ---\n{context_text}\n--- END CONTENT ---\n\n"
		"GUIDELINES:\n"
		"- Answer questions about the content clearly and concisely.\n"
		"- When suggesting edits or rewrites, provide the exact text.\n"
		"- When summarising, be accurate and reference specific clauses/sections.\n"
		"- Use proper legal terminology when appropriate.\n"
		"- If the user asks you to draft or rewrite content, provide it in clean HTML "
		"  (use <p>, <strong>, <em>, <ul>, <ol>, <li> tags).\n"
		"- Keep responses focused on the scoped content — don't reference parts of the "
		"  document outside the current scope unless the user explicitly asks.\n"
		"- Be helpful, professional, and precise.\n"
	)

	# Build multi-turn contents array for Gemini
	contents = []
	# Add conversation history
	for msg in (conversation_history or []):
		if isinstance(msg, str):
			contents.append({'role': 'user', 'parts': [{'text': msg}]})
			continue
		if not isinstance(msg, dict):
			continue
		role = 'user' if msg.get('role') == 'user' else 'model'
		text = msg.get('text', '')
		if text:
			contents.append({'role': role, 'parts': [{'text': text}]})

	# Add current user message
	contents.append({'role': 'user', 'parts': [{'text': message}]})

	# If no history, prepend system prompt to first user message
	if not conversation_history:
		contents[0]['parts'].insert(0, {'text': system_prompt})
	else:
		# Inject system prompt into the first message of the conversation
		if contents and contents[0]['role'] == 'user':
			contents[0]['parts'].insert(0, {'text': system_prompt})
		else:
			contents.insert(0, {'role': 'user', 'parts': [{'text': system_prompt}]})

	model = os.environ.get('GEN_MODEL', 'gemini-2.0-flash')
	payload = {
		'contents': contents,
		'generationConfig': {
			'temperature': 0.4,
			'topP': 0.9,
			'topK': 40,
			'maxOutputTokens': 4096,
		},
	}

	api_key = os.environ.get('GEMINI_API')
	if not api_key:
		return Response(
			{'status': 'error', 'message': 'AI service not configured.'},
			status=status.HTTP_500_INTERNAL_SERVER_ERROR,
		)

	try:
		raw_resp = call_gemini({**payload, 'model': model}, api_key=api_key)
	except Exception as e:
		return Response(
			{'status': 'error', 'message': f'AI service error: {str(e)}'},
			status=status.HTTP_502_BAD_GATEWAY,
		)

	# Extract text response from Gemini
	ai_text = ''
	try:
		candidates = raw_resp.get('candidates', [])
		if candidates:
			parts = candidates[0].get('content', {}).get('parts', [])
			ai_text = '\n'.join(p.get('text', '') for p in parts).strip()
	except (KeyError, IndexError, TypeError):
		ai_text = ''

	if not ai_text:
		return Response(
			{'status': 'error', 'message': 'AI returned an empty response.'},
			status=status.HTTP_502_BAD_GATEWAY,
		)

	return Response({
		'status': 'ok',
		'response': ai_text,
		'scope': scope,
		'scope_label': scope_label,
	}, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# AI Chat Edit — rewrites content and saves to DB
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_chat_edit(request):
	"""
	Ask the AI to rewrite / edit scoped content and apply it directly.

	Request body:
	{
		"document_id": "<uuid>",
		"scope": "section" | "paragraph",
		"scope_id": "<uuid>",
		"instruction": "Rewrite in plain English",
		"conversation_history": [...]   // optional, for context
		"preview": true/false           // if true, return AI rewrite without saving
	}

	Returns the updated object fields so the frontend can patch local state.
	"""
	from documents.models import Section, Paragraph, Table

	document_id = request.data.get('document_id')
	scope = request.data.get('scope')
	scope_id = request.data.get('scope_id')
	instruction = request.data.get('instruction', '').strip()
	conversation_history = request.data.get('conversation_history', [])
	preview_mode = request.data.get('preview', False)

	if not document_id:
		return Response({'status': 'error', 'message': 'document_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
	if scope not in ('section', 'paragraph', 'table'):
		return Response({'status': 'error', 'message': 'scope must be "section", "paragraph", or "table".'}, status=status.HTTP_400_BAD_REQUEST)
	if not scope_id:
		return Response({'status': 'error', 'message': 'scope_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
	if not instruction:
		return Response({'status': 'error', 'message': 'instruction is required.'}, status=status.HTTP_400_BAD_REQUEST)

	document = get_object_or_404(Document, id=document_id)

	# Fetch the target object and its current content
	if scope == 'paragraph':
		obj = Paragraph.objects.filter(id=scope_id).select_related('section').first()
		if not obj or (obj.section and str(obj.section.document_id) != str(document.id)):
			return Response({'status': 'error', 'message': 'Paragraph not found.'}, status=status.HTTP_404_NOT_FOUND)
		current_content = obj.edited_text if obj.has_edits else obj.content_text
		content_label = 'paragraph'
	elif scope == 'table':
		obj = Table.objects.filter(id=scope_id).select_related('section').first()
		if not obj or (obj.section and str(obj.section.document_id) != str(document.id)):
			return Response({'status': 'error', 'message': 'Table not found.'}, status=status.HTTP_404_NOT_FOUND)
		# Build structured JSON representation for AI
		import json as _json
		table_json = {
			'title': obj.title or '',
			'description': obj.description or '',
			'table_type': obj.table_type or 'data',
			'column_headers': obj.column_headers or [],
			'table_data': obj.table_data or [],
		}
		current_content = _json.dumps(table_json, indent=2)
		content_label = 'table'
	else:
		obj = Section.objects.filter(id=scope_id, document=document).first()
		if not obj:
			return Response({'status': 'error', 'message': 'Section not found.'}, status=status.HTTP_404_NOT_FOUND)
		# For sections we also collect child paragraphs so the AI has full context
		current_content = _collect_section_text(obj, depth=0)
		content_label = 'section'

	if not current_content:
		return Response({'status': 'error', 'message': 'No content to edit.'}, status=status.HTTP_400_BAD_REQUEST)

	# Fetch document AI context for type-aligned editing
	# Use 'chat' service context since this is an interactive editing session
	document_ai_context = _get_document_ai_context(document, service_name='chat')

	# ── Hierarchical inference context ─────────────────────────────
	inference_context = ''
	try:
		from aiservices.inference.graph_traversal import get_hierarchical_context_for_scope
		inference_context = get_hierarchical_context_for_scope(
			document, scope, scope_id,
		)
	except Exception:
		pass  # degrade gracefully

	inference_block = ''
	if inference_context:
		inference_block = (
			"\nDOCUMENT INTELLIGENCE (AI analysis of document structure and context):\n"
			f"{inference_context}\n"
			"--- END INTELLIGENCE ---\n\n"
		)

	# Build a targeted edit prompt
	if scope == 'table':
		import json as _json
		edit_system_prompt = (
			f"{document_ai_context}"
			"You are an expert legal document editor embedded in a document editing application.\n\n"
			f"{inference_block}"
			"The user wants to edit the following table.\n\n"
			"--- CURRENT TABLE (JSON) ---\n"
			f"{current_content}\n"
			"--- END TABLE ---\n\n"
			"The table structure is:\n"
			"- 'title': The table title/caption (string)\n"
			"- 'description': Description of the table (string)\n"
			"- 'table_type': One of 'data','comparison','pricing','schedule','matrix','specifications','other'\n"
			"- 'column_headers': Array of column objects, each with 'id' (string), 'label' (string), "
			"optionally 'width', 'align', 'type'\n"
			"- 'table_data': Array of row objects, each with 'row_id' (string) and 'cells' dict "
			"mapping column id to cell value string\n\n"
			"USER INSTRUCTION:\n"
			f"{instruction}\n\n"
			"RULES:\n"
			"- Return ONLY valid JSON with the same structure. No explanations, no preamble.\n"
			"- You MUST return a JSON object with keys: title, description, table_type, column_headers, table_data.\n"
			"- Preserve column ids and row_ids when possible (only change them if columns/rows are added/removed).\n"
			"- If adding new columns, use 'col_N' as id. If adding new rows, use 'r_N' as row_id.\n"
			"- Cell values in table_data.cells must reference valid column ids from column_headers.\n"
			"- Keep the data accurate. If the user asks to add a row/column, add it with sensible defaults.\n"
			"- Return the COMPLETE table JSON, not just the changed parts.\n"
			"- Do NOT wrap the JSON in markdown code fences.\n"
		)
	else:
		edit_system_prompt = (
			f"{document_ai_context}"
			"You are an expert legal document editor embedded in a document editing application.\n\n"
			f"{inference_block}"
			f"The user wants to edit the following {content_label}.\n\n"
			f"--- CURRENT CONTENT ---\n{current_content}\n--- END CONTENT ---\n\n"
			"USER INSTRUCTION:\n"
			f"{instruction}\n\n"
			"RULES:\n"
			"- Return ONLY the rewritten content. No explanations, no preamble, no extra commentary.\n"
			"- Use clean HTML formatting: <p>, <strong>, <em>, <u>, <br>, <ul>, <ol>, <li>, "
			"<span style='...'> are allowed.\n"
			"- Preserve the overall structure and meaning unless the user explicitly asks to change it.\n"
			"- If the instruction is to simplify, use plain language but keep legal accuracy.\n"
			"- If the instruction is to expand, add appropriate legal detail.\n"
			"- Return the content ready to be inserted into the document editor as-is.\n"
		)

	# Build conversation for context (if any)
	contents = []
	for msg in (conversation_history or []):
		if isinstance(msg, str):
			contents.append({'role': 'user', 'parts': [{'text': msg}]})
			continue
		if not isinstance(msg, dict):
			continue
		role = 'user' if msg.get('role') == 'user' else 'model'
		text = msg.get('text', '')
		if text:
			contents.append({'role': role, 'parts': [{'text': text}]})

	# Add the edit request
	contents.append({'role': 'user', 'parts': [{'text': edit_system_prompt}]})

	model = os.environ.get('GEN_MODEL', 'gemini-2.0-flash')
	payload = {
		'contents': contents,
		'generationConfig': {
			'temperature': 0.2,
			'topP': 0.9,
			'topK': 40,
			'maxOutputTokens': 8192,
		},
	}

	api_key = os.environ.get('GEMINI_API')
	if not api_key:
		return Response({'status': 'error', 'message': 'AI service not configured.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

	try:
		raw_resp = call_gemini({**payload, 'model': model}, api_key=api_key)
	except Exception as e:
		return Response({'status': 'error', 'message': f'AI service error: {str(e)}'}, status=status.HTTP_502_BAD_GATEWAY)

	# Extract text
	ai_text = ''
	try:
		candidates = raw_resp.get('candidates', [])
		if candidates:
			parts = candidates[0].get('content', {}).get('parts', [])
			ai_text = '\n'.join(p.get('text', '') for p in parts).strip()
	except (KeyError, IndexError, TypeError):
		ai_text = ''

	if not ai_text:
		return Response({'status': 'error', 'message': 'AI returned an empty response.'}, status=status.HTTP_502_BAD_GATEWAY)

	# Strip markdown code fences if present
	cleaned = ai_text
	if cleaned.startswith('```json'):
		cleaned = cleaned[7:]
	elif cleaned.startswith('```html'):
		cleaned = cleaned[7:]
	elif cleaned.startswith('```'):
		cleaned = cleaned[3:]
	if cleaned.endswith('```'):
		cleaned = cleaned[:-3]
	cleaned = cleaned.strip()

	# ── Table scope: parse AI JSON response ──
	if scope == 'table':
		import json as _json
		try:
			table_result = _json.loads(cleaned)
		except _json.JSONDecodeError:
			return Response({
				'status': 'error',
				'message': 'AI returned invalid JSON for the table. Please try again.',
			}, status=status.HTTP_502_BAD_GATEWAY)

		# Validate required keys
		if not isinstance(table_result, dict):
			return Response({
				'status': 'error',
				'message': 'AI response is not a JSON object.',
			}, status=status.HTTP_502_BAD_GATEWAY)

		new_headers = table_result.get('column_headers', obj.column_headers or [])
		new_data = table_result.get('table_data', obj.table_data or [])
		new_title = table_result.get('title', obj.title or '')
		new_description = table_result.get('description', obj.description or '')
		new_table_type = table_result.get('table_type', obj.table_type or 'data')

		# Build the updated table payload for the frontend
		updated_table = {
			'id': str(obj.id),
			'title': new_title,
			'description': new_description,
			'table_type': new_table_type,
			'column_headers': new_headers,
			'table_data': new_data,
			'num_columns': len(new_headers),
			'num_rows': len(new_data),
			'has_edits': True,
			'section_id': str(obj.section_id) if obj.section_id else None,
		}

		# Build original table for diff
		original_table = {
			'id': str(obj.id),
			'title': obj.title or '',
			'description': obj.description or '',
			'table_type': obj.table_type or 'data',
			'column_headers': obj.column_headers or [],
			'table_data': obj.table_data or [],
			'num_columns': obj.num_columns,
			'num_rows': obj.num_rows,
		}

		if preview_mode:
			return Response({
				'status': 'ok',
				'preview': True,
				'scope': 'table',
				'scope_id': str(obj.id),
				'ai_text': cleaned,
				'original_text': current_content,
				'instruction': instruction,
				'updated': updated_table,
				'original_table': original_table,
			}, status=status.HTTP_200_OK)

		# Apply to DB
		if not obj.original_data_backup:
			obj.original_data_backup = {
				'column_headers': obj.column_headers,
				'table_data': obj.table_data,
				'title': obj.title,
				'description': obj.description,
			}
		obj.title = new_title
		obj.description = new_description
		obj.table_type = new_table_type
		obj.column_headers = new_headers
		obj.table_data = new_data
		obj.num_columns = len(new_headers)
		obj.num_rows = len(new_data)
		obj.has_edits = True
		obj.edit_count = (obj.edit_count or 0) + 1
		obj.modified_by = request.user
		obj.save()

		return Response({
			'status': 'ok',
			'scope': 'table',
			'scope_id': str(obj.id),
			'updated': updated_table,
			'original_table': original_table,
			'ai_text': cleaned,
		}, status=status.HTTP_200_OK)

	# ── Preview mode: return the AI rewrite WITHOUT saving to DB ──
	if preview_mode:
		preview_data = {
			'status': 'ok',
			'preview': True,
			'scope': scope,
			'scope_id': str(obj.id),
			'ai_text': cleaned,
			'original_text': current_content,
			'instruction': instruction,
		}
		if scope == 'paragraph':
			preview_data['updated'] = {
				'id': str(obj.id),
				'edited_text': cleaned,
				'has_edits': True,
				'content_text': obj.content_text,
			}
		else:
			# Section — also split into paragraph-level previews
			import re as _re
			p_blocks = _re.findall(r'<p[^>]*>.*?</p>', cleaned, _re.DOTALL | _re.IGNORECASE)
			if not p_blocks:
				p_blocks = [b.strip() for b in cleaned.split('\n\n') if b.strip()]
			if not p_blocks:
				p_blocks = [cleaned]

			paragraph_count = obj.paragraphs.count()
			if paragraph_count == 0:
				preview_data['updated'] = {
					'id': str(obj.id),
					'edited_text': cleaned,
					'has_edits': True,
					'content_text': obj.content_text,
					'title': obj.title,
				}
			else:
				paragraphs = list(obj.paragraphs.all().order_by('order'))
				preview_paragraphs = []
				for i, para in enumerate(paragraphs):
					block = p_blocks[i] if i < len(p_blocks) else (p_blocks[-1] if p_blocks else cleaned)
					preview_paragraphs.append({
						'id': str(para.id),
						'edited_text': block,
						'original_text': para.edited_text if para.has_edits else para.content_text,
						'has_edits': True,
						'content_text': para.content_text,
						'order': para.order,
					})
				# Extra blocks → new paragraphs (preview only, not saved)
				if len(p_blocks) > len(paragraphs):
					for i, block in enumerate(p_blocks[len(paragraphs):]):
						preview_paragraphs.append({
							'id': None,
							'edited_text': block,
							'original_text': '',
							'has_edits': True,
							'content_text': block,
							'order': len(paragraphs) + i,
							'is_new': True,
						})
				preview_data['updated'] = {
					'id': str(obj.id),
					'title': obj.title,
					'paragraphs': preview_paragraphs,
				}
		return Response(preview_data, status=status.HTTP_200_OK)

	# ── Apply to DB (non-preview mode) ──
	if scope == 'paragraph':
		obj.edited_text = cleaned
		obj.has_edits = True
		obj.modified_by = request.user
		obj.save()
		return Response({
			'status': 'ok',
			'scope': 'paragraph',
			'scope_id': str(obj.id),
			'updated': {
				'id': str(obj.id),
				'edited_text': cleaned,
				'has_edits': True,
				'content_text': obj.content_text,
			},
			'ai_text': cleaned,
		}, status=status.HTTP_200_OK)

	else:  # section
		paragraph_count = obj.paragraphs.count()
		if paragraph_count == 0:
			obj.edited_text = cleaned
			obj.has_edits = True
			obj.modified_by = request.user
			obj.save()
			return Response({
				'status': 'ok',
				'scope': 'section',
				'scope_id': str(obj.id),
				'updated': {
					'id': str(obj.id),
					'edited_text': cleaned,
					'has_edits': True,
					'content_text': obj.content_text,
					'title': obj.title,
				},
				'ai_text': cleaned,
			}, status=status.HTTP_200_OK)
		else:
			import re as _re
			p_blocks = _re.findall(r'<p[^>]*>.*?</p>', cleaned, _re.DOTALL | _re.IGNORECASE)
			if not p_blocks:
				p_blocks = [b.strip() for b in cleaned.split('\n\n') if b.strip()]
			if not p_blocks:
				p_blocks = [cleaned]

			paragraphs = list(obj.paragraphs.all().order_by('order'))
			updated_paragraphs = []

			for i, para in enumerate(paragraphs):
				if i < len(p_blocks):
					para.edited_text = p_blocks[i]
				else:
					para.edited_text = p_blocks[-1] if p_blocks else cleaned
				para.has_edits = True
				para.modified_by = request.user
				para.save()
				updated_paragraphs.append({
					'id': str(para.id),
					'edited_text': para.edited_text,
					'has_edits': True,
					'content_text': para.content_text,
					'order': para.order,
				})

			if len(p_blocks) > len(paragraphs):
				for i, block in enumerate(p_blocks[len(paragraphs):]):
					new_para = Paragraph.objects.create(
						section=obj,
						content_text=block,
						edited_text=block,
						has_edits=True,
						order=len(paragraphs) + i,
						modified_by=request.user,
					)
					updated_paragraphs.append({
						'id': str(new_para.id),
						'edited_text': new_para.edited_text,
						'has_edits': True,
						'content_text': new_para.content_text,
						'order': new_para.order,
					})

			return Response({
				'status': 'ok',
				'scope': 'section',
				'scope_id': str(obj.id),
				'updated': {
					'id': str(obj.id),
					'title': obj.title,
					'paragraphs': updated_paragraphs,
				},
				'ai_text': cleaned,
			}, status=status.HTTP_200_OK)


# ─────────────────────────────────────────────────────────────────────────────
# Document-Type AI Presets — CRUD
# ─────────────────────────────────────────────────────────────────────────────

class DocumentTypeAIPresetViewSet(viewsets.ModelViewSet):
	"""
	CRUD for document-type AI presets.

	Endpoints:
	  GET    /api/ai/presets/                     — list all presets
	  POST   /api/ai/presets/                     — create a preset
	  GET    /api/ai/presets/<uuid>/               — detail
	  PATCH  /api/ai/presets/<uuid>/               — update
	  DELETE /api/ai/presets/<uuid>/               — delete

	  GET    /api/ai/presets/by-type/?document_type=billing  — get by type
	  GET    /api/ai/presets/defaults/             — get factory-default config
	"""
	permission_classes = [IsAuthenticated]

	def get_serializer_class(self):
		from .serializers import (
			DocumentTypeAIPresetSerializer,
			DocumentTypeAIPresetCreateSerializer,
		)
		if self.action in ('create', 'update', 'partial_update'):
			return DocumentTypeAIPresetCreateSerializer
		return DocumentTypeAIPresetSerializer

	def get_queryset(self):
		from .models import DocumentTypeAIPreset
		return DocumentTypeAIPreset.objects.all()

	def perform_create(self, serializer):
		serializer.save(created_by=self.request.user)

	@action(detail=False, methods=['get'], url_path='by-type')
	def by_type(self, request):
		"""
		GET /api/ai/presets/by-type/?document_type=billing

		Return the preset for a specific document_type.
		"""
		from .models import DocumentTypeAIPreset
		from .serializers import DocumentTypeAIPresetSerializer

		doc_type = request.query_params.get('document_type', '').strip()
		if not doc_type:
			return Response(
				{'error': 'document_type query parameter is required.'},
				status=status.HTTP_400_BAD_REQUEST,
			)
		try:
			preset = DocumentTypeAIPreset.objects.get(document_type=doc_type)
			return Response(DocumentTypeAIPresetSerializer(preset).data)
		except DocumentTypeAIPreset.DoesNotExist:
			return Response(
				{
					'status': 'not_found',
					'message': f'No preset for document_type "{doc_type}". Factory defaults apply.',
					'default_config': DocumentTypeAIPreset.get_default_services_config(),
				},
				status=status.HTTP_200_OK,
			)

	@action(detail=False, methods=['get'], url_path='defaults')
	def defaults(self, request):
		"""
		GET /api/ai/presets/defaults/

		Return factory-default AI services config (for UI pre-population).
		"""
		from .models import DocumentTypeAIPreset
		return Response({
			'default_services_config': DocumentTypeAIPreset.get_default_services_config(),
			'available_services': [
				{'key': key, 'label': label}
				for key, label in DocumentTypeAIPreset.AI_SERVICE_CHOICES
			],
		})


# ─────────────────────────────────────────────────────────────────────────────
# Per-Document AI Config — get / patch / toggle
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_ai_config(request, pk):
	"""
	GET /api/ai/documents/<uuid>/config/

	Returns the AI config for a specific document, auto-creating it
	if it doesn't exist.  The response includes:
	- services_config  (per-document overrides)
	- effective_config (fully resolved: factory → preset → document)
	- effective_system_prompt
	- effective_ai_focus
	- preset_config    (the document-type preset for reference)
	"""
	from .models import DocumentAIConfig
	from .serializers import DocumentAIConfigSerializer

	doc = get_object_or_404(Document, id=pk)
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)
	return Response(DocumentAIConfigSerializer(ai_cfg).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def document_ai_config_update(request, pk):
	"""
	PATCH /api/ai/documents/<uuid>/config/

	Update per-document AI config.  Accepts:
	- services_config  (partial — deep-merged into existing)
	- system_prompt
	- ai_focus
	"""
	from .models import DocumentAIConfig
	from .serializers import DocumentAIConfigUpdateSerializer, DocumentAIConfigSerializer

	doc = get_object_or_404(Document, id=pk)
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)

	ser = DocumentAIConfigUpdateSerializer(data=request.data)
	ser.is_valid(raise_exception=True)
	d = ser.validated_data

	if 'services_config' in d:
		existing = ai_cfg.services_config or {}
		incoming = d['services_config'] or {}
		for svc, cfg in incoming.items():
			if svc in existing and isinstance(cfg, dict) and isinstance(existing[svc], dict):
				existing[svc].update(cfg)
			else:
				existing[svc] = cfg
		ai_cfg.services_config = existing

	if 'system_prompt' in d:
		ai_cfg.system_prompt = d['system_prompt']

	if 'service_prompts' in d:
		existing_sp = ai_cfg.service_prompts or {}
		incoming_sp = d['service_prompts'] or {}
		existing_sp.update(incoming_sp)
		ai_cfg.service_prompts = existing_sp

	if 'ai_focus' in d:
		ai_cfg.ai_focus = d['ai_focus']

	ai_cfg.save()
	return Response(DocumentAIConfigSerializer(ai_cfg).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_ai_config_toggle(request, pk):
	"""
	POST /api/ai/documents/<uuid>/config/toggle/

	Quick toggle a single AI service on/off.
	Body: { "service": "paragraph_scoring", "enabled": false }
	"""
	from .models import DocumentAIConfig
	from .serializers import AIServiceToggleSerializer, DocumentAIConfigSerializer

	doc = get_object_or_404(Document, id=pk)
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)

	ser = AIServiceToggleSerializer(data=request.data)
	ser.is_valid(raise_exception=True)
	d = ser.validated_data

	svc_name = d['service']
	enabled = d['enabled']

	existing = ai_cfg.services_config or {}
	if svc_name not in existing:
		existing[svc_name] = {}
	existing[svc_name]['enabled'] = enabled
	ai_cfg.services_config = existing
	ai_cfg.save()

	return Response(DocumentAIConfigSerializer(ai_cfg).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_ai_config_bulk_toggle(request, pk):
	"""
	POST /api/ai/documents/<uuid>/config/bulk-toggle/

	Toggle multiple services at once.
	Body: { "toggles": { "document_scoring": true, "paragraph_scoring": false } }
	"""
	from .models import DocumentAIConfig
	from .serializers import AIServiceBulkToggleSerializer, DocumentAIConfigSerializer

	doc = get_object_or_404(Document, id=pk)
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)

	ser = AIServiceBulkToggleSerializer(data=request.data)
	ser.is_valid(raise_exception=True)
	d = ser.validated_data

	existing = ai_cfg.services_config or {}
	for svc_name, enabled in d['toggles'].items():
		if svc_name not in existing:
			existing[svc_name] = {}
		existing[svc_name]['enabled'] = enabled
	ai_cfg.services_config = existing
	ai_cfg.save()

	return Response(DocumentAIConfigSerializer(ai_cfg).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_ai_config_reset(request, pk):
	"""
	POST /api/ai/documents/<uuid>/config/reset/

	Reset per-document AI config to empty (will fall back to
	document-type preset → factory defaults).
	"""
	from .models import DocumentAIConfig
	from .serializers import DocumentAIConfigSerializer

	doc = get_object_or_404(Document, id=pk)
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)

	ai_cfg.services_config = {}
	ai_cfg.system_prompt = ''
	ai_cfg.service_prompts = {}
	ai_cfg.ai_focus = ''
	ai_cfg.save()

	return Response(DocumentAIConfigSerializer(ai_cfg).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_ai_service_status(request, pk):
	"""
	GET /api/ai/documents/<uuid>/config/status/

	Quick read — returns just the effective enabled/disabled state
	for every service.  Light-weight for the frontend sidebar.
	"""
	from .models import DocumentAIConfig

	doc = get_object_or_404(Document, id=pk)
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)
	effective = ai_cfg.get_effective_config()

	service_status = {}
	for svc, cfg in effective.items():
		service_status[svc] = {
			'enabled': cfg.get('enabled', True),
			'mode': cfg.get('mode'),
		}

	return Response({
		'document_id': str(doc.id),
		'document_type': doc.document_type,
		'services': service_status,
		'has_custom_config': bool(ai_cfg.services_config),
		'has_custom_prompt': bool(ai_cfg.system_prompt),
	})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def document_type_list(request):
	"""
	GET /api/ai/document-types/

	Returns a list of known document types, combining:
	  1. Types that have AI presets configured
	  2. Types used in existing documents (distinct values)
	  3. Common fallback types

	Each entry includes whether a preset exists for that type.
	"""
	from .models import DocumentTypeAIPreset

	# Collect preset types
	preset_map = {}
	for p in DocumentTypeAIPreset.objects.all():
		preset_map[p.document_type] = {
			'document_type': p.document_type,
			'display_name': p.display_name or p.document_type.replace('_', ' ').title(),
			'description': p.description or '',
			'has_preset': True,
			'preset_id': str(p.id),
		}

	# Collect types used in documents
	used_types = (
		Document.objects
		.exclude(document_type__isnull=True)
		.exclude(document_type='')
		.values_list('document_type', flat=True)
		.distinct()
	)
	for dt in used_types:
		if dt not in preset_map:
			preset_map[dt] = {
				'document_type': dt,
				'display_name': dt.replace('_', ' ').title(),
				'description': '',
				'has_preset': False,
				'preset_id': None,
			}

	# Ensure common types are always present
	common_types = [
		('contract', 'Contract'),
		('billing', 'Billing'),
		('nda', 'NDA'),
		('employment', 'Employment'),
		('compliance', 'Compliance'),
		('policy', 'Policy'),
		('agreement', 'Agreement'),
		('memo', 'Memo'),
		('report', 'Report'),
		('letter', 'Letter'),
	]
	for key, label in common_types:
		if key not in preset_map:
			preset_map[key] = {
				'document_type': key,
				'display_name': label,
				'description': '',
				'has_preset': False,
				'preset_id': None,
			}

	result = sorted(preset_map.values(), key=lambda x: x['display_name'])
	return Response(result)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def document_ai_set_type(request, pk):
	"""
	POST /api/ai/documents/<uuid>/config/set-type/

	Change the document's document_type AND apply the matching
	AI preset.  If no preset exists for the new type, resets the
	AI config to factory defaults.

	Body: { "document_type": "billing" }

	Returns the updated AI config (same as document_ai_config).
	"""
	from .models import DocumentAIConfig, DocumentTypeAIPreset
	from .serializers import DocumentAIConfigSerializer

	doc = get_object_or_404(Document, id=pk)

	new_type = (request.data.get('document_type') or '').strip()
	if not new_type:
		return Response(
			{'error': 'document_type is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	# Update the document's document_type field
	doc.document_type = new_type
	doc.save(update_fields=['document_type'])

	# Get or create AI config
	ai_cfg = DocumentAIConfig.get_or_create_for_document(doc)

	# Apply the preset for the new type (or clear to factory defaults).
	# We clear per-document overrides so values inherit from the preset
	# through the merge chain — no duplication.
	try:
		preset = DocumentTypeAIPreset.objects.get(document_type=new_type)
		# Preset exists — clear per-document overrides so values
		# cascade from the preset via get_effective_*() methods.
		ai_cfg.services_config = {}
		ai_cfg.system_prompt = ''
		ai_cfg.service_prompts = {}
		ai_cfg.ai_focus = ''
	except DocumentTypeAIPreset.DoesNotExist:
		# No preset — reset to empty (factory defaults will apply)
		ai_cfg.services_config = {}
		ai_cfg.system_prompt = ''
		ai_cfg.service_prompts = {}
		ai_cfg.ai_focus = ''

	ai_cfg.save()
	return Response(DocumentAIConfigSerializer(ai_cfg).data)


# ── LaTeX AI Generation ─────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ai_generate_latex(request, pk):
	"""
	Generate LaTeX code using Gemini AI based on a user prompt.

	POST /api/ai/documents/<uuid:pk>/generate-latex/
	Body:
	{
		"prompt": "Create a professional contract with terms and conditions",
		"save": true,           // optional, default true — save to Document.latex_code
		"section_id": "<uuid>", // optional — also create/update a LatexCode record
		"preamble": "...",      // optional — custom LaTeX preamble to include
		"code_type": "latex",   // optional — LatexCode.code_type field
		"topic": "..."          // optional — LatexCode.topic field
	}

	Returns:
	{
		"status": "success",
		"latex_code": "\\documentclass{article}...",
		"document_id": "<uuid>",
		"saved_to_document": true,
		"latex_code_id": "<uuid or null>"
	}
	"""
	from documents.models import Section, LatexCode

	document = get_object_or_404(Document, id=pk)

	prompt = (request.data.get('prompt') or '').strip()
	if not prompt:
		return Response(
			{'status': 'error', 'message': 'prompt is required.'},
			status=status.HTTP_400_BAD_REQUEST,
		)

	should_save = request.data.get('save', True)
	section_id = request.data.get('section_id')
	preamble = request.data.get('preamble', '').strip()
	code_type = request.data.get('code_type', 'latex')
	topic = request.data.get('topic', '')

	# ── Guard: check if latex_generation service is enabled ──
	from .models import DocumentAIConfig
	ai_cfg = DocumentAIConfig.get_or_create_for_document(document)
	effective_config = ai_cfg.get_effective_config()
	latex_svc = effective_config.get('latex_generation', {})
	if isinstance(latex_svc, dict) and not latex_svc.get('enabled', True):
		return Response(
			{
				'status': 'error',
				'message': 'LaTeX generation AI service is disabled for this document type.',
			},
			status=status.HTTP_403_FORBIDDEN,
		)

	# ── Build the AI context + system prompt ──
	document_ai_context = _get_document_ai_context(document, service_name='latex_generation')

	# ── Hierarchical inference context ─────────────────────────────
	inference_context = ''
	try:
		from aiservices.inference.graph_traversal import get_hierarchical_context_for_document
		inference_context = get_hierarchical_context_for_document(document)
	except Exception:
		pass  # degrade gracefully

	inference_block = ''
	if inference_context:
		inference_block = (
			"\nDOCUMENT INTELLIGENCE (AI analysis of document structure):\n"
			f"{inference_context}\n"
			"--- END INTELLIGENCE ---\n\n"
		)

	# Get existing document content for context
	doc_title = document.title or 'Untitled Document'
	doc_type = document.document_type or 'general'
	existing_latex = document.latex_code or ''

	system_prompt = (
		f"{document_ai_context}"
		"You are an expert LaTeX code generator. You produce clean, compilable "
		"LaTeX documents using standard packages.\n\n"
		f"{inference_block}"
		"RULES:\n"
		"1. Return ONLY the LaTeX source code — no explanations, no markdown fences, "
		"   no surrounding text.\n"
		"2. Always include a complete, self-contained LaTeX document with "
		"   \\documentclass, \\usepackage, \\begin{document}...\\end{document}.\n"
		"3. Use standard packages: amsmath, amssymb, geometry, hyperref, graphicx, "
		"   fancyhdr, enumitem, titlesec, xcolor.\n"
		"4. For tables, use booktabs and longtable. For code listings, use listings or minted.\n"
		"5. For math-heavy content, use amsmath environments (align, equation, etc.).\n"
		"6. For charts/plots, use pgfplots with tikz.\n"
		"7. Produce professional, well-formatted output suitable for XeLaTeX compilation.\n"
		"8. Use fontspec with standard fonts (when using XeLaTeX features).\n"
		"9. NEVER use square brackets for placeholder text like [Your Name] or "
		"   [Company Name]. Square brackets are LaTeX optional-argument syntax and "
		"   cause compilation errors. Use curly braces with \\textit{}, angle brackets "
		"   like \\textlangle{}Your Name\\textrangle{}, or simply write placeholder "
		"   words without any brackets (e.g. \\_\\_\\_\\_\\_ or PLACEHOLDER).\n"
		"10. The output MUST compile without errors under XeLaTeX. Double-check that "
		"    every command and environment is properly closed and that no raw square "
		"    brackets appear at the start of a line or after \\\\.\n"
		"11. When using \\documentclass with optional arguments, ALWAYS include the "
		"    opening square bracket: \\documentclass[12pt]{article}, NEVER "
		"    \\documentclass12pt]{article}. A missing [ causes a fatal error.\n"
		"12. NEVER use [[placeholder]] inside \\documentclass options, \\setmainfont, "
		"    \\usepackage, or any preamble command. Placeholders are only for document "
		"    body content (text, tables, paragraphs). Use sensible hardcoded defaults "
		"    for font size (12pt), font family, geometry, etc.\n"
		"13. Do NOT use internal config keys like processing_settings.*, "
		"    search_metadata.*, ai_config.*, page_settings.* as placeholders. "
		"    Only use actual document metadata fields (e.g. client_name, amount, "
		"    organisation_name, dates, etc.).\n"
		"14. IMAGE PLACEHOLDERS: Where an image would naturally appear (company logo,\n"
		"    signature block, stamp, diagram, etc.), insert [[image:descriptive_name]]\n"
		"    as a BARE placeholder — do NOT wrap it in \\includegraphics.\n"
		"    The system will automatically generate the correct \\includegraphics\n"
		"    command with proper file paths at render time.\n"
		"    You MAY wrap [[image:name]] in a figure environment for layout:\n"
		"      \\begin{figure}[h]\\centering [[image:company_logo]] \\end{figure}\n"
		"    But write the placeholder DIRECTLY — never write:\n"
		"      \\includegraphics[width=3cm]{[[image:logo]]}  ← WRONG\n"
		"    Instead write:\n"
		"      [[image:logo]]  ← CORRECT\n"
		"    NEVER use \\includegraphics directly with an empty path, a URL, or\n"
		"    a [[placeholder]]. Use descriptive snake_case names: company_logo,\n"
		"    header_logo, signature, stamp, diagram_1, chart_overview, etc.\n"
	)

	if preamble:
		system_prompt += (
			f"\nThe user has specified this custom preamble — incorporate it:\n"
			f"---\n{preamble}\n---\n"
		)

	if existing_latex:
		system_prompt += (
			f"\nThe document already has existing LaTeX code. "
			f"The user may want to modify, extend, or replace it. "
			f"Here is the existing code for context:\n"
			f"--- EXISTING LATEX ---\n{existing_latex[:3000]}\n--- END ---\n"
		)

	# ── Inject available metadata keys so AI can use [[key]] placeholders ──
	metadata = {}
	# Keys that are internal config and must NOT be exposed as [[placeholder]] fields
	INTERNAL_KEY_PREFIXES = (
		'processing_settings', 'search_metadata', 'ai_config',
		'ai_prompt_open', 'header_pdf', 'footer_pdf', 'header_config',
		'footer_config', 'page_settings', 'export_settings',
	)
	try:
		if document.document_metadata:
			metadata.update(document.document_metadata)
		if document.custom_metadata:
			metadata.update(document.custom_metadata)
	except Exception:
		pass

	if metadata:
		def _collect_keys(data, prefix=''):
			keys = []
			for k, v in (data or {}).items():
				full = f"{prefix}.{k}" if prefix else k
				# Skip internal/config keys
				root_key = full.split('.')[0]
				if root_key in INTERNAL_KEY_PREFIXES:
					continue
				if isinstance(v, dict):
					keys.extend(_collect_keys(v, full))
				else:
					keys.append(full)
			return keys

		available_keys = _collect_keys(metadata)
		# Also build a sample table: key → value (truncated)
		sample_lines = []
		for k in available_keys[:40]:
			parts = k.split('.')
			val = metadata
			for p in parts:
				if isinstance(val, dict):
					val = val.get(p, '')
				else:
					val = ''
					break
			sample_lines.append(f"  [[{k}]] → {str(val)[:80]}")

		system_prompt += (
			"\n\nMETADATA PLACEHOLDERS:\n"
			"This document has metadata fields. You can insert dynamic values using "
			"double-bracket placeholders like [[field_name]]. These will be replaced "
			"with actual values when the PDF is rendered.\n"
			"Available fields:\n"
			+ '\n'.join(sample_lines)
			+ "\n\nUse these [[key]] placeholders wherever appropriate instead of "
			"hard-coding values. For example, use [[client_name]] instead of writing "
			"a fake name.\n"
		)

	user_message = (
		f"Document: \"{doc_title}\" (type: {doc_type})\n\n"
		f"User request:\n{prompt}"
	)

	# ── Call Gemini ──
	api_key = os.environ.get('GEMINI_API')
	if not api_key:
		return Response(
			{'status': 'error', 'message': 'AI API key not configured.'},
			status=status.HTTP_500_INTERNAL_SERVER_ERROR,
		)

	payload = {
		'contents': [
			{
				'role': 'user',
				'parts': [
					{'text': system_prompt},
					{'text': user_message},
				],
			}
		],
		'generationConfig': {
			'temperature': 0.3,
			'topP': 0.9,
			'topK': 40,
			'maxOutputTokens': 16000,
		},
	}

	try:
		raw_response = call_gemini(payload, api_key=api_key)
	except Exception as exc:
		return Response(
			{'status': 'error', 'message': f'AI call failed: {exc}'},
			status=status.HTTP_502_BAD_GATEWAY,
		)

	# ── Extract LaTeX from response ──
	latex_code = ''
	try:
		candidates = raw_response.get('candidates', [])
		if candidates:
			parts = candidates[0].get('content', {}).get('parts', [])
			raw_text = ''.join(p.get('text', '') for p in parts)

			# Strip markdown code fences if the model wrapped them
			fence_match = re.search(
				r'```(?:latex|tex)?\s*\n?(.*?)```',
				raw_text,
				re.DOTALL,
			)
			if fence_match:
				latex_code = fence_match.group(1).strip()
			else:
				latex_code = raw_text.strip()
	except Exception:
		latex_code = ''

	if not latex_code:
		return Response(
			{'status': 'error', 'message': 'AI did not return valid LaTeX code.'},
			status=status.HTTP_502_BAD_GATEWAY,
		)

	# ── Sanitize AI-generated code to fix common errors ──
	from documents.latex_render_views import sanitize_ai_latex_code
	latex_code = sanitize_ai_latex_code(latex_code)

	# ── Save to document ──
	latex_code_id = None

	if should_save:
		document.latex_code = latex_code
		document.is_latex_code = True
		document.save(update_fields=['latex_code', 'is_latex_code'])

	# ── Optionally create/update a LatexCode record ──
	if section_id:
		try:
			section = Section.objects.get(id=section_id, document=document)
			latex_obj, _created = LatexCode.objects.update_or_create(
				section=section,
				code_type=code_type,
				defaults={
					'latex_code': latex_code,
					'has_edits': False,
					'edited_code': None,
					'topic': topic or prompt[:255],
					'modified_by': request.user,
					'edit_count': 0,
				},
			)
			latex_code_id = str(latex_obj.id)
		except Section.DoesNotExist:
			pass  # silently skip — document-level save still succeeded

	return Response(
		{
			'status': 'success',
			'latex_code': latex_code,
			'document_id': str(document.id),
			'saved_to_document': bool(should_save),
			'latex_code_id': latex_code_id,
			'is_latex_code': document.is_latex_code,
		},
		status=status.HTTP_200_OK,
	)


# ── AI Dashboard Assistant ───────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ai_dashboard_assistant(request):
	"""AI-powered dashboard assistant that aggregates user activities and
	returns an intelligent summary with recommendations.

	GET /api/ai/dashboard-assistant/

	Returns:
	{
		"activities": [ ... ],          # aggregated user activities
		"ai_summary": "...",            # AI-generated summary text
		"recommendations": [ ... ],     # actionable recommendations
		"stats": { ... },               # quick stats snapshot
	}
	"""
	from django.db.models import Q, Count
	from django.utils import timezone
	from datetime import timedelta
	from sharing.models import Share
	from django.contrib.contenttypes.models import ContentType
	from documents.models import (
		Document, DocumentWorkflow, WorkflowApproval, WorkflowNotification,
	)
	import json as _json

	user = request.user
	now = timezone.now()
	week_ago = now - timedelta(days=7)
	month_ago = now - timedelta(days=30)

	# ── 1. Gather all user activities (metadata-rich) ──────────────────

	# Recent documents – sorted by update time, rich metadata included
	my_docs = (
		Document.objects
		.filter(Q(created_by=user))
		.select_related('last_modified_by')
		.order_by('-updated_at')[:25]
	)
	doc_activities = []
	for doc in my_docs:
		is_recent = doc.updated_at >= week_ago
		meta = doc.document_metadata or {}

		# Extract key metadata for AI context
		dates_meta = meta.get('dates', {})
		legal_meta = meta.get('legal', {})
		financial_meta = meta.get('financial', {})
		terms_meta = meta.get('terms', {})
		classification_meta = meta.get('classification', {})

		# Detect approaching deadlines
		expiry = doc.expiration_date
		days_to_expiry = None
		if expiry:
			days_to_expiry = (expiry - now.date()).days

		doc_info = {
			'type': 'document',
			'action': 'created' if doc.created_at == doc.updated_at else 'updated',
			'title': doc.title,
			'status': doc.status,
			'category': doc.category or '',
			'document_type': doc.document_type or '',
			'updated_at': doc.updated_at.isoformat(),
			'created_at': doc.created_at.isoformat(),
			'is_recent': is_recent,
			# Rich metadata
			'parties': doc.parties[:5] if doc.parties else [],
			'jurisdiction': doc.jurisdiction or legal_meta.get('jurisdiction', ''),
			'governing_law': doc.governing_law or legal_meta.get('governing_law', ''),
			'effective_date': str(doc.effective_date) if doc.effective_date else dates_meta.get('effective_date', ''),
			'expiration_date': str(doc.expiration_date) if doc.expiration_date else dates_meta.get('expiration_date', ''),
			'days_to_expiry': days_to_expiry,
			'version_label': doc.version_label or f'v{doc.major_version}.{doc.minor_version}',
			'is_draft': doc.is_draft,
			'last_modified_by': doc.last_modified_by.username if doc.last_modified_by else '',
			'reference_number': doc.reference_number or legal_meta.get('reference_number', ''),
			'project_name': doc.project_name or '',
			# Financial context (if contract)
			'contract_value': financial_meta.get('contract_value', ''),
			'payment_terms': financial_meta.get('payment_terms', ''),
			# Terms context
			'auto_renewal': doc.auto_renewal,
			'term_length': doc.term_length or terms_meta.get('term_length', ''),
			# Analysis status
			'total_issues': doc.total_issues_count,
			'critical_issues': doc.critical_issues_count,
			'tags': classification_meta.get('tags', []),
		}
		doc_activities.append(doc_info)

	# Pending approvals for user
	pending_approvals = (
		WorkflowApproval.objects
		.filter(approver=user, status='pending', workflow__is_active=True)
		.select_related('workflow', 'workflow__document')[:20]
	)
	approval_activities = []
	for appr in pending_approvals:
		approval_activities.append({
			'type': 'approval',
			'action': 'pending',
			'document_title': appr.workflow.document.title if appr.workflow and appr.workflow.document else 'Unknown',
			'role': appr.role or '',
			'is_required': appr.is_required,
			'created_at': appr.created_at.isoformat() if appr.created_at else '',
		})

	# Active workflows assigned to user
	my_workflows = (
		DocumentWorkflow.objects
		.filter(assigned_to=user, is_active=True)
		.select_related('document', 'assigned_by')
		.order_by('-updated_at')[:20]
	)
	workflow_activities = []
	for wf in my_workflows:
		is_overdue = wf.due_date and wf.due_date < now and not wf.is_completed
		workflow_activities.append({
			'type': 'workflow',
			'action': 'completed' if wf.is_completed else ('overdue' if is_overdue else 'in_progress'),
			'document_title': wf.document.title if wf.document else 'Unknown',
			'status': wf.current_status,
			'priority': wf.priority,
			'is_overdue': bool(is_overdue),
			'due_date': wf.due_date.isoformat() if wf.due_date else None,
		})

	# Shares involving user
	content_type = ContentType.objects.get_for_model(Document)
	recent_shares = (
		Share.objects
		.filter(
			content_type=content_type,
			is_active=True,
		)
		.filter(Q(shared_by=user) | Q(shared_with_user=user))
		.select_related('shared_by', 'shared_with_user')
		.order_by('-shared_at')[:10]
	)
	share_activities = []
	for share in recent_shares:
		try:
			doc = Document.objects.get(id=share.object_id)
			share_activities.append({
				'type': 'share',
				'action': 'shared_by_me' if share.shared_by == user else 'shared_with_me',
				'document_title': doc.title,
				'role': share.role,
				'shared_at': share.shared_at.isoformat() if share.shared_at else '',
			})
		except Document.DoesNotExist:
			pass

	# Unread notifications
	unread_notifications = (
		WorkflowNotification.objects
		.filter(recipient=user, is_read=False)
		.order_by('-created_at')[:10]
	)
	notification_activities = []
	for notif in unread_notifications:
		notification_activities.append({
			'type': 'notification',
			'message': notif.message,
			'notification_type': notif.notification_type,
			'created_at': notif.created_at.isoformat() if notif.created_at else '',
		})

	# ── 2. Compute quick stats ─────────────────────────────────────────
	total_docs = Document.objects.filter(created_by=user).count()
	docs_this_week = Document.objects.filter(created_by=user, updated_at__gte=week_ago).count()
	docs_this_month = Document.objects.filter(created_by=user, updated_at__gte=month_ago).count()
	pending_approval_count = WorkflowApproval.objects.filter(
		approver=user, status='pending', workflow__is_active=True,
	).count()
	overdue_workflows = sum(1 for w in workflow_activities if w.get('is_overdue'))
	active_workflow_count = DocumentWorkflow.objects.filter(
		assigned_to=user, is_active=True, is_completed=False,
	).count()
	unread_count = WorkflowNotification.objects.filter(
		recipient=user, is_read=False,
	).count()

	# Document breakdown by status
	status_breakdown = dict(
		Document.objects.filter(created_by=user)
		.values_list('status')
		.annotate(count=Count('id'))
		.values_list('status', 'count')
	)

	# Approaching deadlines (next 30 days)
	upcoming_deadlines = [
		d for d in doc_activities
		if d.get('days_to_expiry') is not None and 0 < d['days_to_expiry'] <= 30
	]

	# Documents with critical issues
	docs_with_critical = [d for d in doc_activities if d.get('critical_issues', 0) > 0]

	stats = {
		'total_documents': total_docs,
		'documents_active_this_week': docs_this_week,
		'documents_active_this_month': docs_this_month,
		'pending_approvals': pending_approval_count,
		'overdue_workflows': overdue_workflows,
		'active_workflows': active_workflow_count,
		'unread_notifications': unread_count,
		'total_shares': recent_shares.count(),
		'status_breakdown': status_breakdown,
		'approaching_deadlines': len(upcoming_deadlines),
		'documents_with_critical_issues': len(docs_with_critical),
	}

	# ── 3. Build AI context and call LLM ───────────────────────────────
	all_activities = (
		doc_activities + approval_activities + workflow_activities +
		share_activities + notification_activities
	)

	# Build a richer document timeline for the AI
	recent_updates = [d for d in doc_activities if d.get('is_recent')]
	deadline_alerts = [d for d in doc_activities if d.get('days_to_expiry') is not None and 0 < d['days_to_expiry'] <= 30]
	expired_docs = [d for d in doc_activities if d.get('days_to_expiry') is not None and d['days_to_expiry'] <= 0]

	# Compact document summaries sorted by update time (already sorted)
	doc_briefing = []
	for d in doc_activities[:15]:
		brief = {
			'title': d['title'],
			'status': d['status'],
			'category': d['category'],
			'type': d['document_type'],
			'action': d['action'],
			'updated': d['updated_at'],
			'version': d['version_label'],
			'draft': d['is_draft'],
			'modified_by': d['last_modified_by'],
		}
		if d.get('parties'):
			brief['parties'] = [p.get('name', p) if isinstance(p, dict) else str(p) for p in d['parties'][:3]]
		if d.get('jurisdiction'):
			brief['jurisdiction'] = d['jurisdiction']
		if d.get('governing_law'):
			brief['governing_law'] = d['governing_law']
		if d.get('expiration_date'):
			brief['expiration_date'] = d['expiration_date']
			if d.get('days_to_expiry') is not None:
				brief['days_to_expiry'] = d['days_to_expiry']
		if d.get('contract_value'):
			brief['contract_value'] = d['contract_value']
		if d.get('term_length'):
			brief['term_length'] = d['term_length']
		if d.get('auto_renewal'):
			brief['auto_renewal'] = True
		if d.get('critical_issues', 0) > 0:
			brief['critical_issues'] = d['critical_issues']
		if d.get('total_issues', 0) > 0:
			brief['total_issues'] = d['total_issues']
		if d.get('tags'):
			brief['tags'] = d['tags'][:5]
		if d.get('project_name'):
			brief['project_name'] = d['project_name']
		doc_briefing.append(brief)

	activity_summary_text = _json.dumps(all_activities[:30], default=str)
	stats_text = _json.dumps(stats, default=str)
	doc_briefing_text = _json.dumps(doc_briefing, default=str)
	deadline_text = _json.dumps(deadline_alerts[:10], default=str) if deadline_alerts else '[]'
	expired_text = _json.dumps([{'title': d['title'], 'days_overdue': abs(d['days_to_expiry'])} for d in expired_docs[:5]], default=str) if expired_docs else '[]'

	system_prompt = (
		"You are a smart legal document assistant for the LL-Doc platform. "
		"Your role is to give the user a clear, actionable BRIEFING about their document portfolio — "
		"what changed recently, what needs attention, and what's coming up.\n\n"
		"Analyze the document data (sorted by most recent update) and provide:\n\n"
		"1. **summary** (3-5 sentences): A briefing-style overview of recent document activity. "
		"Mention specific document names, what changed (status updates, new drafts, edits by collaborators), "
		"approaching deadlines, and any contracts/agreements that need attention. "
		"Reference document context (parties, jurisdiction, contract values) when relevant.\n\n"
		"2. **recommendations** (3-6 items): Actionable items based on document context. Examples:\n"
		"   - 'Review [document] — expires in X days'\n"
		"   - '[Document] has critical issues flagged by analysis'\n"
		"   - 'Follow up with [party] on [document] in [jurisdiction]'\n"
		"   - 'Approve pending [document] before [date]'\n"
		"   Each item: {title, description, priority: 'high'|'medium'|'low', action_type: string}\n\n"
		"3. **urgent_items**: Things that need IMMEDIATE action (expired documents, overdue workflows, "
		"critical issues, pending approvals). Each: {title, description, type: string}\n\n"
		"4. **document_updates** (up to 5 items): The most important recent document changes. "
		"Each: {title, change_summary, updated_at, status}\n"
		"   change_summary should be a natural language description like "
		"'Status changed to under_review, 3 critical issues found' or 'New draft created for NDA with Acme Corp'.\n\n"
		"Be specific — use document names, party names, dates, and jurisdictions. "
		"Don't be generic. Prioritize by urgency and recency.\n"
		"Return ONLY a JSON object with fields: summary, recommendations, urgent_items, document_updates.\n"
		"No markdown fences, just the JSON."
	)

	user_prompt = (
		f"Dashboard briefing for user '{user.username}' — {now.strftime('%B %d, %Y at %I:%M %p')}:\n\n"
		f"PORTFOLIO STATS:\n{stats_text}\n\n"
		f"RECENT DOCUMENTS (sorted by update time):\n{doc_briefing_text}\n\n"
		f"APPROACHING DEADLINES (next 30 days):\n{deadline_text}\n\n"
		f"EXPIRED/OVERDUE DOCUMENTS:\n{expired_text}\n\n"
		f"PENDING APPROVALS:\n{_json.dumps(approval_activities[:10], default=str)}\n\n"
		f"ACTIVE WORKFLOWS:\n{_json.dumps(workflow_activities[:10], default=str)}\n\n"
		f"RECENT SHARES:\n{_json.dumps(share_activities[:5], default=str)}\n\n"
		f"UNREAD NOTIFICATIONS:\n{_json.dumps(notification_activities[:5], default=str)}\n\n"
		f"Provide your briefing analysis."
	)

	ai_result = {
		'summary': '',
		'recommendations': [],
		'urgent_items': [],
		'document_updates': [],
	}

	ai_provider = 'fallback'  # track which provider answered

	# ── Read provider/model override from query params (from Settings) ─
	req_provider = request.query_params.get('provider', 'auto')   # ollama | gemini | auto
	req_model    = request.query_params.get('model', None)         # e.g. llama3.2, qwen3:8b

	# ── 3a. Try Ollama (local, fast, free) ─────────────────────────────
	use_ollama = req_provider in ('ollama', 'auto')
	try:
		from .ollama_client import call_ollama, is_ollama_available, OLLAMA_MODEL
		if use_ollama and is_ollama_available():
			import logging as _log
			model_to_use = req_model or OLLAMA_MODEL
			_log.getLogger(__name__).info('AI dashboard: using Ollama model=%s', model_to_use)
			parsed = call_ollama(
				system_prompt=system_prompt,
				user_prompt=user_prompt,
				model=model_to_use,
				temperature=0.3,
				max_tokens=2048,
				json_mode=True,
			)
			if isinstance(parsed, dict) and parsed.get('summary'):
				ai_result['summary'] = parsed.get('summary', '')
				ai_result['recommendations'] = parsed.get('recommendations', [])
				ai_result['urgent_items'] = parsed.get('urgent_items', [])
				ai_result['document_updates'] = parsed.get('document_updates', [])
				ai_provider = f'ollama:{model_to_use}'
	except Exception as e:
		import logging
		logging.getLogger(__name__).warning(f'AI dashboard Ollama call failed: {e}')

	# ── 3b. Fall back to Gemini (cloud) if needed ──────────────────────
	use_gemini = req_provider in ('gemini', 'auto')
	if not ai_result['summary'] and use_gemini:
		api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GEN_API_KEY') or os.environ.get('GEMINI_API')
		if api_key:
			try:
				payload = {
					'contents': [
						{
							'role': 'user',
							'parts': [{'text': user_prompt}],
						}
					],
					'systemInstruction': {
						'parts': [{'text': system_prompt}],
					},
					'generationConfig': {
						'temperature': 0.3,
						'maxOutputTokens': 2048,
						'responseMimeType': 'application/json',
					},
				}
				response = call_gemini(payload, api_key=api_key)

				# Parse Gemini response
				from .gemini_ingest import extract_function_call_result
				parsed = extract_function_call_result(response)
				if parsed and isinstance(parsed, dict):
					ai_result['summary'] = parsed.get('summary', '')
					ai_result['recommendations'] = parsed.get('recommendations', [])
					ai_result['urgent_items'] = parsed.get('urgent_items', [])
					ai_result['document_updates'] = parsed.get('document_updates', [])
					ai_provider = 'gemini'
				else:
					# Try direct text extraction
					try:
						text = response.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
						if text:
							import json as _j2
							parsed2 = _j2.loads(text)
							ai_result['summary'] = parsed2.get('summary', '')
							ai_result['recommendations'] = parsed2.get('recommendations', [])
							ai_result['urgent_items'] = parsed2.get('urgent_items', [])
							ai_result['document_updates'] = parsed2.get('document_updates', [])
							ai_provider = 'gemini'
					except Exception:
						pass
			except Exception as e:
				import logging
				logging.getLogger(__name__).warning(f'AI dashboard assistant Gemini call failed: {e}')
				# Fall through to fallback
	
	# ── Fallback: generate summary without AI if no API key or AI failed ──
	if not ai_result['summary']:
		parts = []
		if recent_updates:
			parts.append(f"You updated {len(recent_updates)} document{'s' if len(recent_updates) != 1 else ''} this week.")
			latest = recent_updates[0]
			parts.append(f"Most recent: \"{latest['title']}\" ({latest['status']}).")
		if pending_approval_count > 0:
			parts.append(f"You have {pending_approval_count} pending approval{'s' if pending_approval_count != 1 else ''} waiting for your review.")
		if overdue_workflows > 0:
			parts.append(f"{overdue_workflows} workflow{'s are' if overdue_workflows != 1 else ' is'} overdue and need{'s' if overdue_workflows == 1 else ''} immediate attention.")
		if deadline_alerts:
			parts.append(f"{len(deadline_alerts)} document{'s' if len(deadline_alerts) != 1 else ''} {'have' if len(deadline_alerts) != 1 else 'has'} approaching deadlines within 30 days.")
		if not parts:
			parts.append(f"You have {total_docs} document{'s' if total_docs != 1 else ''} in your workspace. Everything looks good!")
		ai_result['summary'] = ' '.join(parts)

		# Fallback recommendations
		recs = []
		if deadline_alerts:
			for dl in deadline_alerts[:2]:
				recs.append({
					'title': f'Review "{dl["title"]}" — expires in {dl["days_to_expiry"]} days',
					'description': f'This {dl["category"] or "document"} is approaching its expiration date.',
					'priority': 'high' if dl['days_to_expiry'] <= 7 else 'medium',
					'action_type': 'open_document',
				})
		if pending_approval_count > 0:
			recs.append({
				'title': 'Review Pending Approvals',
				'description': f'You have {pending_approval_count} document{"s" if pending_approval_count != 1 else ""} awaiting your approval.',
				'priority': 'high',
				'action_type': 'navigate_approvals',
			})
		if overdue_workflows > 0:
			recs.append({
				'title': 'Address Overdue Workflows',
				'description': f'{overdue_workflows} workflow{"s are" if overdue_workflows != 1 else " is"} past the due date.',
				'priority': 'high',
				'action_type': 'navigate_tasks',
			})
		if docs_with_critical:
			for cd in docs_with_critical[:2]:
				recs.append({
					'title': f'Fix issues in "{cd["title"]}"',
					'description': f'{cd["critical_issues"]} critical issue{"s" if cd["critical_issues"] != 1 else ""} found by analysis.',
					'priority': 'high',
					'action_type': 'open_document',
				})
		if unread_count > 0:
			recs.append({
				'title': 'Check Notifications',
				'description': f'You have {unread_count} unread notification{"s" if unread_count != 1 else ""}.',
				'priority': 'medium',
				'action_type': 'navigate_notifications',
			})
		if total_docs == 0:
			recs.append({
				'title': 'Create Your First Document',
				'description': 'Get started by creating a new legal document.',
				'priority': 'low',
				'action_type': 'create_document',
			})
		ai_result['recommendations'] = recs

		# Fallback urgent items
		urgents = []
		if expired_docs:
			for ed in expired_docs[:3]:
				urgents.append({
					'title': f'"{ed["title"]}" has expired',
					'description': f'This document expired {abs(ed["days_to_expiry"])} day{"s" if abs(ed["days_to_expiry"]) != 1 else ""} ago.',
					'type': 'document_expired',
				})
		if overdue_workflows > 0:
			urgents.append({
				'title': f'{overdue_workflows} Overdue Workflow{"s" if overdue_workflows != 1 else ""}',
				'description': 'These workflows have passed their due dates.',
				'type': 'workflow_overdue',
			})
		if pending_approval_count > 0:
			urgents.append({
				'title': f'{pending_approval_count} Pending Approval{"s" if pending_approval_count != 1 else ""}',
				'description': 'Documents are waiting for your review and approval.',
				'type': 'approval_pending',
			})
		ai_result['urgent_items'] = urgents

		# Fallback document updates
		ai_result['document_updates'] = [
			{
				'title': d['title'],
				'change_summary': f"{'Created' if d['action'] == 'created' else 'Updated'} — status: {d['status']}"
					+ (f", {d['critical_issues']} critical issues" if d.get('critical_issues', 0) > 0 else ''),
				'updated_at': d['updated_at'],
				'status': d['status'],
			}
			for d in recent_updates[:5]
		]

	return Response({
		'status': 'success',
		'user': user.username,
		'stats': stats,
		'activities': all_activities[:20],
		'ai_summary': ai_result['summary'],
		'recommendations': ai_result['recommendations'],
		'urgent_items': ai_result['urgent_items'],
		'document_updates': ai_result.get('document_updates', []),
		'ai_provider': ai_provider,
	})

