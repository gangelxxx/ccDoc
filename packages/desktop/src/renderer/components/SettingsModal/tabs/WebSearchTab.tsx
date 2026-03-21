import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "../../../i18n.js";
import type { WebSearchProvider } from "../../../stores/slices/llm-config.slice.js";

export interface WebSearchTabProps {
  webSearchProvider: WebSearchProvider;
  onWebSearchProviderChange: (provider: WebSearchProvider) => void;
  webSearchApiKey: string;
  onWebSearchApiKeyChange: (key: string) => void;
}

export function WebSearchTab({
  webSearchProvider, onWebSearchProviderChange,
  webSearchApiKey, onWebSearchApiKeyChange,
}: WebSearchTabProps) {
  const t = useT();
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="settings-section">
      <label className="llm-settings-label">{t("webSearchTitle")}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <select
          className="llm-settings-input"
          style={{ flex: "0 0 auto", width: 180, marginBottom: 0 }}
          value={webSearchProvider}
          onChange={(e) => onWebSearchProviderChange(e.target.value as WebSearchProvider)}
        >
          <option value="none">{t("webSearchNone")}</option>
          <option value="tavily">{t("webSearchTavily")}</option>
          <option value="brave">{t("webSearchBrave")}</option>
        </select>
      </div>
      {webSearchProvider !== "none" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type={showKey ? "text" : "password"}
              className="llm-settings-input"
              style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
              placeholder={t("webSearchApiKeyPlaceholder")}
              value={webSearchApiKey}
              onChange={(e) => onWebSearchApiKeyChange(e.target.value)}
            />
            <button
              className="btn-icon"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? t("hideApiKey") : t("showApiKey")}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            {webSearchProvider === "tavily" ? t("webSearchHintTavily") : t("webSearchHintBrave")}
          </div>
        </>
      )}
    </div>
  );
}
