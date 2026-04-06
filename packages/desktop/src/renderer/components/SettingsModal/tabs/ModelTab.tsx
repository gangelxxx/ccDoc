import { useAppStore } from "../../../stores/app.store.js";
import { useT } from "../../../i18n.js";
import type { ModelTier } from "../../../stores/types.js";

export interface ModelTabProps {
  chatTierDraft: ModelTier;
  onChatTierChange: (tier: ModelTier) => void;
  passportTierDraft: ModelTier;
  onPassportTierChange: (tier: ModelTier) => void;
  summaryTierDraft: ModelTier;
  onSummaryTierChange: (tier: ModelTier) => void;
  autoVerifyPlan: boolean;
  onAutoVerifyPlanChange: (v: boolean) => void;
}

const TIER_OPTIONS: ModelTier[] = ["strong", "medium", "weak"];

const TIER_LABEL_KEYS: Record<ModelTier, string> = {
  strong: "tierStrong",
  medium: "tierMedium",
  weak: "tierWeak",
};

function TierSummary({ tier }: { tier: ModelTier }) {
  const modelTiers = useAppStore((s) => s.modelTiers);
  const config = modelTiers[tier];
  const script = config.providerScript.builtinId || "custom";
  const parts = [script, config.modelId, config.effort];
  if (config.thinking) parts.push("thinking");

  return (
    <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 4 }}>
      {parts.join(" · ")}
    </span>
  );
}

function TierSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ModelTier;
  onChange: (tier: ModelTier) => void;
}) {
  const t = useT();

  return (
    <div className="settings-accordion" style={{ padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TierSummary tier={value} />
          <select
            className="llm-settings-input llm-model-select"
            style={{ width: "auto", minWidth: 140, marginBottom: 0 }}
            value={value}
            onChange={(e) => onChange(e.target.value as ModelTier)}
          >
            {TIER_OPTIONS.map((tier) => (
              <option key={tier} value={tier}>{t(TIER_LABEL_KEYS[tier] as any)}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function ModelTab({
  chatTierDraft, onChatTierChange,
  passportTierDraft, onPassportTierChange,
  summaryTierDraft, onSummaryTierChange,
  autoVerifyPlan, onAutoVerifyPlanChange,
}: ModelTabProps) {
  const t = useT();

  return (
    <div className="settings-section">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <TierSelect
          label={t("llmAssistant")}
          value={chatTierDraft}
          onChange={onChatTierChange}
        />
        <TierSelect
          label={t("llmPassport")}
          value={passportTierDraft}
          onChange={onPassportTierChange}
        />
        <TierSelect
          label={t("llmSummary")}
          value={summaryTierDraft}
          onChange={onSummaryTierChange}
        />
      </div>

      {/* Auto-verify plans */}
      <div style={{ marginTop: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoVerifyPlan}
            onChange={(e) => onAutoVerifyPlanChange(e.target.checked)}
          />
          <span>{t("autoVerifyPlan")}</span>
        </label>
        <div className="settings-hint">{t("autoVerifyPlanHint")}</div>
      </div>
    </div>
  );
}
