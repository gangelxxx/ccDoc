import { useState, useRef, useEffect, useCallback } from "react";
import { RotateCcw, X, Loader2, Paperclip, Send, Square, XCircle, ChevronDown, Plus, Copy, Check, Brain, Sparkles } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import type { LlmAttachment, LlmEffort } from "../../stores/app.store.js";
import { applyEffort } from "../../stores/llm-config.js";
import { useT } from "../../i18n.js";
import { renderMarkdown } from "../Editor/editor-utils.js";
import { VoiceButton } from "../VoiceButton/VoiceButton.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** Estimate cost in dollars using blended Opus/Haiku rates.
 *  Opus dominates cost, so we use Opus rates as a reasonable upper bound. */
function estimateCost(tokens: { input: number; output: number; cacheRead: number; cacheCreation: number }): string {
  const cost =
    tokens.input * 15 / 1e6 +           // fresh input: $15/M
    tokens.cacheCreation * 18.75 / 1e6 + // cache creation: $18.75/M
    tokens.cacheRead * 1.5 / 1e6 +       // cache read: $1.5/M
    tokens.output * 75 / 1e6;            // output: $75/M
  if (cost < 0.01) return `<$0.01`;
  return `~$${cost.toFixed(2)}`;
}

export function LlmPanel({ width, onClick }: { width?: number; onClick?: (e: React.MouseEvent) => void }) {
  const {
    llmPanelOpen,
    toggleLlmPanel,
    llmApiKey,
    llmMessages,
    llmLoading,
    llmAborted,
    sendLlmMessage,
    stopLlmChat,
    clearLlmMessages,
    currentSection,
    llmSessions,
    llmCurrentSessionId,
    loadLlmSession,
    deleteLlmSession,
    retryLlmMessage,
    llmWaitingForUser,
    llmPendingOptions,
    submitUserAnswer,
  } = useAppStore();

  const llmSessionMode = useAppStore((s) => s.llmSessionMode);
  const llmTokensUsed = useAppStore((s) => s.llmTokensUsed);
  const includeContext = useAppStore((s) => s.llmIncludeContext);
  const setIncludeContext = useAppStore((s) => s.setLlmIncludeContext);
  const includeSourceCode = useAppStore((s) => s.llmIncludeSourceCode);
  const setIncludeSourceCode = useAppStore((s) => s.setLlmIncludeSourceCode);
  const editorSelectedText = useAppStore((s) => s.editorSelectedText);
  const llmChatConfig = useAppStore((s) => s.llmChatConfig);
  const setLlmChatConfig = useAppStore((s) => s.setLlmChatConfig);
  const llmModels = useAppStore((s) => s.llmModels);
  const llmModelsLoading = useAppStore((s) => s.llmModelsLoading);
  const fetchLlmModels = useAppStore((s) => s.fetchLlmModels);
  const t = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<LlmAttachment[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showSessions, setShowSessions] = useState(false);

  // Input history — persist last 20 messages, navigate with ArrowUp/ArrowDown
  const INPUT_HISTORY_KEY = "llm-input-history";
  const INPUT_HISTORY_MAX = 20;
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState(""); // what user was typing before navigating
  const getHistory = (): string[] => {
    try { return JSON.parse(localStorage.getItem(INPUT_HISTORY_KEY) || "[]"); } catch { return []; }
  };
  const pushHistory = (text: string) => {
    if (!text.trim()) return;
    const history = getHistory().filter(h => h !== text);
    history.unshift(text);
    if (history.length > INPUT_HISTORY_MAX) history.length = INPUT_HISTORY_MAX;
    localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(history));
  };
  const [showModelPicker, setShowModelPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  // Fetch models only when panel is open, API key is set, models not yet loaded, and no model is selected
  useEffect(() => {
    if (llmPanelOpen && llmApiKey && llmModels.length === 0 && !llmChatConfig.model) fetchLlmModels();
  }, [llmPanelOpen, llmApiKey]);

  // Close model picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelPicker]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [llmMessages, llmLoading]);

  // Reset selected option when waiting state ends
  useEffect(() => {
    if (!llmWaitingForUser) setSelectedOption(null);
  }, [llmWaitingForUser]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // strip data:...;base64, prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const newAtts: LlmAttachment[] = [];
    for (const file of imageFiles) {
      const data = await readFileAsBase64(file);
      newAtts.push({ type: "image", name: file.name, mediaType: file.type, data });
    }
    setAttachments(prev => [...prev, ...newAtts]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = () => {
    const text = input.trim();
    // When waiting for user answer, submit the answer instead of sending a new message
    if (llmWaitingForUser) {
      const optionText = selectedOption !== null && llmPendingOptions ? llmPendingOptions[selectedOption] : null;
      // Need either a selected option or typed text
      if (!optionText && !text) return;
      // Build answer: option + optional details
      const answer = optionText
        ? (text ? `${optionText}\n\n${text}` : optionText)
        : text;
      setInput("");
      setSelectedOption(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      submitUserAnswer(answer);
      return;
    }
    if ((!text && attachments.length === 0) || llmLoading) return;
    if (text) pushHistory(text);
    setHistoryIndex(-1);
    const atts = attachments.length > 0 ? [...attachments] : undefined;
    setInput("");
    setAttachments([]);
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendLlmMessage(text, includeContext, atts, includeSourceCode);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape" && llmLoading) {
      e.preventDefault();
      stopLlmChat();
    }
    // ArrowUp/ArrowDown — navigate input history (only when cursor is at line 1)
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const ta = textareaRef.current;
      if (!ta) return;
      // Only activate when cursor is on the first line (no newline before cursor)
      const beforeCursor = ta.value.slice(0, ta.selectionStart);
      if (e.key === "ArrowUp" && beforeCursor.includes("\n")) return;
      if (e.key === "ArrowDown" && ta.value.slice(ta.selectionStart).includes("\n")) return;

      const history = getHistory();
      if (history.length === 0) return;

      e.preventDefault();
      if (e.key === "ArrowUp") {
        const newIdx = historyIndex + 1;
        if (newIdx >= history.length) return;
        if (historyIndex === -1) setSavedInput(input);
        setHistoryIndex(newIdx);
        setInput(history[newIdx]);
      } else {
        if (historyIndex <= -1) return;
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        setInput(newIdx === -1 ? savedInput : history[newIdx]);
      }
    }
  };

  // Global Escape handler — works even when textarea is not focused
  useEffect(() => {
    if (!llmLoading) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopLlmChat();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [llmLoading, stopLlmChat]);

  // Paste handler — images from clipboard
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) imageItems.push(items[i]);
    }
    if (imageItems.length === 0) return; // let default text paste proceed
    e.preventDefault();
    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
    await addImageFiles(files);
  }, [addImageFiles]);

  // File picker handler
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) await addImageFiles(files);
    e.target.value = ""; // reset so same file can be selected again
  }, [addImageFiles]);

  if (!llmPanelOpen) return null;

  return (
    <div className="llm-panel" style={width ? { width } : undefined} onClick={onClick}>
      {/* Header */}
      <div className="llm-panel-header">
        <span className="llm-panel-title">{t("aiAssistantTitle")}</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="btn-icon" onClick={() => clearLlmMessages()} title={t("clearChat")}>
            <RotateCcw size={14} />
          </button>
          <button className="btn-icon" onClick={toggleLlmPanel} title={t("close")}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Session selector */}
      <div className="llm-sessions-bar">
        <button
          className={`llm-sessions-toggle${showSessions ? " active" : ""}`}
          onClick={() => setShowSessions(v => !v)}
        >
          <span className="llm-sessions-current">
            {llmCurrentSessionId
              ? (llmSessions.find(s => s.id === llmCurrentSessionId)?.title || t("session"))
              : t("newSession")}
          </span>
          <ChevronDown size={12} />
        </button>
        {showSessions && (
          <div className="llm-sessions-dropdown">
            <div
              className={`llm-session-item${!llmCurrentSessionId ? " active" : ""}`}
              onClick={() => { clearLlmMessages(); setShowSessions(false); }}
            >
              <Plus size={12} />
              <span>{t("newSession")}</span>
            </div>
            {llmSessions.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(session => (
              <div
                key={session.id}
                className={`llm-session-item${session.id === llmCurrentSessionId ? " active" : ""}`}
                onClick={() => { loadLlmSession(session.id); setShowSessions(false); }}
              >
                <div className="llm-session-info">
                  <span className="llm-session-title">{session.title}</span>
                  <span className="llm-session-date">
                    {new Date(session.updatedAt).toLocaleDateString(t("dateLocale"), { day: "numeric", month: "short" })}
                  </span>
                </div>
                <button
                  className="llm-session-delete"
                  onClick={(e) => { e.stopPropagation(); deleteLlmSession(session.id); }}
                  title={t("deleteSession")}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {llmSessions.length === 0 && (
              <div className="llm-session-empty">{t("noSavedSessions")}</div>
            )}
          </div>
        )}
      </div>

      {/* Doc-update banner */}
      {llmSessionMode === "doc-update" && (
        <div className="llm-doc-update-banner">
          <Sparkles size={14} className={llmLoading ? "pulsing" : ""} />
          <span>{llmLoading ? t("docUpdateInProgress") : t("docUpdateComplete")}</span>
        </div>
      )}

      {/* Messages */}
      <div className="llm-messages">
        {llmMessages.length === 0 && (
          <div className="llm-empty">
            <p>{t("llmEmptyHint")}</p>
            {currentSection && (
              <p style={{ marginTop: 4, fontSize: 11 }}>
                {t("llmSectionContextHint", currentSection.title)}
              </p>
            )}
          </div>
        )}

        {llmMessages.map((msg, i) => {
          const rawText = typeof msg.content === "string" ? msg.content
            : Array.isArray(msg.content) ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
            : "";
          const text = msg.displayContent || rawText;
          if (!text && !msg.attachments?.length) return null;
          const isToolStatus = msg.role === "assistant" && (text.startsWith("\u{1F527}") || text.startsWith("\u{1F50D}") || text.startsWith("\u{1F504}") || text.startsWith("\u{1F4DD}") || text.startsWith("\u{1F4CB}") || text.startsWith("\u{1F4D0}"));
          const isError = msg.role === "assistant" && typeof msg.content === "string" && msg.content.startsWith("\u26A0");
          const isQuestionMsg = !!msg.isQuestion;
          return (
            <div key={i} className={`llm-message llm-message-${msg.role}${isToolStatus ? " llm-message-tool" : ""}${isError ? " llm-message-error" : ""}${isQuestionMsg ? " llm-message-question" : ""}`}>
              {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                <div className="llm-message-images">
                  {msg.attachments.map((att, j) => (
                    <img key={j} src={`data:${att.mediaType};base64,${att.data}`} alt={att.name} />
                  ))}
                </div>
              )}
              {msg.role === "assistant" ? (
                <div
                  className="llm-message-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
                />
              ) : (
                text ? <div className="llm-message-content">{text}</div> : null
              )}
              {!isToolStatus && text && (
                <div className="llm-msg-actions">
                  <button
                    className="llm-msg-action-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(rawText);
                      setCopiedIdx(i);
                      setTimeout(() => setCopiedIdx(null), 1500);
                    }}
                    title={t("copy")}
                  >
                    {copiedIdx === i ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  {msg.role === "user" && (
                    <button
                      className="llm-msg-action-btn"
                      onClick={() => retryLlmMessage(i)}
                      disabled={llmLoading}
                      title={t("retry")}
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Selectable options when waiting for user answer */}
        {llmWaitingForUser && llmPendingOptions && llmPendingOptions.length > 0 && (
          <div className="llm-ask-options">
            {llmPendingOptions.map((opt, i) => (
              <button
                key={i}
                className={`llm-ask-option${selectedOption === i ? " selected" : ""}`}
                onClick={() => {
                  setSelectedOption(prev => prev === i ? null : i);
                  // Focus textarea so user can immediately type details
                  setTimeout(() => textareaRef.current?.focus(), 50);
                }}
              >
                <span className="llm-ask-option-radio" />
                <span className="llm-ask-option-text">{opt}</span>
              </button>
            ))}
            <div className="llm-ask-skip">
              <button className="llm-ask-skip-btn" onClick={stopLlmChat}>
                {t("llmSkip")}
              </button>
            </div>
          </div>
        )}
        {/* Skip button when waiting but no options */}
        {llmWaitingForUser && (!llmPendingOptions || llmPendingOptions.length === 0) && (
          <div className="llm-ask-options">
            <div className="llm-ask-skip">
              <button className="llm-ask-skip-btn" onClick={stopLlmChat}>
                {t("llmSkip")}
              </button>
            </div>
          </div>
        )}

        {llmLoading && !llmWaitingForUser && (
          <div className="llm-message llm-message-assistant">
            <div className="llm-typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer */}
      <div className="llm-footer">
        <div className="llm-context-toggles">
          <label className="llm-context-toggle">
            <input
              type="checkbox"
              checked={includeSourceCode}
              onChange={(e) => setIncludeSourceCode(e.target.checked)}
            />
            {t("includeSourceCode")}
          </label>
          {currentSection && (
            <label className="llm-context-toggle" title={editorSelectedText || currentSection.title}>
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
              />
              {editorSelectedText ? t("selectedText") : t("selectedFile")}
            </label>
          )}
          {(llmTokensUsed.input > 0 || llmTokensUsed.output > 0) && (() => {
            const totalInput = llmTokensUsed.input + llmTokensUsed.cacheCreation + llmTokensUsed.cacheRead;
            const cachePercent = totalInput > 0 ? Math.round(llmTokensUsed.cacheRead / totalInput * 100) : 0;
            const tooltip = [
              t("tokens_title_session"),
              t("tokens_fresh", formatTokens(llmTokensUsed.input)),
              t("tokens_cached", formatTokens(llmTokensUsed.cacheRead), cachePercent),
              t("tokens_cache_write", formatTokens(llmTokensUsed.cacheCreation)),
              t("tokens_output", formatTokens(llmTokensUsed.output)),
              t("tokens_total", formatTokens(totalInput), estimateCost(llmTokensUsed)),
            ].join('\n');
            const label = `↑${formatTokens(llmTokensUsed.input)} ↓${formatTokens(llmTokensUsed.output)}${cachePercent > 0 ? ` ${cachePercent}%` : ''}`;
            return <div className="llm-token-counter" title={tooltip}>{label}</div>;
          })()}
        </div>

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="llm-attachments">
            {attachments.map((att, i) => (
              <div key={i} className="llm-attachment-preview">
                <img src={`data:${att.mediaType};base64,${att.data}`} alt={att.name} />
                <button className="llm-attachment-remove" onClick={() => removeAttachment(i)} title={t("removeAttachment")}>
                  <XCircle size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* TG-style input row */}
        <div className="llm-input-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleFileSelect}
          />
          <button
            className="btn-icon llm-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={!llmApiKey || (llmLoading && !llmWaitingForUser)}
            title={t("attachImage")}
          >
            <Paperclip size={18} />
          </button>
          <VoiceButton
            onTranscript={(text) => setInput((prev) => prev ? prev + " " + text : text)}
            disabled={!llmApiKey || (llmLoading && !llmWaitingForUser)}
            size={16}
          />
          <textarea
            ref={textareaRef}
            className={`llm-input${llmWaitingForUser ? " llm-input-waiting" : ""}`}
            placeholder={llmWaitingForUser ? (selectedOption !== null ? t("llmAddDetails") : t("llmAnswerPlaceholder")) : llmApiKey ? t("llmMessagePlaceholder") : t("llmApiKeyHint")}
            value={input}
            disabled={!llmApiKey || (llmLoading && !llmWaitingForUser)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
          />
          {llmLoading && !llmWaitingForUser ? (
            <button
              className={`btn-icon llm-send-btn llm-stop-btn${llmAborted ? " llm-stopping" : ""}`}
              onClick={stopLlmChat}
              disabled={llmAborted}
              title={llmAborted ? t("stopping") : t("stopChat")}
            >
              {llmAborted ? <Loader2 size={14} className="llm-spinner" /> : <Square size={14} />}
            </button>
          ) : (
            <button
              className="btn-icon llm-send-btn"
              onClick={handleSend}
              disabled={!llmApiKey || (llmWaitingForUser ? (selectedOption === null && !input.trim()) : (!input.trim() && attachments.length === 0))}
              title={llmWaitingForUser ? t("llmAnswer") : t("sendMessage")}
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <div className="llm-model-row">
          <div className="llm-model-picker" ref={modelPickerRef}>
            <button
              className="llm-model-btn"
              onClick={() => {
                const opening = !showModelPicker;
                setShowModelPicker(opening);
                if (opening && llmModels.length === 0 && llmApiKey) fetchLlmModels();
              }}
              title={llmChatConfig.model}
            >
              {llmChatConfig.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}
              <ChevronDown size={10} />
            </button>
            {showModelPicker && (
              <div className="llm-model-dropdown">
                {llmModels.length === 0 && (
                  <div className="llm-model-dropdown-empty">
                    {llmModelsLoading
                      ? <Loader2 size={14} className="llm-spinner" />
                      : "No models"}
                  </div>
                )}
                {(() => {
                  const tierOrder: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2 };
                  const parse = (id: string) => {
                    const m = id.match(/claude-(\w+)-([\d.-]+)/);
                    if (!m) return { tier: "other", tierN: 9, ver: 0 };
                    const tier = m[1];
                    const tierN = tierOrder[tier] ?? 9;
                    const parts = m[2].split("-").filter((p) => p.length <= 2);
                    const ver = parts.length >= 2 ? parseFloat(`${parts[0]}.${parts[1]}`) : parseFloat(parts[0]);
                    return { tier, tierN, ver };
                  };
                  // Find max version per tier
                  const maxVer: Record<string, number> = {};
                  for (const m of llmModels) {
                    const p = parse(m.id);
                    maxVer[p.tier] = Math.max(maxVer[p.tier] ?? 0, p.ver);
                  }
                  return [...llmModels]
                    .filter((m) => { const p = parse(m.id); return p.ver === maxVer[p.tier]; })
                    .sort((a, b) => { const pa = parse(a.id), pb = parse(b.id); return pa.tierN - pb.tierN; });
                })().map((m) => (
                  <div
                    key={m.id}
                    className={`llm-model-option${m.id === llmChatConfig.model ? " active" : ""}`}
                    onClick={() => { setLlmChatConfig({ model: m.id }); setShowModelPicker(false); }}
                  >
                    {m.display_name || m.id.replace(/^claude-/, "").replace(/-\d{8}$/, "")}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="llm-model-right">
            <button
              className={`llm-thinking-btn${llmChatConfig.thinking ? " active" : ""}`}
              onClick={() => setLlmChatConfig({ thinking: !llmChatConfig.thinking })}
              title={llmChatConfig.thinking ? "Thinking ON" : "Thinking OFF"}
            >
              <Brain size={14} />
              {!llmChatConfig.thinking && <span className="llm-thinking-strike" />}
            </button>
            <div className="llm-effort-inline">
              {(["low", "medium", "high"] as LlmEffort[]).map((level, i) => {
                const effortIdx = { low: 0, medium: 1, high: 2 };
                const filled = i <= effortIdx[llmChatConfig.effort];
                return (
                  <button
                    key={level}
                    className={`llm-effort-dot${filled ? " active" : ""}`}
                    onClick={() => setLlmChatConfig(applyEffort(level))}
                    title={level === "low" ? "Low" : level === "medium" ? "Medium" : "High"}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
