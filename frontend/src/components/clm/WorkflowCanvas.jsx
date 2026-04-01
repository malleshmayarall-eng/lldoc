import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { workflowApi, nodeApi, connectionApi } from '@services/clm/clmApi';
import useUndoRedo from '@hooks/clm/useUndoRedo';
import InputNode from './InputNode';
import RuleNode from './RuleNode';
import ActionNode from './ActionNode';
import OutputNode from './OutputNode';
import ListenerNode from './ListenerNode';
import ValidatorNode from './ValidatorNode';
import AINode from './AINode';
import GateNode from './GateNode';
import DocCreateNode from './DocCreateNode';
import SheetNode from './SheetNode';
import SheetEditorModal from '@components/sheets/SheetEditorModal';
import DocCreateWizard from './DocCreateWizard';
import DocumentManager from './DocumentManager';
import Dashboard from './Dashboard';
import ExecutionResults from './ExecutionResults';
import ProcessingProgressPanel from './ProcessingProgressPanel';
import InputPluginsPanel from './InputPluginsPanel';
import NodeInspector from './NodeInspector';
import WorkflowChat from './WorkflowChat';
import WorkflowSettingsPanel from './WorkflowSettingsPanel';
import notify from '@utils/clm/clmNotify';
import { Spinner } from '@components/clm/ui/SharedUI';
import {
  Play, Upload, LayoutGrid, FileText, BarChart3,
  Zap, Settings, ArrowLeft, RefreshCw, Eye, Activity,
  CheckCircle2, XCircle, ChevronDown, ChevronRight,
  Plus, Trash2, ZoomIn, ZoomOut, Maximize, MessageSquare,
  Sparkles, Undo2, Redo2, Bell,
  Share2, Link as LinkIcon, Copy, ExternalLink, Loader2,
} from 'lucide-react';

/* ── tiny helpers ──────────────────────────────────────────── */
const NODE_W = 220;
const NODE_H_BASE = 80;

/**
 * Perpendicular (right-angle) path from source port to target port.
 * Always exits horizontal-right from source, enters horizontal-left to target.
 * Uses a clean H-V-H pattern with proper gap handling.
 */
function orthoPath(s, t) {
  const GAP = 40; // min horizontal clearance before bending
  if (t.x > s.x + GAP) {
    // Normal left-to-right: horizontal exit → vertical → horizontal enter
    const midX = (s.x + t.x) / 2;
    return `M ${s.x} ${s.y} H ${midX} V ${t.y} H ${t.x}`;
  }
  // Target is behind or very close — route around with extra bends
  const outX = s.x + GAP;
  const midY = s.y < t.y ? Math.max(s.y, t.y) + 60 : Math.min(s.y, t.y) - 60;
  const inX = t.x - GAP;
  return `M ${s.x} ${s.y} H ${outX} V ${midY} H ${inX} V ${t.y} H ${t.x}`;
}

/** Get midpoint of the path for placing the "+" button */
function orthoMidpoint(s, t) {
  const GAP = 40;
  if (t.x > s.x + GAP) {
    const midX = (s.x + t.x) / 2;
    const midY = (s.y + t.y) / 2;
    return { x: midX, y: midY };
  }
  const outX = s.x + GAP;
  const midY = s.y < t.y ? Math.max(s.y, t.y) + 60 : Math.min(s.y, t.y) - 60;
  return { x: (outX + (t.x - GAP)) / 2, y: midY };
}

