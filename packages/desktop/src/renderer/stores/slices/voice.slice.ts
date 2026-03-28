import type { SliceCreator } from "../types.js";

export type VoiceModelStatus = "none" | "partial" | "ready";

export interface VoiceSlice {
  voiceModelId: string;
  setVoiceModelId: (id: string) => void;
  voiceStatuses: Record<string, VoiceModelStatus>;
  voiceDownloading: string | null;
  voiceProgress: number;
  voiceCancelling: boolean;
  voiceErrors: Record<string, string>;
  voiceTranscribing: boolean;
  fetchVoiceStatuses: () => Promise<void>;
  initVoiceProgressListener: () => (() => void) | void;
  startVoiceDownload: (modelId: string) => void;
  cancelVoiceDownload: () => void;
  deleteVoiceModel: (modelId: string) => Promise<void>;
  transcribeAudio: (audio: Float32Array) => Promise<string>;
}

export const createVoiceSlice: SliceCreator<VoiceSlice> = (set, get) => ({
  voiceModelId: "", // overwritten by boot
  voiceStatuses: {},
  voiceDownloading: null,
  voiceProgress: 0,
  voiceCancelling: false,
  voiceErrors: {},
  voiceTranscribing: false,

  setVoiceModelId: (id) => {
    set({ voiceModelId: id });
    window.api.settingsPatch({ voiceModelId: id });
  },

  fetchVoiceStatuses: async () => {
    try {
      const result = await window.api.getVoiceStatus();
      set({ voiceStatuses: result?.statuses ?? {} });
    } catch (e) {
      console.error("[fetchVoiceStatuses]", e);
    }
  },

  initVoiceProgressListener: () => {
    return window.api.onVoiceProgress((data: any) => {
      const modelId = data.modelId;
      if (!modelId) return;
      if (data.done) {
        set((s) => {
          const errs = { ...s.voiceErrors };
          delete errs[modelId];
          return {
            voiceDownloading: null,
            voiceProgress: 0,
            voiceCancelling: false,
            voiceErrors: errs,
            voiceStatuses: { ...s.voiceStatuses, [modelId]: "ready" as VoiceModelStatus },
          };
        });
      } else if (data.cancelled) {
        set((s) => ({
          voiceDownloading: null,
          voiceProgress: 0,
          voiceCancelling: false,
          // Mark as partial since files may have been partially downloaded
          voiceStatuses: { ...s.voiceStatuses, [modelId]: "partial" as VoiceModelStatus },
        }));
      } else if (data.error) {
        set((s) => ({
          voiceDownloading: null,
          voiceProgress: 0,
          voiceCancelling: false,
          voiceErrors: { ...s.voiceErrors, [modelId]: data.error },
        }));
      } else if (typeof data.percent === "number") {
        set({ voiceProgress: data.percent });
      }
    });
  },

  startVoiceDownload: (modelId) => {
    set((s) => {
      const errs = { ...s.voiceErrors };
      delete errs[modelId];
      return { voiceDownloading: modelId, voiceProgress: 0, voiceCancelling: false, voiceErrors: errs };
    });
    window.api.downloadVoiceModel(modelId).catch((err: any) => {
      set((s) => ({
        voiceDownloading: null,
        voiceProgress: 0,
        voiceErrors: { ...s.voiceErrors, [modelId]: err?.message || String(err) },
      }));
    });
  },

  cancelVoiceDownload: () => {
    const modelId = get().voiceDownloading;
    if (modelId) window.api.cancelVoiceDownload(modelId);
  },

  deleteVoiceModel: async (modelId) => {
    await window.api.deleteVoiceModel(modelId);
    const s = get();
    set({
      voiceStatuses: { ...s.voiceStatuses, [modelId]: "none" as VoiceModelStatus },
      voiceModelId: s.voiceModelId === modelId ? "" : s.voiceModelId,
    });
    if (s.voiceModelId === modelId) {
      window.api.settingsPatch({ voiceModelId: "" });
    }
  },

  transcribeAudio: async (audio) => {
    const modelId = get().voiceModelId;
    if (!modelId) throw new Error("No voice model selected");
    const language = get().language; // "ru" or "en"
    set({ voiceTranscribing: true });
    try {
      const text = await window.api.transcribeVoice({ audio, modelId, language });
      return text;
    } finally {
      set({ voiceTranscribing: false });
    }
  },
});
