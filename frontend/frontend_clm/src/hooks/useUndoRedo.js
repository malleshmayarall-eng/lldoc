/**
 * useUndoRedo — snapshot-based undo/redo for workflow canvas.
 *
 * Captures serialisable {nodes, connections} snapshots.
 * On undo/redo it diffs the current state against the target snapshot
 * and issues the minimal set of API calls to sync the server.
 *
 * Usage:
 *   const { pushSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo({
 *     nodes, connections, setNodes, setConnections,
 *     workflowId, fetchAll,
 *   });
 */
import { useRef, useCallback, useEffect, useState } from 'react';
import { nodeApi, connectionApi } from '../api/clmApi';

const MAX_HISTORY = 40;

/** Deep-clone plain JSON-safe objects */
const snap = (obj) => JSON.parse(JSON.stringify(obj));

export default function useUndoRedo({
  nodes,
  connections,
  setNodes,
  setConnections,
  workflowId,
  fetchAll,
}) {
  // past = committed snapshots (newest last), future = undone snapshots
  const past   = useRef([]);
  const future = useRef([]);
  const [revision, setRevision] = useState(0);          // trigger re-renders
  const syncing = useRef(false);                         // prevent re-entrant sync

  // ── Push a snapshot BEFORE a mutation ──────────────────────────────────
  const pushSnapshot = useCallback(() => {
    past.current.push(snap({ nodes, connections }));
    if (past.current.length > MAX_HISTORY) past.current.shift();
    future.current = [];          // new mutation kills redo branch
    setRevision((r) => r + 1);
  }, [nodes, connections]);

  // ── Diff + sync helper ────────────────────────────────────────────────
  const applySnapshot = useCallback(async (target) => {
    if (syncing.current) return;
    syncing.current = true;

    const curNodeIds = new Set(nodes.map((n) => n.id));
    const tgtNodeIds = new Set(target.nodes.map((n) => n.id));
    const curConnIds = new Set(connections.map((c) => c.id));
    const tgtConnIds = new Set(target.connections.map((c) => c.id));

    try {
      // 1. Delete connections that exist now but not in target
      for (const c of connections) {
        if (!tgtConnIds.has(c.id)) {
          try { await connectionApi.delete(c.id); } catch {}
        }
      }

      // 2. Delete nodes that exist now but not in target
      for (const n of nodes) {
        if (!tgtNodeIds.has(n.id)) {
          try { await nodeApi.delete(n.id); } catch {}
        }
      }

      // 3. Create nodes that exist in target but not now
      const nodeIdMap = {};      // old-id → new-id (in case server assigns new IDs)
      for (const tn of target.nodes) {
        if (!curNodeIds.has(tn.id)) {
          try {
            const { data } = await nodeApi.create({
              workflow: workflowId,
              node_type: tn.node_type,
              label: tn.label,
              position_x: tn.position_x,
              position_y: tn.position_y,
              config: tn.config,
            });
            nodeIdMap[tn.id] = data.id;
          } catch {}
        } else {
          nodeIdMap[tn.id] = tn.id;
        }
      }

      // 4. Update nodes that exist in both (config/position may differ)
      for (const tn of target.nodes) {
        const resolvedId = nodeIdMap[tn.id] || tn.id;
        if (curNodeIds.has(tn.id)) {
          const cur = nodes.find((n) => n.id === tn.id);
          if (!cur) continue;
          const changed = {};
          if (cur.label !== tn.label) changed.label = tn.label;
          if (cur.position_x !== tn.position_x) changed.position_x = tn.position_x;
          if (cur.position_y !== tn.position_y) changed.position_y = tn.position_y;
          if (JSON.stringify(cur.config) !== JSON.stringify(tn.config)) changed.config = tn.config;
          if (Object.keys(changed).length > 0) {
            try { await nodeApi.update(resolvedId, changed); } catch {}
          }
        }
      }

      // 5. Create connections that exist in target but not now
      for (const tc of target.connections) {
        if (!curConnIds.has(tc.id)) {
          const src = nodeIdMap[tc.source_node] || tc.source_node;
          const tgt = nodeIdMap[tc.target_node] || tc.target_node;
          try {
            await connectionApi.create({
              workflow: workflowId,
              source_node: src,
              target_node: tgt,
            });
          } catch {}
        }
      }

      // 6. Re-fetch authoritative state from server
      await fetchAll();
    } finally {
      syncing.current = false;
    }
  }, [nodes, connections, workflowId, fetchAll]);

  // ── Undo ──────────────────────────────────────────────────────────────
  const undo = useCallback(async () => {
    if (past.current.length === 0 || syncing.current) return;
    // Save current state to future
    future.current.push(snap({ nodes, connections }));
    // Pop last snapshot
    const target = past.current.pop();
    setRevision((r) => r + 1);
    await applySnapshot(target);
  }, [nodes, connections, applySnapshot]);

  // ── Redo ──────────────────────────────────────────────────────────────
  const redo = useCallback(async () => {
    if (future.current.length === 0 || syncing.current) return;
    // Save current state to past
    past.current.push(snap({ nodes, connections }));
    // Pop from future
    const target = future.current.pop();
    setRevision((r) => r + 1);
    await applySnapshot(target);
  }, [nodes, connections, applySnapshot]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Skip if user is typing in an input/textarea/contenteditable
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;

      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (mod && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  return {
    pushSnapshot,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    _revision: revision,                // subscribe to re-renders
  };
}
