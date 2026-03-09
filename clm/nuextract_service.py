"""
NuExtract v2.0 AI Service
==========================
Handles contract text extraction from PDF/DOCX, then uses the NuExtract
model (numind/NuExtract-v1.5 or v2) for zero-shot structured extraction.

Supports both:
  1. Local inference via Hugging Face transformers
  2. Remote API inference via Hugging Face Inference API

Includes confidence scoring, data-type enforcement, and automatic
human-verification flagging.
"""
import json
import logging
import math
import os
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

NUEXTRACT_MODEL = os.getenv('NUEXTRACT_MODEL', 'numind/NuExtract-1.5-tiny')
NUEXTRACT_API_URL = os.getenv(
    'NUEXTRACT_API_URL',
    f'https://api-inference.huggingface.co/models/{NUEXTRACT_MODEL}',
)
HF_API_TOKEN = os.getenv('HF_API_TOKEN', '')
CONFIDENCE_THRESHOLD = float(os.getenv('NUEXTRACT_CONFIDENCE_THRESHOLD', '0.85'))

# Maximum input length for the model (chars). Longer texts are chunked.
MAX_INPUT_LENGTH = int(os.getenv('NUEXTRACT_MAX_INPUT_LENGTH', '6000'))


# ---------------------------------------------------------------------------
# Text extraction from files
# ---------------------------------------------------------------------------

def extract_text_from_pdf(file_obj) -> str:
    """Extract text from a PDF file using PyMuPDF (fitz)."""
    try:
        import fitz  # PyMuPDF
        file_obj.seek(0)
        pdf_bytes = file_obj.read()
        doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        text_parts = []
        for page in doc:
            text_parts.append(page.get_text())
        doc.close()
        return '\n'.join(text_parts)
    except Exception as e:
        logger.error(f"PDF text extraction failed: {e}")
        return ''


def extract_text_from_docx(file_obj) -> str:
    """Extract text from a DOCX file using python-docx."""
    try:
        from docx import Document as DocxDocument
        file_obj.seek(0)
        doc = DocxDocument(file_obj)
        return '\n'.join(para.text for para in doc.paragraphs if para.text.strip())
    except Exception as e:
        logger.error(f"DOCX text extraction failed: {e}")
        return ''


def extract_text(file_obj, file_type: str) -> str:
    """Route to the appropriate extractor."""
    extractors = {
        'pdf': extract_text_from_pdf,
        'docx': extract_text_from_docx,
        'doc': extract_text_from_docx,
        'txt': lambda f: f.read().decode('utf-8', errors='replace'),
    }
    extractor = extractors.get(file_type)
    if not extractor:
        raise ValueError(f"Unsupported file type: {file_type}")
    return extractor(file_obj)


# ---------------------------------------------------------------------------
# NuExtract prompt construction
# ---------------------------------------------------------------------------

def build_nuextract_prompt(text: str, template: dict) -> str:
    """
    Build the prompt string in NuExtract v1.5 format:
      <|input|>\n### Template:\n{template_json}\n### Text:\n{text}\n\n<|output|>
    """
    template_json = json.dumps(template, indent=4)
    return f"<|input|>\n### Template:\n{template_json}\n### Text:\n{text}\n\n<|output|>"


def chunk_text(text: str, max_length: int = MAX_INPUT_LENGTH) -> list[str]:
    """Split long documents into overlapping chunks."""
    if len(text) <= max_length:
        return [text]
    overlap = 500
    chunks = []
    start = 0
    while start < len(text):
        end = start + max_length
        chunks.append(text[start:end])
        start = end - overlap
    return chunks


# ---------------------------------------------------------------------------
# Model inference
# ---------------------------------------------------------------------------

