import type { BackgroundTask, SliceCreator } from "../types.js";

export interface BgTasksSlice {
  bgTasks: BackgroundTask[];
  startBgTask: (label: string) => string;
  finishBgTask: (id: string) => void;
  updateBgTask: (id: string, updates: Partial<Omit<BackgroundTask, "id">>) => void;
  updateBgTaskProgress: (id: string, progress: number) => void;
  summarizingIds: Set<string>;
  addSummarizingId: (id: string) => void;
  removeSummarizingId: (id: string) => void;
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

  updateBgTaskProgress: (id, progress) => {
    const clamped = Math.min(1, Math.max(0, progress));
    set((s) => ({
      bgTasks: s.bgTasks.map((t) =>
        t.id === id ? { ...t, progress: clamped, lastUpdatedAt: Date.now() } : t
      ),
    }));
  },

  summarizingIds: new Set<string>(),
  addSummarizingId: (id) => set((s) => ({ summarizingIds: new Set([...s.summarizingIds, id]) })),
  removeSummarizingId: (id) => set((s) => {
    const next = new Set(s.summarizingIds);
    next.delete(id);
    return { summarizingIds: next };
  }),

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
