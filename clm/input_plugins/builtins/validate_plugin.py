"""
Validate Plugin — Checks extracted fields against configurable rules.
======================================================================
- Required fields (presence check)
- Regex patterns
- Min/max numeric ranges
- Type checks (date, number, email)
"""
import logging
import re

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}')


class ValidatePlugin:
    """Validates extracted metadata against configurable rules."""

    @clm_input_hookimpl
    def on_validate(self, node, document, extracted_fields):
        config = (node.config or {}).get('input_plugins', [])
        settings = {}
        for p in config:
            if p.get('name') == 'validate':
                settings = p.get('settings', {})
                if not p.get('enabled', True):
                    return []
                break

        issues = []

        # ── Required fields check ──────────────────────────────────
        required = settings.get('required_fields', [])
        for field_name in required:
            value = extracted_fields.get(field_name)
            if value is None or (isinstance(value, str) and not value.strip()):
                issues.append({
                    'field': field_name,
                    'severity': 'error',
                    'message': f'Required field "{field_name}" is missing or empty.',
                    'plugin': 'validate',
                    'rule': 'required',
                })

        # ── Per-field rules ────────────────────────────────────────
        field_rules = settings.get('field_rules', {})
        for field_name, rules in field_rules.items():
            value = extracted_fields.get(field_name)
            if value is None:
                continue  # required-check above handles missing fields

            str_value = str(value).strip()

            # Regex
            if 'regex' in rules:
                try:
                    if not re.match(rules['regex'], str_value):
                        issues.append({
                            'field': field_name,
                            'severity': 'error',
                            'message': f'Value "{str_value[:50]}" does not match pattern: {rules["regex"]}',
                            'plugin': 'validate',
                            'rule': 'regex',
                        })
                except re.error:
                    issues.append({
                        'field': field_name,
                        'severity': 'warning',
                        'message': f'Invalid regex pattern: {rules["regex"]}',
                        'plugin': 'validate',
                        'rule': 'regex_error',
                    })

            # Numeric min/max
            if 'min' in rules or 'max' in rules:
                try:
                    num_value = float(str(value).replace(',', '').replace('$', '').replace('£', '').replace('€', ''))
                    if 'min' in rules and num_value < float(rules['min']):
                        issues.append({
                            'field': field_name,
                            'severity': 'warning',
                            'message': f'Value {num_value} is below minimum {rules["min"]}.',
                            'plugin': 'validate',
                            'rule': 'min',
                        })
                    if 'max' in rules and num_value > float(rules['max']):
                        issues.append({
                            'field': field_name,
                            'severity': 'warning',
                            'message': f'Value {num_value} exceeds maximum {rules["max"]}.',
                            'plugin': 'validate',
                            'rule': 'max',
                        })
                except (ValueError, TypeError):
                    issues.append({
                        'field': field_name,
                        'severity': 'warning',
                        'message': f'Cannot evaluate numeric range — value is not a number.',
                        'plugin': 'validate',
                        'rule': 'numeric_cast',
                    })

            # Type checks
            expected_type = rules.get('type')
            if expected_type == 'email':
                if not _EMAIL_RE.match(str_value):
                    issues.append({
                        'field': field_name,
                        'severity': 'error',
                        'message': f'Value "{str_value[:50]}" is not a valid email address.',
                        'plugin': 'validate',
                        'rule': 'type_email',
                    })
            elif expected_type == 'date':
                if not _DATE_RE.match(str_value):
                    issues.append({
                        'field': field_name,
                        'severity': 'warning',
                        'message': f'Value "{str_value[:50]}" is not a recognized date format.',
                        'plugin': 'validate',
                        'rule': 'type_date',
                    })
            elif expected_type == 'number':
                try:
                    float(str(value).replace(',', ''))
                except (ValueError, TypeError):
                    issues.append({
                        'field': field_name,
                        'severity': 'warning',
                        'message': f'Value "{str_value[:50]}" is not a valid number.',
                        'plugin': 'validate',
                        'rule': 'type_number',
                    })

        if issues:
            logger.info(
                f"[validate] doc={document.id} "
                f"errors={sum(1 for i in issues if i['severity'] == 'error')} "
                f"warnings={sum(1 for i in issues if i['severity'] == 'warning')}"
            )

        return issues
