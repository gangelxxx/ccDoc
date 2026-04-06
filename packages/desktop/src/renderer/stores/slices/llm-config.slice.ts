import type { ProgressStage } from "@ccdoc/core";
import type { LlmConfig, SliceCreator, ModelTier, ModelTierConfig, ModelTiersConfig, ModelTestResult, ProviderScriptMeta } from "../types.js";
import type { CustomAgent } from "../llm/types.js";
import { localizeApiError } from "../../i18n.js";
import { toLlmConfigData,
  INITIAL_CHAT_CONFIG, INITIAL_PASSPORT_CONFIG, INITIAL_SUMMARY_CONFIG,
  INITIAL_MODEL_TIERS,
} from "../llm-config.js";

export type WebSearchProvider = "tavily" | "brave" | "none";

export interface LlmConfigSlice {
  llmApiKey: string;
  setLlmApiKey: (key: string) => void;
  hasLlmAccess: () => boolean;
  llmModels: { id: string; display_name: string }[];
  llmModelsLoading: boolean;
  llmModelsError: string | null;
  fetchLlmModels: (apiKey?: string) => Promise<void>;
  llmChatConfig: LlmConfig;
  setLlmChatConfig: (cfg: Partial<LlmConfig>) => void;
  llmPassportConfig: LlmConfig;
  setLlmPassportConfig: (cfg: Partial<LlmConfig>) => void;
  llmSummaryConfig: LlmConfig;
  setLlmSummaryConfig: (cfg: Partial<LlmConfig>) => void;
  webSearchProvider: WebSearchProvider;
  webSearchApiKey: string;
  setWebSearchProvider: (provider: WebSearchProvider) => void;
  setWebSearchApiKey: (key: string) => void;
  // Model tiers
  modelTiers: ModelTiersConfig;
  setModelTier: (tier: ModelTier, config: Partial<ModelTierConfig>) => void;
  setTierAssignment: (key: "chatTier" | "passportTier" | "summaryTier", tier: ModelTier) => void;
  testModelTier: (tier: ModelTier) => Promise<ModelTestResult[]>;
  modelTestResults: Record<ModelTier, ModelTestResult[] | null>;
  modelTestLoading: Record<ModelTier, boolean>;
  fetchTierModels: (tier: ModelTier) => Promise<{ id: string; name: string }[]>;
  builtinScripts: ProviderScriptMeta[];
  loadBuiltinScripts: () => Promise<void>;
  // Custom agents
  customAgents: CustomAgent[];
  setCustomAgents: (agents: CustomAgent[]) => void;
  addCustomAgent: (agent: CustomAgent) => void;
  updateCustomAgent: (id: string, updates: Partial<CustomAgent>) => void;
  deleteCustomAgent: (id: string) => void;
  // Auto-verify plans
  autoVerifyPlan: boolean;
  setAutoVerifyPlan: (v: boolean) => void;
  // Icon progress on taskbar/dock
  showIconProgress: boolean;
  setShowIconProgress: (v: boolean) => void;
  // Progress stages
  progressStages: ProgressStage[];
  setProgressStages: (stages: ProgressStage[]) => void;
  // Developer mode
  devMode: boolean;
  devTrackToolIssues: boolean;
  setDevMode: (v: boolean) => void;
  setDevTrackToolIssues: (v: boolean) => void;
}

