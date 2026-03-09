import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { dmsService } from '../../../services/dmsService';

const FIELD_GROUPS = [
  {
    label: 'Extracted PDF Metadata',
    options: [
      { value: 'title', label: 'Title' },
      { value: 'author', label: 'Author' },
      { value: 'subject', label: 'Subject' },
      { value: 'creator', label: 'Creator' },
      { value: 'producer', label: 'Producer' },
      { value: 'keywords', label: 'Keywords' },
      { value: 'page_count', label: 'Page Count' },
      { value: 'raw_metadata', label: 'Raw Metadata (JSON)' },
    ],
  },
  {
    label: 'Common Custom Metadata',
    options: [
      { value: 'document_type', label: 'Document Type' },
      { value: 'department', label: 'Department' },
      { value: 'client_name', label: 'Client Name' },
      { value: 'project_name', label: 'Project Name' },
      { value: 'contract_id', label: 'Contract ID' },
      { value: 'invoice_number', label: 'Invoice Number' },
      { value: 'effective_date', label: 'Effective Date' },
      { value: 'expiration_date', label: 'Expiration Date' },
      { value: 'status', label: 'Status' },
      { value: 'tags', label: 'Tags (array)' },
    ],
  },
  {
    label: 'Document Model Metadata',
    options: [
      { value: 'version', label: 'Version' },
      { value: 'category', label: 'Category' },
      { value: 'reference_number', label: 'Reference Number' },
      { value: 'governing_law', label: 'Governing Law' },
      { value: 'jurisdiction', label: 'Jurisdiction' },
      { value: 'execution_date', label: 'Execution Date' },
      { value: 'term_length', label: 'Term Length' },
      { value: 'auto_renewal', label: 'Auto Renewal' },
      { value: 'renewal_terms', label: 'Renewal Terms' },
      { value: 'parties', label: 'Parties (array)' },
      { value: 'signatories', label: 'Signatories (array)' },
      { value: 'document_metadata.dates.effective_date', label: 'Dates · Effective Date' },
      { value: 'document_metadata.dates.expiration_date', label: 'Dates · Expiration Date' },
      { value: 'document_metadata.dates.execution_date', label: 'Dates · Execution Date' },
      { value: 'document_metadata.legal.governing_law', label: 'Legal · Governing Law' },
      { value: 'document_metadata.legal.jurisdiction', label: 'Legal · Jurisdiction' },
      { value: 'document_metadata.legal.reference_number', label: 'Legal · Reference Number' },
      { value: 'document_metadata.financial.contract_value', label: 'Financial · Contract Value' },
      { value: 'document_metadata.financial.currency', label: 'Financial · Currency' },
      { value: 'document_metadata.financial.payment_terms', label: 'Financial · Payment Terms' },
      { value: 'document_metadata.terms.term_length', label: 'Terms · Term Length' },
      { value: 'document_metadata.terms.auto_renewal', label: 'Terms · Auto Renewal' },
      { value: 'document_metadata.terms.renewal_terms', label: 'Terms · Renewal Terms' },
      { value: 'document_metadata.terms.notice_period', label: 'Terms · Notice Period' },
      { value: 'document_metadata.provisions.liability_cap', label: 'Provisions · Liability Cap' },
      { value: 'document_metadata.provisions.indemnification', label: 'Provisions · Indemnification' },
      { value: 'document_metadata.provisions.insurance', label: 'Provisions · Insurance' },
      { value: 'document_metadata.provisions.termination', label: 'Provisions · Termination' },
      { value: 'document_metadata.compliance.regulatory_requirements', label: 'Compliance · Regulatory Requirements (array)' },
      { value: 'document_metadata.compliance.certifications', label: 'Compliance · Certifications (array)' },
      { value: 'document_metadata.confidentiality.period', label: 'Confidentiality · Period' },
      { value: 'document_metadata.confidentiality.nda_type', label: 'Confidentiality · NDA Type' },
      { value: 'document_metadata.dispute_resolution.method', label: 'Dispute Resolution · Method' },
      { value: 'document_metadata.dispute_resolution.location', label: 'Dispute Resolution · Location' },
      { value: 'document_metadata.classification.category', label: 'Classification · Category' },
      { value: 'document_metadata.classification.status', label: 'Classification · Status' },
      { value: 'document_metadata.classification.tags', label: 'Classification · Tags (array)' },
      { value: 'custom_metadata', label: 'Custom Metadata (JSON)' },
    ],
  },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'analyzed', label: 'Analyzed' },
  { value: 'approved', label: 'Approved' },
  { value: 'finalized', label: 'Finalized' },
];

const CATEGORY_OPTIONS = [
  { value: 'contract', label: 'Contract/Agreement' },
  { value: 'policy', label: 'Policy Document' },
  { value: 'regulation', label: 'Regulation/Compliance' },
  { value: 'legal_brief', label: 'Legal Brief' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'nda', label: 'Non-Disclosure Agreement' },
  { value: 'license', label: 'License Agreement' },
  { value: 'other', label: 'Other' },
];

const ARRAY_FIELDS = new Set([
  'tags',
  'parties',
  'signatories',
  'document_metadata.compliance.regulatory_requirements',
  'document_metadata.compliance.certifications',
  'document_metadata.classification.tags',
]);

const JSON_FIELDS = new Set(['raw_metadata', 'custom_metadata']);

