import { ChevronRight } from "lucide-react";
import { type LlmConfig, type LlmEffort, applyEffort } from "../../stores/app.store.js";
import { useT } from "../../i18n.js";

export interface LlmConfigSectionProps {
  label: string;
  sectionKey: string;
  draft: LlmConfig;
  onChange: (cfg: Partial<LlmConfig>) => void;
  models: { id: string; display_name: string }[];
  modelsLoading: boolean;
  modelsError: string | null;
  open: boolean;
  onToggle: () => void;
  allowInherit?: boolean;
  parentConfig?: LlmConfig;
}

function getModelShortName(modelId: string, models: { id: string; display_name: string }[]): string {
  const found = models.find(m => m.id === modelId);
  if (found) return found.display_name;
  // Fallback: extract readable name from ID like "claude-sonnet-4-6" → "Sonnet 4.6"
  const match = modelId.match(/claude-(\w+)-([\d-]+)/);
  if (match) return match[1].charAt(0).toUpperCase() + match[1].slice(1) + " " + match[2].replace(/-/g, ".");
  return modelId;
}

export function LlmConfigSection({
  label, sectionKey, draft, onChange, models, modelsLoading, modelsError,
  open, onToggle, allowInherit, parentConfig,
}: LlmConfigSectionProps) {
  const t = useT();
  const inherited = allowInherit && draft.inheritFromParent;
  const effectiveConfig = inherited && parentConfig ? parentConfig : draft;
  const modelName = getModelShortName(effectiveConfig.model, models);
  const summary = `${modelName} · ${effectiveConfig.effort}${effectiveConfig.thinking ? " · thinking" : ""}`;

  return (
    <div className="settings-accordion">
      <div className="settings-accordion-header" onClick={onToggle}>
        <span>{label}</span>
        <span className="settings-accordion-summary">{summary}</span>
        <ChevronRight size={14} className={`settings-accordion-icon${open ? " open" : ""}`} />
      </div>
      <div className={`settings-accordion-body${open ? " open" : ""}`}>
          {allowInherit && (
            <div className="llm-inherit-row">
              <label className="llm-thinking-toggle">
                <input
                  type="checkbox"
                  checked={!!draft.inheritFromParent}
                  onChange={(e) => onChange({ inheritFromParent: e.target.checked })}
                />
                {t("inheritFromParent")}
              </label>
            </div>
          )}

          <div className={inherited ? "llm-inherited-controls" : ""}>
            <label className="llm-settings-label" title="Claude language model used for generating responses">Model</label>
            <select
              className="llm-settings-input llm-model-select"
              value={draft.model}
              onChange={(e) => onChange({ model: e.target.value })}
              title="Choose a model"
              disabled={modelsLoading && models.length === 0}
            >
              {models.length === 0 && (
                <option value={draft.model}>
                  {modelsLoading ? "Loading…" : draft.model}
                </option>
              )}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>
            {modelsError && (
              <div style={{ fontSize: 11, color: "var(--error, #c00)", marginTop: 4 }}>{modelsError}</div>
            )}

            <label className="llm-settings-label" style={{ marginTop: 10 }}>Effort</label>
            <div className="llm-effort-row">
              {(["low", "medium", "high"] as LlmEffort[]).map((level) => (
                <button
                  key={level}
                  className={`llm-effort-btn${draft.effort === level ? " active" : ""}`}
                  onClick={() => onChange(applyEffort(level))}
                >
                  {level === "low" ? "Low" : level === "medium" ? "Medium" : "High"}
                </button>
              ))}
            </div>

            <div className="llm-thinking-row" style={{ marginTop: 10 }}>
              <label className="llm-thinking-toggle">
                <input
                  type="checkbox"
                  checked={draft.thinking}
                  onChange={(e) => onChange({ thinking: e.target.checked })}
                />
                Thinking
              </label>
            </div>
          </div>
      </div>
    </div>
  );
}
