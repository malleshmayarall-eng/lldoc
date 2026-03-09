/**
 * AIStatusBadge — Lightweight sidebar indicator for AI service status.
 *
 * Shows "N/M AI services active" with a custom-config dot.
 * Also shows inference engine health (stale count).
 * Uses the lightweight /config/status/ endpoint.
 *
 * Props:
 *   documentId  — UUID of the document
 *   onClick     — (optional) callback when badge is clicked
 *   className   — (optional) additional CSS classes
 *   inferenceStats — (optional) { totalStale, totalComponents, hasDocumentSummary } from useDocumentInference
 */

import React, { useEffect, useState } from 'react';
import { Brain, Network } from 'lucide-react';
import aiConfigService from '../services/aiConfigService';

const AIStatusBadge = ({ documentId, onClick, className = '', inferenceStats }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;

    aiConfigService
      .getServiceStatus(documentId)
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (!status) return null;

  const services = status.services || {};
  const enabledCount = Object.values(services).filter((s) => s.enabled).length;
  const totalCount = Object.keys(services).length;
  const allEnabled = enabledCount === totalCount;

  const hasInference = inferenceStats?.hasDocumentSummary;
  const staleCount = inferenceStats?.totalStale || 0;

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
          allEnabled
            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
            : 'text-amber-700 bg-amber-50 hover:bg-amber-100'
        }`}
        title={`${enabledCount} of ${totalCount} AI services active${
          status.has_custom_config ? ' (custom config)' : ''
        }`}
      >
        <Brain className="h-3.5 w-3.5" />
        <span className="font-medium">
          {enabledCount}/{totalCount}
        </span>
        {status.has_custom_config && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-blue-500"
            title="Custom configuration"
          />
        )}
      </button>
      {hasInference && (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium ${
            staleCount > 0
              ? 'text-amber-700 bg-amber-50'
              : 'text-indigo-700 bg-indigo-50'
          }`}
          title={`Inference: ${staleCount} stale component${staleCount !== 1 ? 's' : ''}`}
        >
          <Network className="h-3 w-3" />
          {staleCount > 0 ? `${staleCount}⚡` : '✓'}
        </span>
      )}
    </div>
  );
};

export default AIStatusBadge;