const DmsSearchPanel = ({ results, onResults, onSelect }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const handleSelect = (doc) => {
    if (doc?.id) {
      navigate(`/dms/documents/${doc.id}`);
    }
    onSelect?.(doc);
  };
  const [filters, setFilters] = useState([
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      field: 'title',
      operator: 'equals',
      value: '',
    },
  ]);
  const [includeText, setIncludeText] = useState(false);
  const [status, setStatus] = useState({ loading: false, error: null });
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  const fieldOptions = useMemo(
    () => FIELD_GROUPS.flatMap((group) => group.options.map((option) => option.value)),
    []
  );

  const updateFilter = (id, updates) => {
    setFilters((prev) => prev.map((filter) => (filter.id === id ? { ...filter, ...updates } : filter)));
  };

  const addFilter = () => {
    setFilters((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        field: fieldOptions[0] || 'title',
        operator: 'equals',
        value: '',
      },
    ]);
  };

  const removeFilter = (id) => {
    setFilters((prev) => (prev.length > 1 ? prev.filter((filter) => filter.id !== id) : prev));
  };

  const setNestedValue = (target, path, value) => {
    if (!path) return;
    const parts = path.split('.');
    let pointer = target;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        pointer[part] = value;
      } else {
        pointer[part] = pointer[part] || {};
        pointer = pointer[part];
      }
    });
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    setHasSearched(true);
    setCurrentPage(1);
    const filtersPayload = {};
    for (const filter of filters) {
      if (!filter.field || !filter.value?.toString().trim()) {
        continue;
      }

      let normalizedValue = filter.value;

      if (JSON_FIELDS.has(filter.field)) {
        try {
          normalizedValue = JSON.parse(filter.value);
        } catch (error) {
          setStatus({ loading: false, error: 'JSON fields must contain valid JSON.' });
          return;
        }
      } else if (ARRAY_FIELDS.has(filter.field)) {
        normalizedValue = filter.value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (filter.field === 'page_count') {
        normalizedValue = Number(filter.value);
        if (Number.isNaN(normalizedValue)) {
          setStatus({ loading: false, error: 'Page count must be a number.' });
          return;
        }
      }

      setNestedValue(filtersPayload, filter.field, normalizedValue);
    }

    setStatus({ loading: true, error: null });
    try {
      const data = await dmsService.searchDocuments({
        query,
        metadataFilters: filtersPayload,
        includeText,
      });
      if (onResults) onResults(data || []);
      setStatus({ loading: false, error: null });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Search failed.',
      });
    }
  };

  const totalResults = results?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const pagedResults = results?.slice((currentPage - 1) * pageSize, currentPage * pageSize) || [];

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <form className="space-y-3" onSubmit={handleSearch}>
        <div>
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-blue-600" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>

        <div>
          <div className="space-y-2">
            {filters.map((filter) => {
              const isStatus = filter.field === 'status' || filter.field === 'document_metadata.classification.status';
              const isCategory = filter.field === 'category' || filter.field === 'document_metadata.classification.category';
              const isArray = ARRAY_FIELDS.has(filter.field);
              const isJson = JSON_FIELDS.has(filter.field);

              return (
                <div
                  key={filter.id}
                  className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 sm:grid-cols-[1.4fr_0.8fr_1.4fr_auto] sm:items-center"
                >
                  <select
                    value={filter.field}
                    onChange={(event) => updateFilter(filter.id, { field: event.target.value, value: '' })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {FIELD_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  <select
                    value={filter.operator}
                    onChange={(event) => updateFilter(filter.id, { operator: event.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="equals">Equals</option>
                    <option value="contains">Contains</option>
                  </select>

                  {isStatus || isCategory ? (
                    <select
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">Select…</option>
                      {(isStatus ? STATUS_OPTIONS : CATEGORY_OPTIONS).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : isJson ? (
                    <textarea
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                      rows={2}
                      placeholder='{"key": "value"}'
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-mono focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  ) : (
                    <input
                      type="text"
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                      placeholder={isArray ? 'comma, separated, values' : 'value'}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => removeFilter(filter.id)}
                    className="text-xs font-semibold text-gray-400 transition hover:text-red-500"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {status.error && <p className="text-sm text-red-600">{status.error}</p>}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={addFilter}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-600"
          >
            Add filter
          </button>
          <button
            type="submit"
            disabled={status.loading}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {status.loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {hasSearched && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span className="font-semibold text-gray-700">Results</span>
            <span>{totalResults ? `${totalResults} found` : 'No results'}</span>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-gray-200">
            {pagedResults.length ? (
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Title</th>
                    <th className="px-3 py-2 font-semibold">Author</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedResults.map((doc) => (
                    <tr key={doc.id} className="border-t border-gray-200 hover:bg-blue-50">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleSelect(doc)}
                          className="text-left font-semibold text-gray-900"
                        >
                          {doc.title || doc.original_filename}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{doc.metadata?.author || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{doc.metadata?.document_type || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{doc.metadata?.status || '—'}</td>
                      <td className="px-3 py-2 text-gray-400">{doc.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-3 py-4 text-xs text-gray-500">
                No results yet. Run a search to see documents.
              </div>
            )}
          </div>
          {totalResults > pageSize && (
            <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="rounded px-2 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="rounded px-2 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

    </section>
  );
};

export default DmsSearchPanel;
