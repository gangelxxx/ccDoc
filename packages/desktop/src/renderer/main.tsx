import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { useAppStore } from "./stores/app.store.js";
import type { LlmSession } from "./stores/types.js";
import type { Lang } from "./i18n.js";
import { fromLlmConfigData } from "./stores/llm-config.js";
import {
  INITIAL_CHAT_CONFIG, INITIAL_PASSPORT_CONFIG, INITIAL_SUMMARY_CONFIG,
  INITIAL_RESEARCH_CONFIG, INITIAL_WRITER_CONFIG, INITIAL_CRITIC_CONFIG, INITIAL_PLANNER_CONFIG,
} from "./stores/llm-config.js";
import "./styles.css";

// ─── Settings → Zustand state mapping ───────────────────────

interface SettingsData {
  theme: "light" | "dark";
  language: string;
  contentWidth: "narrow" | "medium" | "wide";
  sidebarWidth: number;
  llmPanelWidth: number;
  llmApiKey: string;
  llmChat: any;
  llmPassport: any;
  llmSummary: any;
  llmResearch: any;
  llmWriter: any;
  llmCritic: any;
  llmPlanner: any;
  useSubAgents: boolean;
  webSearchProvider: "tavily" | "brave" | "none";
  webSearchApiKey: string;
  embedding: any;
  voiceModelId: string;
  _version: number;
}

function mapSettingsToState(s: SettingsData, sessions: LlmSession[]) {
  return {
    theme: s.theme,
    language: s.language as Lang,
    contentWidth: s.contentWidth,
    sidebarWidth: s.sidebarWidth,
    llmPanelWidth: s.llmPanelWidth,
    llmApiKey: s.llmApiKey,
    llmChatConfig: fromLlmConfigData(s.llmChat, INITIAL_CHAT_CONFIG),
    llmPassportConfig: fromLlmConfigData(s.llmPassport, INITIAL_PASSPORT_CONFIG),
    llmSummaryConfig: fromLlmConfigData(s.llmSummary, INITIAL_SUMMARY_CONFIG),
    llmResearchConfig: fromLlmConfigData(s.llmResearch, INITIAL_RESEARCH_CONFIG),
    llmWriterConfig: fromLlmConfigData(s.llmWriter, INITIAL_WRITER_CONFIG),
    llmCriticConfig: fromLlmConfigData(s.llmCritic, INITIAL_CRITIC_CONFIG),
    llmPlannerConfig: fromLlmConfigData(s.llmPlanner, INITIAL_PLANNER_CONFIG),
    useSubAgents: s.useSubAgents,
    webSearchProvider: s.webSearchProvider,
    webSearchApiKey: s.webSearchApiKey,
    embeddingConfig: s.embedding,
    voiceModelId: s.voiceModelId || "",
    llmSessions: sessions,
  };
}

// ─── Migration from localStorage ────────────────────────────

