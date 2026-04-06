import { useState, useEffect, useRef } from "react";
import { Loader2, Check, RefreshCw, Copy } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";
import { BgProcessItem } from "./BgProcessItem.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
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

export function StatusBar() {
  const t = useT();
  const bgTasks = useAppStore((s) => s.bgTasks);
  const llmLoading = useAppStore((s) => s.llmLoading);
  const stopLlmChat = useAppStore((s) => s.stopLlmChat);
  const externalChangePending = useAppStore((s) => s.externalChangePending);
  const refreshCurrentSection = useAppStore((s) => s.refreshCurrentSection);
  const [showProgressPopup, setShowProgressPopup] = useState(false);
  const [semanticHovered, setSemanticHovered] = useState(false);
  const semanticTaskRef = useRef<HTMLDivElement>(null);
  const semanticProgressItem = useAppStore((s) => s.semanticProgressItem);
  const semanticProgressLog = useAppStore((s) => s.semanticProgressLog);

  // Listen for background tasks from main process
  useEffect(() => {
    const cleanupStart = window.api.onBgTaskStart(({ id, label }) => {
      useAppStore.setState((s) => ({
        bgTasks: [...s.bgTasks, { id: `main:${id}`, label, startedAt: Date.now() }],
      }));
    });
    const cleanupFinish = window.api.onBgTaskFinish(({ id }) => {
      useAppStore.setState((s) => {
        const task = s.bgTasks.find((t) => t.id === `main:${id}`);
        const isSemantic = task?.label?.startsWith("Semantic");
        const next: Partial<typeof s> = { bgTasks: s.bgTasks.filter((t) => t.id !== `main:${id}`) };
        if (isSemantic) {
          next.semanticProgressItem = null;
          next.semanticProgressLog = [];
        }
        return next;
      });
    });
    const cleanupProgress = window.api.onSemanticProgress(({ item }) => {
      useAppStore.getState().onSemanticProgress(item);
    });
    return () => { cleanupStart(); cleanupFinish(); cleanupProgress(); };
  }, []);

  // Close progress popup on outside click
  useEffect(() => {
    if (!showProgressPopup) return;
    const close = () => setShowProgressPopup(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showProgressPopup]);

  const voiceDownloading = useAppStore((s) => s.voiceDownloading);
  const voiceProgress = useAppStore((s) => s.voiceProgress);
  const openSettings = useAppStore((s) => s.openSettings);
  const embeddingBgTaskIds = useAppStore((s) => s.embeddingBgTaskIds);
  const ideaProcessingTask = useAppStore((s) => s.ideaProcessingTask);
  const openIdeaProcessingResult = useAppStore((s) => s.openIdeaProcessingResult);
  const clearIdeaProcessingTask = useAppStore((s) => s.clearIdeaProcessingTask);
  const projectPath = useAppStore((s) => s.currentProject?.path);

  // Collect bg task IDs managed by BgProcessItem so we skip them in the generic loop
  const bgProcessTaskIds = new Set<string>();
  if (ideaProcessingTask) bgProcessTaskIds.add(ideaProcessingTask.bgTaskId);

  return (
    <div className="status-bar">
      <div className="status-bar-section status-bar-section--left">
        {projectPath && (
          <div className="status-bar-path-group">
            <span className="status-bar-path" title={projectPath}>{projectPath}</span>
            <button
              className="status-bar-copy"
              title={t("copyPath")}
              onClick={() => navigator.clipboard.writeText(projectPath)}
            >
              <Copy size={11} />
            </button>
          </div>
        )}
      </div>
      <div className="status-bar-section" />
      <div className="status-bar-section status-bar-section--right">
        {externalChangePending && (
          <div
            className="status-bar-external-change"
            onClick={refreshCurrentSection}
            title={t("externalChangeHint")}
          >
            <RefreshCw size={12} />
            <span>{t("externalChangeLabel")}</span>
          </div>
        )}
        {llmLoading && (
          <div className="llm-esc-hint" onClick={stopLlmChat}>
            <kbd>Esc</kbd> {t("llmEscHint")}
          </div>
        )}
        {voiceDownloading && (
          <div className="status-bar-task" style={{ cursor: "pointer" }} onClick={() => openSettings("voice")}>
            <Loader2 size={12} className="status-bar-spinner" />
            <span className="status-bar-label">{t("voiceDownloading", voiceDownloading)}</span>
            <span className="status-bar-tokens">{voiceProgress}%</span>
          </div>
        )}

        {/* Idea processing — rendered via reusable BgProcessItem */}
        {ideaProcessingTask && (
          <BgProcessItem
            status={ideaProcessingTask.status}
            label={bgTasks.find((t) => t.id === ideaProcessingTask.bgTaskId)?.label || ideaProcessingTask.sectionTitle}
            startedAt={bgTasks.find((t) => t.id === ideaProcessingTask.bgTaskId)?.startedAt || Date.now()}
            onCancel={clearIdeaProcessingTask}
            onClick={ideaProcessingTask.status === "done" ? openIdeaProcessingResult : undefined}
          />
        )}

        {/* Generic bg tasks (excluding those rendered by BgProcessItem above) */}
        {bgTasks.filter((task) => !bgProcessTaskIds.has(task.id)).map((task) => {
          const isEmbeddingDownload = Object.values(embeddingBgTaskIds).includes(task.id);
          const isSemantic = task.label?.startsWith("Semantic");
          return (
          <div
            key={task.id}
            ref={isSemantic ? semanticTaskRef : undefined}
            className={`status-bar-task${task.finishedAt ? " status-bar-task--done" : ""}`}
            style={isSemantic
              ? { cursor: "pointer", padding: "2px 8px", borderRadius: 4, background: "var(--bg-tertiary, transparent)" }
              : isEmbeddingDownload ? { cursor: "pointer" } : undefined}
            onClick={
              isEmbeddingDownload ? () => openSettings("embeddings") :
              isSemantic ? (e: React.MouseEvent) => { e.stopPropagation(); setShowProgressPopup((p) => !p); } :
              undefined
            }
            onMouseEnter={isSemantic ? () => setSemanticHovered(true) : undefined}
            onMouseLeave={isSemantic ? () => setSemanticHovered(false) : undefined}
          >
            {task.finishedAt ? (
              <Check size={12} className="status-bar-check" />
            ) : (
              <Loader2 size={12} className="status-bar-spinner" />
            )}
            <span className="status-bar-label">{task.label}</span>
            {!task.finishedAt && task.progress !== undefined && (
              <span className="status-bar-progress">{Math.round(task.progress * 100)}%</span>
            )}
            {task.tokens && (() => {
              const tk = task.tokens;
              const cr = tk.cacheRead || 0;
              const cc = tk.cacheCreation || 0;
              const total = tk.input + cr + cc;
              const cachePct = total > 0 ? Math.round(cr / total * 100) : 0;
              const tip = [
                t("tokens_title_task"),
                t("tokens_fresh", formatTokens(tk.input)),
                t("tokens_cached", formatTokens(cr), cachePct),
                t("tokens_cache_write", formatTokens(cc)),
                t("tokens_output", formatTokens(tk.output)),
              ].join('\n');
              return (
                <span className="status-bar-tokens" title={tip}>
                  {"\u2191"}{formatTokens(tk.input)} {"\u2193"}{formatTokens(tk.output)}{cachePct > 0 ? ` ${cachePct}%` : ""}
                </span>
              );
            })()}
            {!task.finishedAt && <Elapsed since={task.startedAt} />}
          </div>
          );
        })}
      </div>
      {/* Semantic progress tooltip & popup — rendered outside overflow:hidden containers */}
      {semanticTaskRef.current && (semanticHovered || showProgressPopup) && (() => {
        const rect = semanticTaskRef.current!.getBoundingClientRect();
        return (
          <>
            {semanticHovered && !showProgressPopup && semanticProgressItem && (
              <div style={{
                position: "fixed",
                right: Math.max(8, window.innerWidth - rect.right),
                top: rect.top - 32,
                maxWidth: Math.min(400, window.innerWidth - 16),
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 12,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                zIndex: 10000,
                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                pointerEvents: "none",
              }}>
                {semanticProgressItem}
              </div>
            )}
            {showProgressPopup && semanticProgressLog.length > 0 && (
              <div style={{
                position: "fixed",
                right: window.innerWidth - rect.right,
                top: rect.top - 30 - semanticProgressLog.length * 22,
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 0",
                minWidth: 250,
                maxWidth: 400,
                zIndex: 10000,
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              }}>
                {semanticProgressLog.map((item, i) => (
                  <div key={i} style={{
                    padding: "3px 12px",
                    fontSize: 12,
                    color: i === semanticProgressLog.length - 1 ? "var(--text)" : "var(--text-secondary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {item}
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
