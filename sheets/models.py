"""
Sheets app — models.py

Google-Sheets-like spreadsheet system for the platform.
Supports formulas, workflow data binding, AI-assisted creation,
per-cell metadata, and public form sharing.

Hierarchy:  Sheet → (columns defined in sheet.columns JSONField)
                   → SheetRow → SheetCell (one per column per row)
                   → SheetShareLink (public form link)
                   → SheetFormSubmission (collected form responses)
"""

import uuid
import re
import json
from django.db import models
from django.conf import settings
from django.utils import timezone


class Sheet(models.Model):
    """
    A spreadsheet workbook (single sheet for now).
    Owned by a user, scoped to an organization.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        'user_management.Organization',
        on_delete=models.CASCADE,
        related_name='sheets',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sheets',
    )
    title = models.CharField(max_length=255, default='Untitled Sheet')
    description = models.TextField(blank=True, default='')

    # Column definitions: list of {key, label, type, width}
    # type: text | number | currency | date | boolean | formula | select
    columns = models.JSONField(default=list, blank=True)

    # Sheet-level metadata
    custom_metadata = models.JSONField(default=dict, blank=True)

    # Workflow binding — optional link to a CLM Workflow
    workflow = models.ForeignKey(
        'clm.Workflow',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sheets',
    )

    # Sheet settings (frozen rows/cols, default col width, etc.)
    settings_json = models.JSONField(default=dict, blank=True)

    # Unique columns — list of column keys that form a composite unique key.
    # Used by CLM workflow sheet nodes to upsert rows (match existing row
    # by these column values instead of always appending), and to prevent
    # duplicate document creation or duplicate email sends for the same entity.
    # Example: ["col_2"] for a single-column unique key (e.g. customer_id),
    #          ["col_0", "col_3"] for a composite key (e.g. email + date).
    unique_columns = models.JSONField(default=list, blank=True)

    # Soft state
    is_archived = models.BooleanField(default=False)
    row_count = models.PositiveIntegerField(default=0)
    col_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return self.title

    def ensure_columns(self, count=None):
        """Ensure at least `count` column definitions exist."""
        count = count or self.col_count or 5
        while len(self.columns) < count:
            idx = len(self.columns)
            col_letter = self._col_letter(idx)
            self.columns.append({
                'key': f'col_{idx}',
                'label': col_letter,
                'type': 'text',
                'width': 120,
            })
        self.col_count = len(self.columns)

    @staticmethod
    def _col_letter(index):
        """Convert 0-based index to Excel-style column letter (A, B, ..., Z, AA, ...)."""
        result = ''
        while True:
            result = chr(65 + index % 26) + result
            index = index // 26 - 1
            if index < 0:
                break
        return result

    def add_column(self, label=None, col_type='text', width=120, formula=None):
        """Append a column and return its key.

        If *col_type* is ``'formula'`` (or *formula* is provided),
        the column definition stores a **formula template** — e.g.
        ``=A{row}+B{row}``.  ``{row}`` is replaced with the 1-based
        row number when the formula is applied to each row.
        """
        idx = len(self.columns)
        key = f'col_{idx}'
        col_def = {
            'key': key,
            'label': label or self._col_letter(idx),
            'type': col_type,
            'width': width,
        }
        if formula:
            col_def['formula'] = formula
            col_def['type'] = 'formula'
        self.columns.append(col_def)
        self.col_count = len(self.columns)
        return key

    # ── Default-column detection ───────────────────────────────────

    _DEFAULT_LABEL_RE = re.compile(r'^[A-Z]{1,3}$')

    @classmethod
    def is_default_column_label(cls, label: str) -> bool:
        """
        Return True if *label* matches the auto-generated Excel-style
        letter pattern produced by ``_col_letter`` (A … Z, AA … ZZ, …).
        """
        return bool(cls._DEFAULT_LABEL_RE.match(label or ''))

    def get_real_columns(self):
        """Return only columns whose labels have been renamed by the user."""
        return [c for c in self.columns
                if not self.is_default_column_label(c.get('label', ''))]

    # ── Empty-row helpers ───────────────────────────────────────────

    def delete_empty_rows(self):
        """
        Remove rows that have **no** cells, or where every cell value is
        blank.  Resets ``row_count`` and re-numbers remaining rows.
        """
        non_empty_ids = set(
            SheetCell.objects
            .filter(row__sheet=self)
            .exclude(raw_value='')
            .values_list('row_id', flat=True)
        )
        empty_qs = self.rows.exclude(id__in=non_empty_ids)
        deleted_count, _ = empty_qs.delete()
        if deleted_count:
            for idx, row in enumerate(self.rows.order_by('order')):
                if row.order != idx:
                    row.order = idx
                    row.save(update_fields=['order'])
            self.row_count = self.rows.count()
            self.save(update_fields=['row_count'])
        return deleted_count

    def remove_column(self, col_key):
        """Remove a column definition and all cell data for that column."""
        self.columns = [c for c in self.columns if c['key'] != col_key]
        self.col_count = len(self.columns)
        # Also remove from unique_columns if present
        if col_key in (self.unique_columns or []):
            self.unique_columns = [k for k in self.unique_columns if k != col_key]
        # Cascade delete cells
        SheetCell.objects.filter(row__sheet=self, column_key=col_key).delete()

    # ── Unique column helpers ───────────────────────────────────────

    def get_unique_column_labels(self):
        """Return human-readable labels for the unique column keys."""
        key_to_label = {c['key']: c.get('label', c['key']) for c in self.columns}
        return [key_to_label.get(k, k) for k in (self.unique_columns or [])]

    def find_row_by_unique_key(self, key_values: dict):
        """
        Find a row whose cells match the given *key_values* dict
        ``{col_key: value}``.

        Returns the matching ``SheetRow`` or ``None``.

        Only checks columns listed in ``self.unique_columns``.
        All unique columns must match for a row to qualify.
        """
        unique_cols = self.unique_columns or []
        if not unique_cols:
            return None

        # Start from all rows, then narrow down with each unique-col value
        candidate_row_ids = None
        for col_key in unique_cols:
            target_value = str(key_values.get(col_key, '')).strip()
            if not target_value:
                return None  # Missing a key value → can't match
            matching_ids = set(
                SheetCell.objects.filter(
                    row__sheet=self,
                    column_key=col_key,
                    raw_value=target_value,
                ).values_list('row_id', flat=True)
            )
            if candidate_row_ids is None:
                candidate_row_ids = matching_ids
            else:
                candidate_row_ids &= matching_ids
            if not candidate_row_ids:
                return None

        if candidate_row_ids:
            from sheets.models import SheetRow as _SR
            return _SR.objects.filter(id__in=candidate_row_ids).first()
        return None

    def find_row_by_unique_values(self, meta: dict, field_to_col: dict):
        """
        Higher-level helper: given a metadata dict and a field→col_key
        mapping, extract the unique-column values and look up a matching row.

        Returns the matching ``SheetRow`` or ``None``.
        """
        unique_cols = self.unique_columns or []
        if not unique_cols:
            return None
        # Build {col_key: value} for unique columns from metadata
        col_to_field = {v: k for k, v in field_to_col.items()}
        key_values = {}
        for col_key in unique_cols:
            field_name = col_to_field.get(col_key)
            if field_name and field_name in meta:
                key_values[col_key] = str(meta[field_name])
            else:
                return None  # Can't build the full unique key
        return self.find_row_by_unique_key(key_values)

    # ── Column-level formula propagation ────────────────────────────

    def get_formula_columns(self):
        """Return column defs that have a column-level formula template."""
        return [c for c in self.columns if c.get('formula')]

    def apply_column_formulas(self, rows=None):
        """
        For every formula column, ensure each row has a SheetCell with
        the column's formula template (``{row}`` replaced by 1-based row#).

        *rows*: optional queryset/list of SheetRow; defaults to all rows.
        Returns the number of cells created.
        """
        formula_cols = self.get_formula_columns()
        if not formula_cols:
            return 0

        if rows is None:
            rows = self.rows.order_by('order')

        created = 0
        for row in rows:
            row_num = row.order + 1  # 1-based
            for col_def in formula_cols:
                formula_str = col_def['formula'].replace('{row}', str(row_num))
                cell, is_new = SheetCell.objects.get_or_create(
                    row=row,
                    column_key=col_def['key'],
                    defaults={
                        'raw_value': formula_str,
                        'formula': formula_str,
                        'value_type': 'formula',
                    },
                )
                if not is_new and cell.formula != formula_str:
                    # Formula template changed → update
                    cell.raw_value = formula_str
                    cell.formula = formula_str
                    cell.value_type = 'formula'
                    cell.save(update_fields=[
                        'raw_value', 'formula', 'value_type', 'updated_at',
                    ])
                if is_new:
                    created += 1
        return created

    # ── Central cell-value validation ───────────────────────────────

    _DATE_RE = re.compile(
        r'^\d{4}-\d{2}-\d{2}$'           # ISO 8601
        r'|^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$'  # common slash/dot
    )

    @staticmethod
    def validate_cell_value(raw_value, col_type):
        """
        Validate and coerce *raw_value* for the given *col_type*.

        Returns ``(clean_value: str, value_type: str, error: str | None)``.

        Supported column types:
            text, number, currency, date, boolean, select, json, formula
        """
        raw = str(raw_value).strip() if raw_value is not None else ''

        # Empty is always valid
        if not raw:
            vtype = col_type if col_type not in ('formula',) else 'text'
            return '', vtype, None

        # Formulas bypass type validation (handled by engine)
        if raw.startswith('='):
            return raw, 'formula', None

        # ── number / currency ────────────────────────────────────
        if col_type in ('number', 'currency'):
            cleaned = (
                raw.replace(',', '')
                   .replace('$', '').replace('€', '').replace('£', '')
                   .replace('¥', '').replace('₹', '')
                   .strip()
            )
            try:
                float(cleaned)
            except (ValueError, TypeError):
                return raw, 'error', f'Expected a number, got "{raw}"'
            return raw, col_type, None

        # ── date ─────────────────────────────────────────────────
        if col_type == 'date':
            if not Sheet._DATE_RE.match(raw):
                return raw, 'error', f'Expected a date (YYYY-MM-DD), got "{raw}"'
            return raw, 'date', None

        # ── boolean ──────────────────────────────────────────────
        if col_type == 'boolean':
            if raw.lower() not in ('true', 'false', '1', '0', 'yes', 'no'):
                return raw, 'error', f'Expected true/false, got "{raw}"'
            return raw, 'boolean', None

        # ── json ─────────────────────────────────────────────────
        if col_type == 'json':
            try:
                json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw, 'error', f'Invalid JSON: "{raw[:60]}"'
            return raw, 'json', None

        # ── select ───────────────────────────────────────────────
        # Select columns accept any string (options are UI-side)
        if col_type == 'select':
            return raw, 'text', None

        # ── formula (column-level) ───────────────────────────────
        if col_type == 'formula':
            return raw, 'formula', None

        # ── text (default) ───────────────────────────────────────
        return raw, 'text', None

    def get_col_type_map(self):
        """Return ``{column_key: column_type}`` dict for fast lookup."""
        return {c['key']: c.get('type', 'text') for c in (self.columns or [])}

    def validate_and_clean_all_cells(self):
        """
        Scan every cell in this sheet and coerce / flag values that
        don't match their column's declared type.

        Returns ``(fixed: int, flagged: int)`` — *fixed* cells had their
        value_type corrected; *flagged* cells have genuinely invalid data
        (value_type set to ``'error'``, error stored in metadata.type_error).
        """
        col_types = self.get_col_type_map()
        formula_keys = {c['key'] for c in self.columns if c.get('formula')}

        fixed, flagged = 0, 0
        cells = SheetCell.objects.filter(row__sheet=self).select_related('row')
        for cell in cells:
            if cell.column_key in formula_keys:
                continue  # formula columns managed separately
            if cell.raw_value.startswith('='):
                continue  # individual formula cells

            expected_type = col_types.get(cell.column_key, 'text')
            clean_val, vtype, err = self.validate_cell_value(
                cell.raw_value, expected_type,
            )

            changed = False
            if err:
                if cell.value_type != 'error':
                    cell.value_type = 'error'
                    cell.metadata['type_error'] = err
                    changed = True
                    flagged += 1
            else:
                if cell.value_type != vtype:
                    cell.value_type = vtype
                    cell.metadata.pop('type_error', None)
                    changed = True
                    fixed += 1
                elif 'type_error' in cell.metadata:
                    cell.metadata.pop('type_error')
                    changed = True

            if changed:
                cell.save(update_fields=['value_type', 'metadata', 'updated_at'])

        return fixed, flagged


class SheetRow(models.Model):
    """A single row in a sheet."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sheet = models.ForeignKey(Sheet, on_delete=models.CASCADE, related_name='rows')
    order = models.PositiveIntegerField(default=0, db_index=True)

    # Row-level metadata (row headings become metadata keys)
    metadata = models.JSONField(default=dict, blank=True)

    # SHA-256 hash of all cell values — used by CLM event system
    # for row-level change detection.  Updated on every bulk_update.
    row_hash = models.CharField(max_length=64, blank=True, default='')

    # If linked to a workflow run / execution
    workflow_run_id = models.UUIDField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order']
        unique_together = [('sheet', 'order')]
        indexes = [
            models.Index(fields=['sheet', 'order'], name='sheetrow_sheet_order_idx'),
            models.Index(fields=['sheet', '-order'], name='sheetrow_sheet_order_desc'),
            models.Index(fields=['workflow_run_id'], name='sheetrow_workflow_run_idx',
                         condition=models.Q(workflow_run_id__isnull=False)),
            models.Index(fields=['sheet', 'row_hash'], name='sheetrow_sheet_rowhash_idx'),
        ]

    def __str__(self):
        return f"Row {self.order} of {self.sheet.title}"

    def compute_row_hash(self) -> str:
        """Compute SHA-256 from all cell values in deterministic order."""
        import hashlib
        cells = self.cells.order_by('column_key').values_list('column_key', 'raw_value')
        payload = json.dumps(list(cells), sort_keys=True, default=str)
        return hashlib.sha256(payload.encode()).hexdigest()


