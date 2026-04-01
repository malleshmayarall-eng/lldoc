/**
 * PublicSheetForm — public form page for sheet sharing
 *
 * When a sheet is shared with a public link, this component renders
 * a clean form based on the sheet's column definitions. Anyone with
 * the link can fill out the form, and each submission becomes a new
 * row in the sheet. The collected data can then be processed by a
 * CLM workflow.
 *
 * Route: /sheets/form/:token
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle, AlertCircle, Loader2, Send,
  FileSpreadsheet, ClipboardList, Calculator,
} from 'lucide-react';
import sheetsService from '../../services/sheetsService';

export default function PublicSheetForm() {
  const { token } = useParams();

  const [formSchema, setFormSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [computedOutputs, setComputedOutputs] = useState({});

  // Fetch form schema
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    sheetsService.getPublicForm(token)
      .then(({ data }) => {
        setFormSchema(data);
        // Initialize form values
        const init = {};
        (data.columns || []).forEach((col) => {
          init[col.key] = '';
        });
        setFormValues(init);
      })
      .catch((e) => {
        setError(e.response?.data?.error || 'This form is not available.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleChange = (colKey, value) => {
    setFormValues((prev) => ({ ...prev, [colKey]: value }));
    // Clear field error on edit
    if (fieldErrors[colKey]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[colKey];
        return next;
      });
    }
  };

  /**
   * Client-side type validation — mirrors the backend rules.
   * Returns an errors object { col_key: message }.
   */
  const validateFields = (columns, values) => {
    const errs = {};
    for (const col of columns) {
      const v = (values[col.key] || '').trim();
      if (!v) continue; // blank is OK (server accepts blanks)

      const t = col.type || 'text';
      if (t === 'number' || t === 'currency') {
        const cleaned = v.replace(/[,$€£]/g, '').trim();
        if (isNaN(Number(cleaned))) {
          errs[col.key] = `Please enter a valid number`;
        }
      } else if (t === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) && !/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(v)) {
          errs[col.key] = `Please enter a valid date (YYYY-MM-DD)`;
        }
      } else if (t === 'boolean') {
        if (!['true', 'false', '1', '0', 'yes', 'no'].includes(v.toLowerCase())) {
          errs[col.key] = `Please select Yes or No`;
        }
      }
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token || submitting) return;

    const columns = formSchema?.columns || [];

    // Basic validation — at least one field filled
    const hasValue = Object.values(formValues).some((v) => (v || '').trim());
    if (!hasValue) {
      setSubmitError('Please fill in at least one field.');
      return;
    }

    // Client-side type validation
    const clientErrors = validateFields(columns, formValues);
    if (Object.keys(clientErrors).length) {
      setFieldErrors(clientErrors);
      setSubmitError('Please fix the highlighted fields.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const response = await sheetsService.submitPublicForm(token, {
        data: formValues,
      });
      // Capture computed formula outputs from response
      if (response.data?.computed_outputs) {
        setComputedOutputs(response.data.computed_outputs);
      }
      setSubmitted(true);
    } catch (err) {
      const data = err.response?.data;
      if (data?.field_errors) {
        setFieldErrors(data.field_errors);
        setSubmitError('Please fix the highlighted fields.');
      } else {
        setSubmitError(data?.error || 'Submission failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setSubmitError(null);
    setFieldErrors({});
    setComputedOutputs({});
    const init = {};
    (formSchema?.columns || []).forEach((col) => {
      init[col.key] = '';
    });
    setFormValues(init);
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mx-auto" />
          <p className="mt-3 text-sm text-gray-500">Loading form…</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Form Unavailable</h2>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  // ── Success ──
  if (submitted) {
    const hasOutputs = Object.keys(computedOutputs).length > 0;
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-cyan-50 flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Response Submitted!</h2>
          <p className="mt-2 text-sm text-gray-600">Thank you! Your response has been recorded.</p>

          {/* ── Computed Output Values ─── */}
          {hasOutputs && (
            <div className="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden text-left">
              <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-cyan-50 border-b border-gray-100 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-blue-500" />
                <p className="text-xs font-semibold text-blue-700">Computed Results</p>
              </div>
              <div className="divide-y divide-gray-100">
                {Object.entries(computedOutputs).map(([key, output]) => (
                  <div key={key} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-600 font-medium">{output.label}</span>
                    <span className="text-sm font-semibold text-gray-900 bg-blue-50 px-3 py-1 rounded-lg">
                      {output.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleReset}
            className="mt-6 px-5 py-2.5 text-sm font-medium text-cyan-700 bg-cyan-50 hover:bg-cyan-100 rounded-lg transition-colors"
          >
            Submit another response
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──
  const columns = formSchema?.columns || [];
  const outputColumns = formSchema?.output_columns || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-blue-50">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">
                  {formSchema?.label || formSchema?.sheet_title || 'Form'}
                </h1>
                {formSchema?.description && (
                  <p className="text-sm text-white/80 mt-0.5">{formSchema.description}</p>
                )}
              </div>
            </div>
          </div>

          {/* Submission count info */}
          {formSchema?.max_submissions && (
            <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
              {formSchema.submission_count} of {formSchema.max_submissions} responses collected
            </div>
          )}

          {/* Output columns notice */}
          {outputColumns.length > 0 && (
            <div className="px-6 py-3 bg-blue-50/60 border-b border-blue-100 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-500 shrink-0" />
              <p className="text-xs text-blue-600">
                This form has <strong>{outputColumns.length} computed field{outputColumns.length !== 1 ? 's' : ''}</strong> ({outputColumns.map(c => c.label).join(', ')}) that will be calculated automatically after you submit.
              </p>
            </div>
          )}

          {/* Form body */}
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5">
            {columns.map((col) => {
              const hasError = !!fieldErrors[col.key];
              const inputClasses = `w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow ${
                hasError
                  ? 'border-red-400 focus:ring-red-400 bg-red-50/40'
                  : 'border-gray-300 focus:ring-cyan-500 focus:border-transparent'
              }`;

              return (
              <div key={col.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {col.label || col.key}
                  {col.type && col.type !== 'text' && (
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-normal ${
                      hasError ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {col.type}
                    </span>
                  )}
                </label>
                {col.type === 'boolean' ? (
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={col.key}
                        value="true"
                        checked={formValues[col.key] === 'true'}
                        onChange={() => handleChange(col.key, 'true')}
                        className="text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="text-sm text-gray-700">Yes</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={col.key}
                        value="false"
                        checked={formValues[col.key] === 'false'}
                        onChange={() => handleChange(col.key, 'false')}
                        className="text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="text-sm text-gray-700">No</span>
                    </label>
                  </div>
                ) : col.type === 'date' ? (
                  <input
                    type="date"
                    value={formValues[col.key] || ''}
                    onChange={(e) => handleChange(col.key, e.target.value)}
                    className={inputClasses}
                  />
                ) : col.type === 'number' || col.type === 'currency' ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    step={col.type === 'currency' ? '0.01' : 'any'}
                    value={formValues[col.key] || ''}
                    onChange={(e) => handleChange(col.key, e.target.value)}
                    placeholder={col.type === 'currency' ? 'e.g. 1234.56' : `Enter ${(col.label || col.key).toLowerCase()}`}
                    className={inputClasses}
                  />
                ) : col.type === 'select' && col.options ? (
                  <select
                    value={formValues[col.key] || ''}
                    onChange={(e) => handleChange(col.key, e.target.value)}
                    className={`${inputClasses} bg-white`}
                  >
                    <option value="">Select…</option>
                    {(col.options || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={formValues[col.key] || ''}
                    onChange={(e) => handleChange(col.key, e.target.value)}
                    placeholder={`Enter ${(col.label || col.key).toLowerCase()}`}
                    className={inputClasses}
                  />
                )}
                {hasError && (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {fieldErrors[col.key]}
                  </p>
                )}
              </div>
              );
            })}

            {/* ── Output (formula) columns — read-only indicators ── */}
            {outputColumns.length > 0 && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5" />
                  Computed Fields (auto-calculated)
                </p>
                {outputColumns.map((col) => (
                  <div key={col.key}>
                    <label className="block text-sm font-medium text-gray-500 mb-1.5">
                      {col.label || col.key}
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-500 font-normal">
                        formula
                      </span>
                    </label>
                    <div className="w-full border border-gray-200 bg-gray-100 rounded-lg px-3 py-2.5 text-sm text-gray-400 italic">
                      Will be calculated after submission
                    </div>
                  </div>
                ))}
              </div>
            )}

            {submitError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-600">{submitError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by Drafter Sheets
        </p>
      </div>
    </div>
  );
}
