import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { useAppStore } from "./stores/app.store.js";
import type { LlmSession, ModelTiersConfig } from "./stores/types.js";
import type { Lang } from "./i18n.js";
import { fromLlmConfigData } from "./stores/llm-config.js";
import {
  INITIAL_CHAT_CONFIG, INITIAL_PASSPORT_CONFIG, INITIAL_SUMMARY_CONFIG,
  INITIAL_MODEL_TIERS,
} from "./stores/llm-config.js";
import "./styles.css";

// ─── Settings → Zustand state mapping ───────────────────────

interface SettingsData {
  theme: "light" | "dark";
  language: string;
  fontFamily: "default" | "serif" | "sans" | "mono" | "system";
  fontSize: "small" | "medium" | "large";
  colorScheme: "teal" | "blue" | "purple";
  contentWidth: "narrow" | "medium" | "wide";
  sidebarWidth: number;
  llmPanelWidth: number;
  llmApiKey: string;
  llmChat: any;
  llmPassport: any;
  llmSummary: any;
  webSearchProvider: "tavily" | "brave" | "none";
  webSearchApiKey: string;
  customAgents: any[];
  embedding: any;
  indexing: any;
  spellcheck: any;
  history: any;
  voiceModelId: string;
  showIconProgress: boolean;
  progressStages: any[];
  devMode: boolean;
  devTrackToolIssues: boolean;
  devToolFeedback: boolean;
  modelTiers: ModelTiersConfig;
  _version: number;
}

function mapSettingsToState(s: SettingsData, sessions: LlmSession[]) {
  return {
    theme: s.theme,
    language: s.language as Lang,
    fontFamily: s.fontFamily || "default",
    fontSize: s.fontSize || "medium",
    colorScheme: s.colorScheme || "teal",
    contentWidth: s.contentWidth,
    sidebarWidth: s.sidebarWidth,
    llmPanelWidth: s.llmPanelWidth,
    llmApiKey: s.llmApiKey,
    llmChatConfig: fromLlmConfigData(s.llmChat, INITIAL_CHAT_CONFIG),
    llmPassportConfig: fromLlmConfigData(s.llmPassport, INITIAL_PASSPORT_CONFIG),
    llmSummaryConfig: fromLlmConfigData(s.llmSummary, INITIAL_SUMMARY_CONFIG),
    webSearchProvider: s.webSearchProvider,
    webSearchApiKey: s.webSearchApiKey,
    customAgents: Array.isArray(s.customAgents) ? s.customAgents : [],
    embeddingConfig: s.embedding,
    indexingConfig: s.indexing,
    spellcheckConfig: s.spellcheck || { enabled: true, languages: ["ru", "en"], userDictionary: [] },
    historyConfig: s.history || { historyRetainDays: 0, maxSnapshotsPerSection: 30, snapshotMaxAgeDays: 30, snapshotCoalesceIntervalSec: 30 },
    voiceModelId: s.voiceModelId || "",
    autoVerifyPlan: s.autoVerifyPlan !== false,
    showIconProgress: s.showIconProgress !== false,
    progressStages: Array.isArray(s.progressStages) ? s.progressStages : [],
    devMode: !!s.devMode,
    devTrackToolIssues: !!s.devTrackToolIssues,
    devToolFeedback: !!s.devToolFeedback,
    modelTiers: s.modelTiers || INITIAL_MODEL_TIERS,
    llmSessions: sessions,
  };
}

// ─── Boot ───────────────────────────────────────────────────

async function boot() {
  let settings: SettingsData;

  try {
    settings = await window.api.settingsGetAll();
  } catch (err) {
    console.error("[boot] failed to load settings:", err);
    settings = {} as any; // fall through with defaults from store
  }

  // Load sessions
  let sessions: LlmSession[] = [];
  try {
    sessions = await window.api.sessionsGetAll();
  } catch (err) {
    console.error("[boot] failed to load sessions:", err);
  }

  // Hydrate Zustand store
  useAppStore.setState(mapSettingsToState(settings, sessions));

  // Apply theme/contentWidth/appearance to DOM
  document.documentElement.setAttribute("data-theme", settings.theme || "light");
  document.documentElement.setAttribute("data-content-width", settings.contentWidth || "narrow");
  document.documentElement.setAttribute("data-font-family", settings.fontFamily || "default");
  document.documentElement.setAttribute("data-font-size", settings.fontSize || "medium");
  document.documentElement.setAttribute("data-color-scheme", settings.colorScheme || "teal");

  // Fetch voice model statuses so mic button is active immediately
  useAppStore.getState().fetchVoiceStatuses();

  createRoot(document.getElementById("root")!).render(<App />);
}

boot();
