"""
sheets/analytics_engine.py — AI-driven analytics engine.

Architecture:
    1.  A FUNCTION_REGISTRY exposes every analysis capability with a
        machine-readable schema (name, description, parameters).
    2.  AI receives the registry + sheet metadata and returns a plan:
        a JSON list of { "function": "<name>", "params": { … } }.
    3.  execute_plan() runs each call server-side and collects results.
    4.  Results (never raw data) go back to AI for suggestions / charts.

This keeps raw cell data on the server.  AI only sees column metadata
and the outputs of the functions it chose to invoke.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from typing import Any

from .analytics import (
    _parse_number,
    _median,
    _percentile,
    _std_dev,
    _skewness,
    _pearson_r,
    extract_sheet_data,
)


# ════════════════════════════════════════════════════════════════════
# Registry helpers
# ════════════════════════════════════════════════════════════════════

_REGISTRY: dict[str, dict] = {}


def _register(name: str, *, description: str, parameters: list[dict], fn):
    """Register an analytics function in the catalog."""
    _REGISTRY[name] = {
        'name': name,
        'description': description,
        'parameters': parameters,
        'fn': fn,
    }


def get_function_catalog() -> list[dict]:
    """Return the AI-visible catalog (no callables)."""
    return [
        {
            'name': entry['name'],
            'description': entry['description'],
            'parameters': entry['parameters'],
        }
        for entry in _REGISTRY.values()
    ]


# ════════════════════════════════════════════════════════════════════
# Registered analysis functions
#
# Every function receives (sheet_data: dict, **params) where
# sheet_data is the output of extract_sheet_data().
# ════════════════════════════════════════════════════════════════════


# ── 1. Column Statistics ─────────────────────────────────────────────

def _fn_column_stats(sheet_data: dict, *, column: str) -> dict:
    """Compute descriptive stats for a single column."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found or empty'}

    nums = [n for v in values if (n := _parse_number(v)) is not None]
    missing = sum(1 for v in values if not str(v).strip())
    all_strs = [str(v).strip() for v in values if str(v).strip()]
    freq = Counter(all_strs).most_common(10)

    result: dict[str, Any] = {
        'column': column,
        'count': len(values),
        'numeric_count': len(nums),
        'missing_count': missing,
        'unique_count': len(set(all_strs)),
        'top_values': [{'value': v, 'count': c} for v, c in freq],
    }

    if nums:
        s = sorted(nums)
        mean = sum(nums) / len(nums)
        std = _std_dev(nums, mean)
        q1 = _percentile(s, 25)
        q3 = _percentile(s, 75)
        result.update({
            'mean': round(mean, 4),
            'median': round(_median(s), 4),
            'std': round(std, 4),
            'min': s[0],
            'max': s[-1],
            'sum': round(sum(nums), 4),
            'q1': round(q1, 4),
            'q3': round(q3, 4),
            'iqr': round(q3 - q1, 4),
            'skewness': round(_skewness(nums, mean, std), 4) if std > 0 else 0,
            'range': round(s[-1] - s[0], 4),
            'cv_pct': round((std / abs(mean)) * 100, 2) if mean != 0 else None,
        })

    return result


_register(
    'column_stats',
    description=(
        'Compute descriptive statistics for a single column: '
        'count, mean, median, std, min, max, Q1, Q3, IQR, skewness, '
        'coefficient of variation, top values by frequency.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label to analyse.'},
    ],
    fn=_fn_column_stats,
)


# ── 2. Detect Outliers ──────────────────────────────────────────────

