import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarClock } from 'lucide-react';
import { dmsService } from '../../../services/dmsService';
import { ResponsiveContainer, Treemap } from 'recharts';

const ALERT_GROUPS = [
  {
    label: 'Expiry & Validity',
    types: ['expiring', 'expired', 'effective', 'effective_today'],
  },
  {
    label: 'Renewal',
    types: ['auto_renewal_upcoming', 'renewal_decision_required', 'renewed'],
  },
  {
    label: 'Termination',
    types: [
      'terminating',
      'termination_effective_today',
      'terminated',
      'termination_initiated',
      'termination_notice_started',
    ],
  },
  {
    label: 'Archiving & Retention',
    types: ['archived', 'retention_nearing_end', 'eligible_for_deletion', 'deletion_scheduled'],
  },
  {
    label: 'Legal Hold & Compliance',
    types: [
      'legal_hold_applied',
      'legal_hold_released',
      'audit_log_generated',
      'compliance_review_due',
      'verification_retention_limit',
      'missing_mandatory_metadata',
    ],
  },
];

const ALERT_COLORS = {
  expiring: { chip: 'bg-amber-100 text-amber-700', fill: '#fde68a', text: '#92400e' },
  expired: { chip: 'bg-red-100 text-red-700', fill: '#fecaca', text: '#b91c1c' },
  effective: { chip: 'bg-sky-100 text-sky-700', fill: '#e0f2fe', text: '#0369a1' },
  effective_today: { chip: 'bg-cyan-100 text-cyan-700', fill: '#cffafe', text: '#0e7490' },
  auto_renewal_upcoming: { chip: 'bg-indigo-100 text-indigo-700', fill: '#e0e7ff', text: '#4338ca' },
  renewal_decision_required: { chip: 'bg-orange-100 text-orange-700', fill: '#ffedd5', text: '#c2410c' },
  renewed: { chip: 'bg-emerald-100 text-emerald-700', fill: '#d1fae5', text: '#047857' },
  terminating: { chip: 'bg-rose-100 text-rose-700', fill: '#ffe4e6', text: '#be123c' },
  termination_effective_today: { chip: 'bg-pink-100 text-pink-700', fill: '#fce7f3', text: '#be185d' },
  terminated: { chip: 'bg-red-200 text-red-800', fill: '#fecdd3', text: '#9f1239' },
  termination_initiated: { chip: 'bg-fuchsia-100 text-fuchsia-700', fill: '#fae8ff', text: '#a21caf' },
  termination_notice_started: { chip: 'bg-violet-100 text-violet-700', fill: '#ede9fe', text: '#6d28d9' },
  archived: { chip: 'bg-slate-100 text-slate-700', fill: '#e2e8f0', text: '#475569' },
  retention_nearing_end: { chip: 'bg-lime-100 text-lime-700', fill: '#ecfccb', text: '#3f6212' },
  eligible_for_deletion: { chip: 'bg-yellow-100 text-yellow-700', fill: '#fef9c3', text: '#a16207' },
  deletion_scheduled: { chip: 'bg-amber-200 text-amber-800', fill: '#fcd34d', text: '#92400e' },
  legal_hold_applied: { chip: 'bg-purple-100 text-purple-700', fill: '#f3e8ff', text: '#7e22ce' },
  legal_hold_released: { chip: 'bg-purple-200 text-purple-800', fill: '#e9d5ff', text: '#6b21a8' },
  audit_log_generated: { chip: 'bg-teal-100 text-teal-700', fill: '#ccfbf1', text: '#0f766e' },
  compliance_review_due: { chip: 'bg-teal-200 text-teal-800', fill: '#99f6e4', text: '#115e59' },
  verification_retention_limit: { chip: 'bg-cyan-200 text-cyan-800', fill: '#a5f3fc', text: '#0e7490' },
  missing_mandatory_metadata: { chip: 'bg-fuchsia-100 text-fuchsia-700', fill: '#f5d0fe', text: '#a21caf' },
};

const formatTypeLabel = (value) => value.replace(/_/g, ' ');

const TreemapNode = ({ x, y, width, height, depth, name, payload, value, children }) => {
  if (width < 6 || height < 6) return null;
  const safePayload = payload || {};
  const isCategory = depth === 1;
  const isLeaf = depth >= 2 && !children;
  const fill = isLeaf ? safePayload.fill || '#c95959ff' : '#e90a0aff';
  const text = isLeaf ? '#ffffff' : '#374151';
  const label = name || safePayload.name || (isCategory ? 'Category' : 'Alert');
  const count = value ?? safePayload.size ?? 0;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke={isCategory ? '#e5e7eb' : '#ffffff'}
        fillOpacity={isLeaf ? 0.95 : 1}
      />
      {isCategory && width > 40 && height > 16 && (
        <text x={x + 4} y={y + 14} fontSize="11" fill={text}>
          {label}
        </text>
      )}
      {isLeaf && width > 40 && height > 18 && (
        <text x={x + 4} y={y + 14} fontSize="11" fill={text}>
          {label} ({count})
        </text>
      )}
    </g>
  );
};

