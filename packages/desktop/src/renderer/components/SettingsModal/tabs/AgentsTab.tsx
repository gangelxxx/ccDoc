import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { AgentEditorModal } from "./AgentEditorModal.js";
import { generateAgentConfig } from "../../../stores/llm/generate-agent.js";
import type { CustomAgent } from "../../../stores/llm/types.js";

function generateId(): string {
  return crypto.randomUUID();
}

function createEmptyAgent(description?: string): CustomAgent {
  return {
    id: generateId(),
    name: "",
    description: description || "",
    systemPrompt: "",
    prompt: "",
    tools: ["gt", "read", "search", "create_section", "update_section"],
    model: "claude-haiku-4-5-20251001",
    thinking: false,
    effort: "medium",
    rating: 10,
    ratingLog: [],
  };
}

export function AgentsTab() {
  const t = useT();
  const { customAgents, addCustomAgent, updateCustomAgent, deleteCustomAgent, addToast, showConfirm } = useAppStore();
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Description dialog state
  const [showDescDialog, setShowDescDialog] = useState(false);
  const [descText, setDescText] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleAdd = () => {
    setShowDescDialog(true);
    setDescText("");
  };

  const handleGenerate = async () => {
    if (!useAppStore.getState().hasLlmAccess()) {
      addToast("error", t("apiKeyRequired"));
      return;
    }

    setGenerating(true);
    try {
      const config = await generateAgentConfig({
        description: descText,
      });

      const agent: CustomAgent = {
        id: generateId(),
        ...config,
        rating: 10,
        ratingLog: [],
      };

      setShowDescDialog(false);
      setDescText("");
      setEditingAgent(agent);
      setIsNew(true);
    } catch (e: any) {
      addToast("error", e?.message || String(e));
      // Fallback: open empty editor with description pre-filled
      const agent = createEmptyAgent(descText);
      setShowDescDialog(false);
      setDescText("");
      setEditingAgent(agent);
      setIsNew(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleEdit = (agent: CustomAgent) => {
    setEditingAgent({ ...agent });
    setIsNew(false);
  };

  const handleDelete = async (id: string) => {
    const agent = customAgents.find((a: CustomAgent) => a.id === id);
    if (!agent) return;
    const ok = await showConfirm(`${t("deleteAgent")}: "${agent.name}"?`, { danger: true });
    if (!ok) return;
    deleteCustomAgent(id);
  };

  const handleSave = (agent: CustomAgent) => {
    if (isNew) {
      addCustomAgent(agent);
    } else {
      updateCustomAgent(agent.id, agent);
    }
    setEditingAgent(null);
    setIsNew(false);
  };

  const handleCancel = () => {
    setEditingAgent(null);
    setIsNew(false);
  };

  return (
    <>
      {editingAgent && (
        <AgentEditorModal
          agent={editingAgent}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}

      <div className="settings-section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <label className="llm-settings-label" style={{ marginBottom: 0 }}>{t("settingsAgents")}</label>
          <button className="agent-add-btn" onClick={handleAdd} disabled={generating}>
            <Plus size={14} />
            {t("addAgent")}
          </button>
        </div>

        {showDescDialog && (
          <div className="agent-desc-dialog">
            <label>{t("describeAgent")}</label>
            <textarea
              rows={3}
              value={descText}
              onChange={(e) => setDescText(e.target.value)}
              placeholder={t("describeAgentPlaceholder")}
              disabled={generating}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              <button
                className={`btn btn-primary${generating ? " btn-loading" : ""}`}
                onClick={handleGenerate}
                disabled={!descText.trim() || generating}
              >
                {generating && <span className="btn-spinner" />}
                {generating ? t("generating") : "OK"}
              </button>
              <button
                className="btn"
                onClick={() => { setShowDescDialog(false); setDescText(""); }}
                disabled={generating}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        )}

        {customAgents.length === 0 && !showDescDialog ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0", textAlign: "center" }}>
            {t("noAgents")}
          </div>
        ) : (
          <div className="agents-list">
            {customAgents.map((agent) => (
              <div key={agent.id} className="agent-card">
                <div className="agent-card-info">
                  <div className="agent-card-name">
                    {agent.name || t("agentName")}
                    <span className={`agent-rating ${(agent.rating ?? 10) > 7 ? "good" : (agent.rating ?? 10) >= 4 ? "medium" : "bad"}`}>
                      {(agent.rating ?? 10).toFixed(1)}
                    </span>
                  </div>
                  <div className="agent-card-desc">{agent.description || "\u2014"}</div>
                  {agent.ratingLog && agent.ratingLog.length > 0 && (
                    <div className="agent-rating-log">
                      {agent.ratingLog.slice(0, 3).map((entry, i) => (
                        <div key={i} className="agent-rating-log-entry">{entry}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="agent-card-actions">
                  <button
                    className="btn-icon"
                    onClick={() => handleEdit(agent)}
                    title={t("editAgent")}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => handleDelete(agent.id)}
                    title={t("deleteAgent")}
                    style={{ color: "var(--danger)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
