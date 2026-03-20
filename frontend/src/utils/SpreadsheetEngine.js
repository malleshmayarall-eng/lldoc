/**
 * SpreadsheetEngine — client-side formula evaluator
 *
 * Mirrors the server-side FormulaEngine for instant feedback.
 * Supports: SUM, AVG, MIN, MAX, COUNT, COUNTA, IF, ROUND, ABS,
 *           CONCAT, UPPER, LOWER, LEN, VLOOKUP, NOW, TODAY
 * Cell references: A1, B2, A1:A10 (ranges)
 */

const CELL_REF = /\b([A-Z]{1,3})(\d+)\b/g;
const RANGE_REF = /\b([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)\b/g;

// ── Helpers ──────────────────────────────────────────────────────────

function colLetterToIndex(letter) {
  let result = 0;
  for (const ch of letter) {
    result = result * 26 + (ch.charCodeAt(0) - 64);
  }
  return result - 1;
}

function colIndexToLetter(index) {
  let result = '';
  let i = index;
  while (true) {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
    if (i < 0) break;
  }
  return result;
}

function parseValue(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  if (raw === true || raw === 'true' || raw === 'TRUE') return true;
  if (raw === false || raw === 'false' || raw === 'FALSE') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  return raw;
}

// ── Split function arguments (respects nested parens) ────────────

function splitArgs(argsStr) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of argsStr) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; }
    else { current += ch; }
  }
  if (current) parts.push(current);
  return parts;
}

// ── Main Engine ──────────────────────────────────────────────────────

export class SpreadsheetEngine {
  /**
   * @param {Object} data — { columns: [{key, label}], cellValues: Map<string, string> }
   *   cellValues key format: "row_col" e.g. "0_col_0" (0-based row, column key)
   */
  constructor(columns, cellValues) {
    this.columns = columns || [];
    this.cellValues = cellValues; // Map or plain object
    this._cache = {};
    this._computing = new Set();

    // Build column-key → letter map for key-based formula resolution
    this._keyToLetter = {};
    for (let i = 0; i < this.columns.length; i++) {
      this._keyToLetter[this.columns[i].key.toLowerCase()] = colIndexToLetter(i);
    }
  }

  /**
   * Convert column-key references (qty3, price{row}) to letter refs (A3, B{row}).
   * Longer keys are matched first so "unit_price5" beats "unit5".
   */
  _resolveColumnKeys(formula) {
    const keys = Object.keys(this._keyToLetter);
    if (keys.length === 0) return formula;
    // Sort longest-first
    keys.sort((a, b) => b.length - a.length);
    const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(
      '\\b(' + escaped.join('|') + ')(\\d+|\\{row\\})',
      'gi'
    );
    return formula.replace(pattern, (_, key, suffix) => {
      const letter = this._keyToLetter[key.toLowerCase()];
      return letter ? `${letter}${suffix}` : `${key}${suffix}`;
    });
  }

  /**
   * Get cell value by column letter + row number (1-based).
   * E.g. getCellValue('A', 1) gets row 0, first column.
   */
  getCellValue(colLetter, rowNum) {
    const cacheKey = `${colLetter}${rowNum}`;
    if (cacheKey in this._cache) return this._cache[cacheKey];

    const colIdx = colLetterToIndex(colLetter);
    if (colIdx >= this.columns.length) return 0;

    const colKey = this.columns[colIdx].key;
    const rowIdx = rowNum - 1; // convert to 0-based
    const mapKey = `${rowIdx}_${colKey}`;
    const raw = this.cellValues instanceof Map
      ? this.cellValues.get(mapKey)
      : this.cellValues[mapKey];

    if (raw === undefined || raw === null || raw === '') {
      this._cache[cacheKey] = 0;
      return 0;
    }

    if (typeof raw === 'string' && raw.startsWith('=')) {
      if (this._computing.has(cacheKey)) return '#CIRCULAR!';
      const val = this.evaluate(raw, colLetter, rowNum);
      this._cache[cacheKey] = val;
      return val;
    }

    const val = parseValue(raw);
    this._cache[cacheKey] = val;
    return val;
  }

