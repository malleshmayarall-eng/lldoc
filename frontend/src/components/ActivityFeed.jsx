/**
 * ActivityFeed Component
 * 
 * Displays access logs with filtering and timeline view
 * Shows who accessed content, when, and what actions they performed
 */

import React, { useState } from 'react';
import { useAccessLogs } from '../hooks/useSharing';
import {
  ACCESS_TYPES,
  ACCESS_TYPE_INFO,
  ANALYTICS_PERIODS
} from '../constants/sharingConstants';

const ActivityFeed = ({
  contentType,
  objectId,
  defaultDays = 30,
  showFilters = true,
  compact = false
}) => {
  const [selectedDays, setSelectedDays] = useState(defaultDays);
  const [selectedAccessType, setSelectedAccessType] = useState(null);

  const { logs, loading, error, loadLogs } = useAccessLogs(
    contentType,
    objectId,
    {
      days: selectedDays,
      accessType: selectedAccessType
    }
  );

  // Format date/time
  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Group logs by date
  const groupLogsByDate = () => {
    const grouped = {};
    
    logs.forEach(log => {
      const date = new Date(log.accessed_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(log);
    });
    
    return grouped;
  };

  const groupedLogs = groupLogsByDate();

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center items-center py-12">
        <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center">
          <i className="fas fa-exclamation-circle text-red-400 mr-3"></i>
          <div>
            <p className="text-sm font-medium text-red-800">Error loading activity</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
            <button
              onClick={loadLogs}
              className="text-sm text-red-600 hover:text-red-800 underline mt-2"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Filters */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          Activity
        </h3>
        <button
          onClick={loadLogs}
          className="text-sm text-gray-500 hover:text-gray-700"
          title="Refresh"
        >
          <i className="fas fa-sync-alt"></i>
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3">
          {/* Time Period Filter */}
          <select
            value={selectedDays}
            onChange={(e) => setSelectedDays(parseInt(e.target.value))}
            className="text-sm border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
          >
            {ANALYTICS_PERIODS.map(period => (
              <option key={period.value} value={period.value}>
                {period.label}
              </option>
            ))}
          </select>

          {/* Access Type Filter */}
          <select
            value={selectedAccessType || ''}
            onChange={(e) => setSelectedAccessType(e.target.value || null)}
            className="text-sm border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All activities</option>
            {Object.values(ACCESS_TYPES).map(type => {
              const info = ACCESS_TYPE_INFO[type];
              return (
                <option key={type} value={type}>
                  {info.label}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Activity Timeline */}
      {logs.length === 0 ? (
        <div className="text-center py-12">
          <i className="fas fa-history text-4xl text-gray-300 mb-4"></i>
          <p className="text-gray-500 text-sm">No activity in this period</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedLogs).map(([date, dateLogs]) => (
            <div key={date}>
              {/* Date Header */}
              <div className="flex items-center mb-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {date}
                </div>
                <div className="flex-1 h-px bg-gray-200 ml-4"></div>
              </div>

              {/* Logs for this date */}
              <div className="space-y-3">
                {dateLogs.map(log => {
                  const accessInfo = ACCESS_TYPE_INFO[log.access_type];
                  
                  return (
                    <div
                      key={log.id}
                      className={`flex items-start space-x-3 ${
                        compact ? 'py-2' : 'p-3'
                      } rounded-lg hover:bg-gray-50 transition-colors ${
                        !log.success ? 'bg-red-50 border border-red-100' : ''
                      }`}
                    >
                      {/* Icon */}
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        log.success
                          ? `bg-${accessInfo.color}-100 text-${accessInfo.color}-600`
                          : 'bg-red-100 text-red-600'
                      }`}>
                        <i className={`fas fa-${log.success ? accessInfo.icon : 'exclamation-triangle'} text-sm`}></i>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            {/* User info */}
                            <p className="text-sm font-medium text-gray-900">
                              {log.user ? (
                                <span>
                                  {log.user.full_name || log.user.username}
                                </span>
                              ) : (
                                <span className="text-gray-500">Anonymous user</span>
                              )}
                              <span className="text-gray-500 font-normal ml-1">
                                {accessInfo.label.toLowerCase()}
                              </span>
                            </p>

                            {/* Timestamp */}
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatDateTime(log.accessed_at)}
                            </p>

                            {/* Error message */}
                            {!log.success && log.error_message && (
                              <p className="text-xs text-red-600 mt-1">
                                <i className="fas fa-exclamation-circle mr-1"></i>
                                {log.error_message}
                              </p>
                            )}

                            {/* Metadata */}
                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                              <div className="mt-2 text-xs text-gray-600">
                                {log.metadata.duration_seconds && (
                                  <span className="mr-3">
                                    <i className="fas fa-clock mr-1"></i>
                                    {log.metadata.duration_seconds}s
                                  </span>
                                )}
                                {log.metadata.sections_viewed && (
                                  <span className="mr-3">
                                    <i className="fas fa-book-open mr-1"></i>
                                    {log.metadata.sections_viewed.length} sections
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* IP Address (hover to see) */}
                          {log.ip_address && (
                            <div 
                              className="text-xs text-gray-400 ml-2"
                              title={`IP: ${log.ip_address}`}
                            >
                              <i className="fas fa-network-wired"></i>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats Summary */}
      {logs.length > 0 && (
        <div className="border-t border-gray-200 pt-4 mt-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{logs.length}</div>
              <div className="text-xs text-gray-500 mt-1">Total activities</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {logs.filter(l => l.success).length}
              </div>
              <div className="text-xs text-gray-500 mt-1">Successful</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {logs.filter(l => !l.success).length}
              </div>
              <div className="text-xs text-gray-500 mt-1">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {new Set(logs.map(l => l.user?.id).filter(Boolean)).size}
              </div>
              <div className="text-xs text-gray-500 mt-1">Unique users</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