def _fn_detect_outliers(sheet_data: dict, *, column: str,
                        method: str = 'iqr',
                        threshold: float = 1.5) -> dict:
    """Detect outliers in a numeric column."""
    values = sheet_data['col_values'].get(column, [])
    row_labels = sheet_data.get('row_labels', [])
    if not values:
        return {'error': f'Column "{column}" not found or empty'}

    nums, indices = [], []
    for i, v in enumerate(values):
        n = _parse_number(v)
        if n is not None:
            nums.append(n)
            indices.append(i)

    if len(nums) < 4:
        return {'column': column, 'outliers': [], 'message': 'Too few numeric values'}

    s = sorted(nums)
    q1 = _percentile(s, 25)
    q3 = _percentile(s, 75)
    iqr = q3 - q1
    mean = sum(nums) / len(nums)
    std = _std_dev(nums, mean)

    if method == 'zscore':
        if std == 0:
            return {'column': column, 'outliers': [], 'message': 'Zero std deviation'}
        outliers = []
        for j, n in enumerate(nums):
            z = (n - mean) / std
            if abs(z) > threshold:
                idx = indices[j]
                outliers.append({
                    'value': n,
                    'row_label': row_labels[idx] if idx < len(row_labels) else str(idx + 1),
                    'z_score': round(z, 2),
                    'severity': 'high' if abs(z) > 3 else 'medium',
                })
    else:  # iqr
        lower = q1 - threshold * iqr
        upper = q3 + threshold * iqr
        outliers = []
        for j, n in enumerate(nums):
            if n < lower or n > upper:
                idx = indices[j]
                z = (n - mean) / std if std > 0 else 0
                outliers.append({
                    'value': n,
                    'row_label': row_labels[idx] if idx < len(row_labels) else str(idx + 1),
                    'deviation': f'{abs(z):.1f} std devs {"above" if n > upper else "below"} mean',
                    'z_score': round(z, 2),
                    'severity': 'high' if abs(z) > 3 else ('medium' if abs(z) > 2 else 'low'),
                    'bounds': {'lower': round(lower, 2), 'upper': round(upper, 2)},
                })

    return {'column': column, 'method': method, 'threshold': threshold,
            'outlier_count': len(outliers), 'outliers': outliers}


_register(
    'detect_outliers',
    description=(
        'Detect outliers in a numeric column using IQR or z-score method. '
        'Returns each outlier with value, row label, z-score, severity.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label to check for outliers.'},
        {'name': 'method', 'type': 'string', 'required': False,
         'description': 'Detection method: "iqr" (default) or "zscore".'},
        {'name': 'threshold', 'type': 'number', 'required': False,
         'description': 'IQR multiplier (default 1.5) or z-score cutoff (default 2.0).'},
    ],
    fn=_fn_detect_outliers,
)


# ── 3. Correlation ──────────────────────────────────────────────────

def _fn_correlation(sheet_data: dict, *, column_a: str, column_b: str) -> dict:
    """Compute Pearson correlation between two columns."""
    vals_a = sheet_data['col_values'].get(column_a, [])
    vals_b = sheet_data['col_values'].get(column_b, [])
    if not vals_a or not vals_b:
        return {'error': 'One or both columns not found'}

    paired = []
    for a, b in zip(vals_a, vals_b):
        na, nb = _parse_number(a), _parse_number(b)
        if na is not None and nb is not None:
            paired.append((na, nb))

    if len(paired) < 5:
        return {'column_a': column_a, 'column_b': column_b,
                'r': None, 'message': 'Insufficient paired numeric values'}

    xs, ys = zip(*paired)
    r = _pearson_r(list(xs), list(ys))
    if r is None:
        return {'column_a': column_a, 'column_b': column_b,
                'r': None, 'message': 'Could not compute correlation'}

    abs_r = abs(r)
    return {
        'column_a': column_a,
        'column_b': column_b,
        'r': round(r, 4),
        'r_squared': round(r ** 2, 4),
        'strength': (
            'very_strong' if abs_r >= 0.9
            else 'strong' if abs_r >= 0.7
            else 'moderate' if abs_r >= 0.4
            else 'weak' if abs_r >= 0.2
            else 'negligible'
        ),
        'direction': 'positive' if r > 0 else 'negative',
        'paired_count': len(paired),
    }


