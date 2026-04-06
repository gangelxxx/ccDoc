import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useAppStore } from "../../stores/app.store.js";
import { useT, type Lang } from "../../i18n.js";
import type { IndexingConfig, ModelTier, ModelTierConfig, ModelTiersConfig } from "../../stores/types.js";
import { ModelTab } from "./tabs/ModelTab.js";
import { ModelTiersTab } from "./tabs/ModelTiersTab.js";
import { EmbeddingsTab } from "./tabs/EmbeddingsTab.js";
import { VoiceTab } from "./tabs/VoiceTab.js";
import { WebSearchTab } from "./tabs/WebSearchTab.js";
import { AppearanceTab } from "./tabs/AppearanceTab.js";
import { AgentsTab } from "./tabs/AgentsTab.js";
import { DeveloperTab } from "./tabs/DeveloperTab.js";
import { IndexingTab } from "./tabs/IndexingTab.js";
import { SpellcheckTab } from "./tabs/SpellcheckTab.js";
import { ProgressStagesTab } from "./tabs/ProgressStagesTab.js";
import { HistoryTab } from "./tabs/HistoryTab.js";

type Tab = "model" | "tiers" | "embeddings" | "indexing" | "voice" | "websearch" | "agents" | "appearance" | "spellcheck" | "progress" | "history" | "developer";

type FontFamily = "default" | "serif" | "sans" | "mono" | "system";
type FontSize = "small" | "medium" | "large";
type ColorScheme = "teal" | "blue" | "purple";