class SheetCell(models.Model):
    """
    A single cell value.

    `raw_value`      — what the user typed (could be a formula like =SUM(A1:A5))
    `computed_value`  — the evaluated result (string representation)
    `value_type`      — inferred or explicit type: text, number, boolean, error
    `formula`         — normalised formula (if raw_value starts with =)
    `metadata`        — arbitrary per-cell metadata (formatting, notes, etc.)
    """

    CELL_TYPES = [
        ('text', 'Text'),
        ('number', 'Number'),
        ('currency', 'Currency'),
        ('boolean', 'Boolean'),
        ('date', 'Date'),
        ('json', 'JSON'),
        ('formula', 'Formula'),
        ('error', 'Error'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    row = models.ForeignKey(SheetRow, on_delete=models.CASCADE, related_name='cells')
    column_key = models.CharField(max_length=50)

    raw_value = models.TextField(blank=True, default='')
    computed_value = models.TextField(blank=True, default='')
    value_type = models.CharField(max_length=10, choices=CELL_TYPES, default='text')
    formula = models.TextField(blank=True, default='')

    # Per-cell metadata: formatting, conditional format rules, notes
    metadata = models.JSONField(default=dict, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('row', 'column_key')]
        indexes = [
            models.Index(fields=['row', 'column_key'], name='sheetcell_row_colkey_idx'),
            models.Index(fields=['column_key', 'raw_value'], name='sheetcell_col_rawval_idx'),
            models.Index(fields=['value_type'], name='sheetcell_valtype_idx'),
        ]

    def __str__(self):
        return f"Cell({self.column_key}, row={self.row.order})"


# ─── Sheet Sharing — public form links ──────────────────────────────

class SheetShareLink(models.Model):
    """
    A shareable link that creates a public form from a sheet's columns.
    Anyone with the link can submit form responses which become new rows.

    When input_format='sheet' on a CLM node that shares a link, this
    model backs that link — form submissions are collected here then
    processed in the workflow.
    """

    class AccessType(models.TextChoices):
        PUBLIC     = 'public', 'Public (anyone with link)'
        EMAIL_OTP  = 'email_otp', 'Email OTP verification'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    sheet = models.ForeignKey(
        Sheet, on_delete=models.CASCADE, related_name='share_links',
    )

    label = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Optional label, e.g. "Vendor intake form"',
    )
    description = models.TextField(
        blank=True, default='',
        help_text='Instructions shown at the top of the form.',
    )

    is_active = models.BooleanField(default=True)
    access_type = models.CharField(
        max_length=20, choices=AccessType.choices,
        default=AccessType.PUBLIC,
    )

    # Optional constraints
    expires_at = models.DateTimeField(null=True, blank=True)
    max_submissions = models.PositiveIntegerField(null=True, blank=True)
    submission_count = models.PositiveIntegerField(default=0)

    # Which columns appear in the form (empty = all columns)
    # List of column keys: ["col_0", "col_1"]
    form_columns = models.JSONField(
        default=list, blank=True,
        help_text='Column keys to include in the form. Empty = all columns.',
    )

    # Optional workflow link — if this form was created from a CLM node
    workflow = models.ForeignKey(
        'clm.Workflow',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='sheet_form_links',
    )
    workflow_node = models.ForeignKey(
        'clm.WorkflowNode',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='sheet_form_links',
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"ShareLink({self.token}) → {self.sheet.title}"

    @property
    def is_expired(self):
        if self.expires_at and timezone.now() > self.expires_at:
            return True
        return False

    @property
    def is_at_limit(self):
        if self.max_submissions and self.submission_count >= self.max_submissions:
            return True
        return False

    @property
    def is_usable(self):
        return self.is_active and not self.is_expired and not self.is_at_limit

    # Column types that are computed / should never be user-editable
    _NON_INPUT_TYPES = frozenset({'formula'})

    def get_form_columns(self):
        """
        Return column definitions that should appear in the public form
        as **input** fields.

        Excludes:
        - formula columns (computed, not user input)
        - default/placeholder columns (single-letter labels like A, B, C …)
        """
        cols = self.sheet.columns or []
        if self.form_columns:
            included = set(self.form_columns)
            cols = [c for c in cols if c['key'] in included]
        return [
            c for c in cols
            if c.get('type', 'text') not in self._NON_INPUT_TYPES
            and not Sheet.is_default_column_label(c.get('label', ''))
        ]

    def get_output_columns(self):
        """
        Return formula/computed column definitions that should appear
        in the public form as **read-only output** fields.

        These columns are computed server-side; the form displays their
        evaluated result but does not accept input for them.
        """
        cols = self.sheet.columns or []
        if self.form_columns:
            included = set(self.form_columns)
            cols = [c for c in cols if c['key'] in included]
        return [
            {**c, 'is_output': True}
            for c in cols
            if c.get('type', 'text') in self._NON_INPUT_TYPES
            and not Sheet.is_default_column_label(c.get('label', ''))
        ]


class SheetFormSubmission(models.Model):
    """
    A single form submission from a public sheet link.
    Each submission becomes a row in the sheet.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    share_link = models.ForeignKey(
        SheetShareLink, on_delete=models.CASCADE, related_name='submissions',
    )
    sheet = models.ForeignKey(
        Sheet, on_delete=models.CASCADE, related_name='form_submissions',
    )
    row = models.ForeignKey(
        SheetRow, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='form_submission',
        help_text='The SheetRow created from this submission.',
    )

    # Submitted data: {"col_0": "value", "col_1": "value"}
    data = models.JSONField(default=dict)

    # Submitter info (if OTP verified)
    submitter_identifier = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Email or identifier of the submitter.',
    )
    submitter_ip = models.GenericIPAddressField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Submission({self.id}) → {self.sheet.title}"


# ─── Server-side formula evaluation engine ──────────────────────────

class FormulaEngine:
    """
    Lightweight server-side formula evaluator.
    Supports: SUM, AVG, MIN, MAX, COUNT, IF, ROUND, CONCAT, ABS, UPPER, LOWER, LEN, VLOOKUP, COUNTA
    Cell references: A1, B2, A1:A10 (ranges) and column-key references: qty1, price3
    """

    CELL_REF = re.compile(r'\b([A-Z]{1,3})(\d+)\b')
    RANGE_REF = re.compile(r'\b([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)\b')

    def __init__(self, sheet):
        self.sheet = sheet
        self._cache = {}       # (col_letter, row_num) -> computed value
        self._computing = set() # cycle detection
        # Build a column-key → letter mapping for key-based formula resolution
        self._key_to_letter = {}
        for i, col in enumerate(sheet.columns):
            self._key_to_letter[col['key'].lower()] = Sheet._col_letter(i)

    # ── Column-key reference resolution ─────────────────────────────

    def _resolve_column_keys(self, formula):
        """
        Convert column-key references (e.g. ``qty3``, ``price{row}``) into
        letter-based references (e.g. ``A3``, ``B{row}``).

        The regex matches ``<col_key><digits_or_{row}>`` where col_key
        is a known column key.  Longer keys are tried first so that
        ``unit_price5`` is matched before ``unit5``.
        """
        if not self._key_to_letter:
            return formula
        # Sort keys longest-first so longer keys match before shorter prefixes
        sorted_keys = sorted(self._key_to_letter, key=len, reverse=True)
        # Build pattern:  (key1|key2|...)(\d+|\{row\})
        escaped = [re.escape(k) for k in sorted_keys]
        pattern = re.compile(
            r'\b(' + '|'.join(escaped) + r')(\d+|\{row\})',
            re.IGNORECASE,
        )

        def _replace(m):
            key = m.group(1).lower()
            suffix = m.group(2)
            letter = self._key_to_letter.get(key, m.group(1))
            return f'{letter}{suffix}'

        return pattern.sub(_replace, formula)

    def _col_index(self, letter):
        """A->0, B->1, ..., Z->25, AA->26"""
        result = 0
        for ch in letter:
            result = result * 26 + (ord(ch) - 64)
        return result - 1

    def _col_key_from_letter(self, letter):
        idx = self._col_index(letter)
        if idx < len(self.sheet.columns):
            return self.sheet.columns[idx]['key']
        return None

    def _get_cell_value(self, col_letter, row_num):
        cache_key = (col_letter, row_num)
        if cache_key in self._cache:
            return self._cache[cache_key]

        col_key = self._col_key_from_letter(col_letter)
        if col_key is None:
            return 0

        try:
            row = self.sheet.rows.get(order=row_num - 1)
            cell = row.cells.get(column_key=col_key)
        except (SheetRow.DoesNotExist, SheetCell.DoesNotExist):
            self._cache[cache_key] = 0
            return 0

        # If the cell itself is a formula, evaluate it first
        if cell.raw_value.startswith('='):
            if cache_key in self._computing:
                return '#CIRCULAR!'
            val = self.evaluate(cell.raw_value, col_letter, row_num)
        else:
            val = self._parse_value(cell.raw_value)

        self._cache[cache_key] = val
        return val

    def _parse_value(self, raw):
        """Try to parse as number, boolean, or keep as string."""
        if raw == '':
            return 0
        if raw.lower() in ('true', 'yes'):
            return True
        if raw.lower() in ('false', 'no'):
            return False
        try:
            return float(raw)
        except (ValueError, TypeError):
            return raw

    def _resolve_range(self, match):
        """Resolve A1:B3 into a flat list of values."""
        col_start, row_start, col_end, row_end = (
            match.group(1), int(match.group(2)),
            match.group(3), int(match.group(4)),
        )
        ci_start = self._col_index(col_start)
        ci_end = self._col_index(col_end)
        values = []
        for r in range(row_start, row_end + 1):
            for ci in range(ci_start, ci_end + 1):
                letter = self.sheet._col_letter(ci)
                val = self._get_cell_value(letter, r)
                if isinstance(val, (int, float)):
                    values.append(val)
                elif isinstance(val, str):
                    try:
                        values.append(float(val))
                    except (ValueError, TypeError):
                        values.append(val)
        return values

    def evaluate(self, raw_value, col_letter=None, row_num=None):
        """Evaluate a formula string starting with '='."""
        if not raw_value.startswith('='):
            return self._parse_value(raw_value)

        cache_key = (col_letter, row_num) if col_letter and row_num else None
        if cache_key:
            self._computing.add(cache_key)

        try:
            # Resolve column-key references (qty3 → A3) before evaluation
            expr = self._resolve_column_keys(raw_value[1:].strip())
            result = self._eval_expr(expr)
        except Exception as e:
            result = f'#ERROR: {e}'
        finally:
            if cache_key:
                self._computing.discard(cache_key)

        if cache_key:
            self._cache[cache_key] = result
        return result

    def _eval_expr(self, expr):
        """Parse and evaluate the expression."""
        upper = expr.upper().strip()

        # ── Function calls ──────────────────────────────────────
        func_match = re.match(r'^(\w+)\((.+)\)$', expr, re.DOTALL)
        if func_match:
            func_name = func_match.group(1).upper()
            args_str = func_match.group(2)
            return self._call_function(func_name, args_str)

        # ── Range reference (shouldn't appear bare, but handle) ──
        range_match = self.RANGE_REF.match(upper)
        if range_match:
            return self._resolve_range(range_match)

        # ── Cell reference ──────────────────────────────────────
        cell_match = re.match(r'^([A-Z]{1,3})(\d+)$', upper)
        if cell_match:
            return self._get_cell_value(cell_match.group(1), int(cell_match.group(2)))

        # ── Arithmetic / simple expression ──────────────────────
        return self._eval_arithmetic(expr)

    def _call_function(self, name, args_str):
        """Dispatch built-in functions."""
        funcs = {
            'SUM': self._fn_sum,
            'AVG': self._fn_avg,
            'AVERAGE': self._fn_avg,
            'MIN': self._fn_min,
            'MAX': self._fn_max,
            'COUNT': self._fn_count,
            'COUNTA': self._fn_counta,
            'IF': self._fn_if,
            'ROUND': self._fn_round,
            'ABS': self._fn_abs,
            'CONCAT': self._fn_concat,
            'UPPER': self._fn_upper,
            'LOWER': self._fn_lower,
            'LEN': self._fn_len,
            'VLOOKUP': self._fn_vlookup,
            'NOW': self._fn_now,
            'TODAY': self._fn_today,
        }
        handler = funcs.get(name)
        if not handler:
            return f'#NAME? ({name})'
        return handler(args_str)

    def _collect_numeric(self, args_str):
        """Parse args, resolve ranges, and collect numeric values."""
        values = []
        for arg in self._split_args(args_str):
            arg = arg.strip()
            rm = self.RANGE_REF.match(arg.upper())
            if rm:
                values.extend([v for v in self._resolve_range(rm) if isinstance(v, (int, float))])
            else:
                cm = re.match(r'^([A-Z]{1,3})(\d+)$', arg.upper())
                if cm:
                    v = self._get_cell_value(cm.group(1), int(cm.group(2)))
                    if isinstance(v, (int, float)):
                        values.append(v)
                else:
                    try:
                        values.append(float(arg))
                    except (ValueError, TypeError):
                        pass
        return values

    def _split_args(self, args_str):
        """Split function arguments respecting nested parentheses."""
        parts = []
        depth = 0
        current = ''
        for ch in args_str:
            if ch == '(':
                depth += 1
                current += ch
            elif ch == ')':
                depth -= 1
                current += ch
            elif ch == ',' and depth == 0:
                parts.append(current)
                current = ''
            else:
                current += ch
        if current:
            parts.append(current)
        return parts

    def _fn_sum(self, args_str):
        return sum(self._collect_numeric(args_str))

    def _fn_avg(self, args_str):
        vals = self._collect_numeric(args_str)
        return sum(vals) / len(vals) if vals else 0

    def _fn_min(self, args_str):
        vals = self._collect_numeric(args_str)
        return min(vals) if vals else 0

    def _fn_max(self, args_str):
        vals = self._collect_numeric(args_str)
        return max(vals) if vals else 0

    def _fn_count(self, args_str):
        return len(self._collect_numeric(args_str))

    def _fn_counta(self, args_str):
        """Count non-empty values."""
        count = 0
        for arg in self._split_args(args_str):
            arg = arg.strip()
            rm = self.RANGE_REF.match(arg.upper())
            if rm:
                count += len(self._resolve_range(rm))
            else:
                cm = re.match(r'^([A-Z]{1,3})(\d+)$', arg.upper())
                if cm:
                    v = self._get_cell_value(cm.group(1), int(cm.group(2)))
                    if v not in (0, '', None):
                        count += 1
                elif arg:
                    count += 1
        return count

    def _fn_if(self, args_str):
        parts = self._split_args(args_str)
        if len(parts) < 3:
            return '#VALUE!'
        condition = self._eval_expr(parts[0].strip())
        if_true = self._eval_expr(parts[1].strip())
        if_false = self._eval_expr(parts[2].strip())
        return if_true if condition else if_false

    def _fn_round(self, args_str):
        parts = self._split_args(args_str)
        val = self._eval_expr(parts[0].strip())
        digits = int(self._eval_expr(parts[1].strip())) if len(parts) > 1 else 0
        return round(float(val), digits)

    def _fn_abs(self, args_str):
        return abs(float(self._eval_expr(args_str.strip())))

    def _fn_concat(self, args_str):
        parts = self._split_args(args_str)
        return ''.join(str(self._eval_expr(p.strip())) for p in parts)

    def _fn_upper(self, args_str):
        return str(self._eval_expr(args_str.strip())).upper()

    def _fn_lower(self, args_str):
        return str(self._eval_expr(args_str.strip())).lower()

    def _fn_len(self, args_str):
        return len(str(self._eval_expr(args_str.strip())))

    def _fn_now(self, args_str):
        return timezone.now().isoformat()

    def _fn_today(self, args_str):
        return timezone.now().date().isoformat()

    def _fn_vlookup(self, args_str):
        """VLOOKUP(search_key, range, col_index, [is_sorted])"""
        parts = self._split_args(args_str)
        if len(parts) < 3:
            return '#VALUE!'

        search_key = self._eval_expr(parts[0].strip())
        range_str = parts[1].strip().upper()
        col_index = int(self._eval_expr(parts[2].strip()))

        rm = self.RANGE_REF.match(range_str)
        if not rm:
            return '#REF!'

        col_start_idx = self._col_index(rm.group(1))
        row_start = int(rm.group(2))
        row_end = int(rm.group(4))

        # Search first column of range for search_key
        first_col_letter = self.sheet._col_letter(col_start_idx)
        target_col_letter = self.sheet._col_letter(col_start_idx + col_index - 1)

        for r in range(row_start, row_end + 1):
            val = self._get_cell_value(first_col_letter, r)
            try:
                if float(val) == float(search_key):
                    return self._get_cell_value(target_col_letter, r)
            except (ValueError, TypeError):
                if str(val).strip().lower() == str(search_key).strip().lower():
                    return self._get_cell_value(target_col_letter, r)

        return '#N/A'

    def _eval_arithmetic(self, expr):
        """
        Safely evaluate simple arithmetic expressions with cell references.
        Replace cell refs with their values, then use a restricted eval.
        """
        resolved = expr

        # Replace range references with SUM of range (common shorthand)
        for rm in self.RANGE_REF.finditer(resolved.upper()):
            vals = self._resolve_range(rm)
            numeric = [v for v in vals if isinstance(v, (int, float))]
            resolved = resolved.replace(rm.group(0), str(sum(numeric)))

        # Replace cell references with values
        def replace_cell(m):
            val = self._get_cell_value(m.group(1), int(m.group(2)))
            if isinstance(val, (int, float)):
                return str(val)
            return '0'

        resolved = self.CELL_REF.sub(replace_cell, resolved.upper())

        # Strip out any alpha characters for safety (allow digits, operators, parens, dots)
        safe = re.sub(r'[^0-9+\-*/().%<>=!& |]', '', resolved)
        if not safe.strip():
            return 0

        try:
            # Replace comparison operators
            safe = safe.replace('==', '==').replace('!=', '!=')
            safe = safe.replace('>=', '>=').replace('<=', '<=')
            result = eval(safe, {"__builtins__": {}}, {})
            return result
        except Exception:
            return '#CALC!'

    def evaluate_all(self):
        """
        Evaluate all formula cells in the sheet and update computed_value.

        Before evaluating, propagate any **column-level** formula
        templates (``column.formula``) to every row so that newly
        added rows automatically receive formula cells.

        Returns count of cells updated.
        """
        # ── 1. Propagate column-level formulas to every row ──
        self.sheet.apply_column_formulas()

        # ── 2. Evaluate individual formula cells ──
        count = 0
        formula_cells = SheetCell.objects.filter(
            row__sheet=self.sheet,
            raw_value__startswith='=',
        ).select_related('row')

        for cell in formula_cells:
            col_idx = None
            for i, col in enumerate(self.sheet.columns):
                if col['key'] == cell.column_key:
                    col_idx = i
                    break
            if col_idx is None:
                continue
            col_letter = self.sheet._col_letter(col_idx)
            row_num = cell.row.order + 1  # 1-based for formulas

            result = self.evaluate(cell.raw_value, col_letter, row_num)
            cell.computed_value = str(result)
            cell.value_type = 'formula'
            cell.save(update_fields=['computed_value', 'value_type', 'updated_at'])
            count += 1

        return count


# ════════════════════════════════════════════════════════════════════
#  SheetDashboard — AI-generated Recharts dashboard config per sheet
# ════════════════════════════════════════════════════════════════════

class SheetDashboard(models.Model):
    """
    Stores an AI-generated dashboard configuration for a Sheet.

    The ``chart_config`` JSONField holds a Recharts-compatible
    specification that the frontend compiles into live charts.

    Structure of chart_config:
    {
      "title": "Sales Dashboard",
      "description": "...",
      "charts": [
        {
          "id": "chart_1",
          "type": "bar",           # bar | line | area | pie | composed | scatter
          "title": "Revenue by Month",
          "dataKey": "col_1",      # column key for Y-axis / value
          "categoryKey": "col_0",  # column key for X-axis / label
          "data": [...],           # pre-computed from sheet rows
          "config": { ... }        # extra Recharts props (colors, stacked, etc.)
        },
        ...
      ],
      "layout": "grid",           # grid | vertical | tabs
      "columns": 2                # grid columns
    }
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sheet = models.ForeignKey(
        Sheet,
        on_delete=models.CASCADE,
        related_name='dashboards',
    )
    title = models.CharField(max_length=255, default='Intelligent Dashboard')
    chart_config = models.JSONField(default=dict, blank=True)
    prompt_used = models.TextField(blank=True, default='')

    # Retry / generation tracking
    generation_status = models.CharField(
        max_length=20,
        choices=[
            ('pending', 'Pending'),
            ('success', 'Success'),
            ('failed', 'Failed'),
            ('fallback', 'Fallback'),
        ],
        default='pending',
    )
    retry_count = models.PositiveIntegerField(default=0)
    error_log = models.JSONField(default=list, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.title} — {self.sheet.title}"


# ════════════════════════════════════════════════════════════════════
#  SheetTask — async operation progress tracking for enterprise ops
# ════════════════════════════════════════════════════════════════════

class SheetTask(models.Model):
    """
    Tracks long-running sheet operations (formula evaluation, search,
    analytics, chart generation) so the frontend can poll for progress.

    Lifecycle:
        pending → running → completed | failed | cancelled
    """

    class TaskType(models.TextChoices):
        FORMULA_EVAL   = 'formula_eval', 'Formula Evaluation'
        SEARCH         = 'search', 'Search'
        ANALYTICS      = 'analytics', 'Analytics'
        CHART_GEN      = 'chart_gen', 'Chart Generation'
        BULK_UPDATE    = 'bulk_update', 'Bulk Update'
        EXPORT         = 'export', 'Export'

    class TaskStatus(models.TextChoices):
        PENDING    = 'pending', 'Pending'
        RUNNING    = 'running', 'Running'
        COMPLETED  = 'completed', 'Completed'
        FAILED     = 'failed', 'Failed'
        CANCELLED  = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sheet = models.ForeignKey(
        Sheet,
        on_delete=models.CASCADE,
        related_name='tasks',
    )
    task_type = models.CharField(max_length=20, choices=TaskType.choices)
    status = models.CharField(
        max_length=20,
        choices=TaskStatus.choices,
        default=TaskStatus.PENDING,
    )

    # Progress (0–100)
    progress = models.PositiveSmallIntegerField(default=0)
    total_items = models.PositiveIntegerField(default=0)
    completed_items = models.PositiveIntegerField(default=0)

    # Human-readable status message
    message = models.CharField(max_length=500, blank=True, default='')

    # Result payload (search results, formula count, etc.)
    result = models.JSONField(default=dict, blank=True)

    # Error info
    error = models.TextField(blank=True, default='')

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['sheet', 'task_type', '-created_at'],
                         name='sheettask_sheet_type_idx'),
            models.Index(fields=['status'], name='sheettask_status_idx'),
        ]

    def __str__(self):
        return f"Task({self.task_type}, {self.status}) — {self.sheet.title}"

    def update_progress(self, completed, total=None, message=''):
        """Convenience method — updates progress fields and saves."""
        if total is not None:
            self.total_items = total
        self.completed_items = completed
        self.progress = min(100, int(completed / max(self.total_items, 1) * 100))
        if message:
            self.message = message
        self.status = self.TaskStatus.RUNNING
        self.save(update_fields=[
            'completed_items', 'total_items', 'progress',
            'message', 'status', 'updated_at',
        ])

    def complete(self, result=None, message=''):
        """Mark task as completed."""
        self.status = self.TaskStatus.COMPLETED
        self.progress = 100
        if result is not None:
            self.result = result
        if message:
            self.message = message
        self.save(update_fields=[
            'status', 'progress', 'result', 'message', 'updated_at',
        ])

    def fail(self, error_msg):
        """Mark task as failed."""
        self.status = self.TaskStatus.FAILED
        self.error = error_msg
        self.save(update_fields=['status', 'error', 'updated_at'])


