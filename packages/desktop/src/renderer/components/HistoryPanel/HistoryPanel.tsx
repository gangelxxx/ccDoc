import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

export function HistoryPanel({ saveRequested, onSaveHandled }: { saveRequested?: boolean; onSaveHandled?: () => void }) {
  const { history, commitVersion, viewCommit, historyViewCommit, deleteHistoryCommit, llmApiKey, llmSummaryConfig, language, currentProject } = useAppStore();
  const t = useT();
  const [showCommit, setShowCommit] = useState(false);
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (saveRequested) {
      setShowCommit(true);
      onSaveHandled?.();
    }
  }, [saveRequested, onSaveHandled]);

  const handleCommit = () => {
    if (!message.trim()) return;
    commitVersion(message.trim());
    setMessage("");
    setShowCommit(false);
  };

  const handleGenerateMessage = async () => {
    if (!llmApiKey || !currentProject?.token) return;
    setGenerating(true);
    const { startBgTask, finishBgTask, updateBgTask } = useAppStore.getState();
    const taskId = startBgTask(language === "ru" ? "Генерация сообщения" : "Generating message");
    try {
      const { model, maxTokens, temperature, thinking, thinkingBudget } = llmSummaryConfig;
      const diff = await window.api.getHistoryDiff(currentProject.token);
      const langInstruction = language === "ru" ? "Respond in Russian." : "Respond in English.";

      const commitSystem = `You are a helpful assistant. The user is saving a version of their documentation project. Based on the diff of changes provided, write a short commit message (1-2 sentences, up to 150 characters) describing what was changed. Output only the message, nothing else. ${langInstruction}`;
      const commitMessages = [{ role: "user", content: `Changes since last version:\n${diff.slice(0, 3000)}` }];
      const estInput = Math.round((commitSystem.length + commitMessages[0].content.length) / 4);
      updateBgTask(taskId, { tokens: { input: estInput, output: 0 } });

      const data = await window.api.llmChat({
        apiKey: llmApiKey,
        system: commitSystem,
        messages: commitMessages,
        model,
        maxTokens,
        temperature: thinking ? 1.0 : temperature,
        ...(thinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
      });

      if (data.usage) {
        updateBgTask(taskId, {
          tokens: { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 },
        });
      }

      const textBlock = data.content?.find((b: any) => b.type === "text");
      const generated = textBlock?.text?.trim();
      if (generated) setMessage(generated);
    } catch (err) {
      console.error("[generateCommitMessage] failed:", err);
    } finally {
      setGenerating(false);
      finishBgTask(taskId);
    }
  };

  return (
    <div className="history-panel">
      {history.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 12 }}>
          {t("noVersionsYet")}
        </div>
      )}

      {history.map((commit) => (
        <div
          key={commit.oid}
          className={`history-item${historyViewCommit?.oid === commit.oid ? " active" : ""}`}
          onClick={() => viewCommit(commit)}
        >
          <div className="history-item-message">{commit.message}</div>
          <div className="history-item-meta">
            <span className="history-item-date">
              {new Date(commit.timestamp * 1000).toLocaleString("ru-RU", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <button
              className="history-item-delete"
              title={t("delete")}
              onClick={(e) => {
                e.stopPropagation();
                deleteHistoryCommit(commit.oid);
              }}
            >
              ×
            </button>
          </div>
        </div>
      ))}

      {showCommit && createPortal(
        <div className="modal-overlay" onClick={() => setShowCommit(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("saveVersion")}</h3>
            <textarea
              placeholder={t("describeChanges")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCommit();
                }
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button
                className="btn"
                onClick={handleGenerateMessage}
                disabled={generating || !llmApiKey}
                title={!llmApiKey ? t("needApiKey") : t("generateCommitMsg")}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 210 }}
              >
                {generating ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.9 2-2 2h-4a2 2 0 0 1-2-2 4 4 0 0 1 4-4z"/>
                    <path d="M8 8v2a6 6 0 0 0 8 0V8"/>
                    <circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/>
                    <path d="M9 17h6"/>
                    <path d="M8 20h8"/>
                  </svg>
                )}
                {t("generateCommitMsg")}
              </button>
              <button className="btn btn-primary" onClick={handleCommit}>{t("save")}</button>
              <button className="btn" onClick={() => setShowCommit(false)}>{t("cancel")}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
