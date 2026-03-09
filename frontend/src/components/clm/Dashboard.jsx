import React, { useState, useEffect, useCallback } from 'react';
import { workflowApi } from '@services/clm/clmApi';
import { StatusBadge, ConfidenceBar, Spinner, EmptyState } from '@components/clm/ui/SharedUI';
import notify from '@utils/clm/clmNotify';
import {
  Activity, Database, Cpu, FileText, CheckCircle2,
  XCircle, Clock, AlertTriangle, RefreshCw, Zap,
  BarChart3, Tag, Server,
} from 'lucide-react';

/**
 * Dashboard — Workflow-level overview:
 * - Document summary stats
 * - Extraction status breakdown
 * - Field options (unique field names + values)
 * - AI Model status
 */
export default function Dashboard({ workflowId }) {
  const [summary, setSummary] = useState(null);
  const [fieldOptions, setFieldOptions] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preloading, setPreloading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, foRes, msRes] = await Promise.allSettled([
        workflowApi.documentSummary(workflowId),
        workflowApi.fieldOptions(workflowId),
        workflowApi.modelStatus(),
      ]);
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data);
      if (foRes.status === 'fulfilled') setFieldOptions(foRes.value.data);
      if (msRes.status === 'fulfilled') setModelStatus(msRes.value.data);
    } catch {
      notify.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handlePreload = async () => {
    setPreloading(true);
    try {
      const { data } = await workflowApi.preloadModel();
      setModelStatus(data);
      notify.success('Model loaded successfully');
    } catch {
      notify.error('Failed to load model');
    } finally {
      setPreloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" className="text-indigo-500" />
      </div>
    );
  }

  const sc = summary?.status_counts || {};

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* ── Stats Cards ───────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<FileText size={20} />}
          label="Total Documents"
          value={summary?.total_documents || 0}
          color="indigo"
        />
        <StatCard
          icon={<CheckCircle2 size={20} />}
          label="Extracted"
          value={sc.completed || 0}
          sub={summary?.total_documents ? `${Math.round((sc.completed / summary.total_documents) * 100)}%` : ''}
          color="emerald"
        />
        <StatCard
          icon={<XCircle size={20} />}
          label="Failed"
          value={sc.failed || 0}
          color="red"
        />
        <StatCard
          icon={<Tag size={20} />}
          label="Unique Fields"
          value={fieldOptions?.total_fields || 0}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Document Extraction Overview ─────────────── */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-indigo-500" />
            Document Extraction Overview
          </h4>
          {(!summary?.documents || summary.documents.length === 0) ? (
            <EmptyState icon="📊" title="No data yet" description="Upload documents to see extraction stats" />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {summary.documents.map((doc) => (
                <div key={doc.document_id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50">
                  <FileText size={14} className={doc.file_type === 'pdf' ? 'text-red-400' : 'text-blue-400'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{doc.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                      <span>{doc.global_field_count}g + {doc.workflow_field_count}w fields</span>
                      <span>·</span>
                      <span>{doc.text_source}</span>
                      {doc.direct_text_length > 0 && <span>· {doc.direct_text_length.toLocaleString()} chars</span>}
                    </div>
                  </div>
                  <div className="w-20">
                    <ConfidenceBar value={doc.overall_confidence} />
                  </div>
                  <StatusBadge status={doc.extraction_status} size="xs" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── AI Model Status ─────────────────────────── */}
        <div className="bg-white rounded-xl border p-5">
          <h4 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Server size={16} className="text-purple-500" />
            AI Model Status
          </h4>
          {modelStatus ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Status</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  modelStatus.loaded ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {modelStatus.loaded ? '● Loaded' : '○ Not Loaded'}
                </span>
              </div>
              {modelStatus.model_name && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Model</span>
                  <span className="text-xs font-mono text-gray-700">{modelStatus.model_name}</span>
                </div>
              )}
              {modelStatus.device && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Device</span>
                  <span className="text-xs font-medium text-gray-700 uppercase">{modelStatus.device}</span>
                </div>
              )}
              {modelStatus.inference_count != null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Inferences</span>
                  <span className="text-xs font-medium text-gray-700">{modelStatus.inference_count}</span>
                </div>
              )}
              <button
                onClick={handlePreload}
                disabled={preloading}
                className="w-full mt-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50"
              >
                {preloading ? <Spinner size="sm" className="text-purple-500" /> : <Zap size={14} />}
                {preloading ? 'Loading…' : modelStatus.loaded ? 'Force Reload' : 'Load Model'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Could not fetch model status</p>
          )}

          {/* Field Options Summary */}
          <hr className="my-4" />
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Database size={16} className="text-indigo-500" />
            Field Index
          </h4>
          {fieldOptions?.field_names?.length > 0 ? (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {fieldOptions.field_names.map((fn) => {
                const vals = fieldOptions.field_values?.[fn] || [];
                return (
                  <div key={fn} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">{fn.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-gray-400">{vals.length} value{vals.length !== 1 ? 's' : ''}</span>
                    </div>
                    {vals.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {vals.slice(0, 5).map((v, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded text-[10px]">{v}</span>
                        ))}
                        {vals.length > 5 && <span className="text-[10px] text-gray-300">+{vals.length - 5} more</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No fields extracted yet</p>
          )}
        </div>
      </div>

      {/* ── Global Fields Reference ───────────────────── */}
      {fieldOptions?.global_fields?.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Activity size={16} className="text-blue-500" />
            Standard CLM Fields (auto-extracted for every document)
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {fieldOptions.global_fields.map((fn) => (
              <span key={fn} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">
                {fn.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Stat Card ───────────────────────────────────────────────────────── */
function StatCard({ icon, label, value, sub, color }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className={`p-2 rounded-lg ${colors[color]}`}>{icon}</span>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
