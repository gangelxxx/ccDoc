import { useState, useRef, useCallback } from "react";
import { Brain, RefreshCw } from "lucide-react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { TOOL_DESCRIPTIONS } from "../../../stores/llm/tool-definitions.js";
import { generateAgentConfig } from "../../../stores/llm/generate-agent.js";
import type { CustomAgent } from "../../../stores/llm/types.js";
import type { LlmEffort } from "../../../stores/types.js";

const TOOL_LABEL_KEYS: Record<string, string> = {
  get_tree: "tool_get_tree", get_section: "tool_get_section",
  get_file_with_sections: "tool_get_file_with_sections", get_sections_batch: "tool_get_sections_batch",
  search: "tool_search", create_section: "tool_create_section",
  bulk_create_sections: "tool_bulk_create_sections", update_section: "tool_update_section",
  delete_section: "tool_delete_section", move_section: "tool_move_section",
  duplicate_section: "tool_duplicate_section", restore_section: "tool_restore_section",
  update_icon: "tool_update_icon", commit_version: "tool_commit_version",
  get_history: "tool_get_history", restore_version: "tool_restore_version",
  create_backup: "tool_create_backup", list_backups: "tool_list_backups",
  get_project_tree: "tool_get_project_tree", get_file_outlines: "tool_get_file_outlines",
  read_project_file: "tool_read_project_file", search_project_files: "tool_search_project_files",
  find_symbols: "tool_find_symbols", web_search: "tool_web_search",
};

/** All tools that agents can use (excluding run_agent to prevent recursion, and ask_user). */
export const AVAILABLE_TOOLS = [
  "get_tree",
  "get_section",
  "get_file_with_sections",
  "get_sections_batch",
  "search",
  "create_section",
  "bulk_create_sections",
  "update_section",
  "delete_section",
  "move_section",
  "duplicate_section",
  "restore_section",
  "update_icon",
  "commit_version",
  "get_history",
  "restore_version",
  "create_backup",
  "list_backups",
  "get_project_tree",
  "get_file_outlines",
  "read_project_file",
  "search_project_files",
  "find_symbols",
  "web_search",
];

function ResizableTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const onGripMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const ta = ref.current;
    if (!ta) return;
    const startY = e.clientY;
    const startH = ta.offsetHeight;
    const onMove = (ev: MouseEvent) => { ta.style.height = Math.max(60, startH + ev.clientY - startY) + "px"; };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);
  return (
    <div className="resizable-textarea">
      <textarea ref={ref} {...props} />
      <div className="resize-grip" onMouseDown={onGripMouseDown}>⋯</div>
    </div>
  );
}

export interface AgentEditorProps {
  agent: CustomAgent;
  onSave: (agent: CustomAgent) => void;
  onCancel: () => void;
}

