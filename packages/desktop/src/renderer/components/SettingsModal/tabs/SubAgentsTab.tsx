import { type LlmConfig } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import { LlmConfigSection } from "../LlmConfigSection.js";

export interface SubAgentsTabProps {
  useSubAgentsDraft: boolean;
  onUseSubAgentsChange: (v: boolean) => void;
  chatDraft: LlmConfig;
  researchDraft: LlmConfig;
  onResearchChange: (cfg: Partial<LlmConfig>) => void;
  writerDraft: LlmConfig;
  onWriterChange: (cfg: Partial<LlmConfig>) => void;
  criticDraft: LlmConfig;
  onCriticChange: (cfg: Partial<LlmConfig>) => void;
  plannerDraft: LlmConfig;
  onPlannerChange: (cfg: Partial<LlmConfig>) => void;
  models: { id: string; display_name: string }[];
  modelsLoading: boolean;
  modelsError: string | null;
  openSection: string;
  onToggleSection: (key: string) => void;
}

export function SubAgentsTab({
  useSubAgentsDraft, onUseSubAgentsChange,
  chatDraft,
  researchDraft, onResearchChange,
  writerDraft, onWriterChange,
  criticDraft, onCriticChange,
  plannerDraft, onPlannerChange,
  models, modelsLoading, modelsError,
  openSection, onToggleSection,
}: SubAgentsTabProps) {
  const t = useT();

  return (
    <div className="settings-section">
      <div className="llm-thinking-row">
        <label className="llm-thinking-toggle">
          <input
            type="checkbox"
            checked={useSubAgentsDraft}
            onChange={(e) => onUseSubAgentsChange(e.target.checked)}
          />
          {t("useSubAgents")}
        </label>
      </div>

      {useSubAgentsDraft && (
        <div style={{ marginTop: 12 }}>
          <LlmConfigSection
            label={t("llmResearch")}
            sectionKey="research"
            draft={researchDraft}
            onChange={onResearchChange}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}

            open={openSection === "research"}
            onToggle={() => onToggleSection("research")}
          />
          <LlmConfigSection
            label={t("llmWriter")}
            sectionKey="writer"
            draft={writerDraft}
            onChange={onWriterChange}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}

            open={openSection === "writer"}
            onToggle={() => onToggleSection("writer")}
            allowInherit
            parentConfig={chatDraft}
          />
          <LlmConfigSection
            label={t("llmCritic")}
            sectionKey="critic"
            draft={criticDraft}
            onChange={onCriticChange}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}

            open={openSection === "critic"}
            onToggle={() => onToggleSection("critic")}
            allowInherit
            parentConfig={chatDraft}
          />
          <LlmConfigSection
            label={t("llmPlanner")}
            sectionKey="planner"
            draft={plannerDraft}
            onChange={onPlannerChange}
            models={models}
            modelsLoading={modelsLoading}
            modelsError={modelsError}

            open={openSection === "planner"}
            onToggle={() => onToggleSection("planner")}
            allowInherit
            parentConfig={chatDraft}
          />
        </div>
      )}
    </div>
  );
}
