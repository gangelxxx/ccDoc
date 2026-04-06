import { useState, useEffect } from "react";
import { useT } from "../../../i18n.js";
import type { ModelTier, ModelTierConfig, ModelTiersConfig, ProviderScriptMeta } from "../../../stores/types.js";
import { ModelTierForm } from "../ModelTierForm.js";

interface ModelTiersTabProps {
  tiersDraft: ModelTiersConfig;
  onTierChange: (tier: ModelTier, patch: Partial<ModelTierConfig>) => void;
  builtinScripts: ProviderScriptMeta[];
}

const TIERS: ModelTier[] = ["strong", "medium", "weak"];

const TIER_LABEL_KEYS: Record<ModelTier, string> = {
  strong: "tierStrong",
  medium: "tierMedium",
  weak: "tierWeak",
};

export function ModelTiersTab({
  tiersDraft,
  onTierChange,
  builtinScripts,
}: ModelTiersTabProps) {
  const t = useT();
  const [codeViewerOpen, setCodeViewerOpen] = useState(false);
  const [codeViewerContent, setCodeViewerContent] = useState("");
  const [codeViewerTitle, setCodeViewerTitle] = useState("");

  const handleViewCode = async (config: ModelTierConfig) => {
    try {
      const code = await window.api.llmScriptCode(config.providerScript);
      setCodeViewerContent(code || "// No code available");
      const meta = builtinScripts.find((s) => s.id === config.providerScript.builtinId);
      setCodeViewerTitle(meta?.name || config.providerScript.builtinId || "Script");
      setCodeViewerOpen(true);
    } catch (e) {
      console.error("Failed to load script code:", e);
    }
  };

  return (
    <div className="settings-section">
      <h4 style={{ marginTop: 0, marginBottom: 12 }}>{t("modelTiersTitle")}</h4>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {TIERS.map((tier) => (
          <ModelTierForm
            key={tier}
            tier={tier}
            config={tiersDraft[tier]}
            onChange={(patch) => onTierChange(tier, patch)}
            builtinScripts={builtinScripts}
            onViewCode={handleViewCode}
          />
        ))}
      </div>

      {/* Script code viewer modal */}
      {codeViewerOpen && (
        <div className="modal-overlay" onClick={() => setCodeViewerOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 700, maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{codeViewerTitle}</h3>
            <pre
              style={{
                background: "var(--bg-sidebar)",
                color: "var(--text)",
                padding: 12,
                borderRadius: 6,
                overflow: "auto",
                maxHeight: "60vh",
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                border: "1px solid var(--border)",
              }}
            >
              {codeViewerContent}
            </pre>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCodeViewerOpen(false)}>{t("close")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
