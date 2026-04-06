import type { ProgressStage } from "@ccdoc/core";

// ─── Settings types ─────────────────────────────────────────
// INVARIANT: Settings is max 2 levels deep — deepPatch relies on this.

// SYNC: duplicated in renderer/stores/llm-config.ts (separate build targets)
export interface LlmConfigData {
  model: string;
  effort: "low" | "medium" | "high";
  thinking: boolean;
  inheritFromParent?: boolean;
}

// ─── Multi-provider model tiers ────────────────────────────

export type ModelTier = "strong" | "medium" | "weak";

export interface ProviderScriptRef {
  type: "builtin" | "custom";
  /** For builtin: ID of built-in script ("anthropic-oauth", "openai", ...) */
  builtinId?: string;
  /** For custom: path to JS file */
  customPath?: string;
  /** For custom: inline JS code */
  customCode?: string;
}

export interface ModelTierConfig {
  providerScript: ProviderScriptRef;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  effort: "low" | "medium" | "high";
  thinking: boolean;
  thinkingBudget: number;
  maxTokens: number;
  temperature: number;
}

export interface ModelTiersConfig {
  strong: ModelTierConfig;
  medium: ModelTierConfig;
  weak: ModelTierConfig;
  /** Tier assignments for each use case */
  chatTier: ModelTier;
  passportTier: ModelTier;
  summaryTier: ModelTier;
}

export interface EmbeddingConfigData {
  mode: string;
  localModelId: string;
  onlineProvider: string;
  onlineModel: string;
  onlineApiKey: string;
}

// SYNC: duplicated in renderer stores/llm/types.ts as CustomAgent
export interface CustomAgentData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  prompt: string;
  tools: string[];
  model: string;
  thinking: boolean;
  effort: "low" | "medium" | "high";
  rating: number;       // 0-10, default 10 (set by assistant via rate_agent)
  ratingLog: string[];  // last problems reported by assistant
}

// SYNC: duplicated in renderer/stores/types.ts as IndexingConfig
export interface IndexingConfigData {
  enabled: boolean;
  intensity: "low" | "medium" | "high";
  excludedDirs: string[];
  codeExtensions: string[];
  maxFileSizeKB: number;
  stalenessIntervalMin: number;
}

export interface SpellcheckConfigData {
  enabled: boolean;
  languages: string[];
  userDictionary: string[];
}

export interface HistorySettingsData {
  historyRetainDays: number;       // 0 = keep all (default)
  maxSnapshotsPerSection: number;  // default 30
  snapshotMaxAgeDays: number;      // default 30
  snapshotCoalesceIntervalSec: number; // default 30
}

export type FontFamily = "default" | "serif" | "sans" | "mono" | "system";
export type FontSize = "small" | "medium" | "large";
export type ColorScheme = "teal" | "blue" | "purple";

export interface Settings {
  // UI
  theme: "light" | "dark";
  language: string;
  fontFamily: FontFamily;
  fontSize: FontSize;
  colorScheme: ColorScheme;
  contentWidth: "narrow" | "medium" | "wide";
  sidebarWidth: number;
  llmPanelWidth: number;
  // LLM
  llmApiKey: string;
  llmChat: LlmConfigData;
  llmPassport: LlmConfigData;
  llmSummary: LlmConfigData;
  webSearchProvider: "tavily" | "brave" | "none";
  webSearchApiKey: string;
  // Custom agents
  customAgents: CustomAgentData[];
  // Embedding
  embedding: EmbeddingConfigData;
  // Indexing
  indexing: IndexingConfigData;
  // Spellcheck
  spellcheck: SpellcheckConfigData;
  // History & storage
  history: HistorySettingsData;
  // Auto-verify plans
  autoVerifyPlan: boolean;
  // Icon progress
  showIconProgress: boolean;
  // Progress stages
  progressStages: ProgressStage[];
  // Voice STT
  voiceModelId: string;
  // Multi-provider model tiers
  modelTiers: ModelTiersConfig;
  // Developer mode
  devMode: boolean;
  devTrackToolIssues: boolean;
  devToolFeedback: boolean;
  // Version (0 = not migrated yet)
  _version: number;
}

