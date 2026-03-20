/**
 * useTaskPoller — custom hook for polling SheetTask progress.
 *
 * Usage:
 *   const { task, isPolling, startPolling, cancel } = useTaskPoller(sheetId);
 *   startPolling(taskId);  // begins polling every 1s
 *   // task = { id, status, progress, total_items, completed_items, result, error, ... }
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import sheetsService from '../services/sheetsService';

const POLL_INTERVAL = 1000; // 1 second

export function useTaskPoller(sheetId) {
  const [task, setTask] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef(null);
  const taskIdRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const poll = useCallback(async () => {
    if (!sheetId || !taskIdRef.current) return;
    try {
      const res = await sheetsService.getTaskStatus(sheetId, taskIdRef.current);
      const taskData = res.data;
      setTask(taskData);

      // Stop polling on terminal states
      if (['completed', 'failed', 'cancelled'].includes(taskData.status)) {
        stopPolling();
      }
    } catch (err) {
      console.error('[useTaskPoller] poll error:', err);
      stopPolling();
    }
  }, [sheetId, stopPolling]);

  const startPolling = useCallback((taskId) => {
    stopPolling(); // clear any existing
    taskIdRef.current = taskId;
    setIsPolling(true);
    setTask(null);
    // Immediate first poll
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
  }, [poll, stopPolling]);

  const cancel = useCallback(() => {
    stopPolling();
    setTask(null);
    taskIdRef.current = null;
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { task, isPolling, startPolling, cancel };
}

export default useTaskPoller;
