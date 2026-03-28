import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useAppStore, type LlmConfig } from "../../stores/app.store.js";
import { useT, type Lang } from "../../i18n.js";
import type { IndexingConfig } from "../../stores/types.js";
import { ModelTab } from "./tabs/ModelTab.js";
import { EmbeddingsTab } from "./tabs/EmbeddingsTab.js";
import { VoiceTab } from "./tabs/VoiceTab.js";
import { WebSearchTab } from "./tabs/WebSearchTab.js";
import { AppearanceTab } from "./tabs/AppearanceTab.js";
import { AgentsTab } from "./tabs/AgentsTab.js";
import { DeveloperTab } from "./tabs/DeveloperTab.js";
import { IndexingTab } from "./tabs/IndexingTab.js";

type Tab = "model" | "embeddings" | "indexing" | "voice" | "websearch" | "agents" | "appearance" | "developer";

type FontFamily = "default" | "serif" | "sans" | "mono" | "system";
type FontSize = "small" | "medium" | "large";
type ColorScheme = "teal" | "blue" | "purple";

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
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    colorScheme, setColorScheme,
    fetchEmbeddingStatus,
    fetchVoiceStatuses,
    voiceModelId, setVoiceModelId,
    devMode, setDevMode,
    addToast,
    indexingConfig, setIndexingConfig,
  } = useAppStore();
  const t = useT();

  const validTabs: Tab[] = ["model", "embeddings", "indexing", "voice", "websearch", "agents", "appearance"];
  const resolvedInitialTab = (initialTab === "theme" || initialTab === "language") ? "appearance" : initialTab;
  const [tab, setTab] = useState<Tab>(validTabs.includes(resolvedInitialTab as Tab) ? resolvedInitialTab as Tab : "model");
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
  const [fontFamilyDraft, setFontFamilyDraft] = useState<FontFamily>(fontFamily);
  const [fontSizeDraft, setFontSizeDraft] = useState<FontSize>(fontSize);
  const [colorSchemeDraft, setColorSchemeDraft] = useState<ColorScheme>(colorScheme);
  const [voiceModelDraft, setVoiceModelDraft] = useState(voiceModelId);
  const [indexingDraft, setIndexingDraft] = useState(indexingConfig);

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
    langDraft !== language ||
    fontFamilyDraft !== fontFamily ||
    fontSizeDraft !== fontSize ||
    colorSchemeDraft !== colorScheme ||
    voiceModelDraft !== voiceModelId ||
    JSON.stringify(indexingDraft) !== JSON.stringify(indexingConfig),
    [keyDraft, chatDraft, passportDraft, summaryDraft, webSearchProviderDraft, webSearchApiKeyDraft,
     themeDraft, langDraft, fontFamilyDraft, fontSizeDraft, colorSchemeDraft, voiceModelDraft,
     indexingDraft,
     llmApiKey, llmChatConfig, llmPassportConfig, llmSummaryConfig, webSearchProvider, webSearchApiKey,
     theme, language, fontFamily, fontSize, colorScheme, voiceModelId, indexingConfig]
  );

  /* --- auto-configure indexing --- */
  const currentProject = useAppStore((s) => s.currentProject);
  const autoToken = currentProject?.token;
  const [autoConfiguring, setAutoConfiguring] = useState(false);
  const handleAutoConfig = async () => {
    if (!autoToken) return;
    setAutoConfiguring(true);
    try {
      const [dirs, exts, sizes] = await Promise.all([
        window.api.scanExclusionSuggestions(autoToken),
        window.api.scanExtensionSuggestions(autoToken),
        window.api.scanFileSizeSuggestion(autoToken),
      ]);
      const patch: Partial<IndexingConfig> = {};
      if (dirs.length > 0) {
        patch.excludedDirs = [...new Set([...indexingDraft.excludedDirs, ...dirs])];
      }
      if (exts.length > 0) {
        patch.codeExtensions = [...new Set([...indexingDraft.codeExtensions, ...exts])];
      }
      if (sizes) {
        patch.maxFileSizeKB = sizes.recommendedKB;
      }
      if (Object.keys(patch).length > 0) {
        setIndexingDraft((d) => ({ ...d, ...patch }));
      }
    } finally {
      setAutoConfiguring(false);
    }
  };

  /* --- save --- */
  const applyChanges = () => {
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
    if (fontFamilyDraft !== fontFamily) setFontFamily(fontFamilyDraft);
    if (fontSizeDraft !== fontSize) setFontSize(fontSizeDraft);
    if (colorSchemeDraft !== colorScheme) setColorScheme(colorSchemeDraft);
    if (voiceModelDraft !== voiceModelId) setVoiceModelId(voiceModelDraft);
    if (JSON.stringify(indexingDraft) !== JSON.stringify(indexingConfig)) setIndexingConfig(indexingDraft);
  };

  const handleSave = () => {
    applyChanges();
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
          <button className={`settings-tab${tab === "indexing" ? " active" : ""}`} onClick={() => setTab("indexing")}>
            {t("settingsIndexing")}
          </button>
          <button className={`settings-tab${tab === "voice" ? " active" : ""}`} onClick={() => setTab("voice")}>
            {t("settingsVoice")}
          </button>
          <button className={`settings-tab${tab === "appearance" ? " active" : ""}`} onClick={() => setTab("appearance")}>
            {t("settingsAppearance")}
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

          {tab === "indexing" && (
            <IndexingTab
              draft={indexingDraft}
              onChange={(cfg) => setIndexingDraft((d) => ({ ...d, ...cfg }))}
            />
          )}

          {tab === "voice" && (
            <VoiceTab
              voiceModelDraft={voiceModelDraft}
              onVoiceModelChange={setVoiceModelDraft}
            />
          )}

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

          {tab === "appearance" && (
            <AppearanceTab
              themeDraft={themeDraft}
              onThemeChange={setThemeDraft}
              langDraft={langDraft}
              onLangChange={setLangDraft}
              fontFamilyDraft={fontFamilyDraft}
              onFontFamilyChange={setFontFamilyDraft}
              fontSizeDraft={fontSizeDraft}
              onFontSizeChange={setFontSizeDraft}
              colorSchemeDraft={colorSchemeDraft}
              onColorSchemeChange={setColorSchemeDraft}
            />
          )}

        </div>

        <div className="modal-actions">
          <div style={{ display: "flex", gap: 8, marginRight: "auto" }}>
            {tab === "indexing" && (
              <button
                className="btn"
                onClick={handleAutoConfig}
                disabled={!autoToken || !indexingDraft.enabled || autoConfiguring}
              >
                {autoConfiguring && <Loader2 size={14} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} />}
                {t("indexingAutoConfig")}
              </button>
            )}
            {isDirty && (
              <button className="btn btn-apply" onClick={applyChanges}>
                {t("apply")}
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={!isDirty}>{t("save")}</button>
          <button className="btn" onClick={onClose}>{t("close")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