class NuExtractService:
    """
    Main service class for NuExtract v2.0 extraction.
    """

    def __init__(self, model_name: str | None = None, api_url: str | None = None):
        self.model_name = model_name or NUEXTRACT_MODEL
        self.api_url = api_url or NUEXTRACT_API_URL
        self._local_model = None
        self._local_tokenizer = None

    # -- Remote (HF Inference API) ------------------------------------------

    def _call_remote(self, prompt: str) -> dict:
        """Call the Hugging Face Inference API."""
        headers = {}
        if HF_API_TOKEN:
            headers['Authorization'] = f'Bearer {HF_API_TOKEN}'

        payload = {
            'inputs': prompt,
            'parameters': {
                'max_new_tokens': 2000,
                'return_full_text': False,
                'temperature': 0.0,
            },
            'options': {
                'wait_for_model': True,
            },
        }

        resp = requests.post(self.api_url, json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        result = resp.json()

        if isinstance(result, list) and len(result) > 0:
            generated_text = result[0].get('generated_text', '')
        elif isinstance(result, dict):
            generated_text = result.get('generated_text', '')
        else:
            generated_text = str(result)

        return self._parse_json_output(generated_text)

    # -- Local inference (transformers) -------------------------------------

    def _get_device(self):
        """Pick the best available device: MPS (Apple GPU) → CUDA → CPU."""
        import torch
        if torch.backends.mps.is_available():
            return 'mps'
        if torch.cuda.is_available():
            return 'cuda'
        return 'cpu'

    def _load_local_model(self):
        """Lazy-load the local model and tokenizer, placing on best device."""
        if self._local_model is not None:
            return
        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self._device = self._get_device()
            logger.info(
                f"Loading NuExtract model locally: {self.model_name} → {self._device}"
            )
            self._local_tokenizer = AutoTokenizer.from_pretrained(
                self.model_name, trust_remote_code=True,
            )
            dtype = torch.float16 if self._device in ('mps', 'cuda') else torch.float32
            self._local_model = AutoModelForCausalLM.from_pretrained(
                self.model_name, trust_remote_code=True, torch_dtype=dtype,
            )
            self._local_model.to(self._device)
            self._local_model.eval()
            logger.info(f"NuExtract model loaded on {self._device}.")
        except ImportError:
            raise ImportError(
                "transformers library required for local inference. "
                "Install with: pip install transformers torch"
            )

    def _call_local(self, prompt: str) -> tuple[dict, dict[str, float]]:
        """
        Run local inference and extract both the structured JSON
        and per-token log probabilities for confidence scoring.
        """
        import torch
        self._load_local_model()

        inputs = self._local_tokenizer(
            prompt, return_tensors='pt', truncation=True, max_length=8192,
        )
        # Move input tensors to the same device as the model
        inputs = {k: v.to(self._device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self._local_model.generate(
                **inputs,
                max_new_tokens=2000,
                temperature=0.01,  # near-greedy
                do_sample=False,
                output_scores=True,
                return_dict_in_generate=True,
            )

        # Decode generated tokens (skip prompt tokens)
        prompt_length = inputs['input_ids'].shape[1]
        generated_ids = outputs.sequences[0][prompt_length:]
        generated_text = self._local_tokenizer.decode(
            generated_ids, skip_special_tokens=True,
        )

        # Compute per-token log-probabilities for confidence
        confidence_scores = self._compute_confidence_from_scores(
            outputs.scores, generated_ids,
        )

        parsed = self._parse_json_output(generated_text)
        return parsed, confidence_scores

    def _compute_confidence_from_scores(
        self, scores: tuple, generated_ids,
    ) -> dict[str, float]:
        """
        Compute field-level confidence from token log-probabilities.
        Maps tokens back to JSON field names and averages the
        softmax probabilities for each field's value tokens.
        """
        import torch
        field_probs: dict[str, list[float]] = {}
        current_field = None

        generated_text_so_far = ''
        for i, (score_tensor, token_id) in enumerate(zip(scores, generated_ids)):
            probs = torch.softmax(score_tensor[0], dim=-1)
            token_prob = probs[token_id].item()
            token_text = self._local_tokenizer.decode([token_id])
            generated_text_so_far += token_text

            # Track which JSON field we're inside
            if '"' in token_text and ':' in generated_text_so_far.split('"')[-2:][0] if len(generated_text_so_far.split('"')) > 2 else False:
                # Heuristic: after a "key": pattern, we're in a value
                parts = generated_text_so_far.rsplit('"', 3)
                if len(parts) >= 3:
                    potential_key = parts[-2].strip()
                    if potential_key and not potential_key.startswith('{'):
                        current_field = potential_key

            if current_field:
                if current_field not in field_probs:
                    field_probs[current_field] = []
                field_probs[current_field].append(token_prob)

        # Average probabilities per field
        return {
            field: sum(probs) / len(probs) if probs else 0.0
            for field, probs in field_probs.items()
        }

    # -- Output parsing -----------------------------------------------------

    def _parse_json_output(self, text: str) -> dict:
        """
        Parse the model's text output into a JSON dict.
        Handles common model quirks (trailing commas, unquoted keys, etc.).
        """
        text = text.strip()
        # Try to find a JSON block
        json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        # Try the whole text
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Fix common issues: trailing commas
        cleaned = re.sub(r',\s*}', '}', text)
        cleaned = re.sub(r',\s*]', ']', cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse NuExtract output as JSON: {text[:200]}")
            return {}

    # -- Data type enforcement -----------------------------------------------

    @staticmethod
    def enforce_field_types(data: dict, field_types: dict) -> dict:
        """
        Cast extracted values to their declared types.
        field_types maps field_name → type_string.
        Supported types: string, decimal, float, int, date, bool
        """
        enforced = {}
        for field, value in data.items():
            target_type = field_types.get(field, 'string')
            try:
                enforced[field] = NuExtractService._cast_value(value, target_type)
            except (ValueError, TypeError, InvalidOperation) as e:
                logger.warning(
                    f"Type enforcement failed for {field}={value!r} "
                    f"(target: {target_type}): {e}"
                )
                enforced[field] = value  # Keep original on failure
        return enforced

    @staticmethod
    def _cast_value(value: Any, target_type: str) -> Any:
        """Cast a single value to the target type."""
        if value is None or (isinstance(value, str) and value.strip() == ''):
            return None

        match target_type:
            case 'string':
                return str(value).strip()
            case 'decimal':
                cleaned = re.sub(r'[^\d.\-]', '', str(value))
                return Decimal(cleaned)
            case 'float':
                cleaned = re.sub(r'[^\d.\-]', '', str(value))
                return float(cleaned)
            case 'int':
                cleaned = re.sub(r'[^\d\-]', '', str(value))
                return int(cleaned)
            case 'date':
                if isinstance(value, date):
                    return value
                # Try common formats
                for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%B %d, %Y', '%b %d, %Y'):
                    try:
                        return datetime.strptime(str(value).strip(), fmt).date()
                    except ValueError:
                        continue
                raise ValueError(f"Cannot parse date: {value}")
            case 'bool':
                if isinstance(value, bool):
                    return value
                return str(value).strip().lower() in ('true', 'yes', '1')
            case _:
                return value

    # -- Confidence scoring (for remote API) ---------------------------------

    @staticmethod
    def estimate_confidence_remote(
        template: dict, extracted: dict,
    ) -> dict[str, float]:
        """
        Heuristic confidence estimation when using the remote API
        (no access to logits). Scores based on:
          - Whether the field was populated (vs empty)
          - Value plausibility (length, format matching)
          - Consistency checks
        """
        scores = {}
        for field in template:
            value = extracted.get(field)
            if value is None or (isinstance(value, str) and not value.strip()):
                scores[field] = 0.0
                continue

            score = 0.7  # Base score for non-empty
            val_str = str(value)

            # Bonus for longer, more specific values
            if len(val_str) > 3:
                score += 0.1
            if len(val_str) > 10:
                score += 0.05

            # Bonus for values that look like expected patterns
            if field.endswith('_date') and re.match(r'\d{4}-\d{2}-\d{2}', val_str):
                score += 0.15
            elif field.endswith('_value') and re.match(r'[\d,.$]+', val_str):
                score += 0.15
            elif field == 'jurisdiction' and len(val_str) > 1:
                score += 0.1

            scores[field] = min(score, 1.0)

        return scores

    # -- Main extraction pipeline -------------------------------------------

    def extract(
        self,
        text: str,
        template: dict,
        field_types: dict | None = None,
        use_local: bool = False,
    ) -> dict:
        """
        Main extraction method.

        Returns:
            {
                "extracted_data": {...},      # Structured metadata
                "confidence": {...},          # Per-field confidence (0.0-1.0)
                "overall_confidence": float,  # Average confidence
                "needs_human_verification": bool,  # True if any field < 85%
                "raw_output": str,            # Raw model response
            }
        """
        if not text.strip():
            return {
                'extracted_data': {k: None for k in template},
                'confidence': {k: 0.0 for k in template},
                'overall_confidence': 0.0,
                'needs_human_verification': True,
                'raw_output': '',
            }

        # Handle long documents via chunking + merging
        chunks = chunk_text(text)
        all_extractions = []

        for chunk in chunks:
            prompt = build_nuextract_prompt(chunk, template)

            if use_local:
                extracted, confidence = self._call_local(prompt)
            else:
                extracted = self._call_remote(prompt)
                confidence = self.estimate_confidence_remote(template, extracted)

            all_extractions.append((extracted, confidence))

        # Merge results from multiple chunks (pick highest-confidence value per field)
        merged_data, merged_confidence = self._merge_chunk_results(
            all_extractions, template,
        )

        # Enforce data types
        if field_types:
            merged_data = self.enforce_field_types(merged_data, field_types)

        # Calculate overall confidence
        conf_values = [v for v in merged_confidence.values() if v > 0]
        overall = sum(conf_values) / len(conf_values) if conf_values else 0.0

        # Flag for human verification
        needs_verification = any(
            v < CONFIDENCE_THRESHOLD
            for v in merged_confidence.values()
        )

        return {
            'extracted_data': merged_data,
            'confidence': merged_confidence,
            'overall_confidence': round(overall, 4),
            'needs_human_verification': needs_verification,
            'raw_output': json.dumps(merged_data),
        }

    def _merge_chunk_results(
        self,
        extractions: list[tuple[dict, dict[str, float]]],
        template: dict,
    ) -> tuple[dict, dict[str, float]]:
        """Merge extraction results from multiple chunks, keeping highest confidence."""
        merged_data = {}
        merged_conf = {}

        for field in template:
            best_value = None
            best_conf = 0.0

            for data, conf in extractions:
                field_conf = conf.get(field, 0.0)
                field_val = data.get(field)

                if field_val and field_conf > best_conf:
                    best_value = field_val
                    best_conf = field_conf

            merged_data[field] = best_value
            merged_conf[field] = round(best_conf, 4)

        return merged_data, merged_conf

    # -- Full pipeline: file → extraction for WorkflowDocument ------------

    def process_document(self, document, template: dict) -> dict:
        """
        Full extraction pipeline for a WorkflowDocument instance:
        1. Extract text from file
        2. Run NuExtract with the provided template
        3. Update document fields
        """
        # Extract text
        text = extract_text(document.file, document.file_type)
        document.original_text = text
        document.extraction_status = 'processing'
        document.save(update_fields=['original_text', 'extraction_status'])

        # Run NuExtract
        use_local = os.getenv('NUEXTRACT_USE_LOCAL', 'false').lower() == 'true'
        result = self.extract(
            text=text,
            template=template,
            use_local=use_local,
        )

        # Update document
        document.extracted_metadata = result['extracted_data']
        document.extraction_confidence = result['confidence']
        document.overall_confidence = result['overall_confidence']
        document.extraction_status = 'completed'
        document.save(update_fields=[
            'extracted_metadata', 'extraction_confidence',
            'overall_confidence', 'extraction_status', 'updated_at',
        ])

        return result


# ---------------------------------------------------------------------------
# Module-level convenience function (used by views.py)
# ---------------------------------------------------------------------------

def process_document(document, template: dict) -> dict:
    """Convenience wrapper: instantiate NuExtractService and process."""
    service = NuExtractService()
    return service.process_document(document, template)