export const createLlmConfigSlice: SliceCreator<LlmConfigSlice> = (set, get) => ({
  llmApiKey: "", // overwritten by boot
  setLlmApiKey: (key) => {
    const cleaned = key.trim().replace(/[^\x20-\x7E]/g, "");
    set({ llmApiKey: cleaned });
    window.api.settingsPatch({ llmApiKey: cleaned }, "llm:apiKey");
  },
  hasLlmAccess: () => {
    const s = get();
    // Check legacy key
    if (s.llmApiKey) return true;
    // Check any tier has a key or uses a keyless provider (ollama)
    const tiers = s.modelTiers;
    const KEYLESS = ["ollama"];
    for (const t of ["strong", "medium", "weak"] as const) {
      if (tiers[t].apiKey) return true;
      if (KEYLESS.includes(tiers[t].providerScript.builtinId || "")) return true;
    }
    return false;
  },
  llmModels: [],
  llmModelsLoading: false,
  llmModelsError: null as string | null,
  fetchLlmModels: async () => {
    if (!get().hasLlmAccess()) return;
    set({ llmModelsLoading: true, llmModelsError: null });
    try {
      const tiers = get().modelTiers;
      const tierConfig = tiers[tiers.chatTier];
      const models = await window.api.llmTierListModels(tierConfig);
      // Map { id, name } → { id, display_name } for compatibility
      set({ llmModels: models.map((m: any) => ({ id: m.id, display_name: m.name || m.id })) });
    } catch (e: any) {
      const raw = e?.message || String(e);
      const msg = localizeApiError(get().language, raw);
      console.error("[fetchLlmModels]", e);
      set({ llmModelsError: msg });
      get().addToast("error", "Models", msg);
    } finally {
      set({ llmModelsLoading: false });
    }
  },
  llmChatConfig: INITIAL_CHAT_CONFIG, // overwritten by boot
  setLlmChatConfig: (cfg) => {
    set((s) => ({ llmChatConfig: { ...s.llmChatConfig, ...cfg } }));
    window.api.settingsPatch({ llmChat: toLlmConfigData(cfg) }, "llm:chatConfig");
  },
  llmPassportConfig: INITIAL_PASSPORT_CONFIG,
  setLlmPassportConfig: (cfg) => {
    set((s) => ({ llmPassportConfig: { ...s.llmPassportConfig, ...cfg } }));
    window.api.settingsPatch({ llmPassport: toLlmConfigData(cfg) }, "llm:passportConfig");
  },
  llmSummaryConfig: INITIAL_SUMMARY_CONFIG,
  setLlmSummaryConfig: (cfg) => {
    set((s) => ({ llmSummaryConfig: { ...s.llmSummaryConfig, ...cfg } }));
    window.api.settingsPatch({ llmSummary: toLlmConfigData(cfg) }, "llm:summaryConfig");
  },
  // Model tiers
  modelTiers: INITIAL_MODEL_TIERS as ModelTiersConfig, // overwritten by boot
  setModelTier: (tier, config) => {
    set((s) => {
      const updated = { ...s.modelTiers, [tier]: { ...s.modelTiers[tier], ...config } };
      window.api.settingsPatch({ modelTiers: updated }, `tiers:${tier}`);
      return { modelTiers: updated };
    });
  },
  setTierAssignment: (key, tier) => {
    set((s) => {
      const updated = { ...s.modelTiers, [key]: tier };
      window.api.settingsPatch({ modelTiers: updated }, `tiers:${key}`);
      return { modelTiers: updated };
    });
  },
  testModelTier: async (tier) => {
    set((s) => ({
      modelTestLoading: { ...s.modelTestLoading, [tier]: true },
      modelTestResults: { ...s.modelTestResults, [tier]: null },
    }));
    try {
      const results = await window.api.llmTestModel(get().modelTiers[tier]);
      set((s) => ({
        modelTestResults: { ...s.modelTestResults, [tier]: results },
      }));
      return results;
    } catch (e: any) {
      const err = [{ stage: "connection" as const, success: false, latencyMs: 0, error: e.message }];
      set((s) => ({ modelTestResults: { ...s.modelTestResults, [tier]: err } }));
      return err;
    } finally {
      set((s) => ({ modelTestLoading: { ...s.modelTestLoading, [tier]: false } }));
    }
  },
  modelTestResults: { strong: null, medium: null, weak: null },
  modelTestLoading: { strong: false, medium: false, weak: false },
  fetchTierModels: async (tier) => {
    const config = get().modelTiers[tier];
    try {
      return await window.api.llmTierListModels(config);
    } catch (e) {
      console.error(`[fetchTierModels] ${tier}:`, e);
      return [];
    }
  },
  builtinScripts: [],
  loadBuiltinScripts: async () => {
    try {
      const scripts = await window.api.llmBuiltinScripts();
      set({ builtinScripts: scripts });
    } catch (e) {
      console.error("[loadBuiltinScripts]", e);
    }
  },

  webSearchProvider: "none" as WebSearchProvider, // overwritten by boot
  webSearchApiKey: "", // overwritten by boot
  setWebSearchProvider: (provider) => {
    set({ webSearchProvider: provider });
    window.api.settingsPatch({ webSearchProvider: provider }, "llm:webSearchProvider");
  },
  setWebSearchApiKey: (key) => {
    const cleaned = key.trim().replace(/[^\x20-\x7E]/g, "");
    set({ webSearchApiKey: cleaned });
    window.api.settingsPatch({ webSearchApiKey: cleaned }, "llm:webSearchApiKey");
  },
  // Custom agents
  customAgents: [], // overwritten by boot
  setCustomAgents: (agents) => {
    set({ customAgents: agents });
    window.api.settingsPatch({ customAgents: agents }, "agents:set");
  },
  addCustomAgent: (agent) => {
    const next = [...get().customAgents, agent];
    set({ customAgents: next });
    window.api.settingsPatch({ customAgents: next }, "agents:add");
  },
  updateCustomAgent: (id, updates) => {
    const next = get().customAgents.map(a => a.id === id ? { ...a, ...updates } : a);
    set({ customAgents: next });
    window.api.settingsPatch({ customAgents: next }, "agents:update");
  },
  deleteCustomAgent: (id) => {
    const next = get().customAgents.filter(a => a.id !== id);
    set({ customAgents: next });
    window.api.settingsPatch({ customAgents: next }, "agents:delete");
  },
  // Auto-verify plans
  autoVerifyPlan: true, // overwritten by boot
  setAutoVerifyPlan: (v) => {
    set({ autoVerifyPlan: v });
    window.api.settingsPatch({ autoVerifyPlan: v }, "settings:autoVerifyPlan");
  },
  // Icon progress
  showIconProgress: true, // overwritten by boot
  setShowIconProgress: (v) => {
    set({ showIconProgress: v });
    window.api.settingsPatch({ showIconProgress: v }, "settings:showIconProgress");
  },
  // Progress stages
  progressStages: [] as ProgressStage[], // overwritten by boot
  setProgressStages: (stages) => {
    set({ progressStages: stages });
    window.api.settingsPatch({ progressStages: stages }, "settings:progressStages");
  },
  // Developer mode
  devMode: false, // overwritten by boot
  devTrackToolIssues: false, // overwritten by boot
  devToolFeedback: false, // overwritten by boot
  setDevMode: (v) => {
    set({ devMode: v });
    window.api.settingsPatch({ devMode: v }, "dev:mode");
  },
  setDevTrackToolIssues: (v) => {
    set({ devTrackToolIssues: v });
    window.api.settingsPatch({ devTrackToolIssues: v }, "dev:trackToolIssues");
  },
  setDevToolFeedback: (v) => {
    set({ devToolFeedback: v });
    window.api.settingsPatch({ devToolFeedback: v }, "dev:toolFeedback");
  },
});