function migrateFromLocalStorage(): Partial<SettingsData> {
  const result: Record<string, any> = {};

  const str = (key: string) => localStorage.getItem(key);
  const val = (key: string) => str(key) || undefined;

  // UI
  if (val("ccdoc-theme")) result.theme = str("ccdoc-theme");
  if (val("ccdoc-language")) result.language = str("ccdoc-language");
  if (val("ccdoc-content-width")) result.contentWidth = str("ccdoc-content-width");
  const sw = Number(str("ccdoc-sidebar-width"));
  if (sw > 0) result.sidebarWidth = sw;
  const lw = Number(str("ccdoc-llm-panel-width"));
  if (lw > 0) result.llmPanelWidth = lw;

  // LLM key
  if (val("ccdoc-llm-key")) result.llmApiKey = str("ccdoc-llm-key")!.trim().replace(/[^\x20-\x7E]/g, "");

  // LLM configs
  const migrateConfig = (prefix: string): Record<string, any> | undefined => {
    const model = val(`${prefix}-model`);
    const effort = val(`${prefix}-effort`);
    const thinking = val(`${prefix}-thinking`);
    const inherit = val(`${prefix}-inherit`);
    if (!model && !effort && !thinking && !inherit) return undefined;
    const cfg: Record<string, any> = {};
    if (model) cfg.model = model;
    if (effort) cfg.effort = effort;
    if (thinking) cfg.thinking = thinking === "true";
    if (inherit !== undefined && inherit !== null) cfg.inheritFromParent = inherit === "true";
    return cfg;
  };

  const chat = migrateConfig("ccdoc-llm");
  if (chat) result.llmChat = chat;
  const passport = migrateConfig("ccdoc-llm-passport");
  if (passport) result.llmPassport = passport;
  const summary = migrateConfig("ccdoc-llm-summary");
  if (summary) result.llmSummary = summary;
  const research = migrateConfig("ccdoc-llm-research");
  if (research) result.llmResearch = research;
  const writer = migrateConfig("ccdoc-llm-writer");
  if (writer) result.llmWriter = writer;
  const critic = migrateConfig("ccdoc-llm-critic");
  if (critic) result.llmCritic = critic;
  const planner = migrateConfig("ccdoc-llm-planner");
  if (planner) result.llmPlanner = planner;

  // Sub-agents & web search
  const useSubRaw = str("ccdoc-use-subagents");
  if (useSubRaw !== null) result.useSubAgents = useSubRaw !== "false";
  if (val("ccdoc-web-search-provider")) result.webSearchProvider = str("ccdoc-web-search-provider");
  if (val("ccdoc-web-search-key")) result.webSearchApiKey = str("ccdoc-web-search-key")!.trim().replace(/[^\x20-\x7E]/g, "");

  // Embedding
  const embMode = val("ccdoc-embedding-mode");
  const embLocal = val("ccdoc-embedding-local-id");
  const embProvider = val("ccdoc-embedding-provider");
  const embModel = val("ccdoc-embedding-online-model");
  const embKey = val("ccdoc-embedding-online-key");
  if (embMode || embLocal || embProvider || embModel || embKey) {
    result.embedding = {};
    if (embMode) result.embedding.mode = embMode;
    if (embLocal) result.embedding.localModelId = embLocal;
    if (embProvider) result.embedding.onlineProvider = embProvider;
    if (embModel) result.embedding.onlineModel = embModel;
    if (embKey) result.embedding.onlineApiKey = embKey;
  }

  return result as Partial<SettingsData>;
}

// ─── Boot ───────────────────────────────────────────────────

async function boot() {
  let settings: SettingsData;

  try {
    settings = await window.api.settingsGetAll();
  } catch (err) {
    console.error("[boot] failed to load settings:", err);
    settings = { _version: 1 } as any; // fall through with defaults from store
  }

  // Migration from localStorage (one-time, when settings.json has _version 0)
  if (!settings._version) {
    try {
      const migrated = migrateFromLocalStorage();

      // Migrate sessions
      let migratedSessions: LlmSession[] = [];
      const rawSessions = localStorage.getItem("ccdoc-llm-sessions");
      if (rawSessions) {
        try {
          const parsed = JSON.parse(rawSessions);
          if (Array.isArray(parsed)) migratedSessions = parsed;
        } catch {}
      }

      await window.api.settingsPatch({ ...migrated, _version: 1 });
      if (migratedSessions.length) await window.api.sessionsSave(migratedSessions);
      // localStorage NOT cleared — kept as read-only fallback for downgrade
      settings = await window.api.settingsGetAll();
    } catch (err) {
      console.error("[migration] failed, will retry next launch:", err);
    }
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

  // Apply theme/contentWidth to DOM
  document.documentElement.setAttribute("data-theme", settings.theme || "light");
  document.documentElement.setAttribute("data-content-width", settings.contentWidth || "narrow");

  // Fetch voice model statuses so mic button is active immediately
  useAppStore.getState().fetchVoiceStatuses();

  createRoot(document.getElementById("root")!).render(<App />);
}

boot();
