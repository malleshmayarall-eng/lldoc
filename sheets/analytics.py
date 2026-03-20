"""
sheets/analytics.py — Pure Python statistical analysis for sheet data.

No AI calls, no external deps (no numpy/scipy). All computation is
done with stdlib math on the extracted sheet table JSON.

Public API:
    build_analytics_report(sheet) -> dict   # The main entry point
"""

import math
import re
from collections import Counter


# ════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════

_CURRENCY_RE = re.compile(r'[\$€£₹¥,\s]')


def _parse_number(val):
    """Try to coerce a cell value to float. Returns None on failure."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    cleaned = _CURRENCY_RE.sub('', s)
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def _median(sorted_vals):
    n = len(sorted_vals)
    if n == 0:
        return 0
    mid = n // 2
    if n % 2 == 0:
        return (sorted_vals[mid - 1] + sorted_vals[mid]) / 2
    return sorted_vals[mid]


def _percentile(sorted_vals, p):
    """Linear interpolation percentile (0-100)."""
    if not sorted_vals:
        return 0
    k = (p / 100) * (len(sorted_vals) - 1)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def _std_dev(vals, mean):
    if len(vals) < 2:
        return 0
    variance = sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)
    return math.sqrt(variance)


def _skewness(vals, mean, std):
    """Sample skewness (Fisher)."""
    n = len(vals)
    if n < 3 or std == 0:
        return 0
    m3 = sum((v - mean) ** 3 for v in vals) / n
    return m3 / (std ** 3)


def _pearson_r(xs, ys):
    """Pearson correlation coefficient between two equal-length lists."""
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


# ════════════════════════════════════════════════════════════════════
# Column-level statistics
# ════════════════════════════════════════════════════════════════════

def compute_column_stats(values):
    """
    Given a list of raw cell values (strings), compute stats for
    those that are numeric.

    Returns dict with keys:
        count, numeric_count, non_numeric_count, missing_count,
        mean, median, std, min, max, q1, q3, iqr, skewness,
        sum, unique_count, top_values (top 5 by frequency)
    """
    nums = []
    missing = 0
    non_numeric = 0
    all_strs = []

    for v in values:
        s = str(v).strip() if v is not None else ''
        if not s:
            missing += 1
            continue
        all_strs.append(s)
        n = _parse_number(v)
        if n is not None:
            nums.append(n)
        else:
            non_numeric += 1

    result = {
        'count': len(values),
        'numeric_count': len(nums),
        'non_numeric_count': non_numeric,
        'missing_count': missing,
        'unique_count': len(set(all_strs)),
    }

    # Top values by frequency
    freq = Counter(all_strs).most_common(5)
    result['top_values'] = [{'value': v, 'count': c} for v, c in freq]

    if not nums:
        result.update({
            'mean': None, 'median': None, 'std': None,
            'min': None, 'max': None, 'sum': None,
            'q1': None, 'q3': None, 'iqr': None, 'skewness': None,
        })
        return result

    sorted_nums = sorted(nums)
    mean = sum(nums) / len(nums)
    std = _std_dev(nums, mean)
    q1 = _percentile(sorted_nums, 25)
    q3 = _percentile(sorted_nums, 75)

    result.update({
        'mean': round(mean, 4),
        'median': round(_median(sorted_nums), 4),
        'std': round(std, 4),
        'min': sorted_nums[0],
        'max': sorted_nums[-1],
        'sum': round(sum(nums), 4),
        'q1': round(q1, 4),
        'q3': round(q3, 4),
        'iqr': round(q3 - q1, 4),
        'skewness': round(_skewness(nums, mean, std), 4) if std > 0 else 0,
    })

    return result


# ════════════════════════════════════════════════════════════════════
# Outlier detection (IQR method)
# ════════════════════════════════════════════════════════════════════

def detect_outliers(col_label, values, row_labels=None):
    """
    Detect outliers using the IQR method (1.5×IQR below Q1 or above Q3).

    Returns list of dicts:
        [{ column, value, row_label, deviation, z_score, severity }]
    """
    nums = []
    indices = []
    for i, v in enumerate(values):
        n = _parse_number(v)
        if n is not None:
            nums.append(n)
            indices.append(i)

    if len(nums) < 4:
        return []

    sorted_nums = sorted(nums)
    q1 = _percentile(sorted_nums, 25)
    q3 = _percentile(sorted_nums, 75)
    iqr = q3 - q1

    if iqr == 0:
        return []

    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    mean = sum(nums) / len(nums)
    std = _std_dev(nums, mean)

    outliers = []
    for j, n in enumerate(nums):
        if n < lower or n > upper:
            original_idx = indices[j]
            label = (row_labels[original_idx] if row_labels and original_idx < len(row_labels) else str(original_idx + 1))
            z = (n - mean) / std if std > 0 else 0
            direction = 'above' if n > upper else 'below'
            outliers.append({
                'column': col_label,
                'value': n,
                'row_index': original_idx,
                'row_label': str(label),
                'deviation': f'{abs(z):.1f} std devs {direction} mean',
                'z_score': round(z, 2),
                'severity': 'high' if abs(z) > 3 else ('medium' if abs(z) > 2 else 'low'),
                'bounds': {'lower': round(lower, 2), 'upper': round(upper, 2)},
            })

    return outliers


# ════════════════════════════════════════════════════════════════════
# Correlation matrix
# ════════════════════════════════════════════════════════════════════

def compute_correlations(numeric_columns):
    """
    Given dict { col_label: [float|None, ...] }, compute pairwise
    Pearson correlations for columns with enough data.

    Returns list of:
        [{ col_a, col_b, r, strength, direction }]
    """
    labels = list(numeric_columns.keys())
    results = []

    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            a_label, b_label = labels[i], labels[j]
            a_vals = numeric_columns[a_label]
            b_vals = numeric_columns[b_label]

            # Pair-wise filter — both must be non-None
            paired = [
                (a, b) for a, b in zip(a_vals, b_vals)
                if a is not None and b is not None
            ]
            if len(paired) < 5:
                continue

            xs, ys = zip(*paired)
            r = _pearson_r(list(xs), list(ys))
            if r is None:
                continue

            abs_r = abs(r)
            strength = (
                'strong' if abs_r >= 0.7
                else 'moderate' if abs_r >= 0.4
                else 'weak'
            )
            direction = 'positive' if r > 0 else 'negative'

            results.append({
                'col_a': a_label,
                'col_b': b_label,
                'r': round(r, 4),
                'strength': strength,
                'direction': direction,
            })

    # Sort by absolute r descending
    results.sort(key=lambda x: abs(x['r']), reverse=True)
    return results


# ════════════════════════════════════════════════════════════════════
# Data quality assessment
# ════════════════════════════════════════════════════════════════════

def assess_data_quality(col_stats, total_rows, total_cols):
    """
    Assess data quality from already-computed column stats.

    Returns:
        { completeness_pct, total_cells, missing_cells,
          issues: [str], score: 'good' | 'fair' | 'poor' }
    """
    total_cells = total_rows * total_cols
    missing = sum(s.get('missing_count', 0) for s in col_stats.values())
    completeness = round((1 - missing / max(total_cells, 1)) * 100, 1)

    issues = []
    for label, stats in col_stats.items():
        if stats['missing_count'] > 0:
            pct = round(stats['missing_count'] / max(stats['count'], 1) * 100, 1)
            if pct > 10:
                issues.append(f'"{label}" has {pct}% missing values ({stats["missing_count"]} cells)')
        if stats['non_numeric_count'] > 0 and stats['numeric_count'] > 0:
            issues.append(
                f'"{label}" has mixed types: {stats["numeric_count"]} numeric, '
                f'{stats["non_numeric_count"]} non-numeric'
            )

    score = 'good' if completeness >= 90 else ('fair' if completeness >= 70 else 'poor')

    return {
        'completeness_pct': completeness,
        'total_cells': total_cells,
        'missing_cells': missing,
        'issues': issues,
        'score': score,
    }


# ════════════════════════════════════════════════════════════════════
# Trend detection (simple linear regression slope)
# ════════════════════════════════════════════════════════════════════

def detect_trends(col_label, values):
    """
    Simple linear regression on sequential numeric values.
    Returns None if insufficient data, else:
        { column, direction, slope, r_squared, description }
    """
    nums = []
    for v in values:
        n = _parse_number(v)
        if n is not None:
            nums.append(n)

    if len(nums) < 5:
        return None

    xs = list(range(len(nums)))
    mean_x = sum(xs) / len(xs)
    mean_y = sum(nums) / len(nums)

    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, nums))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0:
        return None

    slope = num / den
    intercept = mean_y - slope * mean_x

    # R²
    y_pred = [slope * x + intercept for x in xs]
    ss_res = sum((y - yp) ** 2 for y, yp in zip(nums, y_pred))
    ss_tot = sum((y - mean_y) ** 2 for y in nums)
    r_sq = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    direction = 'increasing' if slope > 0 else ('decreasing' if slope < 0 else 'flat')

    return {
        'column': col_label,
        'direction': direction,
        'slope': round(slope, 4),
        'r_squared': round(r_sq, 4),
        'description': (
            f'"{col_label}" shows a {direction} trend '
            f'(slope={slope:+.4f}, R²={r_sq:.3f})'
        ),
    }


# ════════════════════════════════════════════════════════════════════
# Distribution shape
# ════════════════════════════════════════════════════════════════════

def describe_distribution(col_label, stats):
    """
    Describe the distribution shape from column stats.
    Returns a dict or None.
    """
    if stats.get('numeric_count', 0) < 5:
        return None
    if stats.get('std') is None or stats.get('mean') is None:
        return None

    skew = stats.get('skewness', 0)
    cv = (stats['std'] / abs(stats['mean'])) * 100 if stats['mean'] != 0 else 0

    shape = (
        'right-skewed (positive)' if skew > 0.5
        else 'left-skewed (negative)' if skew < -0.5
        else 'approximately symmetric'
    )
    spread = (
        'high variability' if cv > 100
        else 'moderate variability' if cv > 30
        else 'low variability'
    )

    return {
        'column': col_label,
        'shape': shape,
        'skewness': skew,
        'coefficient_of_variation': round(cv, 2),
        'spread': spread,
        'description': (
            f'"{col_label}" is {shape} with {spread} '
            f'(CV={cv:.1f}%, skew={skew:.2f})'
        ),
    }


# ════════════════════════════════════════════════════════════════════
# Extract raw data from a Sheet model instance
# ════════════════════════════════════════════════════════════════════

def extract_sheet_data(sheet):
    """
    Pull structured data from a Sheet model.
    Returns:
        {
            'title': str,
            'columns': [ { key, label, type } ],
            'col_values': { label: [cell_val, ...] },  # per-column arrays
            'row_labels': [str],  # first-column values for row identification
            'total_rows': int,
        }
    """
    columns = sheet.columns or []
    rows_qs = sheet.rows.order_by('order').prefetch_related('cells')

    col_keys = [c['key'] for c in columns]
    col_labels = {c['key']: c.get('label', c['key']) for c in columns}
    col_types = {c['key']: c.get('type', 'text') for c in columns}

    # Init per-column value lists
    col_values = {col_labels[k]: [] for k in col_keys}
    row_labels = []
    total_rows = 0

    for row in rows_qs:
        cell_map = {c.column_key: (c.computed_value or c.raw_value or '') for c in row.cells.all()}
        # Skip fully empty rows
        if not any(str(cell_map.get(k, '')).strip() for k in col_keys):
            continue
        total_rows += 1
        for k in col_keys:
            col_values[col_labels[k]].append(cell_map.get(k, ''))
        # First column as row label
        if col_keys:
            row_labels.append(str(cell_map.get(col_keys[0], '')))

    return {
        'title': sheet.title or 'Untitled Sheet',
        'columns': [
            {'key': c['key'], 'label': col_labels[c['key']], 'type': col_types[c['key']]}
            for c in columns
        ],
        'col_values': col_values,
        'row_labels': row_labels,
        'total_rows': total_rows,
    }


# ════════════════════════════════════════════════════════════════════
# Main entry point
# ════════════════════════════════════════════════════════════════════

def build_analytics_report(sheet):
    """
    Main entry point: compute full statistical report for a sheet.

    Returns a dict ready for JSON serialization:
    {
        "title", "total_rows", "total_columns",
        "column_stats": { label: { ... } },
        "outliers": [ ... ],
        "correlations": [ ... ],
        "trends": [ ... ],
        "distributions": [ ... ],
        "data_quality": { ... },
    }
    """
    data = extract_sheet_data(sheet)

    if data['total_rows'] == 0:
        return {
            'title': data['title'],
            'total_rows': 0,
            'total_columns': len(data['columns']),
            'column_stats': {},
            'outliers': [],
            'correlations': [],
            'trends': [],
            'distributions': [],
            'data_quality': {
                'completeness_pct': 100, 'total_cells': 0,
                'missing_cells': 0, 'issues': [], 'score': 'good',
            },
        }

    # ── Per-column stats ──
    col_stats = {}
    for col in data['columns']:
        label = col['label']
        vals = data['col_values'].get(label, [])
        col_stats[label] = compute_column_stats(vals)

    # ── Outliers (numeric columns only) ──
    all_outliers = []
    for col in data['columns']:
        label = col['label']
        if col_stats[label]['numeric_count'] >= 4:
            outliers = detect_outliers(
                label,
                data['col_values'][label],
                row_labels=data['row_labels'],
            )
            all_outliers.extend(outliers)

    # ── Correlations (collect numeric columns) ──
    numeric_cols = {}
    for col in data['columns']:
        label = col['label']
        if col_stats[label]['numeric_count'] >= 5:
            numeric_cols[label] = [
                _parse_number(v) for v in data['col_values'][label]
            ]
    correlations = compute_correlations(numeric_cols)

    # ── Trends ──
    trends = []
    for col in data['columns']:
        label = col['label']
        if col_stats[label]['numeric_count'] >= 5:
            trend = detect_trends(label, data['col_values'][label])
            if trend:
                trends.append(trend)

    # ── Distributions ──
    distributions = []
    for col in data['columns']:
        label = col['label']
        dist = describe_distribution(label, col_stats[label])
        if dist:
            distributions.append(dist)

    # ── Data quality ──
    quality = assess_data_quality(
        col_stats, data['total_rows'], len(data['columns']),
    )

    return {
        'title': data['title'],
        'total_rows': data['total_rows'],
        'total_columns': len(data['columns']),
        'column_stats': col_stats,
        'outliers': all_outliers,
        'correlations': correlations,
        'trends': trends,
        'distributions': distributions,
        'data_quality': quality,
    }
