import type { BackgroundTask, SliceCreator } from "../types.js";

export interface BgTasksSlice {
  bgTasks: BackgroundTask[];
  startBgTask: (label: string) => string;
  finishBgTask: (id: string) => void;
  updateBgTask: (id: string, updates: Partial<Omit<BackgroundTask, "id">>) => void;
  semanticProgressItem: string | null;
  semanticProgressLog: string[];
  onSemanticProgress: (item: string) => void;
  clearSemanticProgress: () => void;
}

export const createBgTasksSlice: SliceCreator<BgTasksSlice> = (set, get) => ({
  bgTasks: [],

  startBgTask: (label) => {
    const id = Math.random().toString(36).slice(2, 10);
    set((s) => ({ bgTasks: [...s.bgTasks, { id, label, startedAt: Date.now() }] }));
    return id;
  },

  finishBgTask: (id) => {
    const task = get().bgTasks.find((t) => t.id === id);
    if (task?.tokens) {
      // Keep task visible for 5s so user can see token counts
      set((s) => ({
        bgTasks: s.bgTasks.map((t) => t.id === id ? { ...t, finishedAt: Date.now() } : t),
      }));
      setTimeout(() => {
        set((s) => ({ bgTasks: s.bgTasks.filter((t) => t.id !== id) }));
      }, 5000);
    } else {
      set((s) => ({ bgTasks: s.bgTasks.filter((t) => t.id !== id) }));
    }
  },

  updateBgTask: (id, updates) => {
    set((s) => ({
      bgTasks: s.bgTasks.map((t) => t.id === id ? { ...t, ...updates } : t),
    }));
  },

  semanticProgressItem: null,
  semanticProgressLog: [],

  onSemanticProgress: (item) => {
    set((s) => ({
      semanticProgressItem: item,
      semanticProgressLog: [...s.semanticProgressLog.slice(-5), item], // keep last 6
    }));
  },

  clearSemanticProgress: () => {
    set({ semanticProgressItem: null, semanticProgressLog: [] });
  },
});