_register(
    'correlation',
    description=(
        'Compute Pearson correlation coefficient (r) between two numeric '
        'columns. Returns r, r², strength, direction, and paired count.'
    ),
    parameters=[
        {'name': 'column_a', 'type': 'string', 'required': True,
         'description': 'First column label.'},
        {'name': 'column_b', 'type': 'string', 'required': True,
         'description': 'Second column label.'},
    ],
    fn=_fn_correlation,
)


# ── 4. Trend Analysis ───────────────────────────────────────────────

def _fn_trend_analysis(sheet_data: dict, *, column: str) -> dict:
    """Simple linear regression on sequential values."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found'}

    nums = [n for v in values if (n := _parse_number(v)) is not None]
    if len(nums) < 5:
        return {'column': column, 'message': 'Too few numeric values for trend'}

    xs = list(range(len(nums)))
    mx = sum(xs) / len(xs)
    my = sum(nums) / len(nums)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, nums))
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return {'column': column, 'direction': 'flat', 'slope': 0, 'r_squared': 0}

    slope = num / den
    intercept = my - slope * mx
    y_pred = [slope * x + intercept for x in xs]
    ss_res = sum((y - yp) ** 2 for y, yp in zip(nums, y_pred))
    ss_tot = sum((y - my) ** 2 for y in nums)
    r_sq = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    return {
        'column': column,
        'direction': 'increasing' if slope > 0 else ('decreasing' if slope < 0 else 'flat'),
        'slope': round(slope, 4),
        'intercept': round(intercept, 4),
        'r_squared': round(r_sq, 4),
        'data_points': len(nums),
        'first_value': nums[0],
        'last_value': nums[-1],
        'predicted_next': round(slope * len(nums) + intercept, 4),
    }


_register(
    'trend_analysis',
    description=(
        'Perform linear regression on sequential values of a numeric column. '
        'Returns slope, intercept, R², direction, predicted next value.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label to analyse for trends.'},
    ],
    fn=_fn_trend_analysis,
)


# ── 5. Distribution Analysis ────────────────────────────────────────

def _fn_distribution(sheet_data: dict, *, column: str, bins: int = 10) -> dict:
    """Analyse distribution shape and produce a histogram."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found'}

    nums = [n for v in values if (n := _parse_number(v)) is not None]
    if len(nums) < 5:
        return {'column': column, 'message': 'Too few numeric values'}

    s = sorted(nums)
    mean = sum(nums) / len(nums)
    std = _std_dev(nums, mean)
    skew = _skewness(nums, mean, std) if std > 0 else 0
    cv = (std / abs(mean)) * 100 if mean != 0 else 0

    # Histogram bins
    lo, hi = s[0], s[-1]
    bin_width = (hi - lo) / bins if hi != lo else 1
    histogram = []
    for b in range(bins):
        edge_lo = lo + b * bin_width
        edge_hi = lo + (b + 1) * bin_width
        count = sum(1 for n in nums if edge_lo <= n < edge_hi)
        if b == bins - 1:
            count = sum(1 for n in nums if edge_lo <= n <= edge_hi)
        histogram.append({
            'bin_start': round(edge_lo, 4),
            'bin_end': round(edge_hi, 4),
            'count': count,
        })

    # Percentiles
    percentiles = {str(p): round(_percentile(s, p), 4) for p in [5, 10, 25, 50, 75, 90, 95]}

    shape = (
        'right-skewed' if skew > 0.5
        else 'left-skewed' if skew < -0.5
        else 'approximately_symmetric'
    )

    return {
        'column': column,
        'count': len(nums),
        'shape': shape,
        'skewness': round(skew, 4),
        'cv_pct': round(cv, 2),
        'spread': 'high' if cv > 100 else ('moderate' if cv > 30 else 'low'),
        'percentiles': percentiles,
        'histogram': histogram,
    }


_register(
    'distribution',
    description=(
        'Analyse the distribution of a numeric column: shape, skewness, '
        'coefficient of variation, percentiles, and a binned histogram.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label to analyse.'},
        {'name': 'bins', 'type': 'integer', 'required': False,
         'description': 'Number of histogram bins (default 10).'},
    ],
    fn=_fn_distribution,
)