/** Node type metadata for menus / dialogs */
const NODE_TYPES = [
  { type: 'input',      icon: '📥', label: 'Input',      bg: 'hover:bg-blue-50',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { type: 'rule',       icon: '⚙️', label: 'Rule',       bg: 'hover:bg-amber-50',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { type: 'action',     icon: '⚡', label: 'Action',     bg: 'hover:bg-purple-50',  color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { type: 'validator',  icon: '✅', label: 'Validator',  bg: 'hover:bg-emerald-50', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { type: 'ai',         icon: '🧪', label: 'AI',         bg: 'hover:bg-rose-50',    color: 'bg-rose-50 text-rose-700 border-rose-200' },
  { type: 'and_gate',   icon: '∩',  label: 'AND Gate',  bg: 'hover:bg-orange-50',  color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { type: 'doc_create', icon: '📄', label: 'Doc Create', bg: 'hover:bg-indigo-50',  color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { type: 'sheet',      icon: '📊', label: 'Sheet',      bg: 'hover:bg-cyan-50',    color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { type: 'output',     icon: '📤', label: 'Output',     bg: 'hover:bg-green-50',   color: 'bg-green-50 text-green-700 border-green-200' },
];

/* ================================================================
   WorkflowCanvas — the main editor (production version)
   ================================================================ */
export default function WorkflowCanvas() {
  const { id: workflowId } = useParams();
  const navigate = useNavigate();

  /* ── core state ─────────────────── */
  const [workflow, setWorkflow] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ── interaction state ──────────── */
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [connecting, setConnecting] = useState(null);
  const [connectMouse, setConnectMouse] = useState(null);
  const [hoveredConnection, setHoveredConnection] = useState(null);
  const [midpointMenu, setMidpointMenu] = useState(null); // { connId, x, y }
  const [showNodeConfigDialog, setShowNodeConfigDialog] = useState(null); // { type, insertBetween: {sourceId, targetId, connId} | null, position: {x, y} }

  /* ── panels ──────────────────────── */
  const [tab, setTab] = useState('canvas');
  const [executionResult, setExecutionResult] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [executionState, setExecutionState] = useState('idle');  // server-maintained: idle|compiling|executing|completed|failed
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);    // 0–100 upload %
  const [fieldOptions, setFieldOptions] = useState(null);
  const [actionPlugins, setActionPlugins] = useState([]);
  const [listenerTriggers, setListenerTriggers] = useState([]);
  const [aiModels, setAiModels] = useState([]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  /* ── optimizer state ────────────── */
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);
  const [showOptimizeModal, setShowOptimizeModal] = useState(false);
  const [applyingOptimize, setApplyingOptimize] = useState(false);

  /* ── notification / validation state ── */
  const [pendingValidations, setPendingValidations] = useState(null);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef(null);

  /* ── share / upload links state ─── */
  const [showShareModal, setShowShareModal] = useState(false);
  const [uploadLinks, setUploadLinks] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  // Sheet modal
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [sheetModalId, setSheetModalId] = useState(null);
  const [sheetModalTitle, setSheetModalTitle] = useState('');
  const [sheetModalNodeId, setSheetModalNodeId] = useState(null);  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkPassword, setNewLinkPassword] = useState('');
  const [newLinkRequireLogin, setNewLinkRequireLogin] = useState('none');
  const [copiedLinkId, setCopiedLinkId] = useState(null);

  /* ── execution features ─────────── */
  const [executionHistory, setExecutionHistory] = useState([]);
  const [nodeProcessing, setNodeProcessing] = useState({});   // {nodeId: 'processing'|'done'|'error'}
  const [inspectNodeId, setInspectNodeId] = useState(null);   // node ID for inspector dialog
  const [nodesStatus, setNodesStatus] = useState(null);        // { nodes_changed, pending_execution, already_executed }
  const [isLive, setIsLive] = useState(false);
  const [liveInterval, setLiveInterval] = useState(60);
  const [showResultsModal, setShowResultsModal] = useState(false);  // results dialog

  /* ── zoom & pan ─────────────────── */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const didPan = useRef(false);

  const canvasRef = useRef(null);
  const initialResultLoaded = useRef(false);

  /* ── fetch ──────────────────────── */
  const fetchAll = useCallback(async () => {
    try {
      const { data: wf } = await workflowApi.get(workflowId);
      setWorkflow(wf);
      setNodes(wf.nodes || []);
      setConnections(wf.connections || []);
      setIsLive(!!wf.is_live);
      setLiveInterval(wf.live_interval || 60);
      if (wf.execution_state) setExecutionState(wf.execution_state);
      // If server says executing/compiling but we're not tracking locally, resume polling
      if (['executing', 'compiling'].includes(wf.execution_state) && wf.current_execution_id && !executing) {
        setExecuting(true);
        _resumeServerExecution(wf.current_execution_id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  const fetchFieldOptions = useCallback(async () => {
    try {
      const { data } = await workflowApi.fieldOptions(workflowId);
      setFieldOptions(data);
    } catch {}
  }, [workflowId]);

  const fetchActionPlugins = useCallback(async () => {
    try {
      const { data } = await workflowApi.actionPlugins();
      setActionPlugins(data.plugins || []);
    } catch {}
  }, []);

  const fetchListenerTriggers = useCallback(async () => {
    try {
      const { data } = await workflowApi.listenerTriggers();
      setListenerTriggers(data.triggers || []);
    } catch {}
  }, []);

  const fetchAiModels = useCallback(async () => {
    try {
      const { data } = await workflowApi.aiModels();
      setAiModels(data.models || []);
    } catch {}
  }, []);

  const fetchExecutionHistory = useCallback(async () => {
    try {
      const { data } = await workflowApi.executionHistory(workflowId);
      const list = data.executions || data.results || [];
      setExecutionHistory(list);

      // Auto-load the latest execution result on first mount
      if (!initialResultLoaded.current && list.length > 0) {
        initialResultLoaded.current = true;
        try {
          const { data: detail } = await workflowApi.executionDetail(workflowId, list[0].id);
          if (detail.result_data && Object.keys(detail.result_data).length > 0) {
            setExecutionResult(detail.result_data);
          }
        } catch {}
      }
    } catch {}
  }, [workflowId]);

  const fetchPendingValidations = useCallback(async () => {
    try {
      const { data } = await workflowApi.myValidations({ status: 'pending', workflow_id: workflowId });
      setPendingValidations(data);
    } catch {}
  }, [workflowId]);

  const fetchNodesStatus = useCallback(async () => {
    try {
      const { data } = await workflowApi.nodesStatus(workflowId);
      setNodesStatus(data);
    } catch {}
  }, [workflowId]);

  useEffect(() => { fetchAll(); fetchFieldOptions(); fetchActionPlugins(); fetchListenerTriggers(); fetchAiModels(); fetchExecutionHistory(); fetchPendingValidations(); fetchNodesStatus(); }, [fetchAll, fetchFieldOptions, fetchActionPlugins, fetchListenerTriggers, fetchAiModels, fetchExecutionHistory, fetchPendingValidations, fetchNodesStatus]);

  /* ── Close notification panel on outside click ── */
  useEffect(() => {
    if (!showNotifPanel) return;
    const handleClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifPanel(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showNotifPanel]);

  /* ── Undo / Redo ────────────────── */
  const { pushSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo({
    nodes, connections, setNodes, setConnections, workflowId, fetchAll,
  });

  /* ── Add node (with optional position + insert-between-connections) ───────────────────── */
  const addNode = async (type, { overridePos, insertBetween, configOverrides } = {}) => {
    // Calculate viewport center in canvas coordinates
    const rect = canvasRef.current?.getBoundingClientRect();
    const vw = rect?.width || 800;
    const vh = rect?.height || 600;
    const centerX = (vw / 2 - pan.x) / zoom - NODE_W / 2;
    const centerY = (vh / 2 - pan.y) / zoom - NODE_H_BASE / 2;
    const count = nodes.filter((n) => n.node_type === type).length;
    const [px, py] = overridePos || [centerX + count * 30, centerY + count * 30];
    const label =
      type === 'input' ? 'Input' :
      type === 'rule'  ? `Rule ${count + 1}` :
      type === 'listener' ? `Listener ${count + 1}` :
      type === 'validator' ? `Validator ${count + 1}` :
      type === 'action' ? `Action ${count + 1}` :
      type === 'ai' ? `AI ${count + 1}` :
      type === 'and_gate' ? `AND Gate ${count + 1}` :
      type === 'sheet' ? `Sheet ${count + 1}` :
                         'Output';
    try {
      let config =
        type === 'input' ? { source_type: 'upload' } :
        type === 'rule' ? { boolean_operator: 'AND', conditions: [] } :
        type === 'action' ? { plugin: '', settings: {} } :
        type === 'listener' ? { trigger_type: '', gate_message: '', auto_execute_downstream: true } :
        type === 'validator' ? { description: '' } :
        type === 'ai' ? { model: 'gemini-2.5-flash', system_prompt: '', output_format: 'json_extract', output_key: 'ai_analysis', json_fields: [], temperature: 0.3, max_tokens: 2048, include_text: true, include_metadata: true } :
        type === 'and_gate' ? {} :
        type === 'sheet' ? { sheet_id: '', mode: 'input', write_mode: 'append', column_mapping: {}, auto_columns: true, include_fields: [], exclude_fields: [] } :
        {};
      // Merge overrides (from config dialog), extract _label if provided
      let finalLabel = label;
      if (configOverrides) {
        const { _label, ...rest } = configOverrides;
        if (_label) finalLabel = _label;
        config = { ...config, ...rest };
      }
      pushSnapshot();
      const { data } = await nodeApi.create({
        workflow: workflowId,
        node_type: type,
        label: finalLabel,
        position_x: px,
        position_y: py,
        config,
      });
      setNodes((prev) => [...prev, data]);
      setSelected({ type: 'node', id: data.id });

      // If inserting between two nodes, remove old connection and create two new ones
      if (insertBetween) {
        const { sourceId, targetId, connId } = insertBetween;
        // Delete old connection
        await connectionApi.delete(connId);
        setConnections((prev) => prev.filter((c) => c.id !== connId));
        // Create source → new node connection
        const { data: c1 } = await connectionApi.create({ workflow: workflowId, source_node: sourceId, target_node: data.id });
        // Create new node → target connection
        const { data: c2 } = await connectionApi.create({ workflow: workflowId, source_node: data.id, target_node: targetId });
        setConnections((prev) => [...prev, c1, c2]);
      }

      if (type === 'rule') {
        const { data: wf } = await workflowApi.get(workflowId);
        setWorkflow(wf);
      }
      notify.success(`${finalLabel} node added`);
    } catch (e) {
      notify.error('Failed to add node');
    }
  };

  /* ── Open node config dialog (pre-creation) ───────────── */
  const openNodeConfigDialog = (type, insertBetween = null, position = null) => {
    setShowNodeConfigDialog({ type, insertBetween, position });
    setMidpointMenu(null);
  };

  /* ── Handle node config dialog submit ───────────── */
  const handleNodeConfigDialogSubmit = async (type, configOverrides, insertBetween, position) => {
    const pos = position || null;
    await addNode(type, { overridePos: pos ? [pos.x, pos.y] : undefined, insertBetween, configOverrides });
    setShowNodeConfigDialog(null);
  };

  /* ── Delete node ────────────────── */
  const deleteNode = async (nodeId) => {
    try {
      pushSnapshot();
      await nodeApi.delete(nodeId);
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setConnections((prev) => prev.filter((c) => c.source_node !== nodeId && c.target_node !== nodeId));
      if (selected?.id === nodeId) setSelected(null);
      const { data: wf } = await workflowApi.get(workflowId);
      setWorkflow(wf);
      notify.success('Node deleted');
    } catch {
      notify.error('Failed to delete node');
    }
  };

  /* ── Update node config ─────────── */
  const updateNode = async (nodeId, patch) => {
    try {
      pushSnapshot();
      const { data } = await nodeApi.update(nodeId, patch);
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? data : n)));
      const { data: wf } = await workflowApi.get(workflowId);
      setWorkflow(wf);
    } catch (e) {
      notify.error('Failed to update node');
    }
  };

  /* ── Connection (draw edge) ─────── */
  const startConnect = (nodeId, handle = '') => { setConnecting({ nodeId, handle }); };

  const endConnect = async (targetId) => {
    if (!connecting || connecting.nodeId === targetId) {
      setConnecting(null);
      setConnectMouse(null);
      return;
    }
    try {
      pushSnapshot();
      const payload = {
        workflow: workflowId,
        source_node: connecting.nodeId,
        target_node: targetId,
      };
      if (connecting.handle) payload.source_handle = connecting.handle;
      const { data } = await connectionApi.create(payload);
      setConnections((prev) => [...prev, data]);
    } catch (e) {
      notify.error('Cannot create connection');
    }
    setConnecting(null);
    setConnectMouse(null);
  };

  const deleteConnection = async (connId) => {
    pushSnapshot();
    await connectionApi.delete(connId);
    setConnections((prev) => prev.filter((c) => c.id !== connId));
    if (selected?.id === connId) setSelected(null);
  };

  /* ── Drag nodes + Pan canvas ──── */
  const onCanvasMouseMove = (e) => {
    if (connecting) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;
      setConnectMouse({ x: mx, y: my });
    }
    if (panning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan.current = true;
      setPanStart({ x: e.clientX, y: e.clientY });
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (!dragging) return;
    const dx = (e.clientX - dragStart.x) / zoom;
    const dy = (e.clientY - dragStart.y) / zoom;
    setDragStart({ x: e.clientX, y: e.clientY });
    setNodes((prev) =>
      prev.map((n) =>
        n.id === dragging
          ? { ...n, position_x: n.position_x + dx, position_y: n.position_y + dy }
          : n,
      ),
    );
  };

  const onCanvasMouseUp = () => {
    if (dragging) {
      const node = nodes.find((n) => n.id === dragging);
      if (node) {
        nodeApi.update(dragging, { position_x: node.position_x, position_y: node.position_y }).catch(() => {});
      }
      setDragging(null);
    }
    if (connecting) {
      setConnecting(null);
      setConnectMouse(null);
    }
    if (panning) {
      setPanning(false);
    }
  };

  const onCanvasMouseDown = (e) => {
    // Start panning on background drag (canvas itself or the transform layer)
    const target = e.target;
    const isBackground = target === canvasRef.current
      || target.tagName === 'svg'
      || (target.closest && target.closest('[data-canvas-transform]'));
    if (isBackground && e.button === 0 && !connecting) {
      didPan.current = false;
      setPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const onCanvasWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const newZoom = Math.min(3, Math.max(0.2, zoom + delta));

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan((prev) => ({
      x: mx - scale * (mx - prev.x),
      y: my - scale * (my - prev.y),
    }));
    setZoom(newZoom);
  };

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  /* ── Quick upload from sidebar ──── */
  const handleQuickUpload = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    for (const f of files) form.append('files', f);
    try {
      const { data } = await workflowApi.upload(workflowId, form, (progressEvent) => {
        const pct = progressEvent.total
          ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
          : 0;
        setUploadProgress(pct);
      });
      const count = data.count || files.length;
      const zipInfo = data.zip_expanded;
      const msg = zipInfo
        ? `${count} file(s) uploaded (${zipInfo.files_extracted} extracted from ${zipInfo.archives} ZIP)`
        : `${count} file(s) uploaded`;
      notify.success(msg);
      fetchAll();
    } catch (e) {
      notify.error('Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      e.target.value = '';
    }
  };

  /* ── Execute workflow (async with polling, sync fallback) ───────────── */

  // ── Helper: apply execution results to UI ──────────────────────
  const applyResult = (resultData, execStatus) => {
    const data = resultData || {};
    setExecutionResult(data);
    setExecutionState('idle');
    setShowResultsModal(true);  // open results as dialog
    const doneMap = {};
    const nrl = Array.isArray(data.node_results) ? data.node_results : [];
    nodes.forEach((n) => {
      const nr = nrl.find((r) => r.node_id === n.id);
      const hasError = nr?.action?.status === 'failed' || nr?.ai?.status === 'failed';
      doneMap[n.id] = hasError ? 'error' : 'done';
    });
    setNodeProcessing(doneMap);
    fetchAll(); fetchExecutionHistory(); fetchPendingValidations(); fetchNodesStatus();
    if (execStatus === 'failed') {
      notify.error('Execution failed — see results for details');
    } else if (data.smart_meta) {
      const sm = data.smart_meta;
      if (data.message) notify.success(data.message);
      else if (sm.nodes_changed) notify.success(`Config changed — re-executed all ${data.total_documents || 0} documents`);
      else {
        const skipped = data.skipped_documents || 0;
        const executed = data.total_documents || 0;
        notify.success(skipped > 0 ? `${executed} executed · ${skipped} up-to-date` : `Executed ${executed} document${executed !== 1 ? 's' : ''}`);
      }
    } else {
      notify.success('Workflow executed successfully');
    }
    setTimeout(() => setNodeProcessing({}), 4000);
  };

  // ── Helper: poll an execution_id with incremental progress ─────
  const pollExecution = (execId) => new Promise((resolve, reject) => {
    let pollCount = 0;
    const maxPolls = 180;
    const interval = 1500;  // 1.5s for responsive progress
    const timer = setInterval(async () => {
      pollCount++;
      try {
        const { data: st } = await workflowApi.executionStatus(workflowId, execId);
        // Update execution state from server
        if (st.execution_state) setExecutionState(st.execution_state);
        // ── Incremental node progress from node_summary ──────
        if (Array.isArray(st.node_summary) && st.node_summary.length > 0) {
          const progressMap = {};
          const completedIds = new Set(st.node_summary.map(ns => ns.node_id));
          nodes.forEach((n) => {
            if (completedIds.has(n.id)) {
              progressMap[n.id] = 'done';
            } else {
              progressMap[n.id] = 'processing';
            }
          });
          setNodeProcessing(progressMap);
        }
        if (['completed', 'partial', 'failed'].includes(st.status)) {
          clearInterval(timer);
          resolve(st);
        } else if (pollCount >= maxPolls) {
          clearInterval(timer);
          reject(new Error('Execution timed out — check execution history'));
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, interval);
  });

  // ── Resume polling for a server-side execution (page reload recovery) ─
  const _resumeServerExecution = async (execId) => {
    const processingMap = {};
    nodes.forEach((n) => { processingMap[n.id] = 'processing'; });
    setNodeProcessing(processingMap);
    try {
      const result = await pollExecution(execId);
      applyResult(result.result_data || result, result.status);
    } catch (e) {
      const errMap = {};
      nodes.forEach((n) => { errMap[n.id] = 'error'; });
      setNodeProcessing(errMap);
      setTimeout(() => setNodeProcessing({}), 4000);
      notify.error('Execution polling failed: ' + e.message);
    } finally {
      setExecuting(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setExecutionState('compiling');
    setTab('processing');  // auto-switch to live processing view
    const processingMap = {};
    nodes.forEach((n) => { processingMap[n.id] = 'processing'; });
    setNodeProcessing(processingMap);

    try {
      // ── Try async execution first ──────────────────────────────
      const { data: kickoff } = await workflowApi.executeAsync(workflowId, { smart: true });
      const execId = kickoff.execution_id;
      if (!execId) throw new Error('No execution_id returned');
      notify.info('Workflow execution queued…');
      const result = await pollExecution(execId);
      applyResult(result.result_data || result, result.status);
    } catch (e) {
      const resp = e.response;

      // ── 409: execution already in flight → resume polling ──────
      if (resp?.status === 409 && resp?.data?.execution_id) {
        const existingExecId = resp.data.execution_id;
        const age = resp.data.age_seconds || 0;
        notify.info(`Resuming in-flight execution (${resp.data.status}, ${age}s ago)…`);
        try {
          const result = await pollExecution(existingExecId);
          applyResult(result.result_data || result, result.status);
          return;
        } catch (pollErr) {
          notify.warning('In-flight execution unreachable — clearing lock…');
          try { await workflowApi.clearLock(workflowId); } catch {}
        }
      }

      // ── 409: stale lock with no execution_id → auto-clear ─────
      if (resp?.status === 409 && !resp?.data?.execution_id) {
        notify.warning('Stale lock detected — clearing…');
        try { await workflowApi.clearLock(workflowId); } catch {}
      }

      // ── Fallback: sync execution (Celery might not be running) ─
      if (resp?.status === 409 || resp?.status === 500 || e.message?.includes('No execution_id')) {
        try {
          notify.info('Falling back to synchronous execution…');
          setExecutionState('executing');
          const { data: syncResult } = await workflowApi.execute(workflowId, { smart: true });
          applyResult(syncResult, 'completed');
          return;
        } catch (syncErr) {
          const errMap = {};
          nodes.forEach((n) => { errMap[n.id] = 'error'; });
          setNodeProcessing(errMap);
          setExecutionState('idle');
          setTimeout(() => setNodeProcessing({}), 4000);
          notify.error('Execution failed: ' + (syncErr.response?.data?.error || syncErr.message));
          return;
        }
      }

      // ── Other errors ──────────────────────────────────────────
      const errMap = {};
      nodes.forEach((n) => { errMap[n.id] = 'error'; });
      setNodeProcessing(errMap);
      setExecutionState('idle');
      setTimeout(() => setNodeProcessing({}), 4000);
      notify.error('Execution failed: ' + (resp?.data?.error || e.message));
    } finally {
      setExecuting(false);
    }
  };

  /* ── Live mode toggle ───────────── */
  const handleToggleLive = async () => {
    try {
      if (isLive) {
        // Going offline → use pause endpoint
        const { data } = await workflowApi.pause(workflowId);
        setIsLive(false);
        notify.success(data.message || 'Workflow is now offline');
      } else {
        // Pre-flight: check canvas has at least one input node (or sheet node in input mode)
        const hasInput = nodes.some(n => n.node_type === 'input' || (n.node_type === 'sheet' && n.config?.mode === 'input'));
        if (!hasInput) {
          notify.error('Add at least one Input node (or a Sheet node in input mode) before going live.');
          return;
        }
        // Going live → use go-live endpoint (compiles + enables in one step)
        const { data } = await workflowApi.goLive(workflowId, { live_interval: liveInterval });
        setIsLive(true);
        setLiveInterval(data.live_interval || 60);
        notify.success(data.message || 'Workflow is now LIVE');
      }
    } catch (e) {
      const errData = e.response?.data;
      const msg = errData?.error || errData?.message || e.message;
      const errors = errData?.errors;
      let detail = '';
      if (Array.isArray(errors) && errors.length) {
        detail = ': ' + errors.map(err => typeof err === 'string' ? err : (err.message || JSON.stringify(err))).join(', ');
      }
      notify.error(msg + detail);
    }
  };

  /* ── Share / Upload Links ───────── */
  const fetchUploadLinks = async () => {
    setShareLoading(true);
    try {
      const { data } = await workflowApi.uploadLinks(workflowId);
      setUploadLinks(data);
    } catch (e) {
      notify.error('Failed to load upload links');
    } finally {
      setShareLoading(false);
    }
  };

  const handleCreateLink = async () => {
    try {
      const body = {};
      if (newLinkLabel.trim()) body.label = newLinkLabel.trim();
      if (newLinkPassword.trim()) body.password = newLinkPassword.trim();
      if (newLinkRequireLogin !== 'none') body.require_login = newLinkRequireLogin;
      const { data } = await workflowApi.createUploadLink(workflowId, body);
      setUploadLinks(prev => [data, ...prev]);
      setNewLinkLabel('');
      setNewLinkPassword('');
      setNewLinkRequireLogin('none');
      notify.success('Upload link created!');
    } catch (e) {
      notify.error('Failed to create upload link');
    }
  };

  const handleDeleteLink = async (linkId) => {
    try {
      await workflowApi.deleteUploadLink(workflowId, linkId);
      setUploadLinks(prev => prev.filter(l => l.id !== linkId));
      notify.success('Link deleted');
    } catch (e) {
      notify.error('Failed to delete link');
    }
  };

  const handleToggleLink = async (linkId, isActive) => {
    try {
      const { data } = await workflowApi.updateUploadLink(workflowId, linkId, { is_active: !isActive });
      setUploadLinks(prev => prev.map(l => l.id === linkId ? data : l));
    } catch (e) {
      notify.error('Failed to update link');
    }
  };

  const getUploadUrl = (token) => {
    return `${window.location.origin}/clm/upload/${token}`;
  };

  const copyLink = (token, linkId) => {
    navigator.clipboard.writeText(getUploadUrl(token));
    setCopiedLinkId(linkId);
    setTimeout(() => setCopiedLinkId(null), 2000);
    notify.success('Link copied to clipboard!');
  };

  const openShareModal = () => {
    setShowShareModal(true);
    fetchUploadLinks();
  };

  const openSheetModal = async (sheetId, nodeId) => {
    const { sheetsService } = await import('@services/sheetsService');

    // If no sheet linked, auto-create one and link it to the node
    if (!sheetId) {
      if (!nodeId) {
        notify.error('No sheet linked to open');
        return;
      }
      try {
        const nodeObj = nodes.find((n) => n.id === nodeId);
        const label = nodeObj?.label || 'Sheet';
        const { data: newSheet } = await sheetsService.create({
          title: `${label} — auto`,
          col_count: 5,
          row_count: 10,
        });
        // Link the new sheet to the node config
        const existingConfig = nodeObj?.config || {};
        await updateNode(nodeId, {
          config: { ...existingConfig, sheet_id: newSheet.id, sheet_title: newSheet.title },
        });
        sheetId = newSheet.id;
        setSheetModalTitle(newSheet.title || 'Sheet');
      } catch (e) {
        notify.error('Failed to create sheet: ' + (e?.response?.data?.error || e?.message || 'Unknown error'));
        return;
      }
    } else {
      // Try to get the title for the modal header
      try {
        const { data } = await sheetsService.get(sheetId);
        setSheetModalTitle(data?.title || 'Sheet');
      } catch {
        setSheetModalTitle('Sheet');
      }
    }

    setSheetModalId(sheetId);
    setSheetModalNodeId(nodeId || null);
    setShowSheetModal(true);
  };

  const closeSheetModal = () => {
    setShowSheetModal(false);
    setSheetModalId(null);
    setSheetModalTitle('');
    setSheetModalNodeId(null);
  };

  /* ── Optimize workflow ──────────── */
  const handleOptimizePreview = async () => {
    setOptimizing(true);
    try {
      const { data } = await workflowApi.optimizePreview(workflowId);
      setOptimizeResult(data);
      setShowOptimizeModal(true);
    } catch (e) {
      notify.error('Optimization failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setOptimizing(false);
    }
  };

  const handleOptimizeApply = async () => {
    setApplyingOptimize(true);
    try {
      const { data } = await workflowApi.optimizeApply(workflowId);
      setOptimizeResult(data);
      if (data.actions_applied) {
        notify.success(`Applied ${data.proposed_actions?.length || 0} optimization(s)`);
        fetchAll();
      }
      setShowOptimizeModal(false);
    } catch (e) {
      notify.error('Failed to apply optimizations: ' + (e.response?.data?.error || e.message));
    } finally {
      setApplyingOptimize(false);
    }
  };

  /* ── Rebuild template ───────────── */
  const handleRebuildTemplate = async () => {
    try {
      const { data } = await workflowApi.rebuildTemplate(workflowId);
      setWorkflow((prev) => ({ ...prev, extraction_template: data.extraction_template }));
      notify.success(`Template rebuilt: ${data.field_count} fields`);
    } catch {
      notify.error('Failed to rebuild template');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]"><Spinner size="lg" className="text-indigo-500" /></div>;
  if (!workflow) return <div className="p-8 text-center text-red-500">Workflow not found</div>;

  const selectedNode = selected?.type === 'node' ? nodes.find((n) => n.id === selected.id) : null;

  const tabConfig = [
    { id: 'canvas', label: 'Canvas', icon: <LayoutGrid size={14} /> },
    { id: 'documents', label: 'Documents', icon: <FileText size={14} /> },
    { id: 'processing', label: 'Processing', icon: <Activity size={14} /> },
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={14} /> },
  ];

  /* ================================================================
     RENDER
     ================================================================ */
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* ── Top bar ──────────────────── */}
      <div className="bg-white border-b px-4 py-2 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/clm/workflows" className="text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <ArrowLeft size={16} /> <span className="hidden sm:inline text-sm">Back</span>
          </Link>
          <h2 className="font-semibold text-gray-900 truncate">{workflow.name}</h2>
          <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
            {nodes.length} nodes
          </span>
          {workflow.document_count > 0 && (
            <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
              {workflow.document_count} docs
            </span>
          )}

          {/* ── Notification bell ── */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifPanel((p) => !p)}
              className={`relative p-1.5 rounded-lg transition-all ${
                showNotifPanel
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="Pending approvals"
            >
              <Bell size={16} />
              {(pendingValidations?.total_pending || 0) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 ring-2 ring-white">
                  {pendingValidations.total_pending > 99 ? '99+' : pendingValidations.total_pending}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {showNotifPanel && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Pending Approvals</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    (pendingValidations?.total_pending || 0) > 0
                      ? 'bg-red-50 text-red-600 ring-1 ring-red-200'
                      : 'bg-gray-100 text-gray-400'
                  }`}>
                    {pendingValidations?.total_pending || 0}
                  </span>
                </div>

                <div className="max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {!pendingValidations || pendingValidations.total_pending === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center mb-2">
                        <CheckCircle2 size={20} className="text-green-400" />
                      </div>
                      <p className="text-sm text-gray-600 font-medium">All clear!</p>
                      <p className="text-xs text-gray-400 mt-0.5">No pending approvals</p>
                    </div>
                  ) : (
                    <div className="py-1">
                      {(pendingValidations.workflows || []).map((wf) => (
                        <div key={wf.workflow_id}>
                          {/* Group by node within the decisions */}
                          {(() => {
                            const byNode = {};
                            (wf.decisions || []).forEach((d) => {
                              const nid = d.node;
                              if (!byNode[nid]) byNode[nid] = { label: d.node_label || 'Validator', docs: [] };
                              byNode[nid].docs.push(d);
                            });
                            return Object.entries(byNode).map(([nodeId, info]) => (
                              <button
                                key={nodeId}
                                onClick={() => {
                                  setInspectNodeId(nodeId);
                                  setShowNotifPanel(false);
                                }}
                                className="w-full text-left px-4 py-2.5 hover:bg-indigo-50/60 transition-colors flex items-center gap-3 group"
                              >
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center shrink-0 text-sm">✅</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-indigo-700 transition-colors">{info.label}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    {info.docs.length} pending {info.docs.length === 1 ? 'document' : 'documents'}
                                  </p>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {info.docs.slice(0, 3).map((d) => (
                                      <span key={d.id} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md truncate max-w-[120px]" title={d.document_title}>
                                        {d.document_title || 'Untitled'}
                                      </span>
                                    ))}
                                    {info.docs.length > 3 && (
                                      <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">+{info.docs.length - 3} more</span>
                                    )}
                                  </div>
                                </div>
                                <span className="bg-red-50 text-red-600 ring-1 ring-red-200 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">{info.docs.length}</span>
                              </button>
                            ));
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(pendingValidations?.total_pending || 0) > 0 && (
                  <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
                    <button
                      onClick={() => { setTab('dashboard'); setShowNotifPanel(false); }}
                      className="w-full text-center text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                    >
                      View all in Dashboard →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
            {tabConfig.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border bg-white text-gray-600 border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200"
            title="Workflow settings &amp; event triggers"
          >
            <Settings size={14} />
            Settings
          </button>
          <button
            onClick={handleOptimizePreview}
            disabled={optimizing}
            className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
            title="AI-powered workflow optimization"
          >
            {optimizing ? <Spinner size="sm" className="text-white" /> : <Sparkles size={14} />}
            {optimizing ? 'Analyzing…' : 'Optimize'}
          </button>
          {/* Share / Upload Link — for upload-type input nodes */}
          {nodes.some(n => n.node_type === 'input' && (n.config?.source_type === 'upload' || !n.config?.source_type)) && (
          <button
            onClick={openShareModal}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
            title="Create shareable upload link"
          >
            <Share2 size={14} />
            Share
          </button>
          )}
          {/* Share as Form — for sheet-type input nodes */}
          {nodes.some(n => n.node_type === 'input' && n.config?.source_type === 'sheet' && n.config?.sheet_id) && (() => {
            const sheetNode = nodes.find(n => n.node_type === 'input' && n.config?.source_type === 'sheet' && n.config?.sheet_id);
            return (
              <button
                onClick={() => openSheetModal(sheetNode.config.sheet_id, sheetNode.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border bg-white text-cyan-600 border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700 hover:border-cyan-300"
                title="Open sheet &amp; share as form"
              >
                <Share2 size={14} />
                Share Form
              </button>
            );
          })()}

          <div className="flex items-center gap-1.5">
            {/* Execution state badge */}
            {executionState === 'compiling' && (
              <span className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 animate-pulse flex items-center gap-1">
                <Spinner size="xs" className="text-blue-500" /> Compiling…
              </span>
            )}
            {executionState === 'executing' && (
              <span className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200 animate-pulse flex items-center gap-1">
                <Spinner size="xs" className="text-orange-500" /> Executing…
              </span>
            )}

            {/* Pending docs badge */}
            {nodesStatus && nodesStatus.pending_execution > 0 && !nodesStatus.nodes_changed && !executing && (
              <span className="px-2 py-1 rounded-lg text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-200" title={`${nodesStatus.pending_execution} new doc${nodesStatus.pending_execution !== 1 ? 's' : ''} to execute`}>
                {nodesStatus.pending_execution} new
              </span>
            )}

            <button
              onClick={handleExecute}
              disabled={executing || ['compiling', 'executing'].includes(executionState)}
              className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
              title={executing ? `${executionState === 'compiling' ? 'Compiling DAG' : 'Executing nodes'}…` : 'Execute workflow'}
            >
              {executing ? <Spinner size="sm" className="text-white" /> : <Play size={14} />}
              {executing
                ? executionState === 'compiling' ? 'Compiling…'
                  : executionState === 'executing' ? 'Running…'
                  : 'Running…'
                : 'Execute'}
            </button>

            {/* Live mode toggle */}
            <button
              onClick={handleToggleLive}
              disabled={executing}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border ${
                isLive
                  ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100 ring-1 ring-red-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={isLive ? `Live — auto-executing every ${liveInterval}s. Click to stop.` : 'Go live — auto-execute on a schedule'}
            >
              <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`} />
              {isLive ? 'LIVE' : 'Go Live'}
            </button>

            {/* Results (opens dialog) */}
            {executionResult && (
              <button
                onClick={() => setShowResultsModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                title="View last execution results"
              >
                <Zap size={14} />
                Results
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {tab === 'canvas' && (
          <>
            {/* ── Node palette (left) ── */}
            <div className="w-52 bg-white border-r p-3 shrink-0 flex flex-col gap-2 overflow-y-auto">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Add Node</p>
              <button onClick={() => openNodeConfigDialog('input')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors">📥 Input</button>
              <button onClick={() => openNodeConfigDialog('rule')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors">⚙️ Rule</button>
              <button onClick={() => openNodeConfigDialog('action')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors">⚡ Action</button>
              <button onClick={() => openNodeConfigDialog('validator')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">✅ Validator</button>
              <button onClick={() => openNodeConfigDialog('ai')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors">🧪 AI</button>
              <button onClick={() => openNodeConfigDialog('and_gate')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors">∩ AND Gate</button>
              <button onClick={() => openNodeConfigDialog('doc_create')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors">📄 Doc Create</button>
              <button onClick={() => openNodeConfigDialog('sheet')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-cyan-50 text-cyan-700 hover:bg-cyan-100 transition-colors">📊 Sheet</button>
              <button onClick={() => openNodeConfigDialog('output')} className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors">📤 Output</button>

              <hr className="my-2" />
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Template</p>
                <button onClick={handleRebuildTemplate} className="text-[10px] text-indigo-500 hover:text-indigo-700" title="Rebuild template from rule nodes">
                  <RefreshCw size={10} />
                </button>
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 break-words max-h-40 overflow-y-auto">
                {workflow.extraction_template && Object.keys(workflow.extraction_template).length > 0
                  ? Object.keys(workflow.extraction_template).map((k) => (
                      <span key={k} className="inline-block bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded mr-1 mb-1 text-[10px]">{k}</span>
                    ))
                  : <span className="text-gray-400 italic text-[11px]">No fields yet — add rule nodes</span>}
              </div>

              <hr className="my-2" />
            </div>

            {/* ── Canvas ── */}
            <div
              ref={canvasRef}
              className={`flex-1 relative overflow-hidden ${panning ? 'cursor-grabbing' : dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              style={{
                backgroundImage: `
                  linear-gradient(to right, #e5e7eb 1px, transparent 1px),
                  linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)
                `,
                backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
                backgroundPosition: `${pan.x}px ${pan.y}px`,
                backgroundColor: '#fafafa',
              }}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
              onMouseDown={onCanvasMouseDown}
              onWheel={onCanvasWheel}
              onClick={(e) => {
                if (e.target === canvasRef.current && !didPan.current) {
                  setSelected(null);
                  setMidpointMenu(null);
                }
              }}
            >
              {/* Transform layer for zoom + pan */}
              <div
                data-canvas-transform
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '0 0',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '5000px',
                  height: '5000px',
                }}
              >
              {/* SVG connections — orthogonal tree-style lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                {connections.map((c) => {
                  const src = nodes.find((n) => n.id === c.source_node);
                  const tgt = nodes.find((n) => n.id === c.target_node);
                  if (!src || !tgt) return null;
                  // Compute source Y — validator branching handles offset
                  let srcY = src.position_y + NODE_H_BASE / 2;
                  if (src.node_type === 'validator' && c.source_handle) {
                    srcY = src.position_y + (c.source_handle === 'approved' ? NODE_H_BASE * 0.3 : NODE_H_BASE * 0.7);
                  }
                  const s = { x: src.position_x + NODE_W, y: srcY };
                  const t = { x: tgt.position_x,           y: tgt.position_y + NODE_H_BASE / 2 };
                  const path = orthoPath(s, t);
                  const mid = orthoMidpoint(s, t);
                  const isSelected = selected?.type === 'connection' && selected.id === c.id;
                  const isHovered = hoveredConnection === c.id;
                  // Color edges by handle: green for approved, red for rejected
                  const handleColor = c.source_handle === 'approved' ? '#10b981'
                    : c.source_handle === 'rejected' ? '#ef4444' : null;
                  const strokeColor = isSelected ? '#6366f1' : handleColor || (executing ? '#818cf8' : '#94a3b8');
                  return (
                    <g key={c.id} style={{ pointerEvents: 'all' }}
                      onMouseEnter={() => setHoveredConnection(c.id)}
                      onMouseLeave={() => setHoveredConnection(null)}
                    >
                      {/* Invisible fat hit area */}
                      <path
                        d={path} fill="none"
                        stroke="transparent" strokeWidth={14}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelected({ type: 'connection', id: c.id })}
                      />
                      {/* Visible line */}
                      <path
                        d={path} fill="none"
                        stroke={strokeColor}
                        strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        markerEnd={c.source_handle === 'approved' ? 'url(#arrow-approved)' : c.source_handle === 'rejected' ? 'url(#arrow-rejected)' : 'url(#arrow)'}
                        className={executing ? 'animate-dash' : ''}
                      />
                      {/* Handle label on colored edges */}
                      {c.source_handle && (
                        <text
                          x={(s.x + t.x) / 2}
                          y={Math.min(s.y, t.y) - 8}
                          textAnchor="middle"
                          className="fill-current text-[9px] font-medium pointer-events-none"
                          style={{ fill: handleColor || '#94a3b8' }}
                        >
                          {c.source_handle === 'approved' ? 'True' : 'False'}
                        </text>
                      )}
                      {/* Midpoint add button — appears on hover */}
                      {isHovered && !connecting && !executing && (
                        <g
                          style={{ cursor: 'pointer', pointerEvents: 'all' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMidpointMenu({ connId: c.id, x: mid.x, y: mid.y, sourceId: c.source_node, targetId: c.target_node });
                          }}
                        >
                          <circle cx={mid.x} cy={mid.y} r={12} fill="white" stroke="#6366f1" strokeWidth={2} />
                          <text x={mid.x} y={mid.y + 1} textAnchor="middle" dominantBaseline="central" fill="#6366f1" fontSize="16" fontWeight="bold" style={{ pointerEvents: 'none' }}>+</text>
                        </g>
                      )}
                    </g>
                  );
                })}
                {/* In-progress connection line */}
                {connecting && connectMouse && (() => {
                  const src = nodes.find((n) => n.id === connecting.nodeId);
                  if (!src) return null;
                  let srcY = src.position_y + NODE_H_BASE / 2;
                  if (src.node_type === 'validator' && connecting.handle) {
                    srcY = src.position_y + (connecting.handle === 'approved' ? NODE_H_BASE * 0.3 : NODE_H_BASE * 0.7);
                  }
                  const s = { x: src.position_x + NODE_W, y: srcY };
                  const path = orthoPath(s, connectMouse);
                  const color = connecting.handle === 'approved' ? '#10b981' : connecting.handle === 'rejected' ? '#ef4444' : '#6366f1';
                  return (
                    <path
                      d={path} fill="none"
                      stroke={color} strokeWidth={2} strokeDasharray="4 4"
                      strokeLinejoin="round" strokeLinecap="round"
                    />
                  );
                })()}
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                  </marker>
                  <marker id="arrow-approved" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                  </marker>
                  <marker id="arrow-rejected" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
                  </marker>
                </defs>
              </svg>

              {/* Nodes */}
              {nodes.map((node) => {
                const isSelected = selected?.type === 'node' && selected.id === node.id;
                const processingStatus = nodeProcessing[node.id] || null;
                const commonProps = {
                  key: node.id,
                  node,
                  isSelected,
                  processingStatus,
                  // single-click now selects AND opens the inspector (table/CSV view)
                  onSelect: () => {
                    setSelected({ type: 'node', id: node.id });
                    setInspectNodeId(node.id);
                  },
                  // keep double-click mapping for existing shortcuts
                  onDoubleClick: () => setInspectNodeId(node.id),
                  onOpenSheet: () => openSheetModal(node.config?.sheet_id, node.id),
                  onDragStart: (e) => {
                    e.stopPropagation();
                    setDragging(node.id);
                    setDragStart({ x: e.clientX, y: e.clientY });
                  },
                  onConnectStart: (handle) => startConnect(node.id, handle),
                  onConnectEnd: () => endConnect(node.id),
                  onDelete: () => deleteNode(node.id),
                };
                if (node.node_type === 'input')    return <InputNode {...commonProps} />;
                if (node.node_type === 'rule')     return <RuleNode {...commonProps} />;
                if (node.node_type === 'listener') return <ListenerNode {...commonProps} />;
                if (node.node_type === 'validator') return <ValidatorNode {...commonProps} />;
                if (node.node_type === 'action')   return <ActionNode {...commonProps} />;
                if (node.node_type === 'ai')       return <AINode {...commonProps} />;
                if (node.node_type === 'and_gate') return <GateNode {...commonProps} />;
                if (node.node_type === 'doc_create') return <DocCreateNode {...commonProps} />;
                if (node.node_type === 'sheet')      return (
                  <SheetNode
                    {...commonProps}
                    // clicking a sheet node opens the sheet viewer dialog
                    onSelect={() => {
                      setSelected({ type: 'node', id: node.id });
                      setInspectNodeId(null);
                      openSheetModal(node.config?.sheet_id, node.id);
                    }}
                    onDoubleClick={() => {
                      setSelected({ type: 'node', id: node.id });
                      setInspectNodeId(null);
                      openSheetModal(node.config?.sheet_id, node.id);
                    }}
                  />
                );
                if (node.node_type === 'output')    return <OutputNode {...commonProps} />;
                return null;
              })}
              </div>{/* end transform layer */}

              {/* Midpoint menu — appears when clicking + on a connection */}
              {midpointMenu && (
                <div
                  className="absolute z-40"
                  style={{
                    left: midpointMenu.x * zoom + pan.x - 88,
                    top: midpointMenu.y * zoom + pan.y + 16,
                  }}
                >
                  <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-2 w-44 space-y-0.5 animate-in fade-in zoom-in-95">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-2 py-1">Insert Node</p>
                    {NODE_TYPES.map(n => (
                      <button
                        key={n.type}
                        onClick={() => {
                          const pos = { x: midpointMenu.x - NODE_W / 2, y: midpointMenu.y - NODE_H_BASE / 2 };
                          openNodeConfigDialog(n.type, { sourceId: midpointMenu.sourceId, targetId: midpointMenu.targetId, connId: midpointMenu.connId }, pos);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 ${n.bg} transition-colors flex items-center gap-2`}
                      >
                        <span>{n.icon}</span> {n.label}
                      </button>
                    ))}
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button
                        onClick={() => setMidpointMenu(null)}
                        className="w-full text-center px-3 py-1 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Floating add-node button */}
              <div className="absolute bottom-20 right-4 z-30">
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className={`w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all ${
                      showAddMenu ? 'bg-gray-700 text-white rotate-45' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                    title="Add Node"
                  >
                    <Plus size={20} />
                  </button>
                  {showAddMenu && (
                    <div className="absolute bottom-12 right-0 bg-white rounded-xl shadow-xl border p-2 w-44 space-y-1 animate-in fade-in slide-in-from-bottom-2">
                      {NODE_TYPES.map(n => (
                        <button
                          key={n.type}
                          onClick={() => { openNodeConfigDialog(n.type); setShowAddMenu(false); }}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 ${n.bg} transition-colors flex items-center gap-2`}
                        >
                          <span>{n.icon}</span> {n.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Zoom controls + Undo/Redo */}
              <div className="absolute bottom-4 left-4 z-30 flex items-center gap-1 bg-white/90 backdrop-blur rounded-lg shadow border px-1 py-0.5">
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)"
                ><Undo2 size={14} /></button>
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Shift+Z)"
                ><Redo2 size={14} /></button>
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                <button
                  onClick={() => {
                    const nz = Math.min(3, zoom + 0.15);
                    setZoom(nz);
                  }}
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                  title="Zoom in"
                ><ZoomIn size={14} /></button>
                <span className="text-[10px] font-medium text-gray-500 min-w-[36px] text-center select-none">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => {
                    const nz = Math.max(0.2, zoom - 0.15);
                    setZoom(nz);
                  }}
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                  title="Zoom out"
                ><ZoomOut size={14} /></button>
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                <button
                  onClick={resetView}
                  className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
                  title="Reset view"
                ><Maximize size={14} /></button>
              </div>
            </div>

            {/* ── Right sidebar — node config ── */}
            {selectedNode && (
              <div className="w-[420px] bg-white border-l p-4 shrink-0 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-gray-900 capitalize flex items-center gap-2">
                    <Settings size={14} className="text-gray-400" />
                    {selectedNode.node_type} Node
                  </h3>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
                </div>

                {/* Label */}
                <label className="block text-xs text-gray-500 mb-1">Label</label>
                <input
                  value={selectedNode.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? { ...n, label } : n)));
                  }}
                  onBlur={(e) => updateNode(selectedNode.id, { label: e.target.value })}
                  className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                />

                {/* Input config with source selector */}
                {selectedNode.node_type === 'input' && (
                  <InputConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    workflowId={workflowId}
                    onUpdate={() => { fetchAll(); fetchFieldOptions(); }}
                  />
                )}

                {/* Rule config with field options dropdown */}
                {selectedNode.node_type === 'rule' && (
                  <RuleConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    fieldOptions={fieldOptions}
                  />
                )}

                {/* Action config with plugin selector and settings */}
                {selectedNode.node_type === 'action' && (
                  <ActionConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    plugins={actionPlugins}
                    workflowId={workflowId}
                    onExecutionComplete={() => { fetchAll(); }}
                  />
                )}

                {/* Listener config with trigger selector and settings */}
                {selectedNode.node_type === 'listener' && (
                  <ListenerConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    triggers={listenerTriggers}
                    workflowId={workflowId}
                    onUpdate={() => { fetchAll(); }}
                  />
                )}

                {/* Validator config with levels + user assignment */}
                {selectedNode.node_type === 'validator' && (
                  <ValidatorConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    workflowId={workflowId}
                    onUpdate={() => { fetchAll(); }}
                  />
                )}

                {/* AI config with model selector + system prompt */}
                {selectedNode.node_type === 'ai' && (
                  <AIConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    models={aiModels}
                  />
                )}

                {/* Gate config (AND) */}
                {selectedNode.node_type === 'and_gate' && (
                  <GateConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                  />
                )}

                {/* Doc Create config */}
                {selectedNode.node_type === 'doc_create' && (
                  <DocCreateConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    workflowId={workflowId}
                    fieldOptions={fieldOptions}
                  />
                )}

                {/* Sheet config */}
                {selectedNode.node_type === 'sheet' && (
                  <SheetConfigPanel
                    node={selectedNode}
                    onChange={(config) => updateNode(selectedNode.id, { config })}
                    connections={connections}
                  />
                )}

                {/* Node last result + document list — show if node has results or execution data exists */}
                {(selectedNode.last_result?.count != null || (executionResult?.node_results || []).some(r => r.node_id === String(selectedNode.id))) && (
                  <NodeResultPanel
                    node={selectedNode}
                    executionResult={executionResult}
                    nodes={nodes}
                    workflowId={workflowId}
                  />
                )}

                {/* Delete */}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setInspectNodeId(selectedNode.id)}
                    className="flex-1 px-3 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Eye size={12} /> Inspect
                  </button>
                  <button
                    onClick={() => deleteNode(selectedNode.id)}
                    className="flex-1 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                  >
                    Delete Node
                  </button>
                </div>
              </div>
            )}

            {/* Connection selected — delete action */}
            {selected?.type === 'connection' && (
              <div className="w-[420px] bg-white border-l p-4 shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-gray-900">Connection</h3>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
                </div>
                <button
                  onClick={() => deleteConnection(selected.id)}
                  className="w-full px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100"
                >
                  Delete Connection
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Documents tab (full DocumentManager) ──── */}
        {tab === 'documents' && (
          <DocumentManager workflowId={workflowId} onUpdate={fetchAll} />
        )}

        {/* ── Processing tab (live SSE progress) ────── */}
        {tab === 'processing' && (
          <ProcessingProgressPanel
            workflowId={workflowId}
            nodes={nodes}
            connections={connections}
            executing={executing}
            onViewResults={() => setShowResultsModal(true)}
          />
        )}

        {/* ── Dashboard tab ──────────────────────────── */}
        {tab === 'dashboard' && (
          <Dashboard workflowId={workflowId} />
        )}

      </div>

      {/* ── Results Modal (dialog overlay) ──────────── */}
      {showResultsModal && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-sm" onClick={() => setShowResultsModal(false)} />
          <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <Zap size={16} className="text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Execution Results</h3>
                  {executionResult?.total_documents != null && (
                    <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                      {executionResult.total_documents} docs
                    </span>
                  )}
                </div>
                <button onClick={() => setShowResultsModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">
                  ×
                </button>
              </div>
              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                <ExecutionResults
                  result={executionResult}
                  nodes={nodes}
                  executing={executing}
                  workflowId={workflowId}
                  executionHistory={executionHistory}
                  onRefreshHistory={fetchExecutionHistory}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Node Config Dialog — appears before creating a node ──── */}
      {showNodeConfigDialog && (
        <NodeConfigDialog
          nodeType={showNodeConfigDialog.type}
          insertBetween={showNodeConfigDialog.insertBetween}
          position={showNodeConfigDialog.position}
          onSubmit={handleNodeConfigDialogSubmit}
          onCancel={() => setShowNodeConfigDialog(null)}
        />
      )}

      {/* ── Optimize Workflow Modal ──── */}
      {showOptimizeModal && optimizeResult && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/30" onClick={() => setShowOptimizeModal(false)} />
          <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 border-b flex items-center justify-between bg-gradient-to-r from-violet-50 to-purple-50">
                <div className="flex items-center gap-2">
                  <Sparkles size={20} className="text-violet-600" />
                  <h3 className="font-semibold text-gray-900">Workflow Optimization</h3>
                </div>
                <button onClick={() => setShowOptimizeModal(false)} className="text-gray-400 hover:text-gray-600">
                  <XCircle size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Static issues */}
                {optimizeResult.static_issues?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Structural Issues</h4>
                    <div className="space-y-2">
                      {optimizeResult.static_issues.map((issue, i) => (
                        <div key={i} className={`p-3 rounded-lg text-xs ${
                          issue.severity === 'critical' ? 'bg-red-50 border border-red-200 text-red-700' :
                          issue.severity === 'warning' ? 'bg-amber-50 border border-amber-200 text-amber-700' :
                          'bg-blue-50 border border-blue-200 text-blue-700'
                        }`}>
                          <div className="font-medium">{issue.issue}</div>
                          <div className="mt-1 opacity-80">{issue.suggestion}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Summary */}
                {optimizeResult.summary && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">AI Analysis</h4>
                    <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {optimizeResult.summary}
                    </div>
                  </div>
                )}

                {/* Proposed actions */}
                {optimizeResult.proposed_actions?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">
                      Proposed Changes ({optimizeResult.proposed_actions.length})
                    </h4>
                    <div className="space-y-1.5">
                      {optimizeResult.proposed_actions.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 p-2.5 bg-violet-50 rounded-lg text-xs">
                          <span className="px-1.5 py-0.5 bg-violet-200 text-violet-700 rounded font-mono text-[10px]">
                            {a.action}
                          </span>
                          <span className="text-gray-700">
                            {a.action === 'update_node' && `Update "${a.label || a.node_id?.slice(0, 8)}"`}
                            {a.action === 'add_node' && `Add ${a.node_type} node "${a.label}"`}
                            {a.action === 'delete_node' && `Delete node ${a.node_id?.slice(0, 8)}`}
                            {a.action === 'add_connection' && 'Add connection'}
                            {a.action === 'delete_connection' && 'Remove connection'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {optimizeResult.proposed_actions?.length === 0 && !optimizeResult.error && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    Your workflow is already well-optimized!
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowOptimizeModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                {optimizeResult.proposed_actions?.length > 0 && !optimizeResult.actions_applied && (
                  <button
                    onClick={handleOptimizeApply}
                    disabled={applyingOptimize}
                    className="px-5 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {applyingOptimize ? <Spinner size="sm" className="text-white" /> : <Sparkles size={14} />}
                    {applyingOptimize ? 'Applying…' : 'Apply All Changes'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Share / Upload Links Modal ── */}
      {showShareModal && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" onClick={() => setShowShareModal(false)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Share2 size={18} className="text-blue-600" />
                  <h2 className="text-base font-bold text-gray-800">Share Upload Link</h2>
                </div>
                <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
              </div>

              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                {/* Create new link */}
                <div className="mb-5 bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <p className="text-xs font-semibold text-blue-800 mb-3">Create New Upload Link</p>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newLinkLabel}
                      onChange={e => setNewLinkLabel(e.target.value)}
                      placeholder="Label (optional, e.g. 'Client portal')"
                      className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
                    />
                    <input
                      type="text"
                      value={newLinkPassword}
                      onChange={e => setNewLinkPassword(e.target.value)}
                      placeholder="Password protection (optional)"
                      className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
                    />
                    <div>
                      <label className="block text-[11px] font-medium text-blue-700 mb-1">Require verification</label>
                      <select
                        value={newLinkRequireLogin}
                        onChange={e => setNewLinkRequireLogin(e.target.value)}
                        className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
                      >
                        <option value="none">No verification required</option>
                        <option value="email_otp">Email OTP verification</option>
                        <option value="phone_otp">Phone OTP verification</option>
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleCreateLink}
                    className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors flex items-center gap-1.5"
                  >
                    <LinkIcon size={13} />
                    Generate Link
                  </button>
                </div>

                {/* Existing links */}
                {shareLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                  </div>
                ) : uploadLinks.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-400">
                    <LinkIcon size={24} className="mx-auto mb-2 text-gray-300" />
                    No upload links yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Active Links ({uploadLinks.length})
                    </p>
                    {uploadLinks.map(link => (
                      <div
                        key={link.id}
                        className={`border rounded-xl p-4 transition-colors ${
                          link.is_usable
                            ? 'border-gray-200 bg-white'
                            : 'border-gray-100 bg-gray-50 opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                link.is_usable
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>
                                {link.is_usable ? 'Active' : link.is_expired ? 'Expired' : link.is_at_limit ? 'Limit reached' : 'Disabled'}
                              </span>
                              {link.password && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                                  🔒 Password
                                </span>
                              )}
                              {link.require_login === 'email_otp' && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600">
                                  📧 Email OTP
                                </span>
                              )}
                              {link.require_login === 'phone_otp' && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-purple-600">
                                  📱 Phone OTP
                                </span>
                              )}
                            </div>
                            {link.label && (
                              <p className="text-sm font-medium text-gray-800 mt-1">{link.label}</p>
                            )}
                            <p className="text-[10px] text-gray-400 mt-1 font-mono truncate">
                              {getUploadUrl(link.token)}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">
                              {link.upload_count} upload{link.upload_count !== 1 ? 's' : ''} · Created {new Date(link.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => copyLink(link.token, link.id)}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Copy link"
                            >
                              {copiedLinkId === link.id ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                            <a
                              href={getUploadUrl(link.token)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Open upload page"
                            >
                              <ExternalLink size={14} />
                            </a>
                            <button
                              onClick={() => handleToggleLink(link.id, link.is_active)}
                              className={`p-1.5 rounded-lg transition-colors ${
                                link.is_active
                                  ? 'hover:bg-amber-50 text-gray-400 hover:text-amber-600'
                                  : 'hover:bg-emerald-50 text-gray-400 hover:text-emerald-600'
                              }`}
                              title={link.is_active ? 'Disable link' : 'Enable link'}
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteLink(link.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                              title="Delete link"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
                <button
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── AI Chat floating button ──── */}
      {!showChat && (
        <button
          onClick={() => setShowChat(true)}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center group"
          title="AI Assistant"
        >
          <MessageSquare size={20} />
          <span className="absolute -top-8 right-0 px-2 py-1 bg-gray-900 text-white text-[10px] rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            AI Assistant
          </span>
        </button>
      )}

      {/* ── AI Chat slide-out panel ──── */}
      <div
        className={`fixed top-0 right-0 z-[60] h-full w-[380px] max-w-[90vw] bg-white shadow-2xl border-l transform transition-transform duration-300 ease-in-out ${
          showChat ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {showChat && (
          <WorkflowChat
            workflowId={workflowId}
            onWorkflowUpdate={fetchAll}
            onClose={() => setShowChat(false)}
          />
        )}
      </div>

      {/* ── Chat backdrop ──── */}
      {showChat && (
        <div
          className="fixed inset-0 z-[55] bg-black/10"
          onClick={() => setShowChat(false)}
        />
      )}

      {/* ── Workflow Settings slide-out panel ──── */}
      <div
        className={`fixed top-0 right-0 z-[60] h-full w-[420px] max-w-[90vw] bg-white shadow-2xl border-l transform transition-transform duration-300 ease-in-out ${
          showSettings ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {showSettings && (
          <WorkflowSettingsPanel
            workflowId={workflowId}
            onClose={() => setShowSettings(false)}
            onUpdate={fetchAll}
          />
        )}
      </div>

      {/* ── Settings backdrop ──── */}
      {showSettings && (
        <div
          className="fixed inset-0 z-[55] bg-black/10"
          onClick={() => setShowSettings(false)}
        />
      )}

      {/* ── Node Inspector overlay ──── */}
      {inspectNodeId && (
        <NodeInspector
          workflowId={workflowId}
          nodeId={inspectNodeId}
          onClose={() => setInspectNodeId(null)}
        />
      )}

      {/* ── Sheet editor modal (full spreadsheet) ── */}
      <SheetEditorModal
        open={showSheetModal}
        sheetId={sheetModalId}
        title={sheetModalTitle || undefined}
        onClose={closeSheetModal}
        onSaved={() => notify.success('Sheet saved')}
        navigateToFull={() => {
          closeSheetModal();
          navigate(`/sheets/${sheetModalId}`);
        }}
        workflowId={workflowId}
        workflowNodeId={sheetModalNodeId}
      />
    </div>
  );
}


/* ================================================================
   NodeConfigDialog — pre-creation config dialog for node setup
   Shows a modal with type-specific quick configuration fields
   before creating the node and opening the sidebar.
   ================================================================ */
function NodeConfigDialog({ nodeType, insertBetween, position, onSubmit, onCancel }) {
  const [label, setLabel] = React.useState('');
  const [config, setConfig] = React.useState({});
  const [creating, setCreating] = React.useState(false);

  const meta = NODE_TYPES.find(n => n.type === nodeType) || NODE_TYPES[0];

  const handleSubmit = async () => {
    setCreating(true);
    const overrides = { ...config };
    if (label.trim()) overrides._label = label.trim();
    await onSubmit(nodeType, overrides, insertBetween, position);
    setCreating(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95">
          {/* Header */}
          <div className={`px-6 py-4 border-b ${meta.color} bg-opacity-30`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{meta.icon}</span>
                <h3 className="font-semibold text-gray-900">Add {meta.label} Node</h3>
              </div>
              <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Label field — universal */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Node Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={meta.label}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none transition-all"
                autoFocus
              />
            </div>

            {/* Type-specific quick config */}
            {nodeType === 'input' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Source Type</label>
                <select
                  value={config.source_type || 'upload'}
                  onChange={(e) => setConfig(prev => ({ ...prev, source_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                >
                  <option value="upload">📤 Manual Upload</option>
                  <option value="form">📝 Form / CSV</option>
                  <option value="email_inbox">📧 Email Inbox</option>
                  <option value="webhook">🔗 Webhook</option>
                  <option value="google_drive">📁 Google Drive</option>
                  <option value="dropbox">☁️ Dropbox</option>
                  <option value="onedrive">☁️ OneDrive</option>
                  <option value="s3">🗄 S3 Bucket</option>
                  <option value="ftp">🖥 FTP/SFTP</option>
                  <option value="url_scrape">🌐 URL Scrape</option>
                  <option value="table">📊 Table / Sheet</option>
                </select>
              </div>
            )}

            {nodeType === 'rule' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Boolean Operator</label>
                <div className="flex gap-2">
                  {['AND', 'OR'].map(op => (
                    <button
                      key={op}
                      onClick={() => setConfig(prev => ({ ...prev, boolean_operator: op }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                        (config.boolean_operator || 'AND') === op
                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {op}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {nodeType === 'ai' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">AI Model</label>
                  <select
                    value={config.model || 'gemini-2.5-flash'}
                    onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro-preview-05-06">Gemini 2.5 Pro</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Output Key</label>
                  <input
                    value={config.output_key || ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, output_key: e.target.value }))}
                    placeholder="ai_analysis"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  />
                </div>
              </>
            )}

            {nodeType === 'validator' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
                <textarea
                  value={config.description || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What should reviewers validate?"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none resize-none"
                />
              </div>
            )}

            {nodeType === 'action' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Action Type</label>
                <select
                  value={config.plugin || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, plugin: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                >
                  <option value="">Select an action…</option>
                  <option value="email">📧 Send Email</option>
                  <option value="webhook">🔗 Webhook</option>
                  <option value="move_folder">📂 Move to Folder</option>
                  <option value="tag">🏷 Tag Documents</option>
                  <option value="export">📤 Export</option>
                </select>
              </div>
            )}

            {nodeType === 'listener' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Trigger Type</label>
                <select
                  value={config.trigger_type || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, trigger_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                >
                  <option value="">Select a trigger…</option>
                  <option value="manual_gate">🚪 Manual Gate</option>
                  <option value="schedule">⏰ Schedule</option>
                  <option value="webhook">🔗 Webhook</option>
                </select>
              </div>
            )}

            {nodeType === 'sheet' && (
              <div className="bg-cyan-50 rounded-lg p-3 text-xs text-cyan-700">
                <p className="font-medium">📊 Mode is auto-detected from connections</p>
              </div>
            )}

            {/* Info for simple node types */}
            {(nodeType === 'output' || nodeType === 'and_gate' || nodeType === 'doc_create') && (
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                {nodeType === 'output' && <p>Collects final results of the workflow pipeline.</p>}
                {nodeType === 'and_gate' && <p>Waits for all incoming connections to complete before passing data.</p>}
                {nodeType === 'doc_create' && <p>Generates documents from extracted data using templates.</p>}
              </div>
            )}

            {insertBetween && (
              <div className="bg-indigo-50 rounded-lg p-2.5 text-xs text-indigo-600 flex items-center gap-2">
                <span className="text-base">🔗</span>
                <span>Will be inserted between the connected nodes.</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={creating}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add {meta.label}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}


/* ================================================================
   Node Result Panel — shows document list after execution
   ================================================================ */
function NodeResultPanel({ node, executionResult, nodes, workflowId }) {
  const [expanded, setExpanded] = React.useState(false);
  const lastResult = node.last_result || {};
  const count = lastResult.count ?? 0;
  const docIds = lastResult.document_ids || [];

  // Build a title map from execution result
  const titleMap = React.useMemo(() => {
    const map = {};
    if (!executionResult) return map;
    // From output_documents
    (executionResult.output_documents || []).forEach((d) => {
      map[String(d.id)] = d.title;
    });
    // From node_results → ai/action per-doc results
    (executionResult.node_results || []).forEach((nr) => {
      if (nr.ai?.results) nr.ai.results.forEach((r) => { if (r.document_id) map[String(r.document_id)] = r.document_title || map[String(r.document_id)]; });
      if (nr.action?.results) nr.action.results.forEach((r) => { if (r.document_id) map[String(r.document_id)] = r.document_title || map[String(r.document_id)]; });
    });
    return map;
  }, [executionResult]);

  // Find AI results for this node if it's an AI node
  const aiResults = React.useMemo(() => {
    if (node.node_type !== 'ai' || !executionResult) return null;
    const nodeId = String(node.id);
    const nr = (executionResult.node_results || []).find((r) => r.node_id === nodeId);
    return nr?.ai || null;
  }, [node.id, node.node_type, executionResult]);

  // Find previous node to detect which docs were filtered
  const prevNodeDocIds = React.useMemo(() => {
    if (!executionResult) return null;
    const nrs = executionResult.node_results || [];
    const idx = nrs.findIndex((r) => r.node_id === String(node.id));
    if (idx <= 0) return null;
    return nrs[idx - 1].document_ids || [];
  }, [node.id, executionResult]);

  const filteredOutIds = prevNodeDocIds
    ? prevNodeDocIds.filter((id) => !docIds.includes(id))
    : [];

  const typeColors = {
    input: 'text-blue-600', rule: 'text-amber-600', listener: 'text-cyan-600',
    validator: 'text-emerald-600', action: 'text-purple-600', ai: 'text-rose-600',
    and_gate: 'text-orange-600', output: 'text-green-600',
  };

  return (
    <div className="mt-3 bg-gray-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
      >
        <div>
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last Result</p>
          <p className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <span className={typeColors[node.node_type] || 'text-gray-600'}>{count}</span>
            <span className="text-xs font-normal text-gray-500">
              document{count !== 1 ? 's' : ''} {node.node_type === 'action' ? 'processed' : 'passed'}
            </span>
          </p>
        </div>
        {docIds.length > 0 && (
          expanded
            ? <ChevronDown size={14} className="text-gray-400" />
            : <ChevronRight size={14} className="text-gray-400" />
        )}
      </button>

      {/* Action node summary */}
      {lastResult.sent != null && (
        <div className="px-3 pb-2 flex gap-2">
          {lastResult.sent > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">✓ {lastResult.sent} sent</span>}
          {lastResult.skipped > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">⊘ {lastResult.skipped} skipped</span>}
          {lastResult.failed > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">✕ {lastResult.failed} failed</span>}
        </div>
      )}

      {/* AI node summary */}
      {lastResult.ai_model && (
        <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-rose-500 font-medium">🧪 {lastResult.ai_model}</span>
          {lastResult.processed > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">✓ {lastResult.processed}</span>}
          {lastResult.failed > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">✕ {lastResult.failed}</span>}
          {lastResult.cache_hits > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-600 rounded font-medium">⚡ {lastResult.cache_hits} cached</span>}
        </div>
      )}

      {/* Doc Create node summary + links to created editor documents */}
      {lastResult.doc_create_status && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-indigo-500 font-medium">
              📄 {lastResult.creation_mode ? lastResult.creation_mode.replace(/_/g, ' ') : 'doc create'}
            </span>
            {lastResult.created > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">✓ {lastResult.created} created</span>}
            {lastResult.skipped > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">⊘ {lastResult.skipped} skipped</span>}
            {lastResult.failed > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">✕ {lastResult.failed} failed</span>}
          </div>
          {lastResult.created_document_ids?.length > 0 && (
            <div className="space-y-0.5">
              {lastResult.created_document_ids.map(docId => (
                <Link
                  key={docId}
                  to={`/drafter/${docId}`}
                  target="_blank"
                  className="flex items-center gap-1.5 text-[10px] text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded transition-colors"
                >
                  📄 Open in Editor
                  <span className="text-gray-400 font-mono text-[9px]">{docId.slice(0, 8)}…</span>
                  <ExternalLink size={9} className="text-gray-300 ml-auto" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded — document list */}
      {expanded && docIds.length > 0 && (
        <div className="border-t border-gray-200">
          {/* Passed documents */}
          <div className="px-3 py-2 max-h-52 overflow-y-auto space-y-1">
            <p className="text-[9px] uppercase text-gray-400 font-semibold mb-1">
              ✓ Passed ({docIds.length})
            </p>
            {docIds.map((docId) => {
              const title = titleMap[docId] || `Doc ${docId.slice(0, 8)}…`;
              // Find AI result for this doc
              const aiRes = aiResults?.results?.find((r) => String(r.document_id) === docId);
              return (
                <div key={docId} className="flex items-start gap-2 p-1.5 rounded-md bg-white border border-gray-100 hover:border-indigo-200 transition-colors">
                  <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Link
                        to={`/clm/documents/${workflowId}/${docId}`}
                        target="_blank"
                        className="text-xs font-medium text-gray-700 truncate hover:text-indigo-600 transition-colors cursor-pointer"
                        title="Open preview"
                      >
                        {title}
                      </Link>
                      {aiRes?.cache_hit && <span className="text-[9px] px-1 py-0.5 bg-sky-100 text-sky-600 rounded font-medium shrink-0" title="Served from cache">⚡</span>}
                    </div>
                    {aiRes && aiRes.status === 'success' && (
                      <div className="mt-0.5">
                        {aiRes.answer != null && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            aiRes.answer === 'yes' || aiRes.answer === true ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {String(aiRes.answer).toUpperCase()}
                          </span>
                        )}
                        {aiRes.parsed_fields && Object.keys(aiRes.parsed_fields).length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            {Object.entries(aiRes.parsed_fields).slice(0, 3).map(([k, v]) => (
                              <span key={k} className="mr-2">
                                <span className="text-gray-400">{k}:</span> <span className="font-medium">{String(v).slice(0, 30)}</span>
                              </span>
                            ))}
                            {Object.keys(aiRes.parsed_fields).length > 3 && <span className="text-gray-400">+{Object.keys(aiRes.parsed_fields).length - 3} more</span>}
                          </div>
                        )}
                        {aiRes.response && !aiRes.parsed_fields && !aiRes.answer && (
                          <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{aiRes.response}</p>
                        )}
                      </div>
                    )}
                    {aiRes && aiRes.status === 'error' && (
                      <p className="text-[10px] text-red-500 mt-0.5 truncate">{aiRes.error}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filtered out documents */}
          {filteredOutIds.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-200 max-h-32 overflow-y-auto space-y-1">
              <p className="text-[9px] uppercase text-red-400 font-semibold mb-1">
                ✕ Filtered Out ({filteredOutIds.length})
              </p>
              {filteredOutIds.map((docId) => {
                const title = titleMap[docId] || `Doc ${docId.slice(0, 8)}…`;
                return (
                  <div key={docId} className="flex items-center gap-2 p-1.5 rounded-md bg-red-50 border border-red-100">
                    <XCircle size={12} className="text-red-400 shrink-0" />
                    <Link
                      to={`/clm/documents/${workflowId}/${docId}`}
                      target="_blank"
                      className="text-xs text-red-700 truncate flex-1 hover:text-red-900 transition-colors cursor-pointer"
                      title="Open preview"
                    >
                      {title}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ================================================================
   Input Config Panel (sidebar) — source selector + email/upload config
   ================================================================ */
function InputConfigPanel({ node, onChange, workflowId, onUpdate }) {
  const serverConfig = node.config || { source_type: 'upload' };

  const [sourceType, setSourceType] = React.useState(serverConfig.source_type || 'upload');
  // Email
  const [emailHost, setEmailHost] = React.useState(serverConfig.email_host || 'imap.gmail.com');
  const [emailUser, setEmailUser] = React.useState(serverConfig.email_user || '');
  const [emailPassword, setEmailPassword] = React.useState(serverConfig.email_password || '');
  const [emailFolder, setEmailFolder] = React.useState(serverConfig.email_folder || 'INBOX');
  const [filterSubject, setFilterSubject] = React.useState(serverConfig.email_filter_subject || '');
  const [filterSender, setFilterSender] = React.useState(serverConfig.email_filter_sender || '');
  const [includeBody, setIncludeBody] = React.useState(serverConfig.include_body_as_document !== false);
  const [includeAttachments, setIncludeAttachments] = React.useState(serverConfig.include_attachments !== false);
  const [autoExtract, setAutoExtract] = React.useState(serverConfig.auto_extract !== false);
  const [refetchInterval, setRefetchInterval] = React.useState(serverConfig.email_refetch_interval || 0);
  // Google Drive
  const [googleFolderId, setGoogleFolderId] = React.useState(serverConfig.google_folder_id || '');
  const [googleAccess, setGoogleAccess] = React.useState(serverConfig.google_access || 'public');
  const [googleApiKey, setGoogleApiKey] = React.useState(serverConfig.google_api_key || '');
  const [googleCreds, setGoogleCreds] = React.useState(serverConfig.google_credentials_json || '');
  const [showGoogleHelp, setShowGoogleHelp] = React.useState(false);
  // Dropbox
  const [dropboxToken, setDropboxToken] = React.useState(serverConfig.dropbox_access_token || '');
  const [dropboxPath, setDropboxPath] = React.useState(serverConfig.dropbox_folder_path || '');
  // OneDrive
  const [onedriveToken, setOnedriveToken] = React.useState(serverConfig.onedrive_access_token || '');
  const [onedrivePath, setOnedrivePath] = React.useState(serverConfig.onedrive_folder_path || '');
  const [onedriveDrive, setOnedriveDrive] = React.useState(serverConfig.onedrive_drive_id || '');
  // S3
  const [s3Bucket, setS3Bucket] = React.useState(serverConfig.s3_bucket || '');
  const [s3Prefix, setS3Prefix] = React.useState(serverConfig.s3_prefix || '');
  const [s3AccessKey, setS3AccessKey] = React.useState(serverConfig.s3_access_key || '');
  const [s3SecretKey, setS3SecretKey] = React.useState(serverConfig.s3_secret_key || '');
  const [s3Region, setS3Region] = React.useState(serverConfig.s3_region || 'us-east-1');
  // FTP
  const [ftpHost, setFtpHost] = React.useState(serverConfig.ftp_host || '');
  const [ftpPort, setFtpPort] = React.useState(serverConfig.ftp_port || '21');
  const [ftpUser, setFtpUser] = React.useState(serverConfig.ftp_user || '');
  const [ftpPassword, setFtpPassword] = React.useState(serverConfig.ftp_password || '');
  const [ftpPath, setFtpPath] = React.useState(serverConfig.ftp_path || '/');
  const [ftpProtocol, setFtpProtocol] = React.useState(serverConfig.ftp_protocol || 'ftp');
  // URL Scrape
  const [scrapeUrls, setScrapeUrls] = React.useState((serverConfig.urls || []).join('\n'));
  const [scrapeText, setScrapeText] = React.useState(serverConfig.scrape_text !== false);
  // Table
  const [googleSheetUrl, setGoogleSheetUrl] = React.useState(serverConfig.google_sheet_url || '');
  const [tableFile, setTableFile] = React.useState(null);
  const [tablePreviewData, setTablePreviewData] = React.useState(null);
  const [tableUploading, setTableUploading] = React.useState(false);
  const [aiExtract, setAiExtract] = React.useState(serverConfig.ai_extract || false);
  const [sheetNames, setSheetNames] = React.useState([]);
  const [selectedSheet, setSelectedSheet] = React.useState('');
  const [tableImported, setTableImported] = React.useState(!!(serverConfig.table_info));
  // File extensions filter (shared by cloud sources)
  const [fileExtensions, setFileExtensions] = React.useState((serverConfig.file_extensions || []).join(', '));
  // Form / CSV state
  const [formColumns, setFormColumns] = React.useState(serverConfig.form_columns || [{ name: '' }]);
  const [formRows, setFormRows] = React.useState(serverConfig.form_rows || [{}]);
  const [formTargetSheet, setFormTargetSheet] = React.useState(serverConfig.form_target_sheet || '');
  const [formNewSheetTitle, setFormNewSheetTitle] = React.useState('');
  const [formSheets, setFormSheets] = React.useState([]);
  const [formLoadingSheets, setFormLoadingSheets] = React.useState(false);
  const [formSaving, setFormSaving] = React.useState(false);
  // Sheet source state (input → sheet → share as form)
  const [sheetSourceSheets, setSheetSourceSheets] = React.useState([]);
  const [sheetSourceLoading, setSheetSourceLoading] = React.useState(false);
  const [sheetSourceId, setSheetSourceId] = React.useState(serverConfig.sheet_id || '');
  const [sheetSourceLinks, setSheetSourceLinks] = React.useState([]);
  const [sheetSourceLinksLoading, setSheetSourceLinksLoading] = React.useState(false);
  const [sheetSourceCreatingLink, setSheetSourceCreatingLink] = React.useState(false);
  const [sheetSourceCopiedToken, setSheetSourceCopiedToken] = React.useState(null);
  const [sheetSourceCreatingSheet, setSheetSourceCreatingSheet] = React.useState(false);
  const [sheetSourceNewName, setSheetSourceNewName] = React.useState('');
  // UI state
  const [dirty, setDirty] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [lastCheckResult, setLastCheckResult] = React.useState(null);
  const [showTypeFields, setShowTypeFields] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);
  const [showMoreSources, setShowMoreSources] = React.useState(false);
  // Source-change confirmation dialog
  const [pendingSource, setPendingSource] = React.useState(null);
  const [showSourceChangeDialog, setShowSourceChangeDialog] = React.useState(false);
  // Integration plugin state (when selected as input_type)
  const [integrationPlugins, setIntegrationPlugins] = React.useState([]);
  const [integrationSettings, setIntegrationSettings] = React.useState(serverConfig.integration_settings || {});
  // Saved credentials from user profile
  const [savedCredentials, setSavedCredentials] = React.useState([]);
  const [credentialId, setCredentialId] = React.useState(serverConfig.credential_id || '');

  // Fetch available integration plugins (org-enabled)
  React.useEffect(() => {
    let cancelled = false;
    import('../../services/clm/clmApi').then(({ workflowApi }) => {
      workflowApi.inputPluginIntegrations().then(({ data }) => {
        if (!cancelled) setIntegrationPlugins(data.plugins || []);
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch saved credentials from user profile
  React.useEffect(() => {
    let cancelled = false;
    import('../../services/userService').then(({ userService }) => {
      userService.getMyInputCredentials().then((data) => {
        if (!cancelled) setSavedCredentials(data || []);
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    const c = node.config || {};
    setSourceType(c.source_type || 'upload');
    setEmailHost(c.email_host || 'imap.gmail.com');
    setEmailUser(c.email_user || '');
    setEmailPassword(c.email_password || '');
    setEmailFolder(c.email_folder || 'INBOX');
    setFilterSubject(c.email_filter_subject || '');
    setFilterSender(c.email_filter_sender || '');
    setIncludeBody(c.include_body_as_document !== false);
    setIncludeAttachments(c.include_attachments !== false);
    setAutoExtract(c.auto_extract !== false);
    setRefetchInterval(c.email_refetch_interval || 0);
    setGoogleFolderId(c.google_folder_id || '');
    setGoogleAccess(c.google_access || 'public');
    setGoogleApiKey(c.google_api_key || '');
    setGoogleCreds(c.google_credentials_json || '');
    setShowGoogleHelp(false);
    setDropboxToken(c.dropbox_access_token || '');
    setDropboxPath(c.dropbox_folder_path || '');
    setOnedriveToken(c.onedrive_access_token || '');
    setOnedrivePath(c.onedrive_folder_path || '');
    setOnedriveDrive(c.onedrive_drive_id || '');
    setS3Bucket(c.s3_bucket || '');
    setS3Prefix(c.s3_prefix || '');
    setS3AccessKey(c.s3_access_key || '');
    setS3SecretKey(c.s3_secret_key || '');
    setS3Region(c.s3_region || 'us-east-1');
    setFtpHost(c.ftp_host || '');
    setFtpPort(c.ftp_port || '21');
    setFtpUser(c.ftp_user || '');
    setFtpPassword(c.ftp_password || '');
    setFtpPath(c.ftp_path || '/');
    setFtpProtocol(c.ftp_protocol || 'ftp');
    setScrapeUrls((c.urls || []).join('\n'));
    setScrapeText(c.scrape_text !== false);
    setGoogleSheetUrl(c.google_sheet_url || '');
    setTableFile(null);
    setTablePreviewData(null);
    setTableUploading(false);
    setAiExtract(c.ai_extract || false);
    setSheetNames([]);
    setSelectedSheet('');
    setTableImported(!!(c.table_info));
    setFileExtensions((c.file_extensions || []).join(', '));
    setFormColumns(c.form_columns || [{ name: '' }]);
    setFormRows(c.form_rows || [{}]);
    setFormTargetSheet(c.form_target_sheet || '');
    setFormNewSheetTitle('');
    setFormSaving(false);
    // Sheet source
    setSheetSourceId(c.sheet_id || '');
    setSheetSourceLinks([]);
    setSheetSourceNewName('');
    setSheetSourceCreatingSheet(false);
    // Integration plugin settings
    setIntegrationSettings(c.integration_settings || {});
    // Saved credential reference
    setCredentialId(c.credential_id || '');
    setDirty(false);
    setLastCheckResult(null);
    setTestResult(null);
  }, [node.id]);

  // Server-side email polling status
  const serverEmailStatus = (node.config || {});
  const lastCheckedAt = serverEmailStatus.email_last_checked_at;
  const lastCheckStatus = serverEmailStatus.email_last_check_status;
  const lastCheckError = serverEmailStatus.email_last_check_error;

  const parseExtensions = () => fileExtensions.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  // Filter saved credentials matching the current source type
  const matchingCredentials = savedCredentials.filter(c => c.credential_type === sourceType);
  const usingCredential = !!credentialId;

  // Credential selector widget (reused by all source types that support it)
  const CredentialPicker = () => {
    if (matchingCredentials.length === 0 && !credentialId) return null;
    return (
      <div className="mb-3">
        <label className="block text-[10px] text-gray-400 font-medium mb-1">Saved Credentials</label>
        <select
          value={credentialId}
          onChange={(e) => { setCredentialId(e.target.value); setDirty(true); }}
          className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none bg-white"
        >
          <option value="">✏️ Enter manually</option>
          {matchingCredentials.map(c => (
            <option key={c.id} value={c.id}>🔑 {c.label}</option>
          ))}
        </select>
        {credentialId && (
          <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Using saved credential — secrets are stored securely in your profile
          </p>
        )}
        {matchingCredentials.length === 0 && (
          <p className="text-[10px] text-gray-400 mt-1">
            Tip: Save credentials in <span className="font-medium">Settings → Input Node Credentials</span> to reuse across workflows
          </p>
        )}
      </div>
    );
  };

  const buildConfig = () => {
    const config = { source_type: sourceType };
    // When using a saved credential, store the reference — backend resolves secrets
    if (credentialId) config.credential_id = credentialId;
    if (sourceType === 'email_inbox') {
      // Credential fields: only include if entering manually (no saved cred)
      if (!credentialId) {
        Object.assign(config, {
          email_host: emailHost, email_user: emailUser, email_password: emailPassword,
        });
      }
      // Non-credential config (always saved)
      Object.assign(config, {
        email_folder: emailFolder, email_filter_subject: filterSubject,
        email_filter_sender: filterSender, include_body_as_document: includeBody,
        include_attachments: includeAttachments, auto_extract: autoExtract, auto_execute: false,
        email_refetch_interval: refetchInterval,
      });
    } else if (sourceType === 'google_drive') {
      const gConfig = {
        google_folder_id: googleFolderId, google_access: googleAccess,
        file_extensions: parseExtensions(),
      };
      if (!credentialId) {
        if (googleAccess === 'public') {
          gConfig.google_api_key = googleApiKey;
        } else {
          gConfig.google_credentials_json = googleCreds;
        }
      }
      Object.assign(config, gConfig);
    } else if (sourceType === 'dropbox') {
      Object.assign(config, {
        dropbox_folder_path: dropboxPath,
        file_extensions: parseExtensions(),
      });
      if (!credentialId) config.dropbox_access_token = dropboxToken;
    } else if (sourceType === 'onedrive') {
      Object.assign(config, {
        onedrive_folder_path: onedrivePath,
        file_extensions: parseExtensions(),
      });
      if (!credentialId) {
        config.onedrive_access_token = onedriveToken;
        config.onedrive_drive_id = onedriveDrive;
      }
    } else if (sourceType === 's3') {
      Object.assign(config, {
        s3_bucket: s3Bucket, s3_prefix: s3Prefix,
        file_extensions: parseExtensions(),
      });
      if (!credentialId) {
        Object.assign(config, {
          s3_access_key: s3AccessKey, s3_secret_key: s3SecretKey, s3_region: s3Region,
        });
      }
    } else if (sourceType === 'ftp') {
      Object.assign(config, {
        ftp_path: ftpPath,
        file_extensions: parseExtensions(),
      });
      if (!credentialId) {
        Object.assign(config, {
          ftp_host: ftpHost, ftp_port: ftpPort, ftp_user: ftpUser,
          ftp_password: ftpPassword, ftp_protocol: ftpProtocol,
        });
      }
    } else if (sourceType === 'url_scrape') {
      Object.assign(config, {
        urls: scrapeUrls.split('\n').map(u => u.trim()).filter(Boolean),
        scrape_text: scrapeText,
      });
    } else if (sourceType === 'table') {
      Object.assign(config, {
        google_sheet_url: googleSheetUrl || '',
        ai_extract: aiExtract,
      });
      // Preserve table_info from server config if exists
      if (serverConfig.table_info) config.table_info = serverConfig.table_info;
    } else if (sourceType === 'form') {
      Object.assign(config, {
        form_columns: formColumns.filter(c => c.name.trim()),
        form_rows: formRows,
        form_target_sheet: formTargetSheet,
      });
    } else if (sourceType === 'sheet') {
      Object.assign(config, {
        sheet_id: sheetSourceId,
      });
    }
    // If source_type is an integration plugin (webhook, gmail, slack, teams),
    // store the plugin settings alongside source_type
    const isIntegrationSource = integrationPlugins.some(p => p.name === sourceType && p.org_enabled);
    if (isIntegrationSource) {
      config.integration_plugin = sourceType;
      config.integration_settings = integrationSettings;
    }
    return config;
  };

  const handleSave = () => {
    onChange(buildConfig());
    setDirty(false);
    notify.success('Input config saved');
  };

  const handleCheckInbox = async () => {
    if (dirty) { onChange(buildConfig()); setDirty(false); }
    setChecking(true);
    try {
      const { data } = await workflowApi.checkInbox(workflowId, node.id);
      setLastCheckResult(data);
      onUpdate?.();
      if (data.found > 0) {
        const skipMsg = data.skipped ? `, ${data.skipped} skipped (already fetched)` : '';
        notify.success(`Found ${data.found} new document(s)${skipMsg}`);
      } else if (data.skipped > 0) {
        notify.info(`No new emails — ${data.skipped} already fetched`);
      } else {
        notify.info('No new emails found');
      }
    } catch (e) {
      notify.error('Inbox check failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setChecking(false);
    }
  };

  const handleTestConnection = async () => {
    if (dirty) { onChange(buildConfig()); setDirty(false); }
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await workflowApi.testConnection(workflowId, node.id);
      setTestResult(data);
      if (data.ok) notify.success(data.message);
      else notify.error(data.message);
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      setTestResult({ ok: false, message: msg });
      notify.error('Connection test failed: ' + msg);
    } finally {
      setTesting(false);
    }
  };

  // ── Table handlers ──
  const handleTablePreview = async (file, sheetUrl) => {
    setTableUploading(true);
    setTablePreviewData(null);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      if (sheetUrl) fd.append('google_sheet_url', sheetUrl);
      if (aiExtract) fd.append('ai_extract', 'true');
      if (selectedSheet) fd.append('sheet_name', selectedSheet);
      const { data } = await workflowApi.tablePreview(workflowId, fd);
      setTablePreviewData(data);
      if (data.sheet_names?.length) setSheetNames(data.sheet_names);
    } catch (e) {
      notify.error('Preview failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setTableUploading(false);
    }
  };

  const handleTableImport = async () => {
    if (!tableFile && !googleSheetUrl) { notify.error('Add a file or Google Sheet URL'); return; }
    setTableUploading(true);
    try {
      const fd = new FormData();
      if (tableFile) fd.append('file', tableFile);
      if (googleSheetUrl) fd.append('google_sheet_url', googleSheetUrl);
      if (aiExtract) fd.append('ai_extract', 'true');
      if (selectedSheet) fd.append('sheet_name', selectedSheet);
      fd.append('input_node_id', node.id);
      const { data } = await workflowApi.tableUpload(workflowId, fd);
      notify.success(`Imported ${data.documents_created} rows as documents (${data.col_count} columns)`);
      setTableImported(true);
      setTablePreviewData(data);
      // Save the config so source_type=table + google_sheet_url are persisted
      const cfg = { ...buildConfig(), source_type: 'table' };
      if (data.table_info) cfg.table_info = data.table_info;
      if (googleSheetUrl) cfg.google_sheet_url = googleSheetUrl;
      cfg.ai_extract = aiExtract;
      onChange(cfg);
      setDirty(false);
      onUpdate?.();
    } catch (e) {
      notify.error('Import failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setTableUploading(false);
    }
  };

  // ── Form / CSV handlers ──
  // Fetch available sheets for the form target dropdown
  React.useEffect(() => {
    if (sourceType !== 'form') return;
    let cancelled = false;
    setFormLoadingSheets(true);
    import('@services/sheetsService').then(({ sheetsService }) => {
      sheetsService.list().then(({ data }) => {
        if (!cancelled) {
          const list = Array.isArray(data) ? data : (data.results || []);
          setFormSheets(list);
        }
      }).catch(() => {}).finally(() => { if (!cancelled) setFormLoadingSheets(false); });
    });
    return () => { cancelled = true; };
  }, [sourceType]);

  const handleFormAddColumn = () => {
    setFormColumns(prev => [...prev, { name: '' }]);
    setDirty(true);
  };

  const handleFormRemoveColumn = (idx) => {
    setFormColumns(prev => prev.filter((_, i) => i !== idx));
    // Also clean rows
    setFormRows(prev => prev.map(row => {
      const copy = { ...row };
      const removed = formColumns[idx]?.name;
      if (removed) delete copy[removed];
      return copy;
    }));
    setDirty(true);
  };

  const handleFormColumnRename = (idx, newName) => {
    const oldName = formColumns[idx]?.name;
    setFormColumns(prev => prev.map((c, i) => i === idx ? { name: newName } : c));
    // Rename key in all rows
    if (oldName && newName && oldName !== newName) {
      setFormRows(prev => prev.map(row => {
        const copy = { ...row };
        if (oldName in copy) {
          copy[newName] = copy[oldName];
          delete copy[oldName];
        }
        return copy;
      }));
    }
    setDirty(true);
  };

  const handleFormAddRow = () => {
    setFormRows(prev => [...prev, {}]);
    setDirty(true);
  };

  const handleFormRemoveRow = (idx) => {
    setFormRows(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const handleFormCellChange = (rowIdx, colName, value) => {
    setFormRows(prev => prev.map((row, i) => i === rowIdx ? { ...row, [colName]: value } : row));
    setDirty(true);
  };

  const handleFormCreateSheet = async () => {
    try {
      const { sheetsService } = await import('@services/sheetsService');
      const title = formNewSheetTitle.trim() || `Form Data ${new Date().toLocaleDateString()}`;
      const { data } = await sheetsService.create({ title, row_count: 0, col_count: 0 });
      setFormSheets(prev => [data, ...prev]);
      setFormTargetSheet(data.id);
      setFormNewSheetTitle('');
      setDirty(true);
      notify.success(`Sheet "${title}" created`);
    } catch (e) {
      notify.error('Failed to create sheet: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleFormSaveCSVAndExecute = async () => {
    // Validate
    const validCols = formColumns.filter(c => c.name.trim());
    if (validCols.length === 0) { notify.error('Add at least one column'); return; }
    const validRows = formRows.filter(row => validCols.some(c => row[c.name]?.toString().trim()));
    if (validRows.length === 0) { notify.error('Add at least one row with data'); return; }

    setFormSaving(true);
    try {
      // Build CSV content
      const headers = validCols.map(c => c.name);
      const csvLines = [headers.join(',')];
      validRows.forEach(row => {
        const cells = headers.map(h => {
          const val = (row[h] || '').toString().replace(/"/g, '""');
          return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
        });
        csvLines.push(cells.join(','));
      });
      const csvContent = csvLines.join('\n');

      // Create a CSV Blob and upload as file
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const file = new File([blob], 'form_data.csv', { type: 'text/csv' });

      // If a target sheet is selected, save to it first
      if (formTargetSheet) {
        const { sheetsService } = await import('@services/sheetsService');
        const targetSheet = formSheets.find(s => s.id === formTargetSheet);
        // Ensure columns exist
        const existingCols = (targetSheet?.columns || []).map(c => c.label);
        for (const h of headers) {
          if (!existingCols.includes(h)) {
            await sheetsService.addColumn(formTargetSheet, { label: h, type: 'text' });
          }
        }
        // Add rows with cell data
        for (const row of validRows) {
          const { data: newRow } = await sheetsService.addRow(formTargetSheet);
          const cells = [];
          if (targetSheet?.columns) {
            for (const col of targetSheet.columns) {
              if (row[col.label] != null) {
                cells.push({ row_order: newRow.order, column_key: col.key, raw_value: String(row[col.label]) });
              }
            }
          }
          // Also handle new columns
          if (cells.length > 0) {
            await sheetsService.bulkUpdate(formTargetSheet, cells);
          }
        }
        notify.success(`Saved ${validRows.length} rows to sheet`);
      }

      // Upload CSV as document to the workflow
      const fd = new FormData();
      fd.append('files', file);
      await workflowApi.upload(workflowId, fd);

      // Save the config
      const cfg = buildConfig();
      cfg.form_columns = validCols;
      cfg.form_rows = validRows;
      cfg.form_target_sheet = formTargetSheet;
      onChange(cfg);
      setDirty(false);
      onUpdate?.();
      notify.success(`Uploaded ${validRows.length} rows as CSV document`);
    } catch (e) {
      notify.error('Save failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setFormSaving(false);
    }
  };

  // ── Sheet source handlers ──
  React.useEffect(() => {
    if (sourceType !== 'sheet') return;
    let cancelled = false;
    setSheetSourceLoading(true);
    import('@services/sheetsService').then(({ sheetsService }) => {
      sheetsService.list().then(({ data }) => {
        if (!cancelled) {
          const list = Array.isArray(data) ? data : (data.results || []);
          setSheetSourceSheets(list);
        }
      }).catch(() => {}).finally(() => { if (!cancelled) setSheetSourceLoading(false); });
    });
    return () => { cancelled = true; };
  }, [sourceType]);

  // Fetch share links for the selected sheet
  const fetchSheetSourceLinks = React.useCallback(async () => {
    if (!sheetSourceId) { setSheetSourceLinks([]); return; }
    setSheetSourceLinksLoading(true);
    try {
      const { sheetsService } = await import('@services/sheetsService');
      const { data } = await sheetsService.listShareLinks(sheetSourceId);
      setSheetSourceLinks(data);
    } catch { /* swallow */ }
    finally { setSheetSourceLinksLoading(false); }
  }, [sheetSourceId]);

  React.useEffect(() => {
    if (sourceType === 'sheet' && sheetSourceId) fetchSheetSourceLinks();
  }, [sourceType, sheetSourceId, fetchSheetSourceLinks]);

  const handleSheetSourceCreateLink = async () => {
    if (!sheetSourceId) return;
    setSheetSourceCreatingLink(true);
    try {
      const { sheetsService } = await import('@services/sheetsService');
      const sheet = sheetSourceSheets.find(s => s.id === sheetSourceId);
      await sheetsService.createShareLink(sheetSourceId, {
        label: (sheet?.title || 'Sheet') + ' Intake Form',
        workflow: workflowId,
        workflow_node: node.id,
      });
      await fetchSheetSourceLinks();
    } catch (e) {
      notify.error('Failed to create link: ' + (e?.response?.data?.error || e?.message));
    } finally {
      setSheetSourceCreatingLink(false);
    }
  };

  const handleSheetSourceCopyLink = (token) => {
    const url = `${window.location.origin}/sheets/form/${token}`;
    navigator.clipboard.writeText(url);
    setSheetSourceCopiedToken(token);
    setTimeout(() => setSheetSourceCopiedToken(null), 2000);
  };

  const handleSheetSourceToggleLink = async (linkId, isActive) => {
    if (!sheetSourceId) return;
    try {
      const { sheetsService } = await import('@services/sheetsService');
      await sheetsService.updateShareLink(sheetSourceId, linkId, { is_active: !isActive });
      await fetchSheetSourceLinks();
    } catch { /* swallow */ }
  };

  const handleSheetSourceDeleteLink = async (linkId) => {
    if (!sheetSourceId) return;
    try {
      const { sheetsService } = await import('@services/sheetsService');
      await sheetsService.deleteShareLink(sheetSourceId, linkId);
      await fetchSheetSourceLinks();
    } catch { /* swallow */ }
  };

  const handleSheetSourceCreate = async () => {
    setSheetSourceCreatingSheet(true);
    try {
      const { sheetsService } = await import('@services/sheetsService');
      const title = sheetSourceNewName.trim() || `Input Sheet ${new Date().toLocaleDateString()}`;
      const { data } = await sheetsService.create({ title, row_count: 10, col_count: 5 });
      setSheetSourceSheets(prev => [data, ...prev]);
      setSheetSourceId(data.id);
      setSheetSourceNewName('');
      setDirty(true);
      notify.success(`Sheet "${title}" created`);
    } catch (e) {
      notify.error('Failed to create sheet: ' + (e?.response?.data?.error || e?.message));
    } finally {
      setSheetSourceCreatingSheet(false);
    }
  };

  const cloudSources = ['google_drive', 'dropbox', 'onedrive', 's3', 'ftp', 'url_scrape'];

  const primarySources = [
    { value: 'upload',       icon: '📄', label: 'Upload',   desc: 'Manual upload' },
    { value: 'sheet',        icon: '📊', label: 'Sheet',    desc: 'Sheet form' },
    { value: 'form',         icon: '📝', label: 'Form',     desc: 'CSV form' },
    { value: 'url_scrape',   icon: '🌐', label: 'URL',      desc: 'Fetch URLs' },
    { value: 'table',        icon: '�', label: 'Table',    desc: 'Spreadsheet' },
    { value: 'email_inbox',  icon: '📧', label: 'Email',    desc: 'IMAP inbox' },
    { value: 'webhook',      icon: '🔗', label: 'Webhook',  desc: 'API ingest' },
    { value: 'google_drive', icon: '🗂️', label: 'G-Drive',  desc: 'Google Drive' },
  ];

  const moreSources = [
    { value: 'dropbox',      icon: '📦', label: 'Dropbox',  desc: 'Dropbox folder' },
    { value: 'onedrive',     icon: '☁️', label: 'OneDrive', desc: 'SharePoint' },
    { value: 's3',           icon: '🪣', label: 'S3',       desc: 'AWS bucket' },
    { value: 'ftp',          icon: '🖥️', label: 'FTP',      desc: 'FTP/SFTP' },
  ];

  // Integration plugins as input sources (only org-enabled ones)
  const integrationSources = integrationPlugins
    .filter(p => p.org_enabled)
    .map(p => ({
      value: p.name,
      icon: p.icon,
      label: p.display_name?.replace(' Notifier', '') || p.name,
      desc: `${p.display_name} — receive notifications as input`,
      isIntegration: true,
    }));

  // Auto-expand "More" if the current source type is in the secondary list
  const isMoreSource = moreSources.some(s => s.value === sourceType);
  const isIntegrationSource = integrationSources.some(s => s.value === sourceType);

  const handleSourceSwitch = (newSource) => {
    if (newSource === sourceType) return;
    // If switching away from a source that may have documents, show confirmation
    if (sourceType !== 'upload' || sourceType === 'upload') {
      setPendingSource(newSource);
      setShowSourceChangeDialog(true);
    } else {
      setSourceType(newSource);
      setDirty(true);
    }
  };

  const confirmSourceSwitch = () => {
    if (pendingSource) {
      setSourceType(pendingSource);
      setDirty(true);
    }
    setShowSourceChangeDialog(false);
    setPendingSource(null);
  };

  const cancelSourceSwitch = () => {
    setShowSourceChangeDialog(false);
    setPendingSource(null);
  };

  const SourceBtn = ({ s }) => (
    <button
      onClick={() => handleSourceSwitch(s.value)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150 ${
        sourceType === s.value
          ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
          : 'bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      <span className="text-sm leading-none">{s.icon}</span>
      <span>{s.label}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Source-change confirmation dialog */}
      {showSourceChangeDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="bg-white rounded-2xl shadow-2xl p-5 max-w-sm w-full mx-4 border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Change source?</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-1">
              Switching from <span className="font-medium text-gray-700">{
                [...primarySources, ...moreSources].find(s => s.value === sourceType)?.label || sourceType
              }</span> to <span className="font-medium text-gray-700">{
                [...primarySources, ...moreSources].find(s => s.value === pendingSource)?.label || pendingSource
              }</span>.
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed mb-4">
              Existing documents will be archived. Cached extractions are preserved.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelSourceSwitch}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={confirmSourceSwitch}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                Switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Source type selector */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Source</label>
        <div className="flex flex-wrap gap-1.5">
          {primarySources.map((s) => <SourceBtn key={s.value} s={s} />)}
        </div>

        {/* More cloud sources */}
        <button
          onClick={() => setShowMoreSources(!showMoreSources)}
          className="mt-2 text-[10px] font-medium text-gray-400 hover:text-blue-500 transition-colors"
        >
          {(showMoreSources || isMoreSource) ? '− Hide' : '+ More'} cloud sources
        </button>
        {(showMoreSources || isMoreSource) && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {moreSources.map((s) => <SourceBtn key={s.value} s={s} />)}
          </div>
        )}

        {/* Integration plugins as input type */}
        {integrationSources.length > 0 && (
          <>
            <div className="mt-3 mb-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Integrations</label>
              <p className="text-[9px] text-gray-400 mt-0.5">Receive notifications as document input</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {integrationSources.map((s) => <SourceBtn key={s.value} s={s} />)}
            </div>
          </>
        )}
      </div>

      {/* Document type selection removed from input node config */}

      {/* Webhook source info */}
      {sourceType === 'webhook' && (
        <div className="rounded-xl bg-gray-50 p-3 border border-gray-100">
          <code className="block text-[10px] bg-white border border-gray-200 px-2 py-1 rounded-md font-mono text-gray-600">POST /api/clm/workflows/{'{id}'}/webhook-ingest/</code>
        </div>
      )}

      {/* Form / CSV source */}
      {sourceType === 'form' && (
        <div className="space-y-3">
          {/* Column definitions */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1.5">Columns</label>
            <div className="space-y-1.5">
              {formColumns.map((col, ci) => (
                <div key={ci} className="flex items-center gap-1.5">
                  <input
                    value={col.name}
                    onChange={(e) => handleFormColumnRename(ci, e.target.value)}
                    placeholder={`Column ${ci + 1}`}
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
                  />
                  {formColumns.length > 1 && (
                    <button onClick={() => handleFormRemoveColumn(ci)}
                      className="px-1.5 text-red-400 hover:text-red-600 text-sm shrink-0">×</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={handleFormAddColumn}
              className="mt-1.5 text-[11px] text-blue-600 hover:text-blue-700 font-medium transition-colors">
              + Add Column
            </button>
          </div>

          {/* Data rows — editable table */}
          {formColumns.some(c => c.name.trim()) && (
            <div>
              <label className="block text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1.5">
                Data ({formRows.length} row{formRows.length !== 1 ? 's' : ''})
              </label>
              <div className="overflow-auto max-h-72 border border-gray-100 rounded-xl">
                <table className="min-w-full text-[10px]">
                  <thead className="bg-gray-50/80 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-gray-400 font-medium w-8">#</th>
                      {formColumns.filter(c => c.name.trim()).map((col, ci) => (
                        <th key={ci} className="px-2 py-1.5 text-left text-gray-500 font-semibold whitespace-nowrap">{col.name}</th>
                      ))}
                      <th className="px-2 py-1.5 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {formRows.map((row, ri) => (
                      <tr key={ri} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-2 py-1 text-gray-300">{ri + 1}</td>
                        {formColumns.filter(c => c.name.trim()).map((col, ci) => (
                          <td key={ci} className="px-1 py-0.5">
                            <input
                              value={row[col.name] || ''}
                              onChange={(e) => handleFormCellChange(ri, col.name, e.target.value)}
                              className="w-full px-1.5 py-1 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded text-[10px] text-gray-700 outline-none focus:ring-1 focus:ring-blue-100 bg-transparent"
                              placeholder="—"
                            />
                          </td>
                        ))}
                        <td className="px-1 py-0.5">
                          <button onClick={() => handleFormRemoveRow(ri)}
                            className="text-red-300 hover:text-red-500 text-xs">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={handleFormAddRow}
                className="mt-1.5 text-[11px] text-blue-600 hover:text-blue-700 font-medium transition-colors">
                + Add Row
              </button>
            </div>
          )}

          {/* Save to sheet selector */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1.5">Save to Sheet</label>
            {formLoadingSheets ? (
              <p className="text-[11px] text-gray-400">Loading sheets…</p>
            ) : (
              <>
                <select
                  value={formTargetSheet}
                  onChange={(e) => { setFormTargetSheet(e.target.value); setDirty(true); }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none bg-white"
                >
                  <option value="">— None (CSV upload only) —</option>
                  {formSheets.map(s => (
                    <option key={s.id} value={s.id}>{s.title || `Sheet ${s.id.slice(0, 8)}`}</option>
                  ))}
                </select>
                {/* Create new sheet inline */}
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    value={formNewSheetTitle}
                    onChange={(e) => setFormNewSheetTitle(e.target.value)}
                    placeholder="New sheet name…"
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleFormCreateSheet(); }}
                  />
                  <button
                    onClick={handleFormCreateSheet}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
                  >
                    + Create
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Save CSV & Execute */}
          <button
            onClick={handleFormSaveCSVAndExecute}
            disabled={formSaving || !formColumns.some(c => c.name.trim())}
            className="w-full px-2 py-2.5 bg-gray-800 text-white rounded-xl text-xs font-medium hover:bg-gray-900 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-sm"
          >
            {formSaving ? (
              <><Spinner size="sm" className="text-white" /> Saving…</>
            ) : (
              <>📝 Save CSV{formTargetSheet ? ' & Sheet' : ''} → Execute</>
            )}
          </button>
        </div>
      )}

      {/* Sheet source — pick a sheet, share as form for collecting submissions */}
      {sourceType === 'sheet' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-cyan-50/60 p-3 border border-cyan-200">
            <div className="flex items-center gap-2">
              <span className="text-base">📊</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-cyan-700">Sheet Input</p>
                <p className="text-[10px] text-cyan-600">
                  Share as a public form — submissions become rows in the sheet for processing.
                </p>
              </div>
            </div>
          </div>

          {/* Sheet picker */}
          <div>
            <label className="block text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5">Linked Sheet</label>
            {sheetSourceLoading ? (
              <p className="text-[11px] text-gray-400">Loading sheets…</p>
            ) : sheetSourceSheets.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400 italic">No sheets found.</p>
                <div className="flex gap-2">
                  <input
                    value={sheetSourceNewName}
                    onChange={(e) => setSheetSourceNewName(e.target.value)}
                    placeholder="New sheet name"
                    className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSheetSourceCreate(); }}
                  />
                  <button
                    onClick={handleSheetSourceCreate}
                    disabled={sheetSourceCreatingSheet}
                    className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-[11px] font-medium hover:bg-cyan-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {sheetSourceCreatingSheet ? 'Creating…' : '+ Create'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <select
                  value={sheetSourceId}
                  onChange={(e) => { setSheetSourceId(e.target.value); setDirty(true); }}
                  className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
                >
                  <option value="">— Select sheet —</option>
                  {sheetSourceSheets.map(s => (
                    <option key={s.id} value={s.id}>{s.title || `Sheet ${s.id.slice(0,8)}`}</option>
                  ))}
                </select>
                {!sheetSourceId && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={sheetSourceNewName}
                      onChange={(e) => setSheetSourceNewName(e.target.value)}
                      placeholder="New sheet name"
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSheetSourceCreate(); }}
                    />
                    <button
                      onClick={handleSheetSourceCreate}
                      disabled={sheetSourceCreatingSheet}
                      className="px-3 py-1.5 bg-cyan-600 text-white rounded-lg text-[11px] font-medium hover:bg-cyan-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {sheetSourceCreatingSheet ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Share links for the selected sheet */}
          {sheetSourceId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Form Share Links</label>
              </div>

              <button
                onClick={handleSheetSourceCreateLink}
                disabled={sheetSourceCreatingLink}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {sheetSourceCreatingLink ? (
                  <><Spinner size="sm" className="text-white" /> Creating…</>
                ) : (
                  <>🔗 Create Share Link</>
                )}
              </button>

              {sheetSourceLinksLoading ? (
                <div className="flex items-center justify-center py-3">
                  <Spinner size="sm" className="text-gray-400" />
                </div>
              ) : sheetSourceLinks.length === 0 ? (
                <p className="text-center text-[11px] text-gray-400 py-2">
                  No share links yet. Create one to start collecting responses.
                </p>
              ) : (
                <div className="space-y-2">
                  {sheetSourceLinks.map(link => (
                    <div
                      key={link.id}
                      className={`border rounded-xl p-3 transition-colors ${
                        link.is_active ? 'border-cyan-200 bg-cyan-50/40' : 'border-gray-200 bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-gray-800 truncate">{link.label || 'Share Link'}</p>
                          <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5">
                            {window.location.origin}/sheets/form/{link.token}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {link.submission_count} submission{link.submission_count !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleSheetSourceCopyLink(link.token)}
                            className="p-1.5 rounded-lg hover:bg-white text-gray-400 hover:text-cyan-600 transition-colors"
                            title="Copy link"
                          >
                            {sheetSourceCopiedToken === link.token
                              ? <CheckCircle2 size={13} className="text-emerald-500" />
                              : <Copy size={13} />
                            }
                          </button>
                          <button
                            onClick={() => handleSheetSourceToggleLink(link.id, link.is_active)}
                            className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                              link.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`}
                          >
                            {link.is_active ? 'Active' : 'Off'}
                          </button>
                          <button
                            onClick={() => handleSheetSourceDeleteLink(link.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Save config */}
          {dirty && (
            <button
              onClick={handleSave}
              className="w-full px-2 py-2.5 bg-cyan-600 text-white rounded-xl text-xs font-medium hover:bg-cyan-700 transition-colors"
            >
              Save Config
            </button>
          )}
        </div>
      )}

      {/* Email inbox configuration */}
      {sourceType === 'email_inbox' && (
        <div className="space-y-3">

          {/* Credential selector */}
          <CredentialPicker />

          {/* IMAP Host / Email / Password — hidden when using saved credential */}
          {!usingCredential && (
            <>
              {/* IMAP Host */}
              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1">IMAP Host</label>
                <input
                  value={emailHost}
                  onChange={(e) => { setEmailHost(e.target.value); setDirty(true); }}
                  placeholder="imap.gmail.com"
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1">Email</label>
                <input
                  value={emailUser}
                  onChange={(e) => { setEmailUser(e.target.value); setDirty(true); }}
                  placeholder="contracts@company.com"
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1">App Password</label>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => { setEmailPassword(e.target.value); setDirty(true); }}
                  placeholder="16-char app password"
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
                />
              </div>
            </>
          )}

          {/* Folder */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Folder</label>
            <input
              value={emailFolder}
              onChange={(e) => { setEmailFolder(e.target.value); setDirty(true); }}
              placeholder="INBOX"
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-gray-400 font-medium mb-1">Subject filter</label>
              <input
                value={filterSubject}
                onChange={(e) => { setFilterSubject(e.target.value); setDirty(true); }}
                placeholder="Contract"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[11px] text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 font-medium mb-1">Sender filter</label>
              <input
                value={filterSender}
                onChange={(e) => { setFilterSender(e.target.value); setDirty(true); }}
                placeholder="legal@..."
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[11px] text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
              />
            </div>
          </div>

          {/* Document options */}
          <div className="space-y-2 pt-1">
            {[
              { checked: includeBody, set: setIncludeBody, label: 'Include email body' },
              { checked: includeAttachments, set: setIncludeAttachments, label: 'Include attachments' },
              { checked: autoExtract, set: setAutoExtract, label: 'Auto-extract with AI' },
            ].map(({ checked, set, label }) => (
              <label key={label} className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer group/cb">
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 group-hover/cb:border-blue-400'
                }`} onClick={(e) => { e.preventDefault(); set(!checked); setDirty(true); }}>
                  {checked && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </div>
                <span>{label}</span>
              </label>
            ))}
          </div>

          {/* Auto-check interval */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Auto-Check Interval</label>
            <select
              value={refetchInterval}
              onChange={(e) => { setRefetchInterval(Number(e.target.value)); setDirty(true); }}
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none bg-white"
            >
              <option value={0}>Off — manual only</option>
              <option value={60}>Every 1 minute</option>
              <option value={300}>Every 5 minutes</option>
              <option value={900}>Every 15 minutes</option>
              <option value={1800}>Every 30 minutes</option>
              <option value={3600}>Every 1 hour</option>
            </select>
            {refetchInterval > 0 && (
              <p className="text-[10px] text-blue-500 mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Server checks every {refetchInterval < 3600 ? `${refetchInterval / 60}m` : '1h'} — works even when browser is closed
              </p>
            )}
            {lastCheckedAt && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                {lastCheckStatus === 'ok' ? (
                  <span className="text-emerald-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Last checked: {new Date(lastCheckedAt).toLocaleTimeString()}
                  </span>
                ) : lastCheckStatus === 'error' ? (
                  <span className="text-red-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    Error at {new Date(lastCheckedAt).toLocaleTimeString()}: {lastCheckError}
                  </span>
                ) : (
                  <span className="text-gray-400">
                    Last checked: {new Date(lastCheckedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Save */}
          {dirty && (
            <button onClick={handleSave}
              className="w-full px-2 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors">
              Save Config
            </button>
          )}

          {/* Check inbox button */}
          {emailUser && emailPassword && (
            <button onClick={handleCheckInbox} disabled={checking}
              className="w-full px-2 py-2 bg-gray-800 text-white rounded-lg text-xs font-medium hover:bg-gray-900 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
              {checking ? (
                <><Spinner size="sm" className="text-white" /> Checking…</>
              ) : (
                'Check Inbox'
              )}
            </button>
          )}

          {/* Last check result */}
          {lastCheckResult && (
            <div className={`rounded-xl p-3 space-y-1 border ${lastCheckResult.found > 0 ? 'bg-emerald-50/50 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Result</p>
              <p className="text-xs font-medium text-gray-700">{lastCheckResult.found} document(s) created</p>
              {lastCheckResult.skipped > 0 && (
                <p className="text-[10px] text-amber-500">{lastCheckResult.skipped} duplicate(s) skipped</p>
              )}
              {lastCheckResult.documents_created?.map((doc, i) => (
                <p key={i} className="text-[10px] text-gray-500 truncate">
                  {doc.source_type === 'email_body' ? '📧' : '📎'} {doc.title}
                </p>
              ))}
              {lastCheckResult.errors?.length > 0 && (
                <p className="text-[10px] text-red-500">{lastCheckResult.errors.length} error(s)</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Google Drive configuration ── */}
      {sourceType === 'google_drive' && (
        <div className="space-y-3">

          {/* Credential selector */}
          <CredentialPicker />

          {/* Access mode & API key / Service account — hidden when using saved credential */}
          {!usingCredential && (
            <>
              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1.5">Access Mode</label>
                <div className="flex gap-1.5">
                  {[
                    { value: 'public', label: 'Public', desc: 'Anyone with link' },
                    { value: 'private', label: 'Private', desc: 'Service account' },
                  ].map(m => (
                    <button key={m.value}
                      onClick={() => { setGoogleAccess(m.value); setDirty(true); }}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all ${
                        googleAccess === m.value
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Folder URL or ID */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Folder URL or ID</label>
            <input value={googleFolderId} onChange={(e) => { setGoogleFolderId(e.target.value); setDirty(true); }}
              placeholder="Paste folder URL or ID"
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
          </div>

          {/* Public mode — API key (hidden when using saved credential) */}
          {!usingCredential && googleAccess === 'public' && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="block text-[10px] text-gray-400 font-medium">API Key</label>
                <button onClick={() => setShowGoogleHelp(!showGoogleHelp)}
                  className="text-gray-300 hover:text-blue-500 transition-colors">
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <input value={googleApiKey} onChange={(e) => { setGoogleApiKey(e.target.value); setDirty(true); }}
                placeholder="AIzaSy…"
                className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
              {showGoogleHelp && (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 p-2.5 text-[10px] text-amber-700 space-y-1">
                  <ol className="ml-3 list-decimal space-y-0.5">
                    <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="underline text-blue-500">Cloud Console → Credentials</a></li>
                    <li>Create API key → paste above</li>
                    <li>Enable <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener" className="underline text-blue-500">Google Drive API</a></li>
                  </ol>
                  <p className="text-amber-500 mt-1">Folder must be shared as "Anyone with link"</p>
                </div>
              )}
            </div>
          )}

          {/* Private mode — Service account (hidden when using saved credential) */}
          {!usingCredential && googleAccess === 'private' && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="block text-[10px] text-gray-400 font-medium">Service Account JSON</label>
                <button onClick={() => setShowGoogleHelp(!showGoogleHelp)}
                  className="text-gray-300 hover:text-blue-500 transition-colors">
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <textarea value={googleCreds} onChange={(e) => { setGoogleCreds(e.target.value); setDirty(true); }}
                placeholder='Paste JSON credentials…'
                rows={3} className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
              {showGoogleHelp && (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-100 p-2.5 text-[10px] text-amber-700 space-y-1">
                  <ol className="ml-3 list-decimal space-y-0.5">
                    <li>Cloud Console → create project</li>
                    <li>Enable Google Drive API</li>
                    <li>Service Accounts → Create → Keys → JSON</li>
                    <li>Share folder with service account email</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">File Extensions</label>
            <input value={fileExtensions} onChange={(e) => { setFileExtensions(e.target.value); setDirty(true); }}
              placeholder="pdf, docx (leave empty for all)" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
        </div>
      )}

      {/* ── Dropbox configuration ── */}
      {sourceType === 'dropbox' && (
        <div className="space-y-3">
          <CredentialPicker />
          {!usingCredential && (
            <div>
              <label className="block text-[10px] text-gray-400 font-medium mb-1">Access Token</label>
              <input type="password" value={dropboxToken} onChange={(e) => { setDropboxToken(e.target.value); setDirty(true); }}
                placeholder="OAuth2 access token" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
            </div>
          )}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Folder Path</label>
            <input value={dropboxPath} onChange={(e) => { setDropboxPath(e.target.value); setDirty(true); }}
              placeholder="/Contracts" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">File Extensions</label>
            <input value={fileExtensions} onChange={(e) => { setFileExtensions(e.target.value); setDirty(true); }}
              placeholder="pdf, docx (leave empty for all)" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
        </div>
      )}

      {/* ── OneDrive / SharePoint configuration ── */}
      {sourceType === 'onedrive' && (
        <div className="space-y-3">
          <CredentialPicker />
          {!usingCredential && (
            <div>
              <label className="block text-[10px] text-gray-400 font-medium mb-1">Access Token</label>
              <input type="password" value={onedriveToken} onChange={(e) => { setOnedriveToken(e.target.value); setDirty(true); }}
                placeholder="Microsoft Graph Bearer token" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
            </div>
          )}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Folder Path</label>
            <input value={onedrivePath} onChange={(e) => { setOnedrivePath(e.target.value); setDirty(true); }}
              placeholder="Contracts/2024" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Drive ID <span className="text-gray-300 font-normal">(optional)</span></label>
            <input value={onedriveDrive} onChange={(e) => { setOnedriveDrive(e.target.value); setDirty(true); }}
              placeholder="For shared/team drives" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">File Extensions</label>
            <input value={fileExtensions} onChange={(e) => { setFileExtensions(e.target.value); setDirty(true); }}
              placeholder="pdf, docx (leave empty for all)" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
        </div>
      )}

      {/* ── AWS S3 configuration ── */}
      {sourceType === 's3' && (
        <div className="space-y-3">
          <CredentialPicker />
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Bucket</label>
            <input value={s3Bucket} onChange={(e) => { setS3Bucket(e.target.value); setDirty(true); }}
              placeholder="my-contracts-bucket" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Key Prefix</label>
            <input value={s3Prefix} onChange={(e) => { setS3Prefix(e.target.value); setDirty(true); }}
              placeholder="contracts/2024/" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
          </div>
          {!usingCredential && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1">Access Key</label>
                  <input value={s3AccessKey} onChange={(e) => { setS3AccessKey(e.target.value); setDirty(true); }}
                    placeholder="AKIA…" className="w-full px-2 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1">Secret Key</label>
                  <input type="password" value={s3SecretKey} onChange={(e) => { setS3SecretKey(e.target.value); setDirty(true); }}
                    placeholder="••••••" className="w-full px-2 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1">Region</label>
                <input value={s3Region} onChange={(e) => { setS3Region(e.target.value); setDirty(true); }}
                  placeholder="us-east-1" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
              </div>
            </>
          )}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">File Extensions</label>
            <input value={fileExtensions} onChange={(e) => { setFileExtensions(e.target.value); setDirty(true); }}
              placeholder="pdf, docx (leave empty for all)" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
        </div>
      )}

      {/* ── FTP / SFTP configuration ── */}
      {sourceType === 'ftp' && (
        <div className="space-y-3">
          <CredentialPicker />
          {!usingCredential && (
            <>
              <div className="flex gap-1.5">
                {['ftp', 'sftp'].map(p => (
                  <button key={p} onClick={() => { setFtpProtocol(p); setFtpPort(p === 'sftp' ? '22' : '21'); setDirty(true); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${ftpProtocol === p ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                  >{p.toUpperCase()}</button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-400 font-medium mb-1">Host</label>
                  <input value={ftpHost} onChange={(e) => { setFtpHost(e.target.value); setDirty(true); }}
                    placeholder="ftp.company.com" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1">Port</label>
                  <input value={ftpPort} onChange={(e) => { setFtpPort(e.target.value); setDirty(true); }}
                    placeholder="21" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1">Username</label>
                  <input value={ftpUser} onChange={(e) => { setFtpUser(e.target.value); setDirty(true); }}
                    placeholder="user" className="w-full px-2 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1">Password</label>
                  <input type="password" value={ftpPassword} onChange={(e) => { setFtpPassword(e.target.value); setDirty(true); }}
                    placeholder="••••" className="w-full px-2 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
                </div>
              </div>
            </>
          )}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">Remote Directory</label>
            <input value={ftpPath} onChange={(e) => { setFtpPath(e.target.value); setDirty(true); }}
              placeholder="/contracts" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">File Extensions</label>
            <input value={fileExtensions} onChange={(e) => { setFileExtensions(e.target.value); setDirty(true); }}
              placeholder="pdf, docx (leave empty for all)" className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>
        </div>
      )}

      {/* ── URL Scrape configuration ── */}
      {sourceType === 'url_scrape' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] text-gray-400 font-medium mb-1">URLs <span className="text-gray-300 font-normal">(one per line)</span></label>
            <textarea value={scrapeUrls} onChange={(e) => { setScrapeUrls(e.target.value); setDirty(true); }}
              placeholder={'https://example.com/contract.pdf\nhttps://example.com/terms'}
              rows={4} className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono" />
            <p className="text-[10px] text-gray-400 mt-1">{scrapeUrls.split('\n').filter(u => u.trim()).length} URL(s)</p>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer">
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
              scrapeText ? 'bg-blue-600 border-blue-600' : 'border-gray-300 hover:border-blue-400'
            }`} onClick={(e) => { e.preventDefault(); setScrapeText(!scrapeText); setDirty(true); }}>
              {scrapeText && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </div>
            <span>Extract main content from HTML pages</span>
          </label>
        </div>
      )}

      {/* ── Table configuration ── */}
      {sourceType === 'table' && (() => {
        const isImageOrPdf = tableFile && /\.(pdf|png|jpe?g|gif|bmp|tiff?|webp)$/i.test(tableFile.name);
        return (
        <div className="space-y-3">
          <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50/50 p-2.5 border border-emerald-100">
            <p className="text-[11px] text-gray-600">Upload a spreadsheet or connect a Google Sheet. Each row becomes a document, columns become metadata.</p>
          </div>

          {/* File upload area — always visible */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1.5">Upload File</label>
            <label className="flex flex-col items-center justify-center w-full py-4 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors">
              <input type="file" accept=".csv,.tsv,.xlsx,.xls,.ods,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.tif,.webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setTableFile(f);
                    setTablePreviewData(null);
                    setSheetNames([]);
                    setSelectedSheet('');
                    setDirty(true);
                    handleTablePreview(f, null);
                  }
                }}
                className="hidden"
              />
              {tableFile ? (
                <div className="text-center">
                  <p className="text-xs font-medium text-gray-700">{tableFile.name}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Click to replace</p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-lg mb-1 text-gray-300">↑</div>
                  <p className="text-[11px] text-gray-500">Drop file or click to browse</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">CSV · XLSX · XLS · ODS · PDF · Image</p>
                </div>
              )}
            </label>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-[10px] text-gray-400 font-medium">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Google Sheet URL — always visible */}
          <div>
            <label className="block text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">Google Sheet URL</label>
            <input type="url" value={googleSheetUrl}
              onChange={(e) => { setGoogleSheetUrl(e.target.value); setDirty(true); setTablePreviewData(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 outline-none font-mono" />
            {googleSheetUrl && (
              <button onClick={() => handleTablePreview(null, googleSheetUrl)}
                disabled={tableUploading}
                className="mt-1.5 text-[11px] text-emerald-600 hover:text-emerald-700 font-medium transition-colors">
                {tableUploading ? 'Loading…' : 'Preview →'}
              </button>
            )}
            <p className="text-[10px] text-gray-400 mt-1">Must be publicly accessible</p>
          </div>

          {/* Sheet selector (multi-sheet files) */}
          {sheetNames.length > 1 && (
            <div>
              <label className="block text-[10px] text-gray-400 font-medium mb-1">Sheet</label>
              <select value={selectedSheet} onChange={(e) => {
                setSelectedSheet(e.target.value);
                setDirty(true);
                if (tableFile) handleTablePreview(tableFile, null);
              }} className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300 outline-none bg-white">
                <option value="">First sheet</option>
                {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* AI Extract toggle — only for PDF/image files */}
          {isImageOrPdf && (
            <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                aiExtract ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300 hover:border-emerald-400'
              }`} onClick={(e) => { e.preventDefault(); setAiExtract(!aiExtract); setDirty(true); }}>
                {aiExtract && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <span>AI table extraction <span className="text-[10px] text-gray-400">(scanned PDFs/images)</span></span>
            </label>
          )}

          {/* Preview table */}
          {tableUploading && (
            <div className="flex items-center justify-center py-6 gap-2 text-xs text-gray-400">
              <Spinner size="sm" className="text-emerald-500" /> Parsing…
            </div>
          )}

          {tablePreviewData && !tableUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-700">
                  {tablePreviewData.row_count} rows × {tablePreviewData.col_count} cols
                </p>
                <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded-md text-gray-400 font-mono">
                  {tablePreviewData.parse_method}
                </span>
              </div>
              {/* Scrollable data table — all columns, up to 10 rows */}
              <div className="overflow-auto max-h-64 border border-gray-100 rounded-xl">
                <table className="min-w-full text-[9px]">
                  <thead className="bg-gray-50/80 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-gray-400 font-medium sticky left-0 bg-gray-50/80">#</th>
                      {(tablePreviewData.headers || []).map((h, i) => (
                        <th key={i} className="px-2 py-1.5 text-left text-gray-500 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(tablePreviewData.rows || []).slice(0, 10).map((row, ri) => (
                      <tr key={ri} className="hover:bg-emerald-50/30 transition-colors">
                        <td className="px-2 py-1 text-gray-300 sticky left-0 bg-white">{ri + 1}</td>
                        {(tablePreviewData.headers || []).map((h, ci) => (
                          <td key={ci} className="px-2 py-1 text-gray-600 whitespace-nowrap max-w-[140px] truncate">
                            {row[h] != null ? String(row[h]) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tablePreviewData.row_count > 10 && (
                <p className="text-[9px] text-gray-400 text-center">+{tablePreviewData.row_count - 10} more rows</p>
              )}
            </div>
          )}

          {/* Import button */}
          {(tableFile || googleSheetUrl) && (
            <button onClick={handleTableImport} disabled={tableUploading || tableImported}
              className={`w-full px-2 py-2.5 rounded-xl text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                tableImported
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  : 'bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50 shadow-sm'
              }`}>
              {tableUploading ? (
                <><Spinner size="sm" className="text-white" /> Importing…</>
              ) : tableImported ? (
                <>✓ Imported {tablePreviewData?.documents_created || serverConfig.table_info?.row_count || ''} documents</>
              ) : (
                'Import as Documents'
              )}
            </button>
          )}
          {tableImported && (
            <button onClick={() => { setTableImported(false); setTableFile(null); setTablePreviewData(null); }}
              className="w-full text-[10px] text-gray-400 hover:text-red-400 transition-colors">
              Re-import / Replace
            </button>
          )}
        </div>
        );
      })()}

      {/* ── Test Connection button (for cloud sources) ── */}
      {cloudSources.includes(sourceType) && (
        <div className="space-y-2">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="w-full px-2 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {testing ? (
              <><Spinner size="sm" className="text-gray-500" /> Testing…</>
            ) : (
              'Test Connection'
            )}
          </button>
          {testResult && (
            <div className={`rounded-xl p-2.5 text-xs border ${testResult.ok ? 'bg-emerald-50/50 border-emerald-100 text-emerald-600' : 'bg-red-50/50 border-red-100 text-red-600'}`}>
              <p className="font-medium">{testResult.ok ? '✓' : '✕'} {testResult.message}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Integration Plugin Config (when integration is selected as source) ── */}
      {isIntegrationSource && (() => {
        const plugin = integrationPlugins.find(p => p.name === sourceType);
        if (!plugin) return null;
        const schema = plugin.settings_schema || {};
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{plugin.icon}</span>
              <div>
                <p className="text-xs font-semibold text-gray-800">{plugin.display_name}</p>
                <p className="text-[10px] text-gray-400 leading-tight">{plugin.description}</p>
              </div>
            </div>

            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-2.5">
              <p className="text-[10px] text-blue-600 font-medium">📥 All notifications from this integration will be received as document inputs to this node.</p>
            </div>

            {/* Plugin settings form */}
            {Object.keys(schema).length > 0 && (
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Configuration</label>
                {Object.entries(schema).map(([key, fs]) => {
                  const value = integrationSettings[key] ?? fs.default;
                  return (
                    <div key={key}>
                      <label className="block text-[10px] text-gray-500 font-medium mb-1">{fs.label || key}</label>
                      {fs.description && <p className="text-[9px] text-gray-400 mb-1">{fs.description}</p>}

                      {fs.type === 'boolean' && (
                        <button
                          onClick={() => { setIntegrationSettings(prev => ({ ...prev, [key]: !value })); setDirty(true); }}
                          className="flex items-center gap-1.5 text-[10px]"
                        >
                          <div className={`w-8 h-4 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-gray-200'}`}>
                            <div className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform mt-[1px] ${value ? 'translate-x-4' : 'translate-x-[1px]'}`} />
                          </div>
                          <span className="text-gray-600">{value ? 'On' : 'Off'}</span>
                        </button>
                      )}

                      {fs.type === 'string' && (
                        <input
                          type={key.includes('secret') || key.includes('password') ? 'password' : 'text'}
                          value={value || ''}
                          onChange={e => { setIntegrationSettings(prev => ({ ...prev, [key]: e.target.value })); setDirty(true); }}
                          placeholder={fs.default || '…'}
                          className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none"
                        />
                      )}

                      {fs.type === 'select' && (
                        <select
                          value={value || fs.default}
                          onChange={e => { setIntegrationSettings(prev => ({ ...prev, [key]: e.target.value })); setDirty(true); }}
                          className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none bg-white"
                        >
                          {(fs.options || []).map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}

                      {fs.type === 'array' && (
                        <textarea
                          value={Array.isArray(value) ? value.join('\n') : (value || '')}
                          onChange={e => {
                            const lines = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
                            setIntegrationSettings(prev => ({ ...prev, [key]: lines }));
                            setDirty(true);
                          }}
                          rows={2}
                          placeholder="One per line…"
                          className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-xs text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none font-mono resize-y"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Save */}
            {dirty && (
              <button
                onClick={handleSave}
                className="w-full px-2 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                Save Integration Config
              </button>
            )}
          </div>
        );
      })()}

      {/* Save for non-email, non-form, non-integration sources */}
      {sourceType !== 'email_inbox' && sourceType !== 'form' && sourceType !== 'sheet' && !isIntegrationSource && dirty && (
        <button
          onClick={handleSave}
          className="w-full px-2 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"
        >
          Save Config
        </button>
      )}

      {/* ── Input Plugin Pipeline ── */}
      <div className="border-t border-gray-100 pt-3 mt-3">
        <InputPluginsPanel
          workflowId={workflowId}
          nodeId={node.id}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}


/* ================================================================
   Rule Config Panel (sidebar) — with field-options dropdowns
   ================================================================ */
const OPERATORS = [
  { value: 'eq', label: '=', desc: 'equals' },
  { value: 'neq', label: '≠', desc: 'not equals' },
  { value: 'gt', label: '>', desc: 'greater than' },
  { value: 'gte', label: '≥', desc: 'greater or equal' },
  { value: 'lt', label: '<', desc: 'less than' },
  { value: 'lte', label: '≤', desc: 'less or equal' },
  { value: 'contains', label: 'contains', desc: 'text contains' },
  { value: 'not_contains', label: '!contains', desc: 'not contains' },
];

function RuleConfigPanel({ node, onChange, fieldOptions }) {
  const serverConfig = node.config || { boolean_operator: 'AND', conditions: [] };

  const [boolOp, setBoolOp] = React.useState(serverConfig.boolean_operator || 'AND');
  const [conditions, setConditions] = React.useState(serverConfig.conditions || []);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setBoolOp(serverConfig.boolean_operator || 'AND');
    setConditions(serverConfig.conditions || []);
    setDirty(false);
  }, [node.id]);

  const mark = () => setDirty(true);

  const setCondField = (idx, key, value) => {
    setConditions((prev) => prev.map((c, i) => (i === idx ? { ...c, [key]: value } : c)));
    mark();
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, { field: '', operator: 'eq', value: '' }]);
    mark();
  };

  const removeCondition = (idx) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
    mark();
  };

  const handleSave = () => {
    const valid = conditions.filter((c) => c.field && c.field.trim());
    const config = { boolean_operator: boolOp, conditions: valid };
    onChange(config);
    setConditions(valid);
    setDirty(false);
    notify.success('Conditions saved');
  };

  // Available field names from field-options API + global fields + AI node fields
  const { globalFields, aiNodeFields, otherFields, allFields } = React.useMemo(() => {
    const globalSet = new Set(fieldOptions?.global_fields || []);
    const aiSet = new Set(fieldOptions?.ai_node_fields || []);
    const allSet = new Set(fieldOptions?.field_names || []);

    // "other" = fields that are neither global nor AI node
    const otherSet = new Set();
    allSet.forEach((f) => {
      if (!globalSet.has(f) && !aiSet.has(f)) otherSet.add(f);
    });

    return {
      globalFields: [...globalSet].sort(),
      aiNodeFields: [...aiSet].sort(),
      otherFields: [...otherSet].sort(),
      allFields: [...allSet].sort(),
    };
  }, [fieldOptions]);

  // Get value options for a specific field
  const getValueOptions = (fieldName) => {
    return fieldOptions?.field_values?.[fieldName] || [];
  };

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">Match</label>
      <select
        value={boolOp}
        onChange={(e) => { setBoolOp(e.target.value); mark(); }}
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
      >
        <option value="AND">ALL conditions (AND)</option>
        <option value="OR">ANY condition (OR)</option>
      </select>

      <label className="block text-xs text-gray-500 mb-1">Conditions</label>
      <div className="space-y-2">
        {conditions.map((cond, idx) => {
          const valueOptions = getValueOptions(cond.field);
          return (
            <div key={idx} className="flex flex-col gap-1.5 bg-gray-50 rounded-lg p-2.5 border border-gray-100">
              {/* Field name — dropdown or text input */}
              <div className="relative">
                {allFields.length > 0 ? (
                  <div className="flex gap-1">
                    <select
                      value={cond.field}
                      onChange={(e) => setCondField(idx, 'field', e.target.value)}
                      className="px-2 py-1.5 border rounded-md text-xs flex-1 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    >
                      <option value="">Select field…</option>
                      {globalFields.length > 0 && (
                        <optgroup label="📋 Document Fields">
                          {globalFields.map((f) => (
                            <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
                          ))}
                        </optgroup>
                      )}
                      {aiNodeFields.length > 0 && (
                        <optgroup label="🤖 AI Node Fields">
                          {aiNodeFields.map((f) => (
                            <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
                          ))}
                        </optgroup>
                      )}
                      {otherFields.length > 0 && (
                        <optgroup label="📊 Extracted Fields">
                          {otherFields.map((f) => (
                            <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <input
                      value={cond.field}
                      onChange={(e) => setCondField(idx, 'field', e.target.value)}
                      placeholder="or type"
                      className="px-2 py-1.5 border rounded-md text-xs w-24 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                      title="Type a custom field name"
                    />
                  </div>
                ) : (
                  <input
                    value={cond.field}
                    onChange={(e) => setCondField(idx, 'field', e.target.value)}
                    placeholder="field name"
                    className="px-2 py-1.5 border rounded-md text-xs w-full bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                  />
                )}
              </div>

              {/* Operator + Value */}
              <div className="flex gap-1">
                <select
                  value={cond.operator}
                  onChange={(e) => setCondField(idx, 'operator', e.target.value)}
                  className="px-1.5 py-1.5 border rounded-md text-xs w-24 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label} ({op.desc})</option>
                  ))}
                </select>

                {/* Value — dropdown or text */}
                <div className="flex-1 flex gap-1">
                  {valueOptions.length > 0 ? (
                    <>
                      <select
                        value={valueOptions.includes(cond.value) ? cond.value : ''}
                        onChange={(e) => { if (e.target.value) setCondField(idx, 'value', e.target.value); }}
                        className="px-1.5 py-1.5 border rounded-md text-xs flex-1 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                      >
                        <option value="">Select…</option>
                        {valueOptions.map((v, i) => (
                          <option key={i} value={v}>{v}</option>
                        ))}
                      </select>
                      <input
                        value={cond.value}
                        onChange={(e) => setCondField(idx, 'value', e.target.value)}
                        placeholder="or type"
                        className="px-2 py-1.5 border rounded-md text-xs w-20 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                      />
                    </>
                  ) : (
                    <input
                      value={cond.value}
                      onChange={(e) => setCondField(idx, 'value', e.target.value)}
                      placeholder="value"
                      className="px-2 py-1.5 border rounded-md text-xs flex-1 bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    />
                  )}
                </div>

                <button
                  onClick={() => removeCondition(idx)}
                  className="px-1.5 text-red-400 hover:text-red-600 text-sm shrink-0"
                  title="Remove condition"
                >×</button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        onClick={addCondition}
        className="mt-2 w-full px-2 py-2 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors"
      >
        + Add Condition
      </button>
      {dirty && (
        <button
          onClick={handleSave}
          className="mt-2 w-full px-2 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
        >
          💾 Save Conditions
        </button>
      )}
    </div>
  );
}


/* ================================================================
   Action Config Panel (sidebar) — plugin selector + settings
   ================================================================ */
function ActionConfigPanel({ node, onChange, plugins, workflowId, onExecutionComplete }) {
  const serverConfig = node.config || { plugin: '', settings: {} };

  const [pluginName, setPluginName] = React.useState(serverConfig.plugin || '');
  const [pluginSettings, setPluginSettings] = React.useState(serverConfig.settings || {});
  const [dirty, setDirty] = React.useState(false);
  const [runningAction, setRunningAction] = React.useState(false);

  React.useEffect(() => {
    setPluginName(serverConfig.plugin || '');
    setPluginSettings(serverConfig.settings || {});
    setDirty(false);
  }, [node.id]);

  const selectedPlugin = plugins.find((p) => p.name === pluginName);

  const handlePluginChange = (name) => {
    setPluginName(name);
    // Reset settings to defaults when switching plugins
    const plugin = plugins.find((p) => p.name === name);
    if (plugin) {
      const defaults = {};
      Object.entries(plugin.settings_schema || {}).forEach(([key, schema]) => {
        defaults[key] = schema.default ?? '';
      });
      setPluginSettings(defaults);
    } else {
      setPluginSettings({});
    }
    setDirty(true);
  };

  const handleSettingChange = (key, value) => {
    setPluginSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    onChange({ plugin: pluginName, settings: pluginSettings });
    setDirty(false);
    notify.success('Action config saved');
  };

  const handleRunAction = async () => {
    if (!pluginName) {
      notify.error('Select a plugin first');
      return;
    }
    // Save first if dirty
    if (dirty) {
      onChange({ plugin: pluginName, settings: pluginSettings });
      setDirty(false);
    }
    setRunningAction(true);
    try {
      const { data } = await workflowApi.executeAction(workflowId, node.id);
      notify.success(`Action complete: ${data.sent} sent, ${data.skipped} skipped, ${data.failed} failed`);
      onExecutionComplete?.();
    } catch (e) {
      notify.error('Action failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <div>
      {/* Plugin selector */}
      <label className="block text-xs text-gray-500 mb-1">Plugin</label>
      <select
        value={pluginName}
        onChange={(e) => handlePluginChange(e.target.value)}
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
      >
        <option value="">Select plugin…</option>
        {plugins.map((p) => (
          <option key={p.name} value={p.name}>{p.icon} {p.display_name}</option>
        ))}
      </select>

      {/* Plugin badge */}
      {selectedPlugin && (
        <div className="mb-3 flex items-center gap-2 text-xs text-purple-700">
          <span>{selectedPlugin.icon}</span>
          <span className="font-medium">{selectedPlugin.display_name}</span>
        </div>
      )}

      {/* Plugin settings */}
      {selectedPlugin && Object.entries(selectedPlugin.settings_schema || {}).map(([key, schema]) => (
        <div key={key} className="mb-2.5">
          <label className="block text-xs text-gray-500 mb-1">{schema.label || key}</label>
          {schema.type === 'textarea' ? (
            <textarea
              value={pluginSettings[key] ?? schema.default ?? ''}
              onChange={(e) => handleSettingChange(key, e.target.value)}
              placeholder={schema.placeholder || ''}
              rows={3}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none resize-y"
            />
          ) : schema.type === 'boolean' ? (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={pluginSettings[key] ?? schema.default ?? false}
                onChange={(e) => handleSettingChange(key, e.target.checked)}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              {schema.label || key}
            </label>
          ) : schema.type === 'select' ? (
            <select
              value={pluginSettings[key] ?? schema.default ?? ''}
              onChange={(e) => handleSettingChange(key, e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
            >
              {(schema.options || []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : schema.type === 'password' ? (
            <input
              type="password"
              value={pluginSettings[key] ?? ''}
              onChange={(e) => handleSettingChange(key, e.target.value)}
              placeholder={schema.placeholder || ''}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
            />
          ) : (
            <input
              value={pluginSettings[key] ?? schema.default ?? ''}
              onChange={(e) => handleSettingChange(key, e.target.value)}
              placeholder={schema.placeholder || ''}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none"
            />
          )}
        </div>
      ))}

      {/* Save + Run buttons */}
      {dirty && (
        <button
          onClick={handleSave}
          className="mt-2 w-full px-2 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
        >
          💾 Save Config
        </button>
      )}

      {pluginName && (
        <button
          onClick={handleRunAction}
          disabled={runningAction}
          className="mt-2 w-full px-2 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
        >
          {runningAction ? (
            <><Spinner size="sm" className="text-white" /> Running…</>
          ) : (
            <>▶ Run Action Now</>
          )}
        </button>
      )}

      {/* Last execution stats */}
      {node.last_result?.execution_id && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last Execution</p>
          <div className="flex gap-3 text-xs">
            <span className="text-emerald-600 font-medium">✓ {node.last_result.sent || 0} sent</span>
            <span className="text-amber-600 font-medium">⊘ {node.last_result.skipped || 0} skipped</span>
            <span className="text-red-600 font-medium">✕ {node.last_result.failed || 0} failed</span>
          </div>
          <p className="text-[10px] text-gray-400">{node.last_result.count || 0} total documents</p>
        </div>
      )}
    </div>
  );
}


/* ================================================================
   Listener Config Panel (sidebar) — trigger selector + settings
   ================================================================ */
function ListenerConfigPanel({ node, onChange, triggers, workflowId, onUpdate }) {
  const serverConfig = node.config || { trigger_type: '', gate_message: '', auto_execute_downstream: true };

  const [triggerType, setTriggerType] = React.useState(serverConfig.trigger_type || '');
  const [configValues, setConfigValues] = React.useState(() => {
    const { trigger_type, ...rest } = serverConfig;
    return rest;
  });
  const [dirty, setDirty] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [lastCheckResult, setLastCheckResult] = React.useState(null);

  React.useEffect(() => {
    setTriggerType(serverConfig.trigger_type || '');
    const { trigger_type, ...rest } = serverConfig;
    setConfigValues(rest);
    setDirty(false);
    setLastCheckResult(null);
  }, [node.id]);

  const selectedTrigger = triggers.find((t) => t.name === triggerType);

  const handleTriggerChange = (name) => {
    setTriggerType(name);
    // Reset config values to defaults when switching triggers
    const trigger = triggers.find((t) => t.name === name);
    if (trigger) {
      const defaults = {};
      (trigger.config_fields || []).forEach((f) => {
        defaults[f.key] = f.default ?? '';
      });
      setConfigValues(defaults);
    } else {
      setConfigValues({});
    }
    setDirty(true);
  };

  const handleConfigChange = (key, value) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    const config = { trigger_type: triggerType, ...configValues };
    onChange(config);
    setDirty(false);
    notify.success('Listener config saved');
  };

  const handleCheck = async () => {
    // Save first if dirty
    if (dirty) {
      const config = { trigger_type: triggerType, ...configValues };
      onChange(config);
      setDirty(false);
    }
    setChecking(true);
    try {
      const { data } = await workflowApi.checkListener(workflowId, node.id);
      setLastCheckResult(data);
      onUpdate?.();
      if (data.status === 'approved' || data.status === 'auto_fired') {
        notify.success(data.message || 'Listener triggered!');
      } else if (data.status === 'pending') {
        notify.info(data.message || 'Event pending approval');
      } else {
        notify.warning(data.message || 'Listener did not fire');
      }
    } catch (e) {
      notify.error('Check failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setChecking(false);
    }
  };

  const handleForce = async () => {
    setChecking(true);
    try {
      const { data } = await workflowApi.checkListener(workflowId, node.id, { force_trigger: true });
      setLastCheckResult(data);
      onUpdate?.();
      notify.success(data.message || 'Force-triggered!');
    } catch (e) {
      notify.error('Force trigger failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      {/* Trigger type selector */}
      <label className="block text-xs text-gray-500 mb-1">Trigger Type</label>
      <select
        value={triggerType}
        onChange={(e) => handleTriggerChange(e.target.value)}
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
      >
        <option value="">Select trigger…</option>
        {triggers.map((t) => (
          <option key={t.name} value={t.name}>{t.icon} {t.display_name}</option>
        ))}
      </select>

      {/* Trigger badge */}
      {selectedTrigger && (
        <div className="mb-3 flex items-center gap-2 text-xs text-cyan-700">
          <span>{selectedTrigger.icon}</span>
          <span className="font-medium">{selectedTrigger.display_name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            selectedTrigger.category === 'approval' ? 'bg-amber-100 text-amber-700' :
            selectedTrigger.category === 'manual' ? 'bg-gray-100 text-gray-600' :
            'bg-cyan-100 text-cyan-700'
          }`}>{selectedTrigger.category}</span>
        </div>
      )}

      {/* Config fields for the selected trigger */}
      {selectedTrigger && (selectedTrigger.config_fields || []).map((field) => (
        <div key={field.key} className="mb-2.5">
          <label className="block text-xs text-gray-500 mb-1">{field.label || field.key}</label>
          {field.type === 'textarea' ? (
            <textarea
              value={configValues[field.key] ?? field.default ?? ''}
              onChange={(e) => handleConfigChange(field.key, e.target.value)}
              rows={2}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none resize-y"
            />
          ) : field.type === 'boolean' ? (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={configValues[field.key] ?? field.default ?? false}
                onChange={(e) => handleConfigChange(field.key, e.target.checked)}
                className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
              />
              {field.label || field.key}
            </label>
          ) : field.type === 'select' ? (
            <select
              value={configValues[field.key] ?? field.default ?? ''}
              onChange={(e) => handleConfigChange(field.key, e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
            >
              {(field.options || []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : field.type === 'number' ? (
            <input
              type="number"
              value={configValues[field.key] ?? field.default ?? ''}
              onChange={(e) => handleConfigChange(field.key, parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
            />
          ) : (
            <input
              value={configValues[field.key] ?? field.default ?? ''}
              onChange={(e) => handleConfigChange(field.key, e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
            />
          )}
        </div>
      ))}

      {/* Save */}
      {dirty && (
        <button
          onClick={handleSave}
          className="mt-2 w-full px-2 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
        >
          💾 Save Config
        </button>
      )}

      {/* Check / Trigger buttons */}
      {triggerType && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex-1 px-2 py-2 bg-cyan-600 text-white rounded-lg text-xs font-medium hover:bg-cyan-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {checking ? (
              <><Spinner size="sm" className="text-white" /> Checking…</>
            ) : (
              <><Eye size={12} /> Check</>
            )}
          </button>
          <button
            onClick={handleForce}
            disabled={checking}
            className="px-2 py-2 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
            title="Force-trigger regardless of conditions"
          >
            ⚡ Force
          </button>
        </div>
      )}

      {/* Last check result */}
      {lastCheckResult && (
        <div className={`mt-3 rounded-lg p-3 space-y-1 ${
          lastCheckResult.status === 'approved' || lastCheckResult.status === 'auto_fired'
            ? 'bg-emerald-50' : lastCheckResult.status === 'pending'
            ? 'bg-amber-50' : 'bg-gray-50'
        }`}>
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last Check</p>
          <p className="text-xs font-medium text-gray-700">{lastCheckResult.status?.replace(/_/g, ' ')}</p>
          {lastCheckResult.message && (
            <p className="text-[11px] text-gray-500">{lastCheckResult.message}</p>
          )}
          {lastCheckResult.passed_document_ids?.length > 0 && (
            <p className="text-[10px] text-gray-400">{lastCheckResult.passed_document_ids.length} docs passed</p>
          )}
        </div>
      )}

      {/* Node last result */}
      {node.last_result?.listener_status && !lastCheckResult && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last Result</p>
          <p className="text-xs font-medium text-gray-700">{node.last_result.listener_status.replace(/_/g, ' ')}</p>
          {node.last_result.listener_message && (
            <p className="text-[11px] text-gray-500">{node.last_result.listener_message}</p>
          )}
        </div>
      )}
    </div>
  );
}


/* ================================================================
   Validator Config Panel (sidebar) — simple user assignment
   ================================================================ */
function ValidatorConfigPanel({ node, onChange, workflowId, onUpdate }) {
  const [assignedUsers, setAssignedUsers] = React.useState([]);
  const [orgUsers, setOrgUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [description, setDescription] = React.useState(node.config?.description || '');
  const [adding, setAdding] = React.useState(false);

  const fetchUsers = React.useCallback(async () => {
    try {
      const { data } = await workflowApi.validatorUsers(workflowId, { node_id: node.id });
      setAssignedUsers(data.users || []);
    } catch {}
  }, [workflowId, node.id]);

  const fetchOrgUsers = React.useCallback(async () => {
    try {
      const { data } = await workflowApi.orgUsers();
      setOrgUsers(data.users || []);
    } catch {}
  }, []);

  React.useEffect(() => {
    Promise.all([fetchUsers(), fetchOrgUsers()]).finally(() => setLoading(false));
  }, [fetchUsers, fetchOrgUsers]);

  React.useEffect(() => {
    setDescription(node.config?.description || '');
  }, [node.id]);

  const handleSaveDescription = () => {
    onChange({ ...(node.config || {}), description, user_count: assignedUsers.length });
  };

  const handleAddUser = async (e) => {
    const userId = Number(e.target.value);
    if (!userId) return;
    e.target.value = '';
    setAdding(true);
    try {
      const user = orgUsers.find(u => u.user_id === userId);
      await workflowApi.addValidatorUser(workflowId, {
        node: node.id,
        user: userId,
        role_label: user?.role_name || '',
      });
      await fetchUsers();
      onChange({ ...(node.config || {}), user_count: assignedUsers.length + 1 });
      notify.success(`${user?.full_name || 'User'} added`);
    } catch (err) {
      notify.error(err.response?.data?.error || 'Failed to add');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveUser = async (vuId, name) => {
    try {
      await workflowApi.removeValidatorUser(workflowId, { validator_user_id: vuId });
      await fetchUsers();
      onChange({ ...(node.config || {}), user_count: Math.max(0, assignedUsers.length - 1) });
      notify.success(`${name} removed`);
    } catch {
      notify.error('Failed to remove');
    }
  };

  if (loading) return <div className="text-xs text-gray-400 py-4 text-center">Loading…</div>;

  const assignedIds = new Set(assignedUsers.map(a => a.user));
  const available = orgUsers.filter(u => !assignedIds.has(u.user_id));

  return (
    <div>
      {/* Description */}
      <label className="block text-[11px] text-gray-500 mb-1">Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={handleSaveDescription}
        rows={2}
        placeholder="e.g. Legal review before sending"
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-y"
      />

      {/* Add user — simple dropdown */}
      <label className="block text-[11px] text-gray-500 mb-1">Add Validator</label>
      <select
        onChange={handleAddUser}
        disabled={adding || available.length === 0}
        defaultValue=""
        className="w-full mb-3 px-2 py-1.5 border rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none disabled:opacity-50"
      >
        <option value="">{available.length === 0 ? 'All users assigned' : `Select user (${available.length} available)…`}</option>
        {available.map(u => (
          <option key={u.user_id} value={u.user_id}>
            {u.full_name || u.username} — {u.email}
          </option>
        ))}
      </select>

      {/* Assigned list */}
      <label className="block text-[11px] text-gray-500 mb-1">
        Assigned ({assignedUsers.length})
      </label>

      {assignedUsers.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic py-2">No validators yet</p>
      ) : (
        <div className="space-y-1 mb-3">
          {assignedUsers.map(a => (
            <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(a.user_name || '?')[0].toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-700 font-medium truncate">{a.user_name}</p>
                  <p className="text-[9px] text-gray-400 truncate">{a.user_email}</p>
                </div>
              </div>
              <button
                onClick={() => handleRemoveUser(a.id, a.user_name)}
                className="text-gray-300 hover:text-red-500 text-sm shrink-0 ml-1"
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Dashboard link */}
      <a
        href={`/validation/${workflowId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-xs text-emerald-600 hover:text-emerald-800 underline mt-2"
      >
        View Validation Dashboard →
      </a>

      {/* Last result */}
      {node.last_result?.validator_status && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Status</p>
          <p className="text-xs font-medium text-gray-700 capitalize">{node.last_result.validator_status.replace(/_/g, ' ')}</p>
          <div className="flex gap-2 text-[10px]">
            {node.last_result.approved > 0 && <span className="text-emerald-600">✓ {node.last_result.approved}</span>}
            {node.last_result.pending > 0 && <span className="text-amber-600">⏳ {node.last_result.pending}</span>}
            {node.last_result.rejected > 0 && <span className="text-red-600">✕ {node.last_result.rejected}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   AI Config Panel (sidebar) — model selector + system prompt + settings
   ================================================================ */
function AIConfigPanel({ node, onChange, models }) {
  const serverConfig = node.config || {};

  const [model, setModel] = React.useState(serverConfig.model || 'gemini-2.5-flash');
  const [systemPrompt, setSystemPrompt] = React.useState(serverConfig.system_prompt || '');
  const [outputFormat, setOutputFormat] = React.useState(serverConfig.output_format || 'json_extract');
  const [outputKey, setOutputKey] = React.useState(serverConfig.output_key || 'ai_analysis');
  const [jsonFields, setJsonFields] = React.useState(serverConfig.json_fields || []);
  const [temperature, setTemperature] = React.useState(serverConfig.temperature ?? 0.3);
  const [maxTokens, setMaxTokens] = React.useState(serverConfig.max_tokens ?? 2048);
  const [includeText, setIncludeText] = React.useState(serverConfig.include_text ?? true);
  const [includeMetadata, setIncludeMetadata] = React.useState(serverConfig.include_metadata ?? true);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    const c = node.config || {};
    setModel(c.model || 'gemini-2.5-flash');
    setSystemPrompt(c.system_prompt || '');
    setOutputFormat(c.output_format || 'json_extract');
    setOutputKey(c.output_key || 'ai_analysis');
    setJsonFields(c.json_fields || []);
    setTemperature(c.temperature ?? 0.3);
    setMaxTokens(c.max_tokens ?? 2048);
    setIncludeText(c.include_text ?? true);
    setIncludeMetadata(c.include_metadata ?? true);
    setDirty(false);
  }, [node.id]);

  const selectedModel = models.find((m) => m.id === model);

  const addJsonField = () => {
    setJsonFields((prev) => [...prev, { name: '', type: 'string', description: '' }]);
    setDirty(true);
  };
  const updateJsonField = (idx, key, value) => {
    setJsonFields((prev) => prev.map((f, i) => (i === idx ? { ...f, [key]: value } : f)));
    setDirty(true);
  };
  const removeJsonField = (idx) => {
    setJsonFields((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const handleSave = () => {
    onChange({
      model,
      system_prompt: systemPrompt,
      output_format: outputFormat,
      output_key: outputKey,
      json_fields: outputFormat === 'json_extract' ? jsonFields.filter((f) => f.name.trim()) : [],
      temperature: parseFloat(temperature),
      max_tokens: parseInt(maxTokens, 10),
      include_text: includeText,
      include_metadata: includeMetadata,
    });
    setDirty(false);
    notify.success('AI config saved');
  };

  return (
    <div>
      {/* ── Output Format (top priority) ── */}
      <label className="block text-xs text-gray-500 mb-1 font-semibold">Output Format</label>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {[
          { id: 'json_extract', icon: '📋', label: 'JSON', desc: 'Structured fields' },
          { id: 'yes_no',       icon: '✅', label: 'Yes/No', desc: 'Gate decision' },
          { id: 'text',         icon: '📝', label: 'Text', desc: 'Free-form' },
        ].map((fmt) => (
          <button
            key={fmt.id}
            onClick={() => { setOutputFormat(fmt.id); setDirty(true); }}
            className={`p-2 rounded-lg border text-center transition-all ${
              outputFormat === fmt.id
                ? 'border-rose-400 bg-rose-50 ring-2 ring-rose-200'
                : 'border-gray-200 hover:border-rose-300 hover:bg-rose-50/50'
            }`}
          >
            <span className="text-base">{fmt.icon}</span>
            <p className="text-[10px] font-semibold text-gray-700 mt-0.5">{fmt.label}</p>
            <p className="text-[9px] text-gray-400">{fmt.desc}</p>
          </button>
        ))}
      </div>

      {/* ── JSON Fields (only for json_extract) ── */}
      {outputFormat === 'json_extract' && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-gray-500 font-semibold">Extract Fields</label>
            <button
              onClick={addJsonField}
              className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 font-medium"
            >
              + Add Field
            </button>
          </div>
          <div className="space-y-2">
            {jsonFields.map((field, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <div className="flex gap-1.5 mb-1">
                  <input
                    value={field.name}
                    onChange={(e) => updateJsonField(idx, 'name', e.target.value)}
                    placeholder="field_name"
                    className="flex-1 px-2 py-1 border rounded text-[11px] font-mono focus:ring-1 focus:ring-indigo-200 outline-none"
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateJsonField(idx, 'type', e.target.value)}
                    className="px-1.5 py-1 border rounded text-[11px] focus:ring-1 focus:ring-indigo-200 outline-none"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                  <button
                    onClick={() => removeJsonField(idx)}
                    className="text-gray-400 hover:text-red-500 text-sm px-1"
                  >×</button>
                </div>
                <input
                  value={field.description}
                  onChange={(e) => updateJsonField(idx, 'description', e.target.value)}
                  placeholder="Description (helps AI understand what to extract)"
                  className="w-full px-2 py-1 border rounded text-[10px] text-gray-500 focus:ring-1 focus:ring-indigo-200 outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Model selector ── */}
      <label className="block text-xs text-gray-500 mb-1">AI Model</label>
      <select
        value={model}
        onChange={(e) => { setModel(e.target.value); setDirty(true); }}
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none"
      >
        <option value="">Select model…</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.icon} {m.display_name}</option>
        ))}
      </select>

      {selectedModel && (
        <div className="mb-3 bg-gray-50 rounded-lg p-2 text-[11px] text-gray-600">
          <span className="font-medium">{selectedModel.icon} {selectedModel.display_name}</span> — {selectedModel.description}
        </div>
      )}

      {/* ── System prompt ── */}
      <label className="block text-xs text-gray-500 mb-1">System Prompt</label>
      <textarea
        value={systemPrompt}
        onChange={(e) => { setSystemPrompt(e.target.value); setDirty(true); }}
        placeholder={
          outputFormat === 'json_extract'
            ? 'e.g. Analyze this contract and extract the fields listed below…'
            : outputFormat === 'yes_no'
            ? 'e.g. Does this contract contain a non-compete clause?'
            : 'e.g. Summarize the key terms of this agreement…'
        }
        rows={4}
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none resize-y"
      />

      {/* ── Output key ── */}
      <label className="block text-xs text-gray-500 mb-1">Output Key</label>
      <input
        value={outputKey}
        onChange={(e) => { setOutputKey(e.target.value); setDirty(true); }}
        placeholder="ai_analysis"
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none"
      />

      {/* ── Temperature ── */}
      <label className="block text-xs text-gray-500 mb-1">Temperature: {temperature}</label>
      <input
        type="range" min="0" max="1" step="0.1"
        value={temperature}
        onChange={(e) => { setTemperature(parseFloat(e.target.value)); setDirty(true); }}
        className="w-full mb-3 accent-rose-500"
      />

      {/* ── Max tokens ── */}
      <label className="block text-xs text-gray-500 mb-1">Max Tokens</label>
      <input
        type="number" value={maxTokens} min={100} max={8192} step={256}
        onChange={(e) => { setMaxTokens(e.target.value); setDirty(true); }}
        className="w-full mb-3 px-2.5 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none"
      />

      {/* ── Context toggles ── */}
      <label className="flex items-center gap-2 text-xs cursor-pointer mb-2">
        <input type="checkbox" checked={includeText}
          onChange={(e) => { setIncludeText(e.target.checked); setDirty(true); }}
          className="rounded border-gray-300 text-rose-600 focus:ring-rose-500" />
        Include document text
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer mb-3">
        <input type="checkbox" checked={includeMetadata}
          onChange={(e) => { setIncludeMetadata(e.target.checked); setDirty(true); }}
          className="rounded border-gray-300 text-rose-600 focus:ring-rose-500" />
        Include extracted metadata
      </label>

      {/* ── Save button ── */}
      {dirty && (
        <button onClick={handleSave}
          className="mt-2 w-full px-2 py-2 bg-rose-600 text-white rounded-lg text-xs font-medium hover:bg-rose-700 transition-colors">
          💾 Save AI Config
        </button>
      )}

      {/* ── Last AI result ── */}
      {node.last_result?.ai_status && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last AI Run</p>
          <p className="text-xs font-medium text-gray-700 capitalize">{node.last_result.ai_status}</p>
          <div className="flex gap-2 text-[10px]">
            {node.last_result.processed > 0 && <span className="text-emerald-600">✓ {node.last_result.processed} processed</span>}
            {node.last_result.failed > 0 && <span className="text-red-600">✕ {node.last_result.failed} failed</span>}
          </div>
          {node.last_result.ai_model && (
            <p className="text-[10px] text-gray-400">Model: {node.last_result.ai_model}</p>
          )}
        </div>
      )}
    </div>
  );
}


/* ──────────────────────────────────────────────────────── */
/*  GateConfigPanel — AND Gate configuration                */
/* ──────────────────────────────────────────────────────── */

function GateConfigPanel({ node, onChange }) {
  const lastResult = node.last_result || {};

  return (
    <div>
      {/* Gate type info */}
      <div className="bg-orange-50 rounded-lg p-3 text-xs text-orange-700 mb-3">
        <p className="font-semibold">∩ AND Gate</p>
        <p className="text-[11px] opacity-80 mt-0.5">
          Only documents present in every incoming connection pass through.
        </p>
      </div>

      {/* Last result */}
      {lastResult.gate_status && (
        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last Gate Result</p>
          <div className="flex gap-3 text-xs font-medium">
            <span className="text-emerald-600">✓ {lastResult.count ?? 0} passed</span>
            {lastResult.blocked > 0 && (
              <span className="text-gray-400">✕ {lastResult.blocked} blocked</span>
            )}
          </div>
          {lastResult.parent_count > 0 && (
            <p className="text-[10px] text-gray-400">
              {lastResult.parent_count} upstream path{lastResult.parent_count !== 1 ? 's' : ''}
              {' · '}{lastResult.total_upstream} total docs upstream
            </p>
          )}
          {lastResult.gate_message && (
            <p className="text-[10px] text-gray-500 italic">{lastResult.gate_message}</p>
          )}
        </div>
      )}
    </div>
  );
}


/* ──────────────────────────────────────────────────────── */
/*  DocCreateConfigPanel — compact sidebar summary + wizard */
/* ──────────────────────────────────────────────────────── */

function DocCreateConfigPanel({ node, onChange, workflowId, fieldOptions }) {
  const config = node.config || {};
  const creationMode = config.creation_mode || '';
  const mappings = config.field_mappings || [];
  const lastResult = node.last_result || {};
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const MODE_LABELS = { template: '📄 Template', duplicate: '📋 Duplicate', quick_latex: '📐 LaTeX', structured: '📝 Structured' };
  const modeLabel = MODE_LABELS[creationMode] || '— not set —';

  const sourceName = creationMode === 'template'
    ? (config.template_name || '—')
    : (config.source_document_id ? config.source_document_id.slice(0, 8) + '…' : '—');

  const customCount = mappings.filter(m => m.target_field?.startsWith('custom_metadata.')).length;
  const metaCount   = mappings.filter(m => m.target_field?.startsWith('document_metadata.')).length;
  const fieldCount  = mappings.length - customCount - metaCount;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-3.5 border border-indigo-100">
        <p className="font-semibold text-indigo-800 text-xs flex items-center gap-1.5">📄 Document Creator</p>
      </div>

      {/* Config summary */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[10px] text-gray-400 uppercase font-semibold">Mode</span>
          <span className="text-xs font-medium text-gray-700">{modeLabel}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[10px] text-gray-400 uppercase font-semibold">Source</span>
          <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{sourceName}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[10px] text-gray-400 uppercase font-semibold">Mappings</span>
          <div className="flex items-center gap-1.5 text-[10px]">
            {mappings.length === 0 ? (
              <span className="text-gray-400">None</span>
            ) : (
              <>
                {fieldCount > 0 && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{fieldCount} field{fieldCount > 1 ? 's' : ''}</span>}
                {customCount > 0 && <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">{customCount} custom</span>}
                {metaCount > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-medium">{metaCount} meta</span>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Configure button */}
      <button
        onClick={() => setWizardOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
      >
        ⚙️ Configure Document Creator
      </button>

      {/* Last execution result (keep in sidebar for quick glance) */}
      {(lastResult.created != null || lastResult.status) && (
        <div className="bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-100">
          <p className="text-[10px] uppercase text-gray-400 font-semibold">Last Execution</p>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            {lastResult.created > 0 && <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md">✓ {lastResult.created} created</span>}
            {lastResult.skipped > 0 && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md">⊘ {lastResult.skipped} skipped</span>}
            {lastResult.failed > 0 && <span className="px-2 py-1 bg-red-100 text-red-700 rounded-md">✕ {lastResult.failed} failed</span>}
          </div>
          {lastResult.created_document_ids?.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[9px] text-gray-400 font-semibold uppercase">Created Documents</p>
              {lastResult.created_document_ids.map(docId => (
                <a
                  key={docId}
                  href={`/drafter/${docId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[10px] text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1.5 rounded-lg transition-colors"
                >
                  <span>📄</span>
                  <span className="font-medium">Open in Editor</span>
                  <span className="text-gray-400 font-mono ml-auto">{docId.slice(0, 8)}…</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wizard modal */}
      <DocCreateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        node={node}
        onSave={(draft) => onChange(draft)}
        fieldOptions={fieldOptions}
      />
    </div>
  );
}


/* ──────────────────────────────────────────────────────── */
/*  SheetConfigPanel — sidebar config for Sheet nodes       */
/* ──────────────────────────────────────────────────────── */

function SheetConfigPanel({ node, onChange, connections = [] }) {
  const config = node.config || {};
  const writeMode = config.write_mode || 'append';
  const autoColumns = config.auto_columns !== false;
  const lastResult = node.last_result || {};

  // Auto-detect mode: if this node has any incoming connections, it writes (storage).
  // If no incoming connections, it reads from the sheet (input).
  const hasIncoming = connections.some(c => c.target_node === node.id);
  const effectiveMode = hasIncoming ? 'storage' : 'input';

  // Sync effective mode to config whenever connections change
  React.useEffect(() => {
    if (config.mode !== effectiveMode) {
      onChange({ ...config, mode: effectiveMode });
    }
  }, [effectiveMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sheets, setSheets] = React.useState([]);
  const [loadingSheets, setLoadingSheets] = React.useState(false);

  // Fetch available sheets on mount
  React.useEffect(() => {
    let cancelled = false;
    setLoadingSheets(true);
    import('@services/sheetsService').then(({ sheetsService }) => {
      sheetsService.list().then(({ data }) => {
        if (!cancelled) {
          const list = Array.isArray(data) ? data : (data.results || []);
          setSheets(list);
        }
      }).catch(() => {}).finally(() => { if (!cancelled) setLoadingSheets(false); });
    });
    return () => { cancelled = true; };
  }, []);

  const update = (patch) => {
    onChange({ ...config, ...patch });
  };

  const selectedSheet = sheets.find(s => s.id === config.sheet_id);
  const [creatingSheetName, setCreatingSheetName] = React.useState('New Sheet');
  const [creatingSheet, setCreatingSheet] = React.useState(false);

  const handleCreateSheet = async () => {
    setCreatingSheet(true);
    try {
      const { sheetsService } = await import('@services/sheetsService');
      const payload = { title: creatingSheetName, col_count: 5, row_count: 10 };
      const { data } = await sheetsService.create(payload);
      // add to local list and select
      setSheets((prev) => [data, ...prev]);
      update({ sheet_id: data.id, sheet_title: data.title });
      notify.success('Sheet created and linked');
    } catch (e) {
      notify.error('Failed to create sheet: ' + (e.response?.data?.error || e.message));
    } finally {
      setCreatingSheet(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className={`rounded-xl p-3 border ${
        effectiveMode === 'input'
          ? 'bg-blue-50/60 border-blue-200'
          : 'bg-emerald-50/60 border-emerald-200'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-base">{effectiveMode === 'input' ? '📊' : '📝'}</span>
          <div className="flex-1">
            <p className={`text-xs font-semibold ${effectiveMode === 'input' ? 'text-blue-700' : 'text-emerald-700'}`}>
              {effectiveMode === 'input' ? 'Read Mode' : 'Write Mode'}
            </p>
          </div>
          <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
            effectiveMode === 'input'
              ? 'bg-blue-100 text-blue-600'
              : 'bg-emerald-100 text-emerald-600'
          }`}>
            Auto
          </span>
        </div>
      </div>

      {/* Sheet picker */}
      <div>
        <label className="block text-[10px] text-gray-400 uppercase font-semibold mb-1.5">Linked Sheet</label>
        {loadingSheets ? (
          <p className="text-[11px] text-gray-400">Loading sheets…</p>
        ) : sheets.length === 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-400 italic">No sheets found.</p>
            <div className="flex gap-2">
              <input value={creatingSheetName} onChange={(e) => setCreatingSheetName(e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" />
              <button onClick={handleCreateSheet} disabled={creatingSheet} className={`px-3 py-1 rounded text-xs font-medium ${creatingSheet ? 'bg-gray-200 text-gray-500' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                {creatingSheet ? 'Creating…' : 'Create Sheet'}
              </button>
            </div>
          </div>
        ) : (
          <>
          <select
            value={config.sheet_id || ''}
            onChange={(e) => {
              const s = sheets.find(sh => sh.id === e.target.value);
              update({ sheet_id: e.target.value, sheet_title: s?.title || '' });
            }}
            className="w-full px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400 outline-none"
          >
            <option value="">— Select sheet —</option>
            {sheets.map(s => (
              <option key={s.id} value={s.id}>{s.title || `Sheet ${s.id.slice(0, 8)}`}</option>
            ))}
          </select>
          {/* Quick-create when nothing selected */}
          {!config.sheet_id && (
            <div className="mt-2 flex gap-2">
              <input value={creatingSheetName} onChange={(e) => setCreatingSheetName(e.target.value)} className="flex-1 px-2 py-1 border rounded text-sm" placeholder="New sheet name" />
              <button onClick={handleCreateSheet} disabled={creatingSheet} className={`px-3 py-1 rounded text-xs font-medium ${creatingSheet ? 'bg-gray-200 text-gray-500' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                {creatingSheet ? 'Creating…' : 'Create'}
              </button>
            </div>
          )}
          </>
        )}
        {selectedSheet && (
          <p className="text-[10px] text-gray-400 mt-1">
            {selectedSheet.row_count ?? '?'} rows · {selectedSheet.col_count ?? '?'} columns
          </p>
        )}
      </div>

      {/* Write-mode specific: write behavior + overwrite */}
      {effectiveMode === 'storage' && (
        <div>
          <label className="block text-[10px] text-gray-400 uppercase font-semibold mb-1.5">Write Behavior</label>
          <div className="flex gap-1">
            <button
              onClick={() => update({ write_mode: 'append' })}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                writeMode === 'append'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              ➕ Append
            </button>
            <button
              onClick={() => update({ write_mode: 'overwrite' })}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                writeMode === 'overwrite'
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              🔄 Overwrite
            </button>
          </div>
          {writeMode === 'overwrite' && (
            <p className="mt-1.5 text-[10px] text-amber-600 font-medium">⚠️ Clears all rows before writing</p>
          )}
        </div>
      )}

      {/* Auto columns toggle (write mode only) */}
      {effectiveMode === 'storage' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoColumns}
            onChange={(e) => update({ auto_columns: e.target.checked })}
            className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-400"
          />
          <span className="text-xs text-gray-600">Auto-create columns for new fields</span>
        </label>
      )}

      {/* Last execution result */}
      {(lastResult.sheet_status || lastResult.sheet_mode) && (
        <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 border border-gray-100">
          <p className="text-[10px] uppercase text-gray-400 font-semibold flex items-center gap-1.5">
            Last Execution
            {lastResult.sheet_status === 'completed' && <span className="text-[8px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold">✓ Done</span>}
            {lastResult.sheet_status === 'error' && <span className="text-[8px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">✕ Error</span>}
            {lastResult.write_mode === 'overwrite' && <span className="text-[8px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-bold">🔄 Overwrite</span>}
          </p>
          {lastResult.sheet_status === 'error' && lastResult.message && (
            <p className="text-[10px] text-red-600 bg-red-50 rounded-md px-2 py-1">{lastResult.message}</p>
          )}
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            {lastResult.row_count > 0 && (
              <span className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded-md">📊 {lastResult.row_count} rows read</span>
            )}
            {lastResult.rows_overwritten > 0 && (
              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md">🗑️ {lastResult.rows_overwritten} cleared</span>
            )}
            {lastResult.rows_written > 0 && (
              <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md">✓ {lastResult.rows_written} written</span>
            )}
            {lastResult.query_count > 0 && (
              <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-md">⚡ {lastResult.query_count} queries</span>
            )}
            {lastResult.cache_hits > 0 && (
              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md">⊘ {lastResult.cache_hits} cached</span>
            )}
          </div>
          {lastResult.sheet_title && (
            <p className="text-[10px] text-gray-500">Sheet: {lastResult.sheet_title}</p>
          )}
        </div>
      )}
    </div>
  );
}
