import { useState, useRef, useEffect } from 'react';
import {
  Search, SlidersHorizontal, X, ChevronDown, Calendar, Database, Plus,
} from 'lucide-react';

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This year', days: 365 },
];

const isoDate = (d) => d.toISOString().split('T')[0];

const dateAfterPreset = (days) => {
  if (days === 0) return isoDate(new Date());
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
};

/* ─── Reusable pill-select ─── */
const FilterDropdown = ({ label, value, options, onChange, placeholder = 'All' }) => (
  <div className="relative group">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`appearance-none text-xs font-medium pl-3 pr-7 py-1.5 rounded-lg border cursor-pointer transition-all
        ${value
          ? 'bg-blue-50 border-blue-300 text-blue-700'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
    >
      <option value="">{placeholder ? `${label}: ${placeholder}` : label}</option>
      {options.map((opt) => (
        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
  </div>
);

/* ─── Combobox-like input with suggestions ─── */
const SuggestInput = ({ value, onChange, suggestions = [], placeholder, className = '' }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const wrapRef = useRef(null);

  useEffect(() => { setSearch(value || ''); }, [value]);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = suggestions.filter((s) =>
    s.toLowerCase().includes((search || '').toLowerCase())
  ).slice(0, 15);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-transparent bg-white"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { onChange(s); setSearch(s); setOpen(false); }}
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ─── Metadata filter row ─── */
const MetadataFilterRow = ({ filter, index, metadataKeys, onUpdate, onRemove }) => {
  const selectedKeyObj = metadataKeys.find((mk) => mk.key === filter.key);
  const keySuggestions = metadataKeys.map((mk) => mk.key);
  const valueSuggestions = selectedKeyObj?.sample_values || [];

  return (
    <div className="flex items-center gap-2">
      <SuggestInput
        value={filter.key}
        onChange={(v) => onUpdate(index, { ...filter, key: v })}
        suggestions={keySuggestions}
        placeholder="Key…"
        className="w-40"
      />
      <span className="text-gray-400 text-xs">=</span>
      <SuggestInput
        value={filter.value}
        onChange={(v) => onUpdate(index, { ...filter, value: v })}
        suggestions={valueSuggestions}
        placeholder="Value…"
        className="flex-1 min-w-[120px]"
      />
      <button
        onClick={() => onRemove(index)}
        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};

const DmsFilterBar = ({
  filters, onFilterChange, filterOptions, totalCount,
  metadataKeys = [], metadataFilters = [], onMetadataFiltersChange,
}) => {
  const [showDatePanel, setShowDatePanel] = useState(false);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [dateField, setDateField] = useState('created');

  const set = (key, val) => onFilterChange({ ...filters, [key]: val });
  const clear = (key) => {
    const next = { ...filters };
    delete next[key];
    if (key.endsWith('_after')) delete next[key.replace('_after', '_before')];
    if (key.endsWith('_before')) delete next[key.replace('_before', '_after')];
    onFilterChange(next);
  };

  const activeCount = Object.entries(filters).filter(([k, v]) => v && k !== 'q' && k !== 'sort_by' && k !== 'sort_dir').length
    + metadataFilters.filter((mf) => mf.key && mf.value).length;

  const applyDatePreset = (days) => {
    const afterKey = `${dateField}_after`;
    const beforeKey = `${dateField}_before`;
    onFilterChange({
      ...filters,
      [afterKey]: dateAfterPreset(days),
      [beforeKey]: isoDate(new Date()),
    });
    setShowDatePanel(false);
  };

  const applyCustomRange = (after, before) => {
    onFilterChange({
      ...filters,
      [`${dateField}_after`]: after,
      [`${dateField}_before`]: before,
    });
  };

  const activeDateFilters = Object.keys(filters).filter(
    (k) => (k.endsWith('_after') || k.endsWith('_before')) && filters[k]
  );

  // ── Metadata filter helpers ──
  const addMetaFilter = () => {
    onMetadataFiltersChange?.([...metadataFilters, { key: '', value: '' }]);
    setShowMetadataPanel(true);
  };
  const updateMetaFilter = (idx, updated) => {
    const next = [...metadataFilters];
    next[idx] = updated;
    onMetadataFiltersChange?.(next);
  };
  const removeMetaFilter = (idx) => {
    const next = metadataFilters.filter((_, i) => i !== idx);
    onMetadataFiltersChange?.(next);
  };
  const clearAllMetaFilters = () => {
    onMetadataFiltersChange?.([]);
    setShowMetadataPanel(false);
  };

  const activeMetaCount = metadataFilters.filter((mf) => mf.key && mf.value).length;

  return (
    <div className="space-y-2">
      {/* Row 1: search + quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filters.q || ''}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Search documents…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          />
          {filters.q && (
            <button onClick={() => set('q', '')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Dropdown filters */}
        {filterOptions?.statuses?.length > 0 && (
          <FilterDropdown label="Status" value={filters.status || ''} options={filterOptions.statuses} onChange={(v) => set('status', v)} />
        )}
        {filterOptions?.categories?.length > 0 && (
          <FilterDropdown label="Category" value={filters.category || ''} options={filterOptions.categories} onChange={(v) => set('category', v)} />
        )}
        {filterOptions?.document_types?.length > 0 && (
          <FilterDropdown label="Type" value={filters.document_type || ''} options={filterOptions.document_types} onChange={(v) => set('document_type', v)} />
        )}
        {filterOptions?.authors?.length > 0 && (
          <FilterDropdown label="Author" value={filters.author || ''} options={filterOptions.authors} onChange={(v) => set('author', v)} />
        )}
        {filterOptions?.creators?.length > 0 && (
          <FilterDropdown
            label="Uploaded by"
            value={filters.created_by || ''}
            options={filterOptions.creators.map((c) => ({ value: String(c.id), label: c.label }))}
            onChange={(v) => set('created_by', v)}
          />
        )}

        {/* Date filter toggle */}
        <button
          onClick={() => { setShowDatePanel(!showDatePanel); setShowMetadataPanel(false); }}
          className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all
            ${showDatePanel || activeDateFilters.length
              ? 'bg-purple-50 border-purple-300 text-purple-700'
              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
        >
          <Calendar size={12} />
          Date
          {activeDateFilters.length > 0 && (
            <span className="ml-1 px-1 py-0.5 text-[10px] bg-purple-200 text-purple-800 rounded">
              {activeDateFilters.length / 2}
            </span>
          )}
        </button>

        {/* Metadata filter toggle */}
        <button
          onClick={() => { setShowMetadataPanel(!showMetadataPanel); setShowDatePanel(false); }}
          className={`flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all
            ${showMetadataPanel || activeMetaCount
              ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
        >
          <Database size={12} />
          Metadata
          {activeMetaCount > 0 && (
            <span className="ml-1 px-1 py-0.5 text-[10px] bg-emerald-200 text-emerald-800 rounded">
              {activeMetaCount}
            </span>
          )}
        </button>

        {/* Sort */}
        <div className="flex items-center gap-1 ml-auto">
          <SlidersHorizontal size={12} className="text-gray-400" />
          <select
            value={filters.sort_by || 'created_at'}
            onChange={(e) => set('sort_by', e.target.value)}
            className="text-xs bg-transparent border-0 text-gray-600 font-medium cursor-pointer focus:ring-0 pr-5"
          >
            {(filterOptions?.sort_options || [
              { value: 'created_at', label: 'Date Created' },
              { value: 'updated_at', label: 'Date Modified' },
              { value: 'title', label: 'Title' },
            ]).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => set('sort_dir', filters.sort_dir === 'asc' ? 'desc' : 'asc')}
            className="text-xs text-gray-400 hover:text-gray-600 px-1"
            title={filters.sort_dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {filters.sort_dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Active filter badges */}
      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-gray-400">Filters:</span>
          {filters.status && (
            <Badge label={`Status: ${filters.status}`} onClear={() => clear('status')} />
          )}
          {filters.category && (
            <Badge label={`Category: ${filters.category}`} onClear={() => clear('category')} />
          )}
          {filters.document_type && (
            <Badge label={`Type: ${filters.document_type}`} onClear={() => clear('document_type')} />
          )}
          {filters.author && (
            <Badge label={`Author: ${filters.author}`} onClear={() => clear('author')} />
          )}
          {filters.created_by && (
            <Badge label={`Uploaded by: ${filterOptions?.creators?.find(c => String(c.id) === filters.created_by)?.label || filters.created_by}`} onClear={() => clear('created_by')} />
          )}
          {activeDateFilters.map((k) => (
            <Badge key={k} label={`${k.replace(/_/g, ' ')}: ${filters[k]}`} onClear={() => clear(k)} />
          ))}
          {metadataFilters.filter(mf => mf.key && mf.value).map((mf, i) => (
            <Badge
              key={`meta-${i}`}
              label={`${mf.key} = ${mf.value}`}
              color="emerald"
              onClear={() => removeMetaFilter(metadataFilters.indexOf(mf))}
            />
          ))}
          <button
            onClick={() => {
              onFilterChange({ q: filters.q || '', sort_by: filters.sort_by || 'created_at', sort_dir: filters.sort_dir || 'desc' });
              clearAllMetaFilters();
            }}
            className="text-[11px] text-red-500 hover:text-red-700 font-medium ml-1"
          >
            Clear all
          </button>
          {totalCount !== undefined && (
            <span className="text-[11px] text-gray-400 ml-auto">{totalCount} result{totalCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Date picker panel */}
      {showDatePanel && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-500 font-medium">Date field:</span>
            {['created', 'uploaded', 'updated', 'effective', 'expiration', 'signed'].map((f) => (
              <button
                key={f}
                onClick={() => setDateField(f)}
                className={`text-[11px] px-2 py-0.5 rounded-full transition-all capitalize
                  ${dateField === f ? 'bg-purple-100 text-purple-700 font-semibold' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.days}
                onClick={() => applyDatePreset(p.days)}
                className="text-xs px-3 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 hover:border-purple-300 hover:bg-purple-50 transition-all"
              >
                {p.label}
              </button>
            ))}
            <div className="flex items-center gap-1 text-xs">
              <input
                type="date"
                value={filters[`${dateField}_after`] || ''}
                onChange={(e) => applyCustomRange(e.target.value, filters[`${dateField}_before`] || '')}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={filters[`${dateField}_before`] || ''}
                onChange={(e) => applyCustomRange(filters[`${dateField}_after`] || '', e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Metadata filter builder panel */}
      {showMetadataPanel && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Database size={13} className="text-emerald-600" />
              <span className="text-xs text-gray-700 font-semibold">Metadata Filters</span>
              <span className="text-[10px] text-gray-400">Filter by document metadata key-value pairs</span>
            </div>
            <div className="flex items-center gap-2">
              {metadataFilters.length > 0 && (
                <button
                  onClick={clearAllMetaFilters}
                  className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                >
                  Clear all
                </button>
              )}
              <button
                onClick={() => setShowMetadataPanel(false)}
                className="text-gray-300 hover:text-gray-500"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Existing metadata filter rows */}
          <div className="space-y-2">
            {metadataFilters.map((mf, idx) => (
              <MetadataFilterRow
                key={idx}
                filter={mf}
                index={idx}
                metadataKeys={metadataKeys}
                onUpdate={updateMetaFilter}
                onRemove={removeMetaFilter}
              />
            ))}
          </div>

          {/* Add filter button */}
          <button
            onClick={addMetaFilter}
            className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
          >
            <Plus size={13} />
            Add metadata filter
          </button>

          {/* Quick key pills when no filters yet */}
          {metadataFilters.length === 0 && metadataKeys.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[10px] text-gray-400">Quick add:</span>
              {metadataKeys.slice(0, 12).map((mk) => (
                <button
                  key={mk.key}
                  onClick={() => onMetadataFiltersChange?.([...metadataFilters, { key: mk.key, value: '' }])}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all"
                >
                  {mk.key}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── tiny badge ── */
const Badge = ({ label, onClear, color = 'gray' }) => {
  const colors = {
    gray: 'bg-gray-100 text-gray-600',
    emerald: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${colors[color] || colors.gray}`}>
      {label}
      <button onClick={onClear} className="hover:text-red-500 transition-colors"><X size={10} /></button>
    </span>
  );
};

export default DmsFilterBar;
