import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/app.store.js";

const THROTTLE_MS = 300;
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Aggregates bgTasks progress and sends it to the main process
 * for taskbar progress bar (Windows) and dock badge (macOS).
 */
export function useIconProgress(): void {
  const bgTasks = useAppStore((s) => s.bgTasks);
  const showIconProgress = useAppStore((s) => s.showIconProgress);
  const prevKeyRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(0);

  // Listen for bg-task:progress from main process → update store
  useEffect(() => {
    const cleanup = window.api.onBgTaskProgress(({ id, progress }) => {
      useAppStore.getState().updateBgTaskProgress(`main:${id}`, progress);
    });
    return cleanup;
  }, []);

  // Stale task watchdog — mark tasks as error if not updated for 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const { bgTasks, finishBgTask } = useAppStore.getState();
      for (const task of bgTasks) {
        if (task.finishedAt) continue;
        const lastActivity = task.lastUpdatedAt || task.startedAt;
        if (now - lastActivity > STALE_TIMEOUT_MS) {
          finishBgTask(task.id);
        }
      }
    }, 30_000); // check every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // If disabled, clear icon and bail
    if (!showIconProgress) {
      window.api.setIconProgress({ progress: -1, activeCount: 0 });
      prevKeyRef.current = "";
      return;
    }

    const activeTasks = bgTasks.filter((t) => !t.finishedAt);
    const activeCount = activeTasks.length;

    let progress: number;
    if (activeCount === 0) {
      progress = -1;
    } else {
      const withProgress = activeTasks.filter((t) => t.progress !== undefined);
      if (withProgress.length === 0) {
        progress = 2; // all indeterminate
      } else if (withProgress.length < activeCount) {
        progress = 2; // mix → indeterminate
      } else {
        progress = withProgress.reduce((sum, t) => sum + (t.progress ?? 0), 0) / withProgress.length;
      }
    }

    const key = `${progress.toFixed(3)}:${activeCount}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    // Throttle IPC sends
    const now = Date.now();
    const elapsed = now - lastSentRef.current;

    const send = () => {
      lastSentRef.current = Date.now();
      window.api.setIconProgress({ progress, activeCount });
    };

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Send immediately when removing progress or if enough time passed
    if (progress === -1 || elapsed >= THROTTLE_MS) {
      send();
    } else {
      timerRef.current = setTimeout(send, THROTTLE_MS - elapsed);
    }
  }, [bgTasks, showIconProgress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.api.setIconProgress({ progress: -1, activeCount: 0 });
    };
  }, []);
}
