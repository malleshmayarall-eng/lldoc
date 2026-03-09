from django.db import models
from django.contrib.auth.models import User
import uuid

from documents.models import Document


# ─────────────────────────────────────────────────────────────────────────────
# Document-Type AI Presets & Per-Document AI Config
# ─────────────────────────────────────────────────────────────────────────────

class DocumentTypeAIPreset(models.Model):
	"""
	Organisation-level default AI service configuration for a specific
	document_type.  When a new document of this type is created, the preset
	is used as the starting AI config unless overridden.

	For example a ``billing`` document type may disable the paragraph-scoring
	LLM and enable a data-validation AI with a specialised system prompt,
	while a ``contract`` type keeps the full legal-quality scoring pipeline.
	"""

	AI_SERVICE_CHOICES = [
		('document_scoring', 'Document Scoring (LLM)'),
		('paragraph_review', 'Paragraph AI Review'),
		('paragraph_scoring', 'Paragraph Scoring (ONNX / LLM)'),
		('paragraph_rewrite', 'Paragraph Rewrite'),
		('data_validation', 'Data Validation AI'),
		('chat', 'AI Chat'),
		('analysis', 'Document Analysis'),
		('generation', 'AI Content Generation'),
		('latex_generation', 'LaTeX Code Generation'),
	]

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

	# Which document_type this preset covers (maps to Document.document_type)
	document_type = models.CharField(
		max_length=100, db_index=True, unique=True,
		help_text="Maps to Document.document_type, e.g. 'contract', 'billing', 'nda'"
	)
	display_name = models.CharField(
		max_length=255, blank=True, default='',
		help_text="Human-friendly label for the UI, e.g. 'Billing Documents'"
	)
	description = models.TextField(
		blank=True, default='',
		help_text="Explanation of how AI services are tuned for this type"
	)

	# ── Per-service toggle + config ──────────────────────────────────────
	services_config = models.JSONField(default=dict, blank=True, help_text="""
		Master config dict keyed by service name.  Each value is a dict:
		{
			"document_scoring": {
				"enabled": true,
				"mode": "legal",        // "legal" | "financial" | "data" | "custom"
				"model": "gemini-3-flash-preview",
				"temperature": 0.0,
				"max_tokens": 4000,
				"system_prompt_override": null,
				"options": {}
			},
			"paragraph_review": {
				"enabled": true,
				"mode": "legal",
				"model": null,
				"system_prompt_override": null,
				"options": {}
			},
			"paragraph_scoring": {
				"enabled": false,        // e.g. turned off for billing docs
				"mode": "data",
				"model": null,
				"options": {}
			},
			"data_validation": {
				"enabled": true,
				"mode": "financial",
				"system_prompt_override": "You are a financial data validator...",
				"options": {
					"validate_calculations": true,
					"check_totals": true,
					"currency_format": "USD"
				}
			},
			"chat": { "enabled": true, "mode": "legal" },
			"analysis": { "enabled": true },
			"generation": { "enabled": true },
			"paragraph_rewrite": { "enabled": true }
		}
	""")

	# Global system prompt injected into *all* AI calls for this doc type
	system_prompt = models.TextField(
		blank=True, default='',
		help_text="Custom system prompt prepended to every AI call for this document type"
	)

	# Per-service system prompts — each AI service gets a tailored prompt
	service_prompts = models.JSONField(default=dict, blank=True, help_text="""
		Per-service system prompts keyed by service name.  When a service
		makes an AI call, the prompt for that service is used *instead* of
		the global system_prompt.  If a service has no entry here, the
		global system_prompt is used as fallback.
		{
			"document_scoring": "You are a legal quality assessor...",
			"paragraph_review": "You are a paragraph-level legal reviewer...",
			"paragraph_scoring": "You are a paragraph scoring specialist...",
			"paragraph_rewrite": "You are a legal document editor...",
			"data_validation": "You are a financial data validator...",
			"chat": "You are a helpful legal document assistant...",
			"analysis": "You are a legal document analyst...",
			"generation": "You are a legal content generator..."
		}
	""")

	# AI focus description — tells the AI what to concentrate on
	ai_focus = models.TextField(
		blank=True, default='',
		help_text=(
			"Free-form instruction describing what the AI should focus on for "
			"this document type.  E.g. 'Focus on numerical accuracy, totals, "
			"tax calculations, and line-item correctness.'"
		)
	)

	created_by = models.ForeignKey(
		User, on_delete=models.SET_NULL, null=True, blank=True,
		related_name='created_ai_presets'
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['document_type']
		verbose_name = 'Document-Type AI Preset'
		verbose_name_plural = 'Document-Type AI Presets'

	def __str__(self):
		return f"AI Preset: {self.display_name or self.document_type}"

	# ── Helpers ──────────────────────────────────────────────────────────

	def is_service_enabled(self, service_name: str) -> bool:
		"""Check whether a specific AI service is enabled in this preset."""
		svc = (self.services_config or {}).get(service_name, {})
		return bool(svc.get('enabled', True))

	def get_service_config(self, service_name: str) -> dict:
		"""Return the config dict for a single service, with sane defaults."""
		return (self.services_config or {}).get(service_name, {'enabled': True})

	@classmethod
	def get_default_services_config(cls) -> dict:
		"""Return the factory-default services_config for new presets."""
		return {
			'document_scoring': {'enabled': True, 'mode': 'legal'},
			'paragraph_review': {'enabled': True, 'mode': 'legal'},
			'paragraph_scoring': {'enabled': True, 'mode': 'legal'},
			'paragraph_rewrite': {'enabled': True, 'mode': 'legal'},
			'data_validation': {'enabled': False, 'mode': 'data'},
			'chat': {'enabled': True, 'mode': 'legal'},
			'analysis': {'enabled': True, 'mode': 'legal'},
			'generation': {'enabled': True, 'mode': 'legal'},
		}


class DocumentAIConfig(models.Model):
	"""
	Per-document AI service configuration.  Stored as a one-to-one on
	Document so that every document can individually enable / disable /
	tune each AI service.

	Merge chain
	-----------
	DocumentTypeAIPreset.services_config   (org-level defaults per type)
	  ↓  deep-merged
	DocumentAIConfig.services_config       (per-document overrides)
	  ↓  resolved by  get_effective_config()
	Final runtime AI config for each service call

	This config is *automatically copied* when a document is branched,
	duplicated, or promoted — so a user doesn't have to reconfigure AI
	every time.
	"""

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	document = models.OneToOneField(
		Document, on_delete=models.CASCADE,
		related_name='ai_config',
		help_text="The document this AI config belongs to"
	)

	# Per-service overrides — same schema as DocumentTypeAIPreset.services_config
	services_config = models.JSONField(default=dict, blank=True, help_text="""
		Per-document AI service overrides.  Same schema as
		DocumentTypeAIPreset.services_config.  Values here take
		precedence over the document-type preset.
	""")

	# Optional per-document system prompt (prepended to every AI call)
	system_prompt = models.TextField(
		blank=True, default='',
		help_text="Per-document custom system prompt override"
	)

	# Per-service system prompt overrides (same schema as preset service_prompts)
	service_prompts = models.JSONField(default=dict, blank=True, help_text="""
		Per-document per-service system prompt overrides.
		Same schema as DocumentTypeAIPreset.service_prompts.
		Keys here override the preset's service_prompts for this document.
	""")

	# Optional per-document AI focus
	ai_focus = models.TextField(
		blank=True, default='',
		help_text="Per-document AI focus instructions"
	)

	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		verbose_name = 'Document AI Config'
		verbose_name_plural = 'Document AI Configs'

	def __str__(self):
		return f"AI Config for {self.document.title}"

	# ── Resolution helpers ───────────────────────────────────────────────

	def get_effective_config(self) -> dict:
		"""
		Resolve the final AI config by merging:
		  1. factory defaults
		  2. DocumentTypeAIPreset for this document's document_type
		  3. this instance's services_config overrides

		Returns a dict keyed by service name with fully resolved settings.
		"""
		import copy

		# Start from factory defaults
		base = DocumentTypeAIPreset.get_default_services_config()

		# Layer the document-type preset on top
		try:
			preset = DocumentTypeAIPreset.objects.get(
				document_type=self.document.document_type
			)
			preset_cfg = copy.deepcopy(preset.services_config or {})
			for svc, cfg in preset_cfg.items():
				if svc in base and isinstance(cfg, dict):
					base[svc].update(cfg)
				else:
					base[svc] = cfg
		except DocumentTypeAIPreset.DoesNotExist:
			pass

		# Layer per-document overrides on top
		doc_overrides = copy.deepcopy(self.services_config or {})
		for svc, cfg in doc_overrides.items():
			if svc in base and isinstance(cfg, dict):
				base[svc].update(cfg)
			else:
				base[svc] = cfg

		return base

	def get_effective_system_prompt(self) -> str:
		"""
		Build the combined *global* system prompt from:
		  1. Document-type preset system_prompt
		  2. Per-document system_prompt override
		This is the fallback when no service-specific prompt exists.
		"""
		parts = []
		try:
			preset = DocumentTypeAIPreset.objects.get(
				document_type=self.document.document_type
			)
			if preset.system_prompt:
				parts.append(preset.system_prompt)
		except DocumentTypeAIPreset.DoesNotExist:
			pass

		if self.system_prompt:
			parts.append(self.system_prompt)

		return '\n\n'.join(parts)

	def get_effective_service_prompt(self, service_name: str) -> str:
		"""
		Get the fully resolved system prompt for a *specific* AI service.

		Resolution order:
		  1. Per-document service_prompts[service_name] — if set, wins
		  2. Preset service_prompts[service_name]       — type-level default
		  3. Per-document global system_prompt           — doc-level fallback
		  4. Preset global system_prompt                 — type-level fallback
		  5. Empty string                                — factory default

		Unlike ``get_effective_system_prompt()`` which always concatenates
		preset + doc-level prompts, this returns the *single best* prompt
		for the given service — no concatenation of service-level prompts.
		"""
		# 1. Per-document service-specific prompt
		doc_svc_prompt = (self.service_prompts or {}).get(service_name, '').strip()
		if doc_svc_prompt:
			return doc_svc_prompt

		# 2. Preset service-specific prompt
		try:
			preset = DocumentTypeAIPreset.objects.get(
				document_type=self.document.document_type
			)
			preset_svc_prompt = (preset.service_prompts or {}).get(service_name, '').strip()
			if preset_svc_prompt:
				return preset_svc_prompt
		except DocumentTypeAIPreset.DoesNotExist:
			preset = None

		# 3–4. Fall back to the global system_prompt chain
		return self.get_effective_system_prompt()

	def get_effective_service_prompts(self) -> dict:
		"""
		Return a dict of *all* resolved per-service system prompts.
		Useful for serialisation — the frontend can display each
		service's effective prompt.
		"""
		services = list(dict(DocumentTypeAIPreset.AI_SERVICE_CHOICES).keys())
		return {svc: self.get_effective_service_prompt(svc) for svc in services}

	def get_effective_ai_focus(self) -> str:
		"""
		Resolve AI focus: per-document overrides preset if set.
		"""
		if self.ai_focus:
			return self.ai_focus
		try:
			preset = DocumentTypeAIPreset.objects.get(
				document_type=self.document.document_type
			)
			return preset.ai_focus or ''
		except DocumentTypeAIPreset.DoesNotExist:
			return ''

	def is_service_enabled(self, service_name: str) -> bool:
		"""Check whether a service is enabled after merge resolution."""
		cfg = self.get_effective_config()
		svc = cfg.get(service_name, {})
		return bool(svc.get('enabled', True))

	def get_service_config(self, service_name: str) -> dict:
		"""Get fully resolved config for a single service."""
		cfg = self.get_effective_config()
		return cfg.get(service_name, {'enabled': True})

	def get_document_ai_context(self, service_name: str = '') -> str:
		"""
		Build a context prefix string from the document's effective
		system_prompt, ai_focus, and document_type.  This is prepended
		to every AI prompt so that all services respond in a way that is
		aligned with the document type.

		If *service_name* is provided (e.g. ``'paragraph_review'``), the
		service-specific system prompt is used instead of the global one.
		This gives each AI service its own tailored instructions.

		Returns an empty string if no custom context is configured.
		"""
		parts = []

		doc_type = getattr(self.document, 'document_type', '') or ''
		if doc_type:
			parts.append(f'DOCUMENT TYPE: {doc_type}')

		# Pick the right prompt — service-specific beats global
		if service_name:
			system_prompt = self.get_effective_service_prompt(service_name)
		else:
			system_prompt = self.get_effective_system_prompt()
		if system_prompt:
			parts.append(f'SYSTEM INSTRUCTIONS:\n{system_prompt}')

		ai_focus = self.get_effective_ai_focus()
		if ai_focus:
			parts.append(f'AI FOCUS:\n{ai_focus}')

		# Pull per-service mode if set (e.g. "financial" vs "legal")
		effective = self.get_effective_config()
		if service_name:
			svc_cfg = effective.get(service_name, {})
			mode = svc_cfg.get('mode', '') if isinstance(svc_cfg, dict) else ''
			if mode and mode != 'legal':
				parts.append(f'SERVICE MODE: {mode}')
		else:
			modes = set()
			for svc_cfg in effective.values():
				if isinstance(svc_cfg, dict) and svc_cfg.get('mode'):
					modes.add(svc_cfg['mode'])
			if modes and modes != {'legal'}:
				parts.append(f'ACTIVE MODES: {", ".join(sorted(modes))}')

		if not parts:
			return ''

		return (
			'--- DOCUMENT AI CONTEXT ---\n'
			+ '\n\n'.join(parts)
			+ '\n--- END DOCUMENT AI CONTEXT ---\n\n'
		)

	@classmethod
	def get_or_create_for_document(cls, document):
		"""
		Get existing config or create one seeded from the document-type
		preset.  Used to lazily provision AI config on first access.
		"""
		obj, created = cls.objects.get_or_create(
			document=document,
			defaults={'services_config': {}}
		)
		return obj


class AIInteraction(models.Model):
	"""
	Stores an AI interaction (prompt/response) for a document.
	"""
	STATUS_CHOICES = [
		('pending', 'Pending'),
		('completed', 'Completed'),
		('failed', 'Failed'),
	]
	INTERACTION_TYPES = [
		('analysis', 'Analysis'),
		('summary', 'Summary'),
		('rewrite', 'Rewrite'),
		('qa', 'Q&A'),
		('other', 'Other'),
	]

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='ai_interactions')
	requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
	interaction_type = models.CharField(max_length=30, choices=INTERACTION_TYPES, default='analysis')
	model_name = models.CharField(max_length=100, default='gpt')

	prompt = models.TextField()
	response = models.TextField(null=True, blank=True)
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
	error_message = models.TextField(null=True, blank=True)

	tokens_in = models.IntegerField(default=0)
	tokens_out = models.IntegerField(default=0)
	metadata = models.JSONField(default=dict, blank=True)

	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['document', '-created_at']),
			models.Index(fields=['status']),
		]

	def __str__(self):
		return f"{self.document.title} ({self.interaction_type})"


class DocumentAnalysisRun(models.Model):
	"""
	Stores a structured analysis result for a document.
	"""
	STATUS_CHOICES = [
		('pending', 'Pending'),
		('running', 'Running'),
		('completed', 'Completed'),
		('failed', 'Failed'),
	]
	ANALYSIS_TYPES = [
		('risk', 'Risk'),
		('summary', 'Summary'),
		('quality', 'Quality'),
		('compliance', 'Compliance'),
		('custom', 'Custom'),
	]

	id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
	document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='analysis_runs')
	requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
	analysis_type = models.CharField(max_length=30, choices=ANALYSIS_TYPES, default='summary')
	model_name = models.CharField(max_length=100, default='gpt')
	status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
	result = models.JSONField(default=dict, blank=True)
	error_message = models.TextField(null=True, blank=True)
	metadata = models.JSONField(default=dict, blank=True)

	started_at = models.DateTimeField(null=True, blank=True)
	completed_at = models.DateTimeField(null=True, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-created_at']
		indexes = [
			models.Index(fields=['document', '-created_at']),
			models.Index(fields=['status']),
		]

	def __str__(self):
		return f"{self.document.title} ({self.analysis_type})"
