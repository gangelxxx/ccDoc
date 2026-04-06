/**
 * Reusable status bar item for background processes.
 *
 * Usage:
 *   <BgProcessItem
 *     status="processing"       // "processing" | "done" | "error"
 *     label="✨ Generating titles: My Ideas"
 *     startedAt={1711234567890}
 *     onCancel={() => cancelMyProcess()}
 *     onClick={() => openResult()}   // only for "done" state
 *   />
 */

import { useState, useEffect } from "react";
import { Loader2, Check, AlertCircle, X } from "lucide-react";
import { useT } from "../../i18n.js";

export type BgProcessStatus = "processing" | "done" | "error";

interface BgProcessItemProps {
  status: BgProcessStatus;
  label: string;
  startedAt: number;
  progress?: number; // 0..1
  onCancel?: () => void;
  onClick?: () => void;
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  const sec = Math.floor((now - since) / 1000);

  useEffect(() => {
    const interval = sec >= 3600 ? 30_000 : 1000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [sec >= 3600]);

  return <span className="status-bar-elapsed">{formatElapsed(sec)}</span>;
}

export function BgProcessItem({ status, label, startedAt, progress, onCancel, onClick }: BgProcessItemProps) {
  const t = useT();

  const isDone = status === "done";
  const isError = status === "error";
  const isClickable = isDone && !!onClick;

  return (
    <div
      className={`status-bar-task${isDone ? " status-bar-task--bg-done" : ""}${isError ? " status-bar-task--bg-error" : ""}`}
      style={isClickable ? { cursor: "pointer" } : undefined}
      onClick={isClickable ? onClick : undefined}
    >
      {isDone ? (
        <Check size={12} className="status-bar-check" />
      ) : isError ? (
        <AlertCircle size={12} style={{ color: "var(--danger)" }} />
      ) : (
        <Loader2 size={12} className="status-bar-spinner" />
      )}
      <span className="status-bar-label">{label}</span>
      {!isDone && progress !== undefined && (
        <span className="status-bar-progress">{Math.round(progress * 100)}%</span>
      )}
      {!isDone && <Elapsed since={startedAt} />}
      {onCancel && (
        <button
          className="status-bar-task-cancel"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          title={t("cancel")}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
