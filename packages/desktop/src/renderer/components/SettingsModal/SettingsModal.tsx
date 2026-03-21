import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAppStore, type LlmConfig } from "../../stores/app.store.js";
import { useT, type Lang } from "../../i18n.js";
import { ModelTab } from "./tabs/ModelTab.js";
import { EmbeddingsTab } from "./tabs/EmbeddingsTab.js";
import { VoiceTab } from "./tabs/VoiceTab.js";
import { SubAgentsTab } from "./tabs/SubAgentsTab.js";
import { WebSearchTab } from "./tabs/WebSearchTab.js";
import { AppearanceTab } from "./tabs/AppearanceTab.js";

type Tab = "model" | "embeddings" | "voice" | "websearch" | "theme" | "language" | "subagents";

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
    llmResearchConfig, setLlmResearchConfig,
    llmWriterConfig, setLlmWriterConfig,
    llmCriticConfig, setLlmCriticConfig,
    llmPlannerConfig, setLlmPlannerConfig,
    useSubAgents, setUseSubAgents,
    webSearchProvider, setWebSearchProvider,
    webSearchApiKey, setWebSearchApiKey,
    theme, toggleTheme,
    language, setLanguage,
    fetchEmbeddingStatus,
    fetchVoiceStatuses,
  } = useAppStore();
  const t = useT();

  const validTabs: Tab[] = ["model", "embeddings", "voice", "websearch", "theme", "language", "subagents"];
  const [tab, setTab] = useState<Tab>(validTabs.includes(initialTab as Tab) ? initialTab as Tab : "model");
  const [openSection, setOpenSection] = useState<string>("chat");

  /* --- drafts --- */
  const [keyDraft, setKeyDraft] = useState(llmApiKey);
  const [chatDraft, setChatDraft] = useState<LlmConfig>(llmChatConfig);
  const [passportDraft, setPassportDraft] = useState<LlmConfig>(llmPassportConfig);
  const [summaryDraft, setSummaryDraft] = useState<LlmConfig>(llmSummaryConfig);
  const [researchDraft, setResearchDraft] = useState<LlmConfig>(llmResearchConfig);
  const [writerDraft, setWriterDraft] = useState<LlmConfig>(llmWriterConfig);
  const [criticDraft, setCriticDraft] = useState<LlmConfig>(llmCriticConfig);
  const [plannerDraft, setPlannerDraft] = useState<LlmConfig>(llmPlannerConfig);
  const [useSubAgentsDraft, setUseSubAgentsDraft] = useState(useSubAgents);
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
    !configsEqual(researchDraft, llmResearchConfig) ||
    !configsEqual(writerDraft, llmWriterConfig) ||
    !configsEqual(criticDraft, llmCriticConfig) ||
    !configsEqual(plannerDraft, llmPlannerConfig) ||
    useSubAgentsDraft !== useSubAgents ||
    webSearchProviderDraft !== webSearchProvider ||
    webSearchApiKeyDraft !== webSearchApiKey ||
    themeDraft !== theme ||
    langDraft !== language,
    [keyDraft, chatDraft, passportDraft, summaryDraft, researchDraft, writerDraft, criticDraft, plannerDraft, useSubAgentsDraft, webSearchProviderDraft, webSearchApiKeyDraft, themeDraft, langDraft,
     llmApiKey, llmChatConfig, llmPassportConfig, llmSummaryConfig, llmResearchConfig, llmWriterConfig, llmCriticConfig, llmPlannerConfig, useSubAgents, webSearchProvider, webSearchApiKey, theme, language]
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
    if (!configsEqual(researchDraft, llmResearchConfig)) setLlmResearchConfig(researchDraft);
    if (!configsEqual(writerDraft, llmWriterConfig)) setLlmWriterConfig(writerDraft);
    if (!configsEqual(criticDraft, llmCriticConfig)) setLlmCriticConfig(criticDraft);
    if (!configsEqual(plannerDraft, llmPlannerConfig)) setLlmPlannerConfig(plannerDraft);
    if (useSubAgentsDraft !== useSubAgents) setUseSubAgents(useSubAgentsDraft);
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
          <button className={`settings-tab${tab === "subagents" ? " active" : ""}`} onClick={() => setTab("subagents")}>
            {t("settingsSubAgents")}
          </button>
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

          {tab === "theme" && (
            <AppearanceTab mode="theme" themeDraft={themeDraft} onThemeChange={setThemeDraft} />
          )}

          {tab === "language" && (
            <AppearanceTab mode="language" langDraft={langDraft} onLangChange={setLangDraft} />
          )}

          {tab === "subagents" && (
            <SubAgentsTab
              useSubAgentsDraft={useSubAgentsDraft}
              onUseSubAgentsChange={setUseSubAgentsDraft}
              chatDraft={chatDraft}
              researchDraft={researchDraft}
              onResearchChange={(cfg) => setResearchDraft((d) => ({ ...d, ...cfg }))}
              writerDraft={writerDraft}
              onWriterChange={(cfg) => setWriterDraft((d) => ({ ...d, ...cfg }))}
              criticDraft={criticDraft}
              onCriticChange={(cfg) => setCriticDraft((d) => ({ ...d, ...cfg }))}
              plannerDraft={plannerDraft}
              onPlannerChange={(cfg) => setPlannerDraft((d) => ({ ...d, ...cfg }))}
              {...modelProps}
            />
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
