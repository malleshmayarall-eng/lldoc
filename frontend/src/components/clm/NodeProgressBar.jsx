import React from 'react';

/**
 * NodeProgressBar — shows processing state on workflow nodes.
 *
 * processingStatus:
 *   'processing' → animated indeterminate progress bar
 *   'done'       → brief green flash (auto-fades)
 *   'error'      → brief red flash (auto-fades)
 *   null/undef   → hidden
 *
 * colorClass: tailwind color for the progress bar (defaults to indigo)
 */
export default function NodeProgressBar({ processingStatus, colorClass = 'from-indigo-400 to-indigo-600' }) {
  if (!processingStatus) return null;

  if (processingStatus === 'processing') {
    return (
      <div className="w-full h-1 bg-gray-100 rounded-b-xl overflow-hidden">
        <div
          className={`h-full w-1/3 bg-gradient-to-r ${colorClass} rounded-full animate-progress-slide`}
        />
      </div>
    );
  }

  if (processingStatus === 'done') {
    return (
      <div className="w-full h-1 rounded-b-xl overflow-hidden">
        <div className="h-full w-full bg-gradient-to-r from-emerald-400 to-green-500 rounded-full animate-pulse" />
      </div>
    );
  }

  if (processingStatus === 'error') {
    return (
      <div className="w-full h-1 rounded-b-xl overflow-hidden">
        <div className="h-full w-full bg-gradient-to-r from-red-400 to-red-500 rounded-full animate-pulse" />
      </div>
    );
  }

  return null;
}
