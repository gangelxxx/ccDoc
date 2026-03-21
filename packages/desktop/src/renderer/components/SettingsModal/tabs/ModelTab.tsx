import { useState } from "react";
import { Eye, EyeOff, Key } from "lucide-react";
import { type LlmConfig } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { LlmConfigSection } from "../LlmConfigSection.js";

export interface ModelTabProps {
  keyDraft: string;
  onKeyChange: (key: string) => void;
  chatDraft: LlmConfig;
  onChatChange: (cfg: Partial<LlmConfig>) => void;
  passportDraft: LlmConfig;
  onPassportChange: (cfg: Partial<LlmConfig>) => void;
  summaryDraft: LlmConfig;
  onSummaryChange: (cfg: Partial<LlmConfig>) => void;
  models: { id: string; display_name: string }[];
  modelsLoading: boolean;
  modelsError: string | null;
  openSection: string;
  onToggleSection: (key: string) => void;
}

export function ModelTab({
  keyDraft, onKeyChange,
  chatDraft, onChatChange,
  passportDraft, onPassportChange,
  summaryDraft, onSummaryChange,
  models, modelsLoading, modelsError,
  openSection, onToggleSection,
}: ModelTabProps) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const handleSetupToken = async () => {
    setSetupLoading(true);
    try {
      const result = await window.api.llmSetupToken();
      if (result.ok && result.key) {
        onKeyChange(result.key);
      }
    } catch (err) {
      console.error("setup-token error:", err);
    } finally {
      setSetupLoading(false);
    }
  };

  return (
    <div className="settings-section">
      <label className="llm-settings-label">{t("anthropicApiKey")}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type={showKey ? "text" : "password"}
          className="llm-settings-input"
          style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
          placeholder="sk-ant-..."
          value={keyDraft}
          onChange={(e) => onKeyChange(e.target.value)}
        />
        <button
          className="btn-icon"
          onClick={() => setShowKey((v) => !v)}
          title={showKey ? t("hideApiKey") : t("showApiKey")}
        >
          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          className="btn-icon"
          onClick={handleSetupToken}
          disabled={setupLoading}
          title={t("requestApiKey")}
        >
          <Key size={14} />
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <LlmConfigSection
          label={t("llmAssistant")}
          sectionKey="chat"
          draft={chatDraft}
          onChange={onChatChange}
          models={models}
          modelsLoading={modelsLoading}
          modelsError={modelsError}

          open={openSection === "chat"}
          onToggle={() => onToggleSection("chat")}
        />
        <LlmConfigSection
          label={t("llmPassport")}
          sectionKey="passport"
          draft={passportDraft}
          onChange={onPassportChange}
          models={models}
          modelsLoading={modelsLoading}
          modelsError={modelsError}

          open={openSection === "passport"}
          onToggle={() => onToggleSection("passport")}
        />
        <LlmConfigSection
          label={t("llmSummary")}
          sectionKey="summary"
          draft={summaryDraft}
          onChange={onSummaryChange}
          models={models}
          modelsLoading={modelsLoading}
          modelsError={modelsError}

          open={openSection === "summary"}
          onToggle={() => onToggleSection("summary")}
        />
      </div>
    </div>
  );
}