const DmsAlertsPanel = () => {
  const [warningDays, setWarningDays] = useState(30);
  const [alerts, setAlerts] = useState([]);
  const [titleMap, setTitleMap] = useState({});
  const [status, setStatus] = useState({ loading: false, error: null });
  const [currentPage, setCurrentPage] = useState(1);
  const [activeType, setActiveType] = useState(null);
  const pageSize = 8;

  const groupCounts = useMemo(() => {
    const counts = Object.fromEntries(ALERT_GROUPS.map((group) => [group.label, {}]));
    alerts.forEach((alert) => {
      const match = ALERT_GROUPS.find((group) => group.types.includes(alert.alert_type));
      if (match) {
        counts[match.label][alert.alert_type] = (counts[match.label][alert.alert_type] || 0) + 1;
      }
    });
    return counts;
  }, [alerts]);

  const treemapGroups = useMemo(() => {
    return ALERT_GROUPS.map((group) => {
      const items = group.types
        .map((type) => ({
          type,
          count: groupCounts[group.label]?.[type] || 0,
        }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count);
      const total = items.reduce((sum, item) => sum + item.count, 0);
      return { label: group.label, total, items };
    }).filter((group) => group.total > 0);
  }, [groupCounts]);

  const treemapData = useMemo(() => {
    return treemapGroups.map((group) => ({
      name: group.label,
      children: group.items.map((item) => {
        const color = ALERT_COLORS[item.type] || {
          chip: 'bg-gray-100 text-gray-700',
          fill: '#f3f4f6',
          text: '#374151',
        };
        return {
          name: formatTypeLabel(item.type),
          type: item.type,
          size: item.count,
          fill: color.fill,
          text: color.text,
        };
      }),
    }));
  }, [treemapGroups]);

  const filteredAlerts = activeType
    ? alerts.filter((alert) => alert.alert_type === activeType)
    : alerts;
  const totalResults = filteredAlerts.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const pagedAlerts = filteredAlerts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const loadAlerts = async () => {
    setStatus({ loading: true, error: null });
    try {
      const data = await dmsService.getAlerts({ warningDays });
      const normalized = Array.isArray(data) ? data : [];
      setAlerts(normalized);
      const uniqueIds = Array.from(new Set(normalized.map((alert) => alert.document_id).filter(Boolean)));
      if (uniqueIds.length) {
        const entries = await Promise.all(
          uniqueIds.map(async (docId) => {
            try {
              const doc = await dmsService.getDocument(docId);
              return [docId, doc?.title || doc?.original_filename || docId];
            } catch (error) {
              return [docId, docId];
            }
          })
        );
        setTitleMap(Object.fromEntries(entries));
      } else {
        setTitleMap({});
      }
      setStatus({ loading: false, error: null });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Failed to load alerts.',
      });
    }
  };

  useEffect(() => {
    loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warningDays]);

  useEffect(() => {
    setCurrentPage(1);
  }, [alerts.length, activeType]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900">Alerts</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <CalendarClock className="h-4 w-4" />
          <span>Warning days</span>
          <select
            value={warningDays}
            onChange={(event) => setWarningDays(Number(event.target.value))}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {[1,7, 14, 30, 60, 90].map((days) => (
              <option key={days} value={days}>
                {days}
              </option>
            ))}
          </select>
        </div>
      </div>

      {status.error && <p className="mt-2 text-xs text-red-600">{status.error}</p>}

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="flex h-64 flex-col rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Alert Treemap</p>
          {treemapGroups.length ? (
            <div className="mt-3 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={treemapData}
                  dataKey="size"
                  stroke="#ffffff"
                  isAnimationActive={false}
                  content={<TreemapNode />}
                  onClick={(node) => {
                    if (!node?.type) return;
                    setActiveType((prev) => (prev === node.type ? null : node.type));
                  }}
                />
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-[11px] text-gray-500">
              No alert counts available yet.
            </div>
          )}
        </div>

        <div className="flex h-64 flex-col overflow-hidden rounded-md border border-gray-200">
          {filteredAlerts.length ? (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Document</th>
                  <th className="px-3 py-2 font-semibold">Due date</th>
                  <th className="px-3 py-2 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {pagedAlerts.map((alert, index) => (
                  <tr
                    key={`${alert.document_id}-${index}`}
                    className={`border-t border-gray-200 ${
                      ALERT_COLORS[alert.alert_type]?.chip || 'bg-white'
                    }`}
                  >
                    <td className="px-3 py-2 text-gray-600">
                      {titleMap[alert.document_id] || alert.document_id}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{alert.due_date}</td>
                    <td className="px-3 py-2 text-gray-800">{alert.message}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          ) : (
            <div className="px-3 py-4 text-xs text-gray-500">
              {status.loading ? 'Loading alerts…' : 'No alerts within this window.'}
            </div>
          )}
        </div>
        {totalResults > pageSize && (
          <div className="flex items-center justify-between border-t border-gray-100 px-2 py-2 text-xs text-gray-600">
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
    </section>
  );
};

export default DmsAlertsPanel;
