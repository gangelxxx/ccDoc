import type { EmbeddingConfig, EmbeddingMode, OnlineProvider, SliceCreator } from "../types.js";

const INITIAL_EMBEDDING_CONFIG: EmbeddingConfig = {
  mode: "none" as EmbeddingMode,
  localModelId: "multilingual-e5-small",
  onlineProvider: "openai" as OnlineProvider,
  onlineModel: "text-embedding-3-small",
  onlineApiKey: "",
}; // overwritten by boot

export interface EmbeddingSlice {
  embeddingConfig: EmbeddingConfig;
  setEmbeddingConfig: (cfg: Partial<EmbeddingConfig>) => void;
  embeddingStatuses: Record<string, "none" | "partial" | "ready">;
  embeddingDownloading: Record<string, number>;
  embeddingCancelling: Record<string, boolean>;
  embeddingErrors: Record<string, string>;
  embeddingBgTaskIds: Record<string, string>;
  fetchEmbeddingStatus: () => Promise<void>;
  initEmbeddingProgressListener: () => (() => void) | void;
  startEmbeddingDownload: (modelId: string) => void;
  cancelEmbeddingDownload: (modelId: string) => void;
  deleteEmbeddingModel: (modelId: string) => Promise<void>;
}

export const createEmbeddingSlice: SliceCreator<EmbeddingSlice> = (set, get) => ({
  embeddingConfig: INITIAL_EMBEDDING_CONFIG,
  embeddingStatuses: {},
  embeddingDownloading: {},
  embeddingCancelling: {},
  embeddingErrors: {},
  embeddingBgTaskIds: {},

  setEmbeddingConfig: (cfg) => {
    const prev = get().embeddingConfig;
    const next = { ...prev, ...cfg };
    set({ embeddingConfig: next });
    window.api.settingsPatch({ embedding: next });
    // Hot-swap: notify main process if mode or model changed
    const modeChanged = prev.mode !== next.mode;
    const modelChanged = prev.localModelId !== next.localModelId || prev.onlineModel !== next.onlineModel || prev.onlineProvider !== next.onlineProvider;
    const keyChanged = prev.onlineApiKey !== next.onlineApiKey;
    if (modeChanged || modelChanged || keyChanged) {
      window.api.applyEmbeddingConfig();
    }
  },

  fetchEmbeddingStatus: async () => {
    try {
      const result = await window.api.getEmbeddingStatus();
      set({ embeddingStatuses: result?.statuses ?? {} });
    } catch (e) {
      console.error("[fetchEmbeddingStatus]", e);
    }
  },

  initEmbeddingProgressListener: () => {
    return window.api.onEmbeddingProgress((data: any) => {
      const modelId = data.modelId;
      if (!modelId) return;
      const clearActive = (s: any) => {
        const dl = { ...s.embeddingDownloading };
        delete dl[modelId];
        const ca = { ...s.embeddingCancelling };
        delete ca[modelId];
        const bgTaskId = s.embeddingBgTaskIds[modelId];
        const ids = { ...s.embeddingBgTaskIds };
        delete ids[modelId];
        const bgTasks = bgTaskId ? s.bgTasks.filter((t: any) => t.id !== bgTaskId) : s.bgTasks;
        return { dl, ca, ids, bgTasks };
      };
      if (data.done) {
        set((s) => {
          const { dl, ca, ids, bgTasks } = clearActive(s);
          return { embeddingDownloading: dl, embeddingCancelling: ca, embeddingStatuses: { ...s.embeddingStatuses, [modelId]: "ready" }, bgTasks, embeddingBgTaskIds: ids };
        });
      } else if (data.cancelled) {
        set((s) => {
          const { dl, ca, ids, bgTasks } = clearActive(s);
          return { embeddingDownloading: dl, embeddingCancelling: ca, embeddingStatuses: { ...s.embeddingStatuses, [modelId]: "partial" }, bgTasks, embeddingBgTaskIds: ids };
        });
      } else if (data.error) {
        set((s) => {
          const { dl, ca, ids, bgTasks } = clearActive(s);
          return { embeddingDownloading: dl, embeddingCancelling: ca, embeddingErrors: { ...s.embeddingErrors, [modelId]: data.error }, bgTasks, embeddingBgTaskIds: ids };
        });
      } else if (typeof data.percent === "number") {
        set((s) => ({ embeddingDownloading: { ...s.embeddingDownloading, [modelId]: data.percent } }));
      }
    });
  },

  startEmbeddingDownload: (modelId) => {
    set((s) => {
      const errs = { ...s.embeddingErrors };
      delete errs[modelId];
      return { embeddingDownloading: { ...s.embeddingDownloading, [modelId]: 0 }, embeddingErrors: errs };
    });
    const bgTaskId = get().startBgTask(`Загрузка ${modelId}`);
    set((s) => ({ embeddingBgTaskIds: { ...s.embeddingBgTaskIds, [modelId]: bgTaskId } }));
    window.api.downloadEmbeddingModel(modelId).catch((err: any) => {
      set((s) => {
        const dl = { ...s.embeddingDownloading };
        delete dl[modelId];
        const ids = { ...s.embeddingBgTaskIds };
        const tid = ids[modelId];
        delete ids[modelId];
        const bgTasks = tid ? s.bgTasks.filter(t => t.id !== tid) : s.bgTasks;
        return { embeddingDownloading: dl, embeddingErrors: { ...s.embeddingErrors, [modelId]: err?.message || String(err) }, bgTasks, embeddingBgTaskIds: ids };
      });
    });
  },

  cancelEmbeddingDownload: (modelId) => {
    window.api.cancelEmbeddingDownload(modelId);
    set((s) => {
      const bgTaskId = s.embeddingBgTaskIds[modelId];
      const bgTasks = bgTaskId
        ? s.bgTasks.map(t => t.id === bgTaskId ? { ...t, label: `Остановка ${modelId}` } : t)
        : s.bgTasks;
      return { embeddingCancelling: { ...s.embeddingCancelling, [modelId]: true }, bgTasks };
    });
  },

  deleteEmbeddingModel: async (modelId) => {
    await window.api.deleteEmbeddingModel(modelId);
    set((s) => ({
      embeddingStatuses: { ...s.embeddingStatuses, [modelId]: "none" },
      embeddingConfig: s.embeddingConfig.localModelId === modelId && s.embeddingConfig.mode === "local"
        ? { ...s.embeddingConfig, mode: "none" }
        : s.embeddingConfig,
    }));
  },
});