// ─── Defaults ───────────────────────────────────────────────

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const SETTINGS_DEFAULTS: Settings = {
  theme: "light",
  language: "en",
  fontFamily: "default",
  fontSize: "medium",
  colorScheme: "teal",
  contentWidth: "narrow",
  sidebarWidth: 268,
  llmPanelWidth: 320,
  llmApiKey: "",
  llmChat: { model: "claude-opus-4-6", effort: "medium", thinking: true },
  llmPassport: { model: DEFAULT_MODEL, effort: "low", thinking: false },
  llmSummary: { model: DEFAULT_MODEL, effort: "low", thinking: false },
  webSearchProvider: "none",
  webSearchApiKey: "",
  customAgents: [],
  embedding: {
    mode: "none",
    localModelId: "multilingual-e5-small",
    onlineProvider: "openai",
    onlineModel: "text-embedding-3-small",
    onlineApiKey: "",
  },
  indexing: {
    enabled: true,
    intensity: "low",
    excludedDirs: [
      "node_modules", ".git", ".ccdoc", "dist", "build", ".next", "vendor",
      "__pycache__", ".vscode", ".idea", ".svn", "coverage", ".nyc_output",
      ".cache", ".turbo", "release", "out", ".output", "logs",
    ],
    codeExtensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".go", ".rs"],
    maxFileSizeKB: 500,
    stalenessIntervalMin: 5,
  },
  spellcheck: {
    enabled: true,
    languages: ["ru", "en"],
    userDictionary: [],
  },
  history: {
    historyRetainDays: 0,
    maxSnapshotsPerSection: 30,
    snapshotMaxAgeDays: 30,
    snapshotCoalesceIntervalSec: 30,
  },
  autoVerifyPlan: true,
  showIconProgress: true,
  progressStages: [
    { id: 'new',     name: 'New',            percent: 0,   color: '#94a3b8' },
    { id: 'dev',     name: 'In Development', percent: 25,  color: '#3b82f6' },
    { id: 'test',    name: 'Testing',        percent: 50,  color: '#f59e0b' },
    { id: 'prod',    name: 'In Production',  percent: 75,  color: '#22c55e' },
    { id: 'done',    name: 'Done',           percent: 100, color: '#10b981' },
  ],
  voiceModelId: "",
  modelTiers: {
    strong: {
      providerScript: { type: "builtin", builtinId: "anthropic-oauth" },
      modelId: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      effort: "high",
      thinking: true,
      thinkingBudget: 10000,
      maxTokens: 16384,
      temperature: 1,
    },
    medium: {
      providerScript: { type: "builtin", builtinId: "anthropic-oauth" },
      modelId: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      effort: "medium",
      thinking: false,
      thinkingBudget: 5000,
      maxTokens: 8192,
      temperature: 0.7,
    },
    weak: {
      providerScript: { type: "builtin", builtinId: "anthropic-oauth" },
      modelId: "claude-haiku-4-5-20251001",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      effort: "low",
      thinking: false,
      thinkingBudget: 2000,
      maxTokens: 4096,
      temperature: 0,
    },
    chatTier: "medium",
    passportTier: "weak",
    summaryTier: "weak",
  },
  devMode: false,
  devTrackToolIssues: false,
  devToolFeedback: false,
  _version: 0,
};

// ─── LLM config keys (for validation iteration) ────────────

export const LLM_CONFIG_KEYS = [
  "llmChat", "llmPassport", "llmSummary",
] as const;

export const MODEL_TIER_KEYS: ModelTier[] = ["strong", "medium", "weak"];