export function SettingsModal({ onClose, initialTab }: { onClose: () => void; initialTab?: string }) {
  const {
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
    spellcheckConfig, setSpellcheckConfig,
    historyConfig, setHistoryConfig,
    modelTiers, setModelTier, setTierAssignment,
    builtinScripts, loadBuiltinScripts,
  } = useAppStore();
  const t = useT();

  const validTabs: Tab[] = ["model", "tiers", "embeddings", "indexing", "voice", "websearch", "agents", "appearance", "spellcheck", "progress", "history"];
  const resolvedInitialTab = (initialTab === "theme" || initialTab === "language") ? "appearance" : initialTab;
  const [tab, setTab] = useState<Tab>(validTabs.includes(resolvedInitialTab as Tab) ? resolvedInitialTab as Tab : "model");

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
  const [webSearchProviderDraft, setWebSearchProviderDraft] = useState(webSearchProvider);
  const [webSearchApiKeyDraft, setWebSearchApiKeyDraft] = useState(webSearchApiKey);
  const [themeDraft, setThemeDraft] = useState(theme);
  const [langDraft, setLangDraft] = useState<Lang>(language);
  const [fontFamilyDraft, setFontFamilyDraft] = useState<FontFamily>(fontFamily);
  const [fontSizeDraft, setFontSizeDraft] = useState<FontSize>(fontSize);
  const [colorSchemeDraft, setColorSchemeDraft] = useState<ColorScheme>(colorScheme);
  const [voiceModelDraft, setVoiceModelDraft] = useState(voiceModelId);
  const [autoVerifyPlanDraft, setAutoVerifyPlanDraft] = useState(useAppStore.getState().autoVerifyPlan);
  const [showIconProgressDraft, setShowIconProgressDraft] = useState(useAppStore.getState().showIconProgress);
  const [indexingDraft, setIndexingDraft] = useState(indexingConfig);
  const [spellcheckEnabledDraft, setSpellcheckEnabledDraft] = useState(spellcheckConfig.enabled);
  const [spellcheckLangsDraft, setSpellcheckLangsDraft] = useState(spellcheckConfig.languages);
  const [progressStagesDraft, setProgressStagesDraft] = useState(useAppStore.getState().progressStages);
  const [tiersDraft, setTiersDraft] = useState<ModelTiersConfig>(modelTiers);

  const handleTierChange = (tier: ModelTier, patch: Partial<ModelTierConfig>) => {
    setTiersDraft((d) => ({ ...d, [tier]: { ...d[tier], ...patch } }));
  };
  const handleTierAssignmentChange = (key: "chatTier" | "passportTier" | "summaryTier", tier: ModelTier) => {
    setTiersDraft((d) => ({ ...d, [key]: tier }));
  };

  const [historyRetainDaysDraft, setHistoryRetainDaysDraft] = useState(historyConfig.historyRetainDays);
  const [maxSnapshotsDraft, setMaxSnapshotsDraft] = useState(historyConfig.maxSnapshotsPerSection);
  const [snapshotMaxAgeDaysDraft, setSnapshotMaxAgeDaysDraft] = useState(historyConfig.snapshotMaxAgeDays);
  const [snapshotCoalesceDraft, setSnapshotCoalesceDraft] = useState(historyConfig.snapshotCoalesceIntervalSec);

  /* --- side effects --- */
  useEffect(() => {
    if (tab === "embeddings") fetchEmbeddingStatus();
    if (tab === "voice") fetchVoiceStatuses();
    if (tab === "tiers" && builtinScripts.length === 0) loadBuiltinScripts();
  }, [tab]);

  /* --- dirty check --- */
  const isDirty = useMemo(() =>
    JSON.stringify(tiersDraft) !== JSON.stringify(modelTiers) ||
    webSearchProviderDraft !== webSearchProvider ||
    webSearchApiKeyDraft !== webSearchApiKey ||
    themeDraft !== theme ||
    langDraft !== language ||
    fontFamilyDraft !== fontFamily ||
    fontSizeDraft !== fontSize ||
    colorSchemeDraft !== colorScheme ||
    voiceModelDraft !== voiceModelId ||
    JSON.stringify(indexingDraft) !== JSON.stringify(indexingConfig) ||
    spellcheckEnabledDraft !== spellcheckConfig.enabled ||
    JSON.stringify(spellcheckLangsDraft) !== JSON.stringify(spellcheckConfig.languages) ||
    autoVerifyPlanDraft !== useAppStore.getState().autoVerifyPlan ||
    JSON.stringify(progressStagesDraft) !== JSON.stringify(useAppStore.getState().progressStages) ||
    historyRetainDaysDraft !== historyConfig.historyRetainDays ||
    maxSnapshotsDraft !== historyConfig.maxSnapshotsPerSection ||
    snapshotMaxAgeDaysDraft !== historyConfig.snapshotMaxAgeDays ||
    snapshotCoalesceDraft !== historyConfig.snapshotCoalesceIntervalSec,
    [tiersDraft, modelTiers,
     webSearchProviderDraft, webSearchApiKeyDraft,
     themeDraft, langDraft, fontFamilyDraft, fontSizeDraft, colorSchemeDraft, voiceModelDraft,
     indexingDraft, spellcheckEnabledDraft, spellcheckLangsDraft, autoVerifyPlanDraft, progressStagesDraft,
     historyRetainDaysDraft, maxSnapshotsDraft, snapshotMaxAgeDaysDraft, snapshotCoalesceDraft,
     webSearchProvider, webSearchApiKey,
     theme, language, fontFamily, fontSize, colorScheme, voiceModelId, indexingConfig, spellcheckConfig, historyConfig]
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
    // Model tiers
    if (JSON.stringify(tiersDraft) !== JSON.stringify(modelTiers)) {
      for (const tier of ["strong", "medium", "weak"] as const) {
        if (JSON.stringify(tiersDraft[tier]) !== JSON.stringify(modelTiers[tier])) {
          setModelTier(tier, tiersDraft[tier]);
        }
      }
      for (const key of ["chatTier", "passportTier", "summaryTier"] as const) {
        if (tiersDraft[key] !== modelTiers[key]) {
          setTierAssignment(key, tiersDraft[key]);
        }
      }
    }
    if (webSearchProviderDraft !== webSearchProvider) setWebSearchProvider(webSearchProviderDraft);
    if (webSearchApiKeyDraft !== webSearchApiKey) setWebSearchApiKey(webSearchApiKeyDraft);
    if (themeDraft !== theme) toggleTheme();
    if (langDraft !== language) setLanguage(langDraft);
    if (fontFamilyDraft !== fontFamily) setFontFamily(fontFamilyDraft);
    if (fontSizeDraft !== fontSize) setFontSize(fontSizeDraft);
    if (colorSchemeDraft !== colorScheme) setColorScheme(colorSchemeDraft);
    if (voiceModelDraft !== voiceModelId) setVoiceModelId(voiceModelDraft);
    if (autoVerifyPlanDraft !== useAppStore.getState().autoVerifyPlan) useAppStore.getState().setAutoVerifyPlan(autoVerifyPlanDraft);
    if (showIconProgressDraft !== useAppStore.getState().showIconProgress) useAppStore.getState().setShowIconProgress(showIconProgressDraft);
    if (JSON.stringify(indexingDraft) !== JSON.stringify(indexingConfig)) setIndexingConfig(indexingDraft);
    if (spellcheckEnabledDraft !== spellcheckConfig.enabled || JSON.stringify(spellcheckLangsDraft) !== JSON.stringify(spellcheckConfig.languages)) {
      setSpellcheckConfig({ enabled: spellcheckEnabledDraft, languages: spellcheckLangsDraft });
    }
    if (JSON.stringify(progressStagesDraft) !== JSON.stringify(useAppStore.getState().progressStages)) {
      useAppStore.getState().setProgressStages(progressStagesDraft);
    }
    if (historyRetainDaysDraft !== historyConfig.historyRetainDays ||
        maxSnapshotsDraft !== historyConfig.maxSnapshotsPerSection ||
        snapshotMaxAgeDaysDraft !== historyConfig.snapshotMaxAgeDays ||
        snapshotCoalesceDraft !== historyConfig.snapshotCoalesceIntervalSec) {
      setHistoryConfig({
        historyRetainDays: historyRetainDaysDraft,
        maxSnapshotsPerSection: maxSnapshotsDraft,
        snapshotMaxAgeDays: snapshotMaxAgeDaysDraft,
        snapshotCoalesceIntervalSec: snapshotCoalesceDraft,
      });
    }
  };

  const handleSave = () => {
    applyChanges();
    onClose();
  };



  return createPortal(
    <div className="modal-overlay">
      <div className="modal settings-modal">
        <h3>{t("settings")}</h3>

        <div className="settings-body">
          <div className="settings-tabs">
            <button className={`settings-tab${tab === "model" ? " active" : ""}`} onClick={() => setTab("model")}>
              {t("settingsModel")}
            </button>
            <button className={`settings-tab${tab === "tiers" ? " active" : ""}`} onClick={() => setTab("tiers")}>
              {t("settingsModelTiers")}
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
            <button className={`settings-tab${tab === "spellcheck" ? " active" : ""}`} onClick={() => setTab("spellcheck")}>
              {t("settingsSpellcheck")}
            </button>
            <button className={`settings-tab${tab === "progress" ? " active" : ""}`} onClick={() => setTab("progress")}>
              {t("settingsProgressStages")}
            </button>
            <button className={`settings-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
              {t("settingsHistory")}
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
              chatTierDraft={tiersDraft.chatTier}
              onChatTierChange={(t) => handleTierAssignmentChange("chatTier", t)}
              passportTierDraft={tiersDraft.passportTier}
              onPassportTierChange={(t) => handleTierAssignmentChange("passportTier", t)}
              summaryTierDraft={tiersDraft.summaryTier}
              onSummaryTierChange={(t) => handleTierAssignmentChange("summaryTier", t)}
              autoVerifyPlan={autoVerifyPlanDraft}
              onAutoVerifyPlanChange={setAutoVerifyPlanDraft}
            />
          )}

          {tab === "tiers" && (
            <ModelTiersTab
              tiersDraft={tiersDraft}
              onTierChange={handleTierChange}
              builtinScripts={builtinScripts}
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

          {tab === "spellcheck" && (
            <SpellcheckTab
              enabled={spellcheckEnabledDraft}
              onEnabledChange={setSpellcheckEnabledDraft}
              languages={spellcheckLangsDraft}
              onLanguagesChange={setSpellcheckLangsDraft}
            />
          )}

          {tab === "progress" && (
            <ProgressStagesTab
              stages={progressStagesDraft}
              onChange={setProgressStagesDraft}
            />
          )}

          {tab === "history" && (
            <HistoryTab
              historyRetainDays={historyRetainDaysDraft}
              onHistoryRetainDaysChange={setHistoryRetainDaysDraft}
              maxSnapshotsPerSection={maxSnapshotsDraft}
              onMaxSnapshotsChange={setMaxSnapshotsDraft}
              snapshotMaxAgeDays={snapshotMaxAgeDaysDraft}
              onSnapshotMaxAgeDaysChange={setSnapshotMaxAgeDaysDraft}
              snapshotCoalesceIntervalSec={snapshotCoalesceDraft}
              onSnapshotCoalesceChange={setSnapshotCoalesceDraft}
            />
          )}

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
              showIconProgress={showIconProgressDraft}
              onShowIconProgressChange={setShowIconProgressDraft}
            />
          )}

          </div>
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
