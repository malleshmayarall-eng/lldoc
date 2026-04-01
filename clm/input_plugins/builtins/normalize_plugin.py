"""
Normalize Plugin — Cleans and normalises extracted metadata.
==============================================================
- Trims whitespace from string values
- Optionally lowercases field names
- Optionally converts to snake_case
- Coerces type-like strings (dates, numbers, booleans)
"""
import logging
import re
from datetime import date, datetime

from ..hookspecs import clm_input_hookimpl

logger = logging.getLogger(__name__)


def _to_snake_case(name: str) -> str:
    """Convert "Contract Value" or "contractValue" to "contract_value"."""
    # camelCase → snake
    s1 = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', name)
    s2 = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1)
    # spaces / hyphens → underscores
    result = re.sub(r'[\s\-]+', '_', s2).lower()
    # collapse multiple underscores
    return re.sub(r'_+', '_', result).strip('_')


def _coerce_value(value):
    """Try to coerce string values to proper Python types."""
    if not isinstance(value, str):
        return value

    stripped = value.strip()
    if not stripped:
        return stripped

    # Booleans
    if stripped.lower() in ('true', 'yes', 'on'):
        return True
    if stripped.lower() in ('false', 'no', 'off'):
        return False

    # Numbers (integers)
    if re.match(r'^-?\d+$', stripped):
        try:
            return int(stripped)
        except (ValueError, OverflowError):
            pass

    # Numbers (floats) — allow comma-separated thousands
    cleaned = stripped.replace(',', '')
    if re.match(r'^-?\d+\.\d+$', cleaned):
        try:
            return float(cleaned)
        except ValueError:
            pass

    # Currency values ($1,234.56)
    if re.match(r'^[\$£€¥₹][\d,]+\.?\d*$', stripped):
        try:
            return float(re.sub(r'[^\d.]', '', stripped))
        except ValueError:
            pass

    # ISO dates (YYYY-MM-DD)
    if re.match(r'^\d{4}-\d{2}-\d{2}$', stripped):
        try:
            return date.fromisoformat(stripped).isoformat()
        except ValueError:
            pass

    # ISO datetimes
    if re.match(r'^\d{4}-\d{2}-\d{2}T', stripped):
        try:
            return datetime.fromisoformat(stripped).isoformat()
        except ValueError:
            pass

    return stripped


class NormalizePlugin:
    """Normalises extracted metadata fields."""

    @clm_input_hookimpl
    def on_transform(self, node, document):
        config = (node.config or {}).get('input_plugins', [])
        settings = {}
        for p in config:
            if p.get('name') == 'normalize':
                settings = p.get('settings', {})
                if not p.get('enabled', True):
                    return
                break

        meta = dict(document.extracted_metadata or {})
        if not meta:
            return

        new_meta = {}
        for key, value in meta.items():
            # Key transformations
            new_key = key

            if settings.get('trim_values', True) and isinstance(new_key, str):
                new_key = new_key.strip()

            if settings.get('lowercase_keys', True):
                new_key = new_key.lower()

            if settings.get('snake_case', False):
                new_key = _to_snake_case(new_key)

            # Value transformations
            new_value = value

            if settings.get('trim_values', True) and isinstance(new_value, str):
                new_value = new_value.strip()

            if settings.get('coerce_types', True):
                new_value = _coerce_value(new_value)

            new_meta[new_key] = new_value

        document.extracted_metadata = new_meta
        logger.debug(
            f"[normalize] doc={document.id} "
            f"keys_renamed={sum(1 for k in meta if k not in new_meta)}"
        )
