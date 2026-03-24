import type { HistoryCommit, SliceCreator } from "../types.js";

export interface RestoreProgress {
  current: number;
  total: number;
  title: string;
}

export interface HistorySlice {
  history: HistoryCommit[];
  restoreProgress: RestoreProgress | null;
  commitVersion: (message: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  restoreVersion: (commitId: string) => Promise<void>;
  deleteHistoryCommit: (commitId: string) => Promise<void>;

  // History viewer
  historyViewCommit: HistoryCommit | null;
  historyViewSections: { id: string; parent_id: string | null; title: string; type: string; sort_key: string; icon: string | null }[];
  historyViewSectionId: string | null;
  historyViewContent: { title: string; content: string } | null;
  historyViewCurrentContent: string | null;
  historyDiffIds: { added: string[]; removed: string[]; changed: string[] } | null;
  viewCommit: (commit: HistoryCommit) => Promise<void>;
  viewCommitSection: (sectionId: string) => Promise<void>;
  closeHistoryView: () => void;
}

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  history: [],
  restoreProgress: null,

  commitVersion: async (message) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const oid = await window.api.commitVersion(currentProject.token, message);
      if (!oid) {
        get().addToast("info", "Nothing to save", "No sections to commit");
        return;
      }
      await get().loadHistory();
      get().addToast("success", "Version saved", message);
    } catch (e: any) {
      get().addToast("error", "Failed to save version", e.message);
    }
  },

  loadHistory: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const history = await window.api.getHistory(currentProject.token);
      set({ history });
    } catch (e: any) {
      get().addToast("error", "Failed to load history", e.message);
    }
  },

  restoreVersion: async (commitId) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ treeLoading: true, restoreProgress: { current: 0, total: 0, title: "" } });
    const cleanup = window.api.onRestoreProgress((data) => {
      set({ restoreProgress: data });
    });
    try {
      await window.api.restoreVersion(currentProject.token, commitId);
      await get().loadTree();
      set({ currentSection: null });
      get().addToast("success", "Version restored");
    } catch (e: any) {
      get().addToast("error", "Failed to restore version", e.message);
    } finally {
      cleanup();
      set({ treeLoading: false, restoreProgress: null });
    }
  },

  deleteHistoryCommit: async (commitId) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      await window.api.deleteHistoryCommit(currentProject.token, commitId);
      await get().loadHistory();
    } catch (e: any) {
      get().addToast("error", "Failed to delete commit", e.message);
    }
  },

  // History viewer
  historyViewCommit: null,
  historyViewSections: [],
  historyViewSectionId: null,
  historyViewContent: null,
  historyViewCurrentContent: null,
  historyDiffIds: null,

  viewCommit: async (commit) => {
    const { currentProject } = get();
    if (!currentProject) return;
    // Reset view immediately so UI reflects the new commit
    set({
      historyViewCommit: commit,
      historyViewSectionId: null,
      historyViewContent: null,
      historyViewCurrentContent: null,
      historyViewSections: [],
      historyDiffIds: null,
    });
    try {
      const [sections, diffIds] = await Promise.all([
        window.api.getHistoryStructure(currentProject.token, commit.oid),
        window.api.getHistoryDiffIds(currentProject.token, commit.oid),
      ]);
      set({
        historyViewSections: sections.map((s: any) => ({ id: s.id, parent_id: s.parent_id, title: s.title, type: s.type, sort_key: s.sort_key, icon: s.icon })),
        historyDiffIds: diffIds,
      });
    } catch (e: any) {
      get().addToast("error", "Failed to load version", e.message);
    }
  },

  viewCommitSection: async (sectionId) => {
    const { currentProject, historyViewCommit } = get();
    if (!currentProject || !historyViewCommit) return;
    set({ historyViewSectionId: sectionId, historyViewContent: null, historyViewCurrentContent: null });
    try {
      const [versionContent, currentContent] = await Promise.all([
        window.api.getSectionAtVersion(currentProject.token, sectionId, historyViewCommit.oid).catch(() => null),
        window.api.getSectionContent(currentProject.token, sectionId, "markdown").catch(() => null),
      ]);
      set({
        historyViewContent: versionContent || { title: "", content: "" },
        historyViewCurrentContent: typeof currentContent === "string" ? currentContent : null,
      });
    } catch (e: any) {
      get().addToast("error", "Failed to load section version", e.message);
    }
  },

  closeHistoryView: () => {
    set({
      historyViewCommit: null,
      historyViewSections: [],
      historyViewSectionId: null,
      historyViewContent: null,
      historyViewCurrentContent: null,
      historyDiffIds: null,
    });
  },
});
