import type { LlmConfig, SliceCreator } from "../types.js";
import type { CustomAgent } from "../llm/types.js";
import { localizeApiError } from "../../i18n.js";
import { toLlmConfigData,
  INITIAL_CHAT_CONFIG, INITIAL_PASSPORT_CONFIG, INITIAL_SUMMARY_CONFIG,
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
  webSearchProvider: WebSearchProvider;
  webSearchApiKey: string;
  setWebSearchProvider: (provider: WebSearchProvider) => void;
  setWebSearchApiKey: (key: string) => void;
  // Custom agents
  customAgents: CustomAgent[];
  setCustomAgents: (agents: CustomAgent[]) => void;
  addCustomAgent: (agent: CustomAgent) => void;
  updateCustomAgent: (id: string, updates: Partial<CustomAgent>) => void;
  deleteCustomAgent: (id: string) => void;
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
  // Custom agents
  customAgents: [], // overwritten by boot
  setCustomAgents: (agents) => {
    set({ customAgents: agents });
    window.api.settingsPatch({ customAgents: agents });
  },
  addCustomAgent: (agent) => {
    const next = [...get().customAgents, agent];
    set({ customAgents: next });
    window.api.settingsPatch({ customAgents: next });
  },
  updateCustomAgent: (id, updates) => {
    const next = get().customAgents.map(a => a.id === id ? { ...a, ...updates } : a);
    set({ customAgents: next });
    window.api.settingsPatch({ customAgents: next });
  },
  deleteCustomAgent: (id) => {
    const next = get().customAgents.filter(a => a.id !== id);
    set({ customAgents: next });
    window.api.settingsPatch({ customAgents: next });
  },
  // Developer mode
  devMode: false, // overwritten by boot
  devTrackToolIssues: false, // overwritten by boot
  setDevMode: (v) => {
    set({ devMode: v });
    window.api.settingsPatch({ devMode: v });
  },
  setDevTrackToolIssues: (v) => {
    set({ devTrackToolIssues: v });
    window.api.settingsPatch({ devTrackToolIssues: v });
  },
});
