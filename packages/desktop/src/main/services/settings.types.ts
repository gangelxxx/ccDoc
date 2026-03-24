// ─── Settings types ─────────────────────────────────────────
// INVARIANT: Settings is max 2 levels deep — deepPatch relies on this.

// SYNC: duplicated in renderer/stores/llm-config.ts (separate build targets)
export interface LlmConfigData {
  model: string;
  effort: "low" | "medium" | "high";
  thinking: boolean;
  inheritFromParent?: boolean;
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

export interface Settings {
  // UI
  theme: "light" | "dark";
  language: string;
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
  // Voice STT
  voiceModelId: string;
  // Developer mode
  devMode: boolean;
  devTrackToolIssues: boolean;
  // Version (0 = not migrated yet)
  _version: number;
}

// ─── Defaults ───────────────────────────────────────────────

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const SETTINGS_DEFAULTS: Settings = {
  theme: "light",
  language: "en",
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
  voiceModelId: "",
  devMode: false,
  devTrackToolIssues: false,
  _version: 0,
};

// ─── LLM config keys (for validation iteration) ────────────

export const LLM_CONFIG_KEYS = [
  "llmChat", "llmPassport", "llmSummary",
] as const;

// ─── Validation ─────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  if (typeof val !== "number" || isNaN(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function validateSettings(raw: any): Settings {
  const s = { ...SETTINGS_DEFAULTS, ...raw };

  if (!["light", "dark"].includes(s.theme)) s.theme = "light";
  if (typeof s.language !== "string" || !s.language) s.language = "en";
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

  if (typeof s.devMode !== "boolean") s.devMode = false;
  if (typeof s.devTrackToolIssues !== "boolean") s.devTrackToolIssues = false;

  s._version = typeof s._version === "number" ? s._version : 0;

  return s;
}
