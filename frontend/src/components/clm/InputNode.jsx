import React from 'react';
import { Trash2, Search, FileInput, Mail, Globe, Table2, Link2, HardDrive, Cloud, CloudCog, Server, Terminal, Upload, Bell, MessageSquare, Users } from 'lucide-react';
import NodeProgressBar from './NodeProgressBar';

/**
 * Input Node — unified entry point for documents.
 * source_type controls how documents arrive:
 *   upload         — manual file upload (default)
 *   email_inbox    — fetch from IMAP mailbox
 *   webhook        — external POST / integration webhook
 *   gmail          — Gmail integration (notifications)
 *   slack          — Slack integration (notifications)
 *   teams          — MS Teams integration (notifications)
 * Modern minimal blue theme.
 */
export default function InputNode({ node, isSelected, onSelect, onDragStart, onConnectStart, onConnectEnd, onDelete, processingStatus, onDoubleClick }) {
  const config = node.config || {};
  const sourceType = config.source_type || 'upload';
  const lastResult = node.last_result || {};

  const sourceLabels = {
    upload:       { icon: Upload, label: 'Upload', desc: 'Manual upload', color: 'blue' },
    email_inbox:  { icon: Mail, label: 'Email', desc: config.email_user || 'IMAP inbox', color: 'blue' },
    webhook:      { icon: Link2, label: 'Webhook',
      desc: config.integration_plugin ? 'Integration webhook' : 'API ingest', color: 'blue' },
    gmail:        { icon: Mail, label: 'Gmail', desc: 'Notifications', color: 'red' },
    slack:        { icon: MessageSquare, label: 'Slack', desc: 'Notifications', color: 'purple' },
    teams:        { icon: Users, label: 'Teams', desc: 'Notifications', color: 'blue' },
    google_drive: { icon: HardDrive, label: 'Google Drive', desc: config.google_folder_id
      ? `${config.google_access === 'private' ? '🔒' : ''} ${config.google_folder_id.length > 20 ? 'Folder linked' : config.google_folder_id.slice(0,12) + '…'}`
      : 'Connect folder', color: 'blue' },
    dropbox:      { icon: Cloud, label: 'Dropbox', desc: config.dropbox_folder_path || 'Dropbox folder', color: 'blue' },
    onedrive:     { icon: CloudCog, label: 'OneDrive', desc: config.onedrive_folder_path || 'SharePoint', color: 'blue' },
    s3:           { icon: Server, label: 'S3', desc: config.s3_bucket ? `${config.s3_bucket}` : 'AWS bucket', color: 'blue' },
    ftp:          { icon: Terminal, label: config.ftp_protocol === 'sftp' ? 'SFTP' : 'FTP', desc: config.ftp_host || 'FTP/SFTP', color: 'blue' },
    url_scrape:   { icon: Globe, label: 'URL', desc: `${(config.urls || []).length} URL(s)`, color: 'blue' },
    table:        { icon: Table2, label: 'Table', desc: config.table_info
      ? `${config.table_info.row_count}×${config.table_info.col_count}`
      : config.google_sheet_url ? 'Google Sheet' : 'Spreadsheet', color: 'emerald' },
  };
  const src = sourceLabels[sourceType] || sourceLabels.upload;
  const SrcIcon = src.icon;
  const isIntegration = ['gmail', 'slack', 'teams'].includes(sourceType) || !!config.integration_plugin;

  /* Color maps for integration sources */
  const colorMap = {
    red:     { bg: 'bg-red-50',    text: 'text-red-600',    ring: 'ring-red-200',    shadow: 'shadow-red-100/60',    border: 'border-red-400' },
    purple:  { bg: 'bg-purple-50', text: 'text-purple-600', ring: 'ring-purple-200', shadow: 'shadow-purple-100/60', border: 'border-purple-400' },
    emerald: { bg: 'bg-emerald-50',text: 'text-emerald-600',ring: 'ring-emerald-200',shadow: 'shadow-emerald-100/60',border: 'border-emerald-400' },
    blue:    { bg: 'bg-blue-50',   text: 'text-blue-600',   ring: 'ring-blue-200',   shadow: 'shadow-blue-100/60',   border: 'border-blue-400' },
  };
  const cm = colorMap[src.color] || colorMap.blue;

  const docCount = lastResult.count ?? null;

  return (
    <div
      className={`absolute select-none group ${isSelected ? 'z-20' : 'z-10'}`}
      style={{ left: node.position_x, top: node.position_y, width: 220 }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      onMouseDown={onDragStart}
    >
      <div
        className={`rounded-2xl border bg-white transition-all duration-200 ${
          isSelected
            ? 'border-blue-400 shadow-lg shadow-blue-100/60 ring-1 ring-blue-200'
            : 'border-gray-200 hover:border-blue-300 shadow-sm hover:shadow-md'
        }`}
      >
        {/* Header */}
        <div className="px-3 py-2 flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${cm.bg}`}>
            <SrcIcon size={14} className={cm.text} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-gray-800 truncate leading-tight">{node.label || 'Input'}</p>
            <p className="text-[10px] text-gray-400 leading-tight">{src.label}</p>
          </div>
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
              title="Inspect"
            ><Search size={11} /></button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
              title="Delete"
            ><Trash2 size={11} /></button>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-3 border-t border-gray-100" />

        {/* Body */}
        <div className="px-3 py-2 space-y-1.5">
          {/* Source description */}
          <p className="text-[10px] text-gray-500 truncate">{src.desc}</p>

          {/* Document type badge removed */}

          {/* Email inbox details */}
          {sourceType === 'email_inbox' && config.email_user && (
            <div className="space-y-1">
              {config.email_folder && config.email_folder !== 'INBOX' && (
                <p className="text-[9px] text-gray-400 truncate">📂 {config.email_folder}</p>
              )}
              {config.email_filter_subject && (
                <p className="text-[9px] text-gray-400 truncate">↳ {config.email_filter_subject}</p>
              )}
              <div className="flex gap-1 flex-wrap">
                {config.include_body_as_document !== false && (
                  <span className="text-[8px] bg-blue-50 text-blue-500 px-1 py-px rounded">body</span>
                )}
                {config.include_attachments !== false && (
                  <span className="text-[8px] bg-blue-50 text-blue-500 px-1 py-px rounded">attach</span>
                )}
                {config.email_refetch_interval > 0 && (
                  <span className="text-[8px] bg-emerald-50 text-emerald-600 px-1 py-px rounded flex items-center gap-0.5" title="Server-side polling active">
                    <Server size={7} />
                    {config.email_refetch_interval < 3600 ? `${config.email_refetch_interval / 60}m` : '1h'}
                  </span>
                )}
                {config.email_last_check_status === 'ok' && (
                  <span className="text-[8px] bg-gray-50 text-gray-400 px-1 py-px rounded">✓</span>
                )}
                {config.email_last_check_status === 'error' && (
                  <span className="text-[8px] bg-red-50 text-red-400 px-1 py-px rounded" title={config.email_last_check_error}>✗</span>
                )}
              </div>
            </div>
          )}

          {/* Cloud source details */}
          {sourceType === 's3' && config.s3_bucket && (
            <p className="text-[9px] text-gray-400 truncate font-mono">{config.s3_bucket}/{config.s3_prefix || ''}</p>
          )}
          {sourceType === 'ftp' && config.ftp_host && (
            <p className="text-[9px] text-gray-400 truncate font-mono">{config.ftp_host}:{config.ftp_port || 21}</p>
          )}
          {sourceType === 'url_scrape' && (config.urls || []).length > 0 && (
            <p className="text-[9px] text-gray-400">{config.urls.length} URL{config.urls.length !== 1 ? 's' : ''} configured</p>
          )}

          {/* Table details */}
          {sourceType === 'table' && config.table_info && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-px rounded">
                  {config.table_info.row_count}r × {config.table_info.col_count}c
                </span>
                {config.table_info.parse_method && (
                  <span className="text-[8px] text-gray-400">{config.table_info.parse_method}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-0.5">
                {(config.table_info.headers || []).slice(0, 3).map(h => (
                  <span key={h} className="text-[8px] bg-gray-50 text-gray-500 px-1 py-px rounded font-mono">{h}</span>
                ))}
                {(config.table_info.headers || []).length > 3 && (
                  <span className="text-[8px] text-gray-400">+{config.table_info.headers.length - 3}</span>
                )}
              </div>
            </div>
          )}
          {sourceType === 'table' && config.google_sheet_url && !config.table_info && (
            <p className="text-[9px] text-emerald-500">Google Sheet linked</p>
          )}

          {(config.file_extensions || []).length > 0 && ['google_drive','dropbox','onedrive','s3','ftp'].includes(sourceType) && (
            <p className="text-[9px] text-gray-400">{config.file_extensions.join(', ')}</p>
          )}

          {/* Integration plugin details */}
          {isIntegration && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[9px] font-medium ${cm.text} ${cm.bg} border border-${src.color}-100 px-1.5 py-0.5 rounded-md`}>
                <Bell size={8} />
                Listening
              </span>
              {config.integration_settings && Object.keys(config.integration_settings).length > 0 && (
                <span className="text-[8px] text-gray-400">configured</span>
              )}
            </div>
          )}

          {/* Document count from last execution */}
          {docCount != null && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <div className="w-1 h-1 rounded-full bg-blue-400" />
              <p className="text-[10px] text-blue-600 font-medium">
                {docCount} doc{docCount !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>

        {/* Processing progress bar */}
        <NodeProgressBar processingStatus={processingStatus} colorClass="from-blue-400 to-blue-600" />
      </div>

      {/* Connection handles */}
      <div
        className="absolute top-1/2 -left-2 w-4 h-4 bg-blue-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-blue-600 hover:scale-125 transition-all"
        title="Connect to this node"
        onMouseUp={(e) => { e.stopPropagation(); onConnectEnd(); }}
      />
      <div
        className="absolute top-1/2 -right-2 w-4 h-4 bg-blue-400 border-2 border-white rounded-full -translate-y-1/2 cursor-pointer hover:bg-blue-600 hover:scale-125 transition-all"
        title="Drag to connect"
        onMouseDown={(e) => { e.stopPropagation(); onConnectStart(); }}
      />
    </div>
  );
}