  /**
   * Resolve a range like A1:B3 into a flat array of values.
   */
  resolveRange(colStart, rowStart, colEnd, rowEnd) {
    const ciStart = colLetterToIndex(colStart);
    const ciEnd = colLetterToIndex(colEnd);
    const values = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let ci = ciStart; ci <= ciEnd; ci++) {
        const letter = colIndexToLetter(ci);
        values.push(this.getCellValue(letter, r));
      }
    }
    return values;
  }

  /**
   * Evaluate a formula string (e.g. "=SUM(A1:A5)").
   * Returns the computed value.
   */
  evaluate(rawValue, colLetter = null, rowNum = null) {
    if (typeof rawValue !== 'string' || !rawValue.startsWith('=')) {
      return parseValue(rawValue);
    }

    const cacheKey = colLetter && rowNum ? `${colLetter}${rowNum}` : null;
    if (cacheKey) this._computing.add(cacheKey);

    let result;
    try {
      // Resolve column-key references (qty3 → A3) before evaluation
      const expr = this._resolveColumnKeys(rawValue.slice(1).trim());
      result = this._evalExpr(expr);
    } catch (e) {
      result = `#ERROR: ${e.message}`;
    } finally {
      if (cacheKey) this._computing.delete(cacheKey);
    }

    if (cacheKey) this._cache[cacheKey] = result;
    return result;
  }

  /**
   * Inject formula-template cells from column definitions.
   * For each column that has a `.formula` template (e.g. "=A{row}+B{row}"),
   * set every row's cell value to the expanded formula (replacing {row} with 1-based row number).
   * @param {number} rowCount — total number of rows
   * @param {Object|Map} cellValues — will be mutated in place
   */
  applyColumnFormulas(rowCount) {
    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const col = this.columns[colIdx];
      if (!col.formula) continue;
      const template = col.formula.startsWith('=') ? col.formula : `=${col.formula}`;
      for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
        const rowNum = rowIdx + 1;
        const expanded = template.replace(/\{row\}/gi, String(rowNum));
        const mapKey = `${rowIdx}_${col.key}`;
        if (this.cellValues instanceof Map) {
          this.cellValues.set(mapKey, expanded);
        } else {
          this.cellValues[mapKey] = expanded;
        }
      }
    }
  }

  /**
   * Evaluate all cells and return a new Map of computed values.
   * Key format: "row_col" → computed value.
   */
  evaluateAll(rowCount = 0) {
    // First inject column-level formula templates
    if (rowCount > 0) {
      this.applyColumnFormulas(rowCount);
    }

    this._cache = {};
    const results = new Map();

    const entries = this.cellValues instanceof Map
      ? [...this.cellValues.entries()]
      : Object.entries(this.cellValues);

    for (const [mapKey, raw] of entries) {
      if (typeof raw === 'string' && raw.startsWith('=')) {
        // Parse mapKey: "rowIdx_colKey"
        const underscoreIdx = mapKey.indexOf('_');
        const rowIdx = parseInt(mapKey.substring(0, underscoreIdx));
        const colKey = mapKey.substring(underscoreIdx + 1);

        const colIdx = this.columns.findIndex((c) => c.key === colKey);
        if (colIdx < 0) continue;

        const colLetter = colIndexToLetter(colIdx);
        const rowNum = rowIdx + 1;
        const computed = this.evaluate(raw, colLetter, rowNum);
        results.set(mapKey, computed);
      } else {
        results.set(mapKey, parseValue(raw));
      }
    }

    return results;
  }

  // ── Internal expression parser ─────────────────────────────────

  _evalExpr(expr) {
    const upper = expr.toUpperCase().trim();

    // Function call: FUNC(args)
    const funcMatch = expr.match(/^(\w+)\((.+)\)$/s);
    if (funcMatch) {
      const funcName = funcMatch[1].toUpperCase();
      const argsStr = funcMatch[2];
      return this._callFunction(funcName, argsStr);
    }

    // Cell reference: A1
    const cellMatch = upper.match(/^([A-Z]{1,3})(\d+)$/);
    if (cellMatch) {
      return this.getCellValue(cellMatch[1], parseInt(cellMatch[2]));
    }

    // Arithmetic
    return this._evalArithmetic(expr);
  }

  _callFunction(name, argsStr) {
    const funcs = {
      SUM: (a) => this._collectNumeric(a).reduce((s, v) => s + v, 0),
      AVG: (a) => { const v = this._collectNumeric(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; },
      AVERAGE: (a) => { const v = this._collectNumeric(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; },
      MIN: (a) => { const v = this._collectNumeric(a); return v.length ? Math.min(...v) : 0; },
      MAX: (a) => { const v = this._collectNumeric(a); return v.length ? Math.max(...v) : 0; },
      COUNT: (a) => this._collectNumeric(a).length,
      COUNTA: (a) => {
        let count = 0;
        for (const arg of splitArgs(a)) {
          const t = arg.trim().toUpperCase();
          const rm = t.match(/^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/);
          if (rm) {
            count += this.resolveRange(rm[1], +rm[2], rm[3], +rm[4]).filter((v) => v !== 0 && v !== '' && v !== null).length;
          } else {
            const cm = t.match(/^([A-Z]{1,3})(\d+)$/);
            if (cm) {
              const v = this.getCellValue(cm[1], +cm[2]);
              if (v !== 0 && v !== '' && v !== null) count++;
            } else if (arg.trim()) count++;
          }
        }
        return count;
      },
      IF: (a) => {
        const parts = splitArgs(a);
        if (parts.length < 3) return '#VALUE!';
        const cond = this._evalExpr(parts[0].trim());
        return cond ? this._evalExpr(parts[1].trim()) : this._evalExpr(parts[2].trim());
      },
      ROUND: (a) => {
        const parts = splitArgs(a);
        const val = this._evalExpr(parts[0].trim());
        const digits = parts.length > 1 ? parseInt(this._evalExpr(parts[1].trim())) : 0;
        return Number(Number(val).toFixed(digits));
      },
      ABS: (a) => Math.abs(Number(this._evalExpr(a.trim()))),
      CONCAT: (a) => splitArgs(a).map((p) => String(this._evalExpr(p.trim()))).join(''),
      UPPER: (a) => String(this._evalExpr(a.trim())).toUpperCase(),
      LOWER: (a) => String(this._evalExpr(a.trim())).toLowerCase(),
      LEN: (a) => String(this._evalExpr(a.trim())).length,
      NOW: () => new Date().toISOString(),
      TODAY: () => new Date().toISOString().split('T')[0],
      VLOOKUP: (a) => {
        const parts = splitArgs(a);
        if (parts.length < 3) return '#VALUE!';
        const searchKey = this._evalExpr(parts[0].trim());
        const rangeStr = parts[1].trim().toUpperCase();
        const colIndex = parseInt(this._evalExpr(parts[2].trim()));
        const rm = rangeStr.match(/^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/);
        if (!rm) return '#REF!';
        const colStartIdx = colLetterToIndex(rm[1]);
        const rowStart = parseInt(rm[2]);
        const rowEnd = parseInt(rm[4]);
        const firstColLetter = colIndexToLetter(colStartIdx);
        const targetColLetter = colIndexToLetter(colStartIdx + colIndex - 1);
        for (let r = rowStart; r <= rowEnd; r++) {
          const val = this.getCellValue(firstColLetter, r);
          if (String(val).toLowerCase() === String(searchKey).toLowerCase() || Number(val) === Number(searchKey)) {
            return this.getCellValue(targetColLetter, r);
          }
        }
        return '#N/A';
      },
    };

    const handler = funcs[name];
    if (!handler) return `#NAME? (${name})`;
    return handler(argsStr);
  }

  _collectNumeric(argsStr) {
    const values = [];
    for (const arg of splitArgs(argsStr)) {
      const t = arg.trim().toUpperCase();
      const rm = t.match(/^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/);
      if (rm) {
        const rangeVals = this.resolveRange(rm[1], +rm[2], rm[3], +rm[4]);
        for (const v of rangeVals) {
          if (typeof v === 'number') values.push(v);
        }
      } else {
        const cm = t.match(/^([A-Z]{1,3})(\d+)$/);
        if (cm) {
          const v = this.getCellValue(cm[1], +cm[2]);
          if (typeof v === 'number') values.push(v);
        } else {
          const num = Number(arg.trim());
          if (!isNaN(num)) values.push(num);
        }
      }
    }
    return values;
  }

  _evalArithmetic(expr) {
    let resolved = expr.toUpperCase();

    // Replace ranges with SUM
    resolved = resolved.replace(
      /([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)/g,
      (_, c1, r1, c2, r2) => {
        const vals = this.resolveRange(c1, +r1, c2, +r2);
        const nums = vals.filter((v) => typeof v === 'number');
        return String(nums.reduce((s, v) => s + v, 0));
      }
    );

    // Replace cell refs with values
    resolved = resolved.replace(/([A-Z]{1,3})(\d+)/g, (_, col, row) => {
      const val = this.getCellValue(col, parseInt(row));
      return typeof val === 'number' ? String(val) : '0';
    });

    // Strip everything except numbers and operators
    const safe = resolved.replace(/[^0-9+\-*/().%<>=!& |]/g, '');
    if (!safe.trim()) return 0;

    try {
      // eslint-disable-next-line no-eval
      return Function(`"use strict"; return (${safe})`)();
    } catch {
      return '#CALC!';
    }
  }
}

// ── Convenience exports ──────────────────────────────────────────

export { colLetterToIndex, colIndexToLetter, parseValue };
export default SpreadsheetEngine;