# ════════════════════════════════════════════════════════════════════
#  RowExecutionTracker — per-row change-detection for workflow triggers
# ════════════════════════════════════════════════════════════════════

class RowExecutionTracker(models.Model):
    """
    Tracks the last-executed row_hash per (sheet, row, workflow).

    Purpose: even if webhooks / CLM events fail, the hash discrepancy
    between ``SheetRow.row_hash`` and ``RowExecutionTracker.last_executed_hash``
    reveals rows that changed but were never processed.

    The reconcile-pending endpoint compares these two values and
    re-triggers workflows for any unprocessed rows.

    Each sheet row is treated as a "form data record" — when a row is
    saved (new or updated) and its hash differs from the tracker, a
    workflow execution is triggered for that specific row.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sheet = models.ForeignKey(
        Sheet, on_delete=models.CASCADE, related_name='execution_trackers',
    )
    row = models.ForeignKey(
        SheetRow, on_delete=models.CASCADE, related_name='execution_trackers',
    )
    workflow = models.ForeignKey(
        'clm.Workflow', on_delete=models.CASCADE,
        related_name='row_execution_trackers',
    )

    # The row_hash at the time the workflow was last successfully triggered
    last_executed_hash = models.CharField(
        max_length=64, blank=True, default='',
        help_text='SHA-256 row hash when the workflow was last triggered for this row.',
    )

    # Execution tracking
    last_execution_id = models.UUIDField(
        null=True, blank=True,
        help_text='UUID of the WorkflowExecution that last processed this row.',
    )
    last_triggered_at = models.DateTimeField(
        null=True, blank=True,
        help_text='When the workflow was last triggered for this row.',
    )

    # Failure tracking
    consecutive_failures = models.PositiveSmallIntegerField(
        default=0,
        help_text='How many times triggering failed in a row.',
    )
    last_error = models.TextField(blank=True, default='')
    last_error_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('sheet', 'row', 'workflow')]
        indexes = [
            models.Index(
                fields=['sheet', 'workflow'],
                name='rowexectracker_sheet_wf_idx',
            ),
            models.Index(
                fields=['last_executed_hash'],
                name='rowexectracker_hash_idx',
            ),
        ]

    def __str__(self):
        return (
            f"RowExecTracker(sheet={self.sheet_id}, "
            f"row={self.row_id}, wf={self.workflow_id})"
        )

    @classmethod
    def mark_triggered(cls, sheet, row, workflow, execution_id=None):
        """
        Record that a workflow was successfully triggered for this row.
        Updates last_executed_hash to the row's current row_hash.
        """
        tracker, _ = cls.objects.update_or_create(
            sheet=sheet,
            row=row,
            workflow=workflow,
            defaults={
                'last_executed_hash': row.row_hash,
                'last_execution_id': execution_id,
                'last_triggered_at': timezone.now(),
                'consecutive_failures': 0,
                'last_error': '',
            },
        )
        return tracker

    @classmethod
    def mark_failed(cls, sheet, row, workflow, error_msg=''):
        """Record that triggering failed for this row."""
        tracker, _ = cls.objects.get_or_create(
            sheet=sheet,
            row=row,
            workflow=workflow,
        )
        tracker.consecutive_failures += 1
        tracker.last_error = error_msg[:2000]
        tracker.last_error_at = timezone.now()
        tracker.save(update_fields=[
            'consecutive_failures', 'last_error', 'last_error_at', 'updated_at',
        ])
        return tracker

    @classmethod
    def find_pending_rows(cls, sheet, workflow):
        """
        Find rows where current row_hash differs from last_executed_hash.

        Returns a queryset of SheetRow objects that have unprocessed changes.
        This covers two cases:
          1. Rows with a tracker whose hash is stale (event failed)
          2. Rows with no tracker at all (never processed)
        """
        # Rows with a stale tracker
        stale_trackers = cls.objects.filter(
            sheet=sheet, workflow=workflow,
        ).exclude(
            last_executed_hash=models.F('row__row_hash'),
        ).values_list('row_id', flat=True)

        # Rows with no tracker at all (but that have data — non-empty hash)
        tracked_row_ids = cls.objects.filter(
            sheet=sheet, workflow=workflow,
        ).values_list('row_id', flat=True)

        never_tracked = SheetRow.objects.filter(
            sheet=sheet,
        ).exclude(
            id__in=tracked_row_ids,
        ).exclude(
            row_hash='',
        ).values_list('id', flat=True)

        # Union
        all_pending_ids = set(stale_trackers) | set(never_tracked)
        return SheetRow.objects.filter(id__in=all_pending_ids).order_by('order')
