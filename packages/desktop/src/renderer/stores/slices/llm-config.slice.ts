import type { LlmConfig, SliceCreator } from "../types.js";
import { localizeApiError } from "../../i18n.js";
import { toLlmConfigData,
  INITIAL_CHAT_CONFIG, INITIAL_PASSPORT_CONFIG, INITIAL_SUMMARY_CONFIG,
  INITIAL_RESEARCH_CONFIG, INITIAL_WRITER_CONFIG, INITIAL_CRITIC_CONFIG, INITIAL_PLANNER_CONFIG,
} from "../llm-config.js";

export type WebSearchProvider = "tavily" | "brave" | "none";

export interface LlmConfigSlice {
  llmApiKey: string;
  setLlmApiKey: (key: string) => void;
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
  llmResearchConfig: LlmConfig;
  setLlmResearchConfig: (cfg: Partial<LlmConfig>) => void;
  llmWriterConfig: LlmConfig;
  setLlmWriterConfig: (cfg: Partial<LlmConfig>) => void;
  llmCriticConfig: LlmConfig;
  setLlmCriticConfig: (cfg: Partial<LlmConfig>) => void;
  llmPlannerConfig: LlmConfig;
  setLlmPlannerConfig: (cfg: Partial<LlmConfig>) => void;
  useSubAgents: boolean;
  setUseSubAgents: (enabled: boolean) => void;
  webSearchProvider: WebSearchProvider;
  webSearchApiKey: string;
  setWebSearchProvider: (provider: WebSearchProvider) => void;
  setWebSearchApiKey: (key: string) => void;
}

export const createLlmConfigSlice: SliceCreator<LlmConfigSlice> = (set, get) => ({
  llmApiKey: "", // overwritten by boot
  setLlmApiKey: (key) => {
    const cleaned = key.trim().replace(/[^\x20-\x7E]/g, "");
    set({ llmApiKey: cleaned });
    window.api.settingsPatch({ llmApiKey: cleaned });
  },
  llmModels: [],
  llmModelsLoading: false,
  llmModelsError: null as string | null,
  fetchLlmModels: async (apiKey) => {
    const key = apiKey || get().llmApiKey;
    if (!key) return;
    set({ llmModelsLoading: true, llmModelsError: null });
    try {
      const models = await window.api.llmModels(key);
      set({ llmModels: models });
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
    window.api.settingsPatch({ llmChat: toLlmConfigData(cfg) });
  },
  llmPassportConfig: INITIAL_PASSPORT_CONFIG,
  setLlmPassportConfig: (cfg) => {
    set((s) => ({ llmPassportConfig: { ...s.llmPassportConfig, ...cfg } }));
    window.api.settingsPatch({ llmPassport: toLlmConfigData(cfg) });
  },
  llmSummaryConfig: INITIAL_SUMMARY_CONFIG,
  setLlmSummaryConfig: (cfg) => {
    set((s) => ({ llmSummaryConfig: { ...s.llmSummaryConfig, ...cfg } }));
    window.api.settingsPatch({ llmSummary: toLlmConfigData(cfg) });
  },
  llmResearchConfig: INITIAL_RESEARCH_CONFIG,
  setLlmResearchConfig: (cfg) => {
    set((s) => ({ llmResearchConfig: { ...s.llmResearchConfig, ...cfg } }));
    window.api.settingsPatch({ llmResearch: toLlmConfigData(cfg) });
  },
  llmWriterConfig: INITIAL_WRITER_CONFIG,
  setLlmWriterConfig: (cfg) => {
    set((s) => ({ llmWriterConfig: { ...s.llmWriterConfig, ...cfg } }));
    window.api.settingsPatch({ llmWriter: toLlmConfigData(cfg) });
  },
  llmCriticConfig: INITIAL_CRITIC_CONFIG,
  setLlmCriticConfig: (cfg) => {
    set((s) => ({ llmCriticConfig: { ...s.llmCriticConfig, ...cfg } }));
    window.api.settingsPatch({ llmCritic: toLlmConfigData(cfg) });
  },
  llmPlannerConfig: INITIAL_PLANNER_CONFIG,
  setLlmPlannerConfig: (cfg) => {
    set((s) => ({ llmPlannerConfig: { ...s.llmPlannerConfig, ...cfg } }));
    window.api.settingsPatch({ llmPlanner: toLlmConfigData(cfg) });
  },
  useSubAgents: true, // overwritten by boot
  setUseSubAgents: (enabled) => {
    set({ useSubAgents: enabled });
    window.api.settingsPatch({ useSubAgents: enabled });
  },
  webSearchProvider: "none" as WebSearchProvider, // overwritten by boot
  webSearchApiKey: "", // overwritten by boot
  setWebSearchProvider: (provider) => {
    set({ webSearchProvider: provider });
    window.api.settingsPatch({ webSearchProvider: provider });
  },
  setWebSearchApiKey: (key) => {
    const cleaned = key.trim().replace(/[^\x20-\x7E]/g, "");
    set({ webSearchApiKey: cleaned });
    window.api.settingsPatch({ webSearchApiKey: cleaned });
  },
});
