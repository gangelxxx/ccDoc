import type { LlmConfig, LlmEffort } from "./types.js";
import { DEFAULT_MODEL } from "../llm-utils.js";

// ─── Effort presets ─────────────────────────────────────────

export const EFFORT_PRESETS: Record<LlmEffort, { maxTokens: number; temperature: number; thinkingBudget: number }> = {
  low:    { maxTokens: 2048,  temperature: 0,   thinkingBudget: 4000 },
  medium: { maxTokens: 16384, temperature: 0.7, thinkingBudget: 10000 },
  high:   { maxTokens: 16384, temperature: 1.0, thinkingBudget: 16000 },
};

export function applyEffort(effort: LlmEffort): Partial<LlmConfig> {
  return { effort, ...EFFORT_PRESETS[effort] };
}

// ─── Settings ↔ LlmConfig converters ────────────────────────

// SYNC: duplicated in main/services/settings.types.ts (separate build targets)
/** Data shape stored in settings.json (no computed fields) */
export interface LlmConfigData {
  model: string;
  effort: "low" | "medium" | "high";
  thinking: boolean;
  inheritFromParent?: boolean;
}

/** Convert settings data → full LlmConfig (applying effort presets) */
export function fromLlmConfigData(data: LlmConfigData | undefined, defaults: LlmConfig): LlmConfig {
  if (!data) return defaults;
  const effort = (["low", "medium", "high"].includes(data.effort) ? data.effort : defaults.effort) as LlmEffort;
  const preset = EFFORT_PRESETS[effort];
  return {
    model: data.model || defaults.model,
    effort,
    maxTokens: preset.maxTokens,
    temperature: preset.temperature,
    thinking: typeof data.thinking === "boolean" ? data.thinking : defaults.thinking,
    thinkingBudget: preset.thinkingBudget,
    inheritFromParent: data.inheritFromParent !== undefined ? data.inheritFromParent : defaults.inheritFromParent,
  };
}

/** Convert partial LlmConfig → data for settings.json */
export function toLlmConfigData(cfg: Partial<LlmConfig>): Partial<LlmConfigData> {
  const data: Partial<LlmConfigData> = {};
  if (cfg.model !== undefined) data.model = cfg.model;
  if (cfg.effort !== undefined) data.effort = cfg.effort;
  if (cfg.thinking !== undefined) data.thinking = cfg.thinking;
  if (cfg.inheritFromParent !== undefined) data.inheritFromParent = cfg.inheritFromParent;
  return data;
}

// ─── Default configs (hardcoded, overwritten by boot) ───────

export const INITIAL_CHAT_CONFIG: LlmConfig = {
  model: "claude-opus-4-6", effort: "medium", maxTokens: 16384, temperature: 0.7, thinking: true, thinkingBudget: 10000,
};

export const INITIAL_PASSPORT_CONFIG: LlmConfig = {
  model: DEFAULT_MODEL, effort: "low", maxTokens: 2048, temperature: 0, thinking: false, thinkingBudget: 4000,
};

export const INITIAL_SUMMARY_CONFIG: LlmConfig = {
  model: DEFAULT_MODEL, effort: "low", maxTokens: 2048, temperature: 0, thinking: false, thinkingBudget: 4000,
};