export function AgentEditor({ agent, onSave, onCancel }: AgentEditorProps) {
  const t = useT();
  const { llmModels, llmModelsLoading } = useAppStore();

  const [draft, setDraft] = useState<CustomAgent>({ ...agent });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenText, setRegenText] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);

  const handleRegenerate = async () => {
    const { llmApiKey, llmChatConfig } = useAppStore.getState();
    if (!llmApiKey) return;
    setRegenLoading(true);
    try {
      const config = await generateAgentConfig({
        description: regenText || draft.description,
        apiKey: llmApiKey,
        model: llmChatConfig.model,
      });
      setDraft(d => ({ ...d, ...config }));
      setRegenOpen(false);
    } catch (e: any) {
      useAppStore.getState().addToast("error", e?.message || String(e));
    } finally {
      setRegenLoading(false);
    }
  };

  const update = <K extends keyof CustomAgent>(key: K, value: CustomAgent[K]) => {
    setDraft(d => ({ ...d, [key]: value }));
  };

  const toggleTool = (tool: string) => {
    setDraft(d => ({
      ...d,
      tools: d.tools.includes(tool)
        ? d.tools.filter(t => t !== tool)
        : [...d.tools, tool],
    }));
  };

  const canSave = draft.name.trim().length > 0;

  return (
    <div className="agent-editor">
      <div className="agent-editor-body">
      {/* Name */}
      <div>
        <label>{t("agentName")}</label>
        <input
          className="llm-settings-input"
          style={{ marginBottom: 0 }}
          value={draft.name}
          onChange={e => update("name", e.target.value)}
          placeholder={t("agentName")}
          autoFocus
        />
      </div>

      {/* Description */}
      <div>
        <label>{t("agentDescription")}</label>
        <input
          className="llm-settings-input"
          style={{ marginBottom: 0 }}
          value={draft.description}
          onChange={e => update("description", e.target.value)}
          placeholder={t("agentDescriptionPlaceholder")}
        />
      </div>

      {/* System prompt */}
      <div>
        <label>{t("agentSystemPrompt")}</label>
        <ResizableTextarea
          rows={6}
          value={draft.systemPrompt}
          onChange={e => update("systemPrompt", e.target.value)}
          placeholder="You are a specialized agent..."
        />
      </div>

      {/* Prompt */}
      <div>
        <label>{t("agentPrompt")}</label>
        <ResizableTextarea
          rows={4}
          value={draft.prompt}
          onChange={e => update("prompt", e.target.value)}
          placeholder="Instructions prepended to each task..."
        />
      </div>

      {/* Model + Thinking + Effort — single row */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <select
          className="llm-settings-input"
          style={{ marginBottom: 0, flex: 1 }}
          value={draft.model}
          onChange={e => update("model", e.target.value)}
        >
          {llmModels.length > 0 ? (
            llmModels.map(m => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))
          ) : (
            <option value={draft.model}>{draft.model}</option>
          )}
        </select>
        {llmModelsLoading && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>...</span>
        )}
        <button
          className={`llm-thinking-btn${draft.thinking ? " active" : ""}`}
          onClick={() => update("thinking", !draft.thinking)}
          title={draft.thinking ? "Thinking ON" : "Thinking OFF"}
          type="button"
        >
          <Brain size={14} />
          {!draft.thinking && <span className="llm-thinking-strike" />}
        </button>
        <div className="llm-effort-inline" style={{ marginLeft: 0 }}>
          {(["low", "medium", "high"] as LlmEffort[]).map((level, i) => {
            const effortIdx = { low: 0, medium: 1, high: 2 };
            const filled = i <= effortIdx[draft.effort];
            return (
              <button
                key={level}
                className={`llm-effort-dot${filled ? " active" : ""}`}
                onClick={() => update("effort", level)}
                title={level === "low" ? "Low" : level === "medium" ? "Medium" : "High"}
                type="button"
              />
            );
          })}
        </div>
      </div>

      {/* Tools (collapsible) */}
      <div>
        <label
          style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4 }}
          onClick={() => setToolsOpen(o => !o)}
        >
          <span style={{ display: "inline-block", transition: "transform 0.15s", transform: toolsOpen ? "rotate(90deg)" : "rotate(0deg)", fontSize: 10 }}>▶</span>
          {t("agentTools")} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({draft.tools.length})</span>
        </label>
        {toolsOpen && (
          <div className="agent-tools-grid">
            {AVAILABLE_TOOLS.map(tool => (
              <label key={tool} className="agent-tool-item">
                <input
                  type="checkbox"
                  checked={draft.tools.includes(tool)}
                  onChange={() => toggleTool(tool)}
                />
                <span title={TOOL_DESCRIPTIONS[tool] || tool}>
                  {t(TOOL_LABEL_KEYS[tool] as any) || tool}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      </div>

      {/* Regenerate dialog */}
      {regenOpen && (
        <div className="agent-regen-dialog">
          <textarea
            rows={2}
            value={regenText}
            onChange={e => setRegenText(e.target.value)}
            placeholder={t("describeAgentPlaceholder")}
            disabled={regenLoading}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
            <button className={`btn btn-primary${regenLoading ? " btn-loading" : ""}`} onClick={handleRegenerate} disabled={regenLoading}>
              {regenLoading && <span className="btn-spinner" />}
              {regenLoading ? t("generating") : t("generate")}
            </button>
            <button className="btn" onClick={() => setRegenOpen(false)} disabled={regenLoading}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Actions — always visible, right-aligned */}
      <div className="agent-editor-footer">
        <button
          className="btn"
          onClick={() => { setRegenText(draft.description); setRegenOpen(true); }}
          title={t("regenerateAgent")}
          disabled={regenLoading}
        >
          <RefreshCw size={13} />
          {t("regenerateAgent")}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={!canSave}>
          {t("save")}
        </button>
        <button className="btn" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
