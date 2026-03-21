import { useState, useEffect } from "react";
import { Loader2, Check, RefreshCw, Copy } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

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
  // Listen for background tasks from main process
  useEffect(() => {
    const cleanupStart = window.api.onBgTaskStart(({ id, label }) => {
      useAppStore.setState((s) => ({
        bgTasks: [...s.bgTasks, { id: `main:${id}`, label, startedAt: Date.now() }],
      }));
    });
    const cleanupFinish = window.api.onBgTaskFinish(({ id }) => {
      useAppStore.setState((s) => ({
        bgTasks: s.bgTasks.filter((t) => t.id !== `main:${id}`),
      }));
    });
    return () => { cleanupStart(); cleanupFinish(); };
  }, []);

  const voiceDownloading = useAppStore((s) => s.voiceDownloading);
  const voiceProgress = useAppStore((s) => s.voiceProgress);
  const openSettings = useAppStore((s) => s.openSettings);
  const embeddingBgTaskIds = useAppStore((s) => s.embeddingBgTaskIds);
  const projectPath = useAppStore((s) => s.currentProject?.path);

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
        {bgTasks.map((task) => {
          const isEmbeddingDownload = Object.values(embeddingBgTaskIds).includes(task.id);
          return (
          <div
            key={task.id}
            className={`status-bar-task${task.finishedAt ? " status-bar-task--done" : ""}`}
            style={isEmbeddingDownload ? { cursor: "pointer" } : undefined}
            onClick={isEmbeddingDownload ? () => openSettings("embeddings") : undefined}
          >
            {task.finishedAt ? (
              <Check size={12} className="status-bar-check" />
            ) : (
              <Loader2 size={12} className="status-bar-spinner" />
            )}
            <span className="status-bar-label">{task.label}</span>
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
    </div>
  );
}