// ─── Validation ─────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  if (typeof val !== "number" || isNaN(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function validateSettings(raw: any): Settings {
  const s = { ...SETTINGS_DEFAULTS, ...raw };

  if (!["light", "dark"].includes(s.theme)) s.theme = "light";
  if (typeof s.language !== "string" || !s.language) s.language = "en";
  if (!["default", "serif", "sans", "mono", "system"].includes(s.fontFamily)) s.fontFamily = "default";
  if (!["small", "medium", "large"].includes(s.fontSize)) s.fontSize = "medium";
  if (!["teal", "blue", "purple"].includes(s.colorScheme)) s.colorScheme = "teal";
  if (!["narrow", "medium", "wide"].includes(s.contentWidth)) s.contentWidth = "narrow";
  s.sidebarWidth = clamp(s.sidebarWidth, 140, 800);
  s.llmPanelWidth = clamp(s.llmPanelWidth, 200, 1200);

  for (const key of LLM_CONFIG_KEYS) {
    if (!s[key] || typeof s[key] !== "object") {
      s[key] = { ...SETTINGS_DEFAULTS[key] };
    } else {
      s[key] = { ...SETTINGS_DEFAULTS[key], ...s[key] };
      if (!["low", "medium", "high"].includes(s[key].effort)) s[key].effort = "medium";
    }
  }

  if (!s.embedding || typeof s.embedding !== "object") {
    s.embedding = { ...SETTINGS_DEFAULTS.embedding };
  } else {
    s.embedding = { ...SETTINGS_DEFAULTS.embedding, ...s.embedding };
    if (!["none", "local", "online"].includes(s.embedding.mode)) s.embedding.mode = "none";
    if (!["openai", "voyage"].includes(s.embedding.onlineProvider)) s.embedding.onlineProvider = "openai";
  }

  if (!["tavily", "brave", "none"].includes(s.webSearchProvider)) s.webSearchProvider = "none";

  // Indexing
  if (!s.indexing || typeof s.indexing !== "object") {
    s.indexing = { ...SETTINGS_DEFAULTS.indexing };
  } else {
    s.indexing = { ...SETTINGS_DEFAULTS.indexing, ...s.indexing };
    if (!["low", "medium", "high"].includes(s.indexing.intensity)) s.indexing.intensity = "medium";
    if (typeof s.indexing.enabled !== "boolean") s.indexing.enabled = true;
    if (!Array.isArray(s.indexing.excludedDirs)) s.indexing.excludedDirs = [...SETTINGS_DEFAULTS.indexing.excludedDirs];
    if (!Array.isArray(s.indexing.codeExtensions)) s.indexing.codeExtensions = [...SETTINGS_DEFAULTS.indexing.codeExtensions];
    s.indexing.maxFileSizeKB = clamp(s.indexing.maxFileSizeKB, 50, 2000);
    s.indexing.stalenessIntervalMin = clamp(s.indexing.stalenessIntervalMin, 1, 60);
  }

  // Validate customAgents
  if (!Array.isArray(s.customAgents)) {
    s.customAgents = [];
  } else {
    s.customAgents = s.customAgents.filter(
      (a: any) => a && typeof a === "object" && typeof a.id === "string" && typeof a.name === "string"
    ).map((a: any) => ({
      id: a.id,
      name: a.name || "",
      description: a.description || "",
      systemPrompt: a.systemPrompt || "",
      prompt: a.prompt || "",
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || "claude-haiku-4-5-20251001",
      thinking: typeof a.thinking === "boolean" ? a.thinking : false,
      effort: ["low", "medium", "high"].includes(a.effort) ? a.effort : "medium",
      rating: typeof a.rating === "number" && !isNaN(a.rating) ? Math.max(0, Math.min(10, a.rating)) : 10,
      ratingLog: Array.isArray(a.ratingLog) ? a.ratingLog.filter((x: any) => typeof x === "string").slice(0, 10) : [],
    }));
  }

  // Spellcheck
  if (!s.spellcheck || typeof s.spellcheck !== "object") {
    s.spellcheck = { ...SETTINGS_DEFAULTS.spellcheck };
  } else {
    s.spellcheck = { ...SETTINGS_DEFAULTS.spellcheck, ...s.spellcheck };
    if (typeof s.spellcheck.enabled !== "boolean") s.spellcheck.enabled = true;
    if (!Array.isArray(s.spellcheck.languages)) s.spellcheck.languages = ["ru", "en"];
    if (!Array.isArray(s.spellcheck.userDictionary)) s.spellcheck.userDictionary = [];
  }

  // History
  if (!s.history || typeof s.history !== "object") {
    s.history = { ...SETTINGS_DEFAULTS.history };
  } else {
    s.history = { ...SETTINGS_DEFAULTS.history, ...s.history };
    s.history.historyRetainDays = clamp(s.history.historyRetainDays, 0, 365);
    s.history.maxSnapshotsPerSection = clamp(s.history.maxSnapshotsPerSection, 1, 100);
    s.history.snapshotMaxAgeDays = clamp(s.history.snapshotMaxAgeDays, 1, 365);
    s.history.snapshotCoalesceIntervalSec = clamp(s.history.snapshotCoalesceIntervalSec, 5, 300);
  }

  // Model tiers
  if (!s.modelTiers || typeof s.modelTiers !== "object") {
    s.modelTiers = { ...SETTINGS_DEFAULTS.modelTiers };
  } else {
    for (const tier of MODEL_TIER_KEYS) {
      if (!s.modelTiers[tier] || typeof s.modelTiers[tier] !== "object") {
        s.modelTiers[tier] = { ...SETTINGS_DEFAULTS.modelTiers[tier] };
      } else {
        const t = s.modelTiers[tier];
        if (!t.providerScript || typeof t.providerScript !== "object") {
          t.providerScript = { ...SETTINGS_DEFAULTS.modelTiers[tier].providerScript };
        }
        if (typeof t.modelId !== "string") t.modelId = SETTINGS_DEFAULTS.modelTiers[tier].modelId;
        if (typeof t.baseUrl !== "string") t.baseUrl = SETTINGS_DEFAULTS.modelTiers[tier].baseUrl;
        if (typeof t.apiKey !== "string") t.apiKey = "";
        if (!["low", "medium", "high"].includes(t.effort)) t.effort = SETTINGS_DEFAULTS.modelTiers[tier].effort;
        if (typeof t.thinking !== "boolean") t.thinking = SETTINGS_DEFAULTS.modelTiers[tier].thinking;
        t.thinkingBudget = clamp(t.thinkingBudget ?? SETTINGS_DEFAULTS.modelTiers[tier].thinkingBudget, 1000, 100000);
        t.maxTokens = clamp(t.maxTokens ?? SETTINGS_DEFAULTS.modelTiers[tier].maxTokens, 256, 65536);
        t.temperature = clamp(t.temperature ?? SETTINGS_DEFAULTS.modelTiers[tier].temperature, 0, 2);
      }
    }
    for (const tierKey of ["chatTier", "passportTier", "summaryTier"] as const) {
      if (!["strong", "medium", "weak"].includes(s.modelTiers[tierKey])) {
        s.modelTiers[tierKey] = SETTINGS_DEFAULTS.modelTiers[tierKey];
      }
    }
  }

  if (typeof s.autoVerifyPlan !== "boolean") s.autoVerifyPlan = true;
  if (typeof s.showIconProgress !== "boolean") s.showIconProgress = true;
  if (!Array.isArray(s.progressStages) || s.progressStages.length < 2) {
    s.progressStages = [...SETTINGS_DEFAULTS.progressStages];
  }
  if (typeof s.devMode !== "boolean") s.devMode = false;
  if (typeof s.devTrackToolIssues !== "boolean") s.devTrackToolIssues = false;
  if (typeof s.devToolFeedback !== "boolean") s.devToolFeedback = false;

  s._version = typeof s._version === "number" ? s._version : 0;

  return s;
}