# ── 6. Frequency / Value Counts ─────────────────────────────────────

def _fn_value_counts(sheet_data: dict, *, column: str, top_n: int = 20) -> dict:
    """Count occurrences of each unique value in a column."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found'}

    cleaned = [str(v).strip() for v in values if str(v).strip()]
    freq = Counter(cleaned).most_common(top_n)

    return {
        'column': column,
        'total_non_empty': len(cleaned),
        'unique_count': len(set(cleaned)),
        'top_values': [{'value': v, 'count': c, 'pct': round(c / len(cleaned) * 100, 1)} for v, c in freq],
    }


_register(
    'value_counts',
    description=(
        'Count the frequency of each unique value in a column. '
        'Useful for categorical / text columns. Returns top N values with counts and percentages.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label.'},
        {'name': 'top_n', 'type': 'integer', 'required': False,
         'description': 'How many top values to return (default 20).'},
    ],
    fn=_fn_value_counts,
)


# ── 7. Group-by Aggregation ─────────────────────────────────────────

def _fn_group_by(sheet_data: dict, *, group_column: str,
                 value_column: str, agg: str = 'sum') -> dict:
    """Group rows by one column and aggregate another."""
    grp_vals = sheet_data['col_values'].get(group_column, [])
    val_vals = sheet_data['col_values'].get(value_column, [])
    if not grp_vals or not val_vals:
        return {'error': 'One or both columns not found'}

    groups: dict[str, list[float]] = {}
    for g, v in zip(grp_vals, val_vals):
        key = str(g).strip()
        if not key:
            key = '(empty)'
        n = _parse_number(v)
        if n is not None:
            groups.setdefault(key, []).append(n)

    agg_fn = {
        'sum': lambda vs: round(sum(vs), 4),
        'mean': lambda vs: round(sum(vs) / len(vs), 4) if vs else 0,
        'count': lambda vs: len(vs),
        'min': lambda vs: min(vs),
        'max': lambda vs: max(vs),
        'median': lambda vs: round(_median(sorted(vs)), 4),
    }
    compute = agg_fn.get(agg, agg_fn['sum'])

    result_rows = sorted(
        [{'group': k, 'value': compute(vs), 'row_count': len(vs)} for k, vs in groups.items()],
        key=lambda x: x['value'], reverse=True,
    )

    return {
        'group_column': group_column,
        'value_column': value_column,
        'aggregation': agg,
        'group_count': len(result_rows),
        'results': result_rows,
    }


_register(
    'group_by',
    description=(
        'Group rows by a categorical column and aggregate a numeric column. '
        'Supports sum, mean, count, min, max, median. '
        'Returns sorted groups with aggregated values.'
    ),
    parameters=[
        {'name': 'group_column', 'type': 'string', 'required': True,
         'description': 'Column to group by (typically text/categorical).'},
        {'name': 'value_column', 'type': 'string', 'required': True,
         'description': 'Numeric column to aggregate.'},
        {'name': 'agg', 'type': 'string', 'required': False,
         'description': 'Aggregation: "sum" (default), "mean", "count", "min", "max", "median".'},
    ],
    fn=_fn_group_by,
)


# ── 8. Cross-tabulation ─────────────────────────────────────────────

def _fn_crosstab(sheet_data: dict, *, row_column: str,
                 col_column: str) -> dict:
    """Produce a cross-tabulation (contingency table) of two columns."""
    row_vals = sheet_data['col_values'].get(row_column, [])
    col_vals = sheet_data['col_values'].get(col_column, [])
    if not row_vals or not col_vals:
        return {'error': 'One or both columns not found'}

    table: dict[str, Counter] = {}
    for r, c in zip(row_vals, col_vals):
        rk = str(r).strip() or '(empty)'
        ck = str(c).strip() or '(empty)'
        table.setdefault(rk, Counter())[ck] += 1

    all_cols = sorted({ck for row in table.values() for ck in row})
    rows = []
    for rk in sorted(table):
        row_data = {'label': rk}
        for ck in all_cols:
            row_data[ck] = table[rk].get(ck, 0)
        row_data['total'] = sum(table[rk].values())
        rows.append(row_data)

    return {
        'row_column': row_column,
        'col_column': col_column,
        'column_headers': all_cols,
        'rows': rows[:50],  # Limit for response size
        'total_combinations': sum(len(r) for r in table.values()),
    }


_register(
    'crosstab',
    description=(
        'Create a cross-tabulation (pivot / contingency table) between two '
        'categorical columns. Shows counts for each combination.'
    ),
    parameters=[
        {'name': 'row_column', 'type': 'string', 'required': True,
         'description': 'Column for rows of the cross-tab.'},
        {'name': 'col_column', 'type': 'string', 'required': True,
         'description': 'Column for columns of the cross-tab.'},
    ],
    fn=_fn_crosstab,
)


# ── 9. Comparison (two-column) ──────────────────────────────────────

def _fn_compare_columns(sheet_data: dict, *, column_a: str,
                        column_b: str) -> dict:
    """Compare statistics between two numeric columns."""
    res_a = _fn_column_stats(sheet_data, column=column_a)
    res_b = _fn_column_stats(sheet_data, column=column_b)
    if 'error' in res_a or 'error' in res_b:
        return {'error': 'One or both columns could not be analysed'}

    comparison = {'column_a': res_a, 'column_b': res_b, 'differences': {}}
    for key in ('mean', 'median', 'std', 'min', 'max', 'sum'):
        va = res_a.get(key)
        vb = res_b.get(key)
        if va is not None and vb is not None:
            comparison['differences'][key] = {
                'a': va, 'b': vb,
                'diff': round(va - vb, 4),
                'pct_diff': round(((va - vb) / abs(vb)) * 100, 2) if vb != 0 else None,
            }

    return comparison


_register(
    'compare_columns',
    description=(
        'Compare descriptive statistics between two numeric columns. '
        'Shows side-by-side stats and differences (absolute & percentage).'
    ),
    parameters=[
        {'name': 'column_a', 'type': 'string', 'required': True,
         'description': 'First column label.'},
        {'name': 'column_b', 'type': 'string', 'required': True,
         'description': 'Second column label.'},
    ],
    fn=_fn_compare_columns,
)


# ── 10. Data Quality Check ──────────────────────────────────────────

def _fn_data_quality(sheet_data: dict) -> dict:
    """Assess data quality across all columns."""
    cols = sheet_data['col_values']
    total_rows = sheet_data['total_rows']
    total_cols = len(cols)
    total_cells = total_rows * total_cols

    missing = 0
    issues = []
    column_quality = {}

    for label, vals in cols.items():
        col_missing = sum(1 for v in vals if not str(v).strip())
        missing += col_missing
        pct_filled = round((1 - col_missing / max(len(vals), 1)) * 100, 1)
        column_quality[label] = {
            'filled_pct': pct_filled,
            'missing_count': col_missing,
        }

        if pct_filled < 90:
            issues.append(f'"{label}" is only {pct_filled}% filled ({col_missing} missing)')

        # Check for mixed types
        has_num = any(_parse_number(v) is not None for v in vals if str(v).strip())
        has_text = any(
            _parse_number(v) is None and str(v).strip()
            for v in vals
        )
        if has_num and has_text:
            issues.append(f'"{label}" has mixed numeric and text values')

    completeness = round((1 - missing / max(total_cells, 1)) * 100, 1)

    return {
        'total_cells': total_cells,
        'missing_cells': missing,
        'completeness_pct': completeness,
        'score': 'good' if completeness >= 90 else ('fair' if completeness >= 70 else 'poor'),
        'column_quality': column_quality,
        'issues': issues,
    }


_register(
    'data_quality',
    description=(
        'Assess data quality across the entire sheet: completeness, '
        'missing values per column, mixed-type detection, overall score.'
    ),
    parameters=[],  # no params — runs on whole sheet
    fn=_fn_data_quality,
)


# ── 11. Moving Average ──────────────────────────────────────────────

def _fn_moving_average(sheet_data: dict, *, column: str,
                       window: int = 3) -> dict:
    """Compute a moving average for a numeric column."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found'}

    nums = [_parse_number(v) for v in values]
    # Replace None with previous value for continuity
    clean = []
    for n in nums:
        if n is not None:
            clean.append(n)
        elif clean:
            clean.append(clean[-1])

    if len(clean) < window:
        return {'column': column, 'message': 'Too few values for moving average'}

    ma = []
    for i in range(len(clean) - window + 1):
        segment = clean[i:i + window]
        ma.append({
            'index': i + window - 1,
            'value': round(sum(segment) / window, 4),
        })

    return {
        'column': column,
        'window': window,
        'data_points': len(ma),
        'moving_average': ma,
        'smoothed_start': ma[0]['value'] if ma else None,
        'smoothed_end': ma[-1]['value'] if ma else None,
    }


