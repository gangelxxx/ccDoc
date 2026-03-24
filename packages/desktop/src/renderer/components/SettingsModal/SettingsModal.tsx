import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppStore, type LlmConfig } from "../../stores/app.store.js";
import { useT, type Lang } from "../../i18n.js";
import { ModelTab } from "./tabs/ModelTab.js";
import { EmbeddingsTab } from "./tabs/EmbeddingsTab.js";
import { VoiceTab } from "./tabs/VoiceTab.js";
import { WebSearchTab } from "./tabs/WebSearchTab.js";
import { AppearanceTab } from "./tabs/AppearanceTab.js";
import { AgentsTab } from "./tabs/AgentsTab.js";
import { DeveloperTab } from "./tabs/DeveloperTab.js";

type Tab = "model" | "embeddings" | "voice" | "websearch" | "agents" | "theme" | "language" | "developer";

function configsEqual(a: LlmConfig, b: LlmConfig): boolean {
  return a.model === b.model && a.effort === b.effort && a.thinking === b.thinking && a.inheritFromParent === b.inheritFromParent;
}

export function SettingsModal({ onClose, initialTab }: { onClose: () => void; initialTab?: string }) {
  const {
    llmApiKey, setLlmApiKey,
    llmModels, llmModelsLoading, llmModelsError, fetchLlmModels,
    llmChatConfig, setLlmChatConfig,
    llmPassportConfig, setLlmPassportConfig,
    llmSummaryConfig, setLlmSummaryConfig,
    webSearchProvider, setWebSearchProvider,
    webSearchApiKey, setWebSearchApiKey,
    theme, toggleTheme,
    language, setLanguage,
    fetchEmbeddingStatus,
    fetchVoiceStatuses,
    devMode, setDevMode,
    addToast,
  } = useAppStore();
  const t = useT();

  const validTabs: Tab[] = ["model", "embeddings", "voice", "websearch", "agents", "theme", "language"];
  const [tab, setTab] = useState<Tab>(validTabs.includes(initialTab as Tab) ? initialTab as Tab : "model");
  const [openSection, setOpenSection] = useState<string>("chat");

  // Secret dev mode activation: press "8" four times in a row
  const devCodeRef = useRef("");
  const handleDevCode = useCallback((e: KeyboardEvent) => {
    if (e.key === "8") {
      devCodeRef.current += "8";
      if (devCodeRef.current.length >= 4) {
        if (!devMode) {
          setDevMode(true);
          addToast("info", t("devModeActivated"));
        }
        devCodeRef.current = "";
      }
    } else {
      devCodeRef.current = "";
    }
  }, [devMode, setDevMode, addToast, t]);

  useEffect(() => {
    document.addEventListener("keydown", handleDevCode);
    return () => document.removeEventListener("keydown", handleDevCode);
  }, [handleDevCode]);

  /* --- drafts --- */
  const [keyDraft, setKeyDraft] = useState(llmApiKey);
  const [chatDraft, setChatDraft] = useState<LlmConfig>(llmChatConfig);
  const [passportDraft, setPassportDraft] = useState<LlmConfig>(llmPassportConfig);
  const [summaryDraft, setSummaryDraft] = useState<LlmConfig>(llmSummaryConfig);
  const [webSearchProviderDraft, setWebSearchProviderDraft] = useState(webSearchProvider);
  const [webSearchApiKeyDraft, setWebSearchApiKeyDraft] = useState(webSearchApiKey);
  const [themeDraft, setThemeDraft] = useState(theme);
  const [langDraft, setLangDraft] = useState<Lang>(language);

  /* --- side effects --- */
  useEffect(() => {
    if (tab === "embeddings") fetchEmbeddingStatus();
    if (tab === "voice") fetchVoiceStatuses();
  }, [tab]);

  useEffect(() => {
    if (llmApiKey && llmModels.length === 0) {
      fetchLlmModels(llmApiKey);
    }
  }, []);

  /* --- dirty check --- */
  const isDirty = useMemo(() =>
    keyDraft !== llmApiKey ||
    !configsEqual(chatDraft, llmChatConfig) ||
    !configsEqual(passportDraft, llmPassportConfig) ||
    !configsEqual(summaryDraft, llmSummaryConfig) ||
    webSearchProviderDraft !== webSearchProvider ||
    webSearchApiKeyDraft !== webSearchApiKey ||
    themeDraft !== theme ||
    langDraft !== language,
    [keyDraft, chatDraft, passportDraft, summaryDraft, webSearchProviderDraft, webSearchApiKeyDraft, themeDraft, langDraft,
     llmApiKey, llmChatConfig, llmPassportConfig, llmSummaryConfig, webSearchProvider, webSearchApiKey, theme, language]
  );

  /* --- save --- */
  const handleSave = () => {
    if (keyDraft !== llmApiKey) {
      setLlmApiKey(keyDraft);
      if (keyDraft) fetchLlmModels(keyDraft);
    }
    if (!configsEqual(chatDraft, llmChatConfig)) setLlmChatConfig(chatDraft);
    if (!configsEqual(passportDraft, llmPassportConfig)) setLlmPassportConfig(passportDraft);
    if (!configsEqual(summaryDraft, llmSummaryConfig)) setLlmSummaryConfig(summaryDraft);
    if (webSearchProviderDraft !== webSearchProvider) setWebSearchProvider(webSearchProviderDraft);
    if (webSearchApiKeyDraft !== webSearchApiKey) setWebSearchApiKey(webSearchApiKeyDraft);
    if (themeDraft !== theme) toggleTheme();
    if (langDraft !== language) setLanguage(langDraft);
    onClose();
  };

  const toggleSection = (key: string) => {
    const opening = openSection !== key;
    setOpenSection((prev) => (prev === key ? "" : key));
    if (opening && keyDraft && llmModels.length === 0 && !llmModelsLoading) {
      fetchLlmModels(keyDraft);
    }
  };

  /* --- shared LLM model props --- */
  const modelProps = {
    models: llmModels,
    modelsLoading: llmModelsLoading,
    modelsError: llmModelsError,
    openSection,
    onToggleSection: toggleSection,
  };

  return createPortal(
    <div className="modal-overlay">
      <div className="modal settings-modal">
        <h3>{t("settings")}</h3>

        <div className="settings-tabs">
          <button className={`settings-tab${tab === "model" ? " active" : ""}`} onClick={() => setTab("model")}>
            {t("settingsModel")}
          </button>
          <button className={`settings-tab${tab === "embeddings" ? " active" : ""}`} onClick={() => setTab("embeddings")}>
            {t("settingsEmbeddings")}
          </button>
          <button className={`settings-tab${tab === "voice" ? " active" : ""}`} onClick={() => setTab("voice")}>
            {t("settingsVoice")}
          </button>
          <button className={`settings-tab${tab === "theme" ? " active" : ""}`} onClick={() => setTab("theme")}>
            {t("settingsTheme")}
          </button>
          <button className={`settings-tab${tab === "language" ? " active" : ""}`} onClick={() => setTab("language")}>
            {t("settingsLanguage")}
          </button>
          <button className={`settings-tab${tab === "websearch" ? " active" : ""}`} onClick={() => setTab("websearch")}>
            {t("webSearchTitle")}
          </button>
          <button className={`settings-tab${tab === "agents" ? " active" : ""}`} onClick={() => setTab("agents")}>
            {t("settingsAgents")}
          </button>
          {devMode && (
            <button className={`settings-tab${tab === "developer" ? " active" : ""}`} onClick={() => setTab("developer")}>
              {t("settingsDeveloper")}
            </button>
          )}
        </div>

        <div className="settings-tab-content">
          {tab === "model" && (
            <ModelTab
              keyDraft={keyDraft}
              onKeyChange={setKeyDraft}
              chatDraft={chatDraft}
              onChatChange={(cfg) => setChatDraft((d) => ({ ...d, ...cfg }))}
              passportDraft={passportDraft}
              onPassportChange={(cfg) => setPassportDraft((d) => ({ ...d, ...cfg }))}
              summaryDraft={summaryDraft}
              onSummaryChange={(cfg) => setSummaryDraft((d) => ({ ...d, ...cfg }))}
              {...modelProps}
            />
          )}

          {tab === "embeddings" && <EmbeddingsTab />}

          {tab === "voice" && <VoiceTab />}

          {tab === "websearch" && (
            <WebSearchTab
              webSearchProvider={webSearchProviderDraft}
              onWebSearchProviderChange={setWebSearchProviderDraft}
              webSearchApiKey={webSearchApiKeyDraft}
              onWebSearchApiKeyChange={setWebSearchApiKeyDraft}
            />
          )}

          {tab === "agents" && <AgentsTab />}

          {tab === "developer" && <DeveloperTab />}

          {tab === "theme" && (
            <AppearanceTab mode="theme" themeDraft={themeDraft} onThemeChange={setThemeDraft} />
          )}

          {tab === "language" && (
            <AppearanceTab mode="language" langDraft={langDraft} onLangChange={setLangDraft} />
          )}

        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={!isDirty}>{t("save")}</button>
          <button className="btn" onClick={onClose}>{t("close")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
