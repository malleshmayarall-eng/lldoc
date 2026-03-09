/**
 * SaveCoordinator — Centralized document save orchestrator
 *
 * Coalesces rapid edits, serializes flushes, and deduplicates
 * changes across the entire editor lifecycle.
 *
 * All entities are created via direct POST API calls first (create-first
 * pattern), so the coordinator only handles updates and deletes.
 *
 * Production-grade guarantees:
 *  • At most ONE in-flight partial-save request at a time (mutex).
 *  • Debounced auto-flush (configurable, default 1 200 ms).
 *  • ETag / 412 conflict detection with caller-supplied handler.
 */

import { ChangeQueue, normalizeChange } from './partialSaveQueue';
import documentService from '../services/documentService';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Stable key for an entity change (type + identifier). */
const entityKey = (change) => {
  const id = change.id || change.client_id;
  return `${change.type}:${id}`;
};

// ─── SaveCoordinator ────────────────────────────────────────────────────────

export class SaveCoordinator {
  /**
   * @param {Object} opts
   * @param {() => string|null}       opts.getDocumentId  — returns the current doc UUID
   * @param {(result: Object) => void} opts.onSaveResult   — callback with partial-save response
   * @param {(error: Error) => void}   opts.onSaveError    — callback on save failure
   * @param {(conflict: string) => void} opts.onConflict   — callback for 412 conflicts
   * @param {(status: string) => void} opts.onStatusChange — 'idle' | 'saving' | 'ok' | 'error'
   * @param {number}                   opts.debounceMs     — auto-flush debounce (default 1200)
   */
  constructor(opts = {}) {
    this._getDocumentId = opts.getDocumentId || (() => null);
    this._onSaveResult = opts.onSaveResult || (() => {});
    this._onSaveError = opts.onSaveError || (() => {});
    this._onConflict = opts.onConflict || (() => {});
    this._onStatusChange = opts.onStatusChange || (() => {});
    this._debounceMs = opts.debounceMs ?? 1200;

    // Core queue (coalesces changes by entity key)
    this._queue = new ChangeQueue();

    // Mutex: true while a partial-save POST is in progress
    this._flushing = false;

    // Debounce timer
    this._flushTimer = null;

    // Whether another flush was requested while one was running
    this._flushQueued = false;

    // 412 alert already shown (prevent spam)
    this._conflictShown = false;

    this._status = 'idle';
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Current queue size. */
  get size() {
    return this._queue.size;
  }

  get status() {
    return this._status;
  }

  /**
   * Enqueue a change.
   *
   * The coordinator will:
   *  1. Normalize the change via ChangeQueue.
   *  2. Coalesce duplicate changes.
   *  3. Schedule a debounced flush.
   */
  enqueue(change) {
    const normalized = this._prepareChange(change);
    if (!normalized) return;

    this._queue.add(normalized);
    this._scheduleFlush();
  }

  /**
   * Flush all pending changes NOW (cancels any debounce timer).
   * Returns a Promise that resolves when the save completes.
   */
  async flush() {
    this._clearTimer();

    // If already flushing, mark that another flush is needed and wait
    if (this._flushing) {
      this._flushQueued = true;
      return;
    }

    await this._doFlush();
  }

  /**
   * Clear the queue and all state (e.g. on document reload).
   */
  reset() {
    this._clearTimer();
    this._queue.clear();
    this._flushing = false;
    this._flushQueued = false;
    this._conflictShown = false;
    this._setStatus('idle');
  }

  /** Destroy timers. Call when unmounting. */
  dispose() {
    this._clearTimer();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _setStatus(status) {
    this._status = status;
    this._onStatusChange(status);
  }

  _clearTimer() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  _scheduleFlush() {
    this._clearTimer();
    this._flushTimer = setTimeout(() => {
      this.flush();
    }, this._debounceMs);
  }

  /**
   * Normalize a change before queueing.
   */
  _prepareChange(change) {
    let prepared;
    try {
      prepared = normalizeChange(change);
    } catch (err) {
      console.warn('[SaveCoordinator] Invalid change dropped:', err.message, change);
      return null;
    }

    return prepared;
  }

  /**
   * Core flush logic. Serialized — only one runs at a time.
   */
  async _doFlush() {
    const documentId = this._getDocumentId();
    if (!documentId) return;
    if (this._queue.size === 0) return;

    this._flushing = true;
    this._setStatus('saving');

    // 1. Gather all pending changes
    const pending = this._queue.pending;

    // 2. Deduplicate by entity key (belt-and-suspenders)
    const deduped = new Map();
    for (const change of pending) {
      const key = entityKey(change);
      const existing = deduped.get(key);
      if (existing) {
        // merge data, prefer the later change
        deduped.set(key, {
          ...existing,
          ...change,
          data: { ...existing.data, ...change.data },
          op: change.op,
        });
      } else {
        deduped.set(key, change);
      }
    }
    const finalChanges = Array.from(deduped.values());

    if (finalChanges.length === 0) {
      this._flushing = false;
      this._setStatus('ok');
      return;
    }

    // 3. Send to backend
    try {
      const payload = { changes: finalChanges };
      const result = await documentService.partialSave(documentId, payload);

      // 4. Clear the queue
      this._queue.clear();

      // 5. Notify caller
      this._onSaveResult(result);
      this._conflictShown = false;
      this._setStatus(this._queue.size > 0 ? 'idle' : 'ok');
    } catch (error) {
      // Handle 412 conflict
      const is412 =
        error?.name === 'StaleDataError' ||
        error?.response?.status === 412;
      if (is412) {
        if (!this._conflictShown) {
          this._conflictShown = true;
          this._onConflict('This document was updated elsewhere. Please refresh to sync.');
        }
      } else {
        this._onSaveError(error);
      }

      this._setStatus('error');
    } finally {
      this._flushing = false;

      // If another flush was requested while we were busy, go again
      if (this._flushQueued || this._queue.size > 0) {
        this._flushQueued = false;
        this._scheduleFlush();
      }
    }
  }
}

export default SaveCoordinator;