_register(
    'moving_average',
    description=(
        'Compute a simple moving average (SMA) for a numeric column. '
        'Returns the smoothed series.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label.'},
        {'name': 'window', 'type': 'integer', 'required': False,
         'description': 'Window size (default 3).'},
    ],
    fn=_fn_moving_average,
)


# ── 12. Percentage Change ───────────────────────────────────────────

def _fn_pct_change(sheet_data: dict, *, column: str) -> dict:
    """Compute row-over-row percentage change for a numeric column."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found'}

    nums = [_parse_number(v) for v in values]
    row_labels = sheet_data.get('row_labels', [])
    changes = []

    for i in range(1, len(nums)):
        prev, curr = nums[i - 1], nums[i]
        if prev is not None and curr is not None and prev != 0:
            pct = round(((curr - prev) / abs(prev)) * 100, 2)
            label = row_labels[i] if i < len(row_labels) else str(i + 1)
            changes.append({'index': i, 'row_label': label, 'pct_change': pct})

    if not changes:
        return {'column': column, 'message': 'Could not compute percentage changes'}

    avg_change = round(sum(c['pct_change'] for c in changes) / len(changes), 2)
    max_increase = max(changes, key=lambda c: c['pct_change'])
    max_decrease = min(changes, key=lambda c: c['pct_change'])

    return {
        'column': column,
        'data_points': len(changes),
        'average_pct_change': avg_change,
        'max_increase': max_increase,
        'max_decrease': max_decrease,
        'changes': changes,
    }


_register(
    'pct_change',
    description=(
        'Compute row-over-row percentage change for a numeric column. '
        'Returns each change, average change, max increase, max decrease.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label.'},
    ],
    fn=_fn_pct_change,
)


# ── 13. Cumulative Sum ──────────────────────────────────────────────

def _fn_cumulative_sum(sheet_data: dict, *, column: str) -> dict:
    """Compute cumulative sum for a numeric column."""
    values = sheet_data['col_values'].get(column, [])
    if not values:
        return {'error': f'Column "{column}" not found'}

    row_labels = sheet_data.get('row_labels', [])
    running = 0
    series = []
    for i, v in enumerate(values):
        n = _parse_number(v)
        if n is not None:
            running += n
            label = row_labels[i] if i < len(row_labels) else str(i + 1)
            series.append({'index': i, 'row_label': label, 'cumulative': round(running, 4)})

    return {
        'column': column,
        'total': round(running, 4),
        'data_points': len(series),
        'series': series,
    }


_register(
    'cumulative_sum',
    description=(
        'Compute a running cumulative sum for a numeric column. '
        'Useful for tracking totals over sequential rows.'
    ),
    parameters=[
        {'name': 'column', 'type': 'string', 'required': True,
         'description': 'The column label.'},
    ],
    fn=_fn_cumulative_sum,
)


# ── 14. Ratio / Derived Column ──────────────────────────────────────

def _fn_ratio(sheet_data: dict, *, numerator_column: str,
              denominator_column: str) -> dict:
    """Compute the ratio of two numeric columns row-by-row."""
    num_vals = sheet_data['col_values'].get(numerator_column, [])
    den_vals = sheet_data['col_values'].get(denominator_column, [])
    if not num_vals or not den_vals:
        return {'error': 'One or both columns not found'}

    row_labels = sheet_data.get('row_labels', [])
    ratios = []
    for i, (nv, dv) in enumerate(zip(num_vals, den_vals)):
        n = _parse_number(nv)
        d = _parse_number(dv)
        if n is not None and d is not None and d != 0:
            label = row_labels[i] if i < len(row_labels) else str(i + 1)
            ratios.append({'index': i, 'row_label': label, 'ratio': round(n / d, 4)})

    if not ratios:
        return {'error': 'No valid numeric pairs found'}

    ratio_vals = [r['ratio'] for r in ratios]
    return {
        'numerator': numerator_column,
        'denominator': denominator_column,
        'count': len(ratios),
        'mean_ratio': round(sum(ratio_vals) / len(ratio_vals), 4),
        'min_ratio': round(min(ratio_vals), 4),
        'max_ratio': round(max(ratio_vals), 4),
        'ratios': ratios,
    }


_register(
    'ratio',
    description=(
        'Compute the row-by-row ratio of two numeric columns (A / B). '
        'Returns mean, min, max, and all row ratios.'
    ),
    parameters=[
        {'name': 'numerator_column', 'type': 'string', 'required': True,
         'description': 'Column for the numerator.'},
        {'name': 'denominator_column', 'type': 'string', 'required': True,
         'description': 'Column for the denominator.'},
    ],
    fn=_fn_ratio,
)


# ════════════════════════════════════════════════════════════════════
# Plan Executor
# ════════════════════════════════════════════════════════════════════

def execute_plan(sheet_data: dict, plan: list[dict],
                 max_calls: int = 25) -> list[dict]:
    """
    Execute a list of function calls against sheet data.

    plan: [ { "function": "column_stats", "params": { "column": "Revenue" } }, ... ]

    Returns a list of results aligned with the plan.
    """
    results = []
    for i, call in enumerate(plan[:max_calls]):
        fn_name = call.get('function', '')
        params = call.get('params', {})

        entry = _REGISTRY.get(fn_name)
        if not entry:
            results.append({
                'function': fn_name,
                'error': f'Unknown function "{fn_name}"',
            })
            continue

        try:
            output = entry['fn'](sheet_data, **params)
            results.append({
                'function': fn_name,
                'params': params,
                'result': output,
            })
        except Exception as exc:
            results.append({
                'function': fn_name,
                'params': params,
                'error': str(exc)[:300],
            })

    return results


# ════════════════════════════════════════════════════════════════════
# Metadata extractor (for AI to decide which functions to call)
# ════════════════════════════════════════════════════════════════════

def build_sheet_metadata(sheet_data: dict) -> dict:
    """
    Build lightweight metadata about the sheet for the AI planner.
    Includes column names, types, sample values — NO full data.
    """
    metadata = {
        'title': sheet_data['title'],
        'total_rows': sheet_data['total_rows'],
        'columns': [],
    }

    for col in sheet_data.get('columns', []):
        label = col['label']
        vals = sheet_data['col_values'].get(label, [])

        # Quick type inference
        nums = [n for v in vals[:50] if (n := _parse_number(v)) is not None]
        non_empty = [str(v).strip() for v in vals if str(v).strip()]
        sample = non_empty[:5]
        unique_count = len(set(non_empty))

        col_meta = {
            'label': label,
            'declared_type': col.get('type', 'text'),
            'inferred_type': 'numeric' if len(nums) > len(non_empty) * 0.6 else 'text',
            'total_values': len(vals),
            'non_empty': len(non_empty),
            'unique_count': unique_count,
            'sample_values': sample,
        }

        if nums:
            col_meta['numeric_preview'] = {
                'min': min(nums),
                'max': max(nums),
                'sample_mean': round(sum(nums) / len(nums), 2),
            }

        metadata['columns'].append(col_meta)

    return metadata
