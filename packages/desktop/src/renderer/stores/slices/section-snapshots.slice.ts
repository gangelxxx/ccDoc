import type { SliceCreator } from "../types.js";

export interface SectionSnapshotEntry {
  id: string;
  section_id: string;
  title: string;
  type: string;
  source: string;
  created_at: string;
  byte_size: number;
  content?: string;
  /** Child section title (when aggregating for a file) */
  section_title?: string;
}

export interface SectionSnapshotsSlice {
  // State
  snapshotsPanelOpen: boolean;
  snapshotsPanelSectionId: string | null;
  snapshotsPanelSectionTitle: string;
  snapshots: SectionSnapshotEntry[];
  snapshotsLoading: boolean;
  snapshotsHasMore: boolean;
  selectedSnapshotIds: string[];
  diffData: { left: string; right: string; leftLabel: string; rightLabel: string } | null;
  diffLoading: boolean;

  // Actions
  openSnapshotsPanel: (sectionId: string, sectionTitle: string) => void;
  closeSnapshotsPanel: () => void;
  loadSnapshots: (sectionId: string) => Promise<void>;
  loadMoreSnapshots: () => Promise<void>;
  toggleSnapshotSelection: (snapshotId: string) => void;
  clearSnapshotSelection: () => void;
  loadDiff: () => Promise<void>;
  loadDiffWithCurrent: (snapshotId: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
}

const PAGE_SIZE = 30;

export const createSectionSnapshotsSlice: SliceCreator<SectionSnapshotsSlice> = (set, get) => ({
  snapshotsPanelOpen: false,
  snapshotsPanelSectionId: null,
  snapshotsPanelSectionTitle: "",
  snapshots: [],
  snapshotsLoading: false,
  snapshotsHasMore: false,
  selectedSnapshotIds: [],
  diffData: null,
  diffLoading: false,

  openSnapshotsPanel: (sectionId, sectionTitle) => {
    set({
      snapshotsPanelOpen: true,
      snapshotsPanelSectionId: sectionId,
      snapshotsPanelSectionTitle: sectionTitle,
      snapshots: [],
      selectedSnapshotIds: [],
      diffData: null,
    });
    get().loadSnapshots(sectionId);
  },

  closeSnapshotsPanel: () => {
    set({
      snapshotsPanelOpen: false,
      snapshotsPanelSectionId: null,
      snapshotsPanelSectionTitle: "",
      snapshots: [],
      selectedSnapshotIds: [],
      diffData: null,
    });
  },

  loadSnapshots: async (sectionId) => {
    const token = get().currentProject?.token;
    if (!token) return;
    set({ snapshotsLoading: true });
    try {
      console.log(`[snapshots] loading for sectionId=${sectionId.substring(0,8)} token=${token.substring(0,8)}`);
      const items = await window.api.snapshotsList(token, sectionId, PAGE_SIZE, 0);
      console.log(`[snapshots] got ${items.length} items`, items);
      set({
        snapshots: items,
        snapshotsHasMore: items.length >= PAGE_SIZE,
      });
    } catch (e: any) {
      console.error(`[snapshots] load failed:`, e);
      get().addToast("error", "Failed to load snapshots", e.message);
    } finally {
      set({ snapshotsLoading: false });
    }
  },

  loadMoreSnapshots: async () => {
    const token = get().currentProject?.token;
    const sectionId = get().snapshotsPanelSectionId;
    if (!token || !sectionId) return;
    const offset = get().snapshots.length;
    set({ snapshotsLoading: true });
    try {
      const items = await window.api.snapshotsList(token, sectionId, PAGE_SIZE, offset);
      set({
        snapshots: [...get().snapshots, ...items],
        snapshotsHasMore: items.length >= PAGE_SIZE,
      });
    } catch (e: any) {
      get().addToast("error", "Failed to load more snapshots", e.message);
    } finally {
      set({ snapshotsLoading: false });
    }
  },

  toggleSnapshotSelection: (snapshotId) => {
    const current = get().selectedSnapshotIds;
    if (current.length === 1 && current[0] === snapshotId) {
      // Deselect
      set({ selectedSnapshotIds: [], diffData: null });
    } else {
      // Single selection — click selects one, auto-compare with current
      set({ selectedSnapshotIds: [snapshotId], diffData: null });
      get().loadDiffWithCurrent(snapshotId);
    }
  },

  clearSnapshotSelection: () => {
    set({ selectedSnapshotIds: [], diffData: null });
  },

  loadDiff: async () => {
    const token = get().currentProject?.token;
    const ids = get().selectedSnapshotIds;
    if (!token || ids.length !== 2) return;
    set({ diffLoading: true });
    try {
      const pair = await window.api.snapshotsGetPair(token, ids[0], ids[1]);
      if (!pair) {
        get().addToast("error", "Snapshot not found");
        return;
      }
      // Order by created_at (older first)
      const older = pair.a.created_at <= pair.b.created_at ? pair.a : pair.b;
      const newer = pair.a.created_at <= pair.b.created_at ? pair.b : pair.a;
      set({
        diffData: {
          left: older.content,
          right: newer.content,
          leftLabel: formatSnapshotLabel(older),
          rightLabel: formatSnapshotLabel(newer),
        },
      });
    } catch (e: any) {
      get().addToast("error", "Failed to load diff", e.message);
    } finally {
      set({ diffLoading: false });
    }
  },

  loadDiffWithCurrent: async (snapshotId) => {
    const token = get().currentProject?.token;
    if (!token) return;
    set({ diffLoading: true });
    try {
      const snapshot = await window.api.snapshotsGet(token, snapshotId);
      if (!snapshot) { get().addToast("error", "Snapshot not found"); set({ diffLoading: false }); return; }
      // Use the snapshot's own section_id to get current content (important for aggregated file view)
      const currentContent = await window.api.getSectionContent(token, snapshot.section_id, "markdown");
      set({
        diffData: {
          left: snapshot.content,
          right: typeof currentContent === "string" ? currentContent : "",
          leftLabel: formatSnapshotLabel(snapshot),
          rightLabel: "Current",
        },
      });
    } catch (e: any) {
      get().addToast("error", "Failed to load diff", e.message);
    } finally {
      set({ diffLoading: false });
    }
  },

  restoreSnapshot: async (snapshotId) => {
    const token = get().currentProject?.token;
    const panelSectionId = get().snapshotsPanelSectionId;
    if (!token || !panelSectionId) return;
    try {
      // Find the actual section_id from the snapshot (may differ in aggregated file view)
      const snap = get().snapshots.find(s => s.id === snapshotId);
      const targetSectionId = snap?.section_id || panelSectionId;
      await window.api.snapshotsRestore(token, targetSectionId, snapshotId);
      get().addToast("success", "Version restored");
      await get().selectSection(panelSectionId);
      await get().loadSnapshots(panelSectionId);
      set({ diffData: null, selectedSnapshotIds: [] });
    } catch (e: any) {
      get().addToast("error", "Failed to restore", e.message);
    }
  },

  deleteSnapshot: async (snapshotId) => {
    const token = get().currentProject?.token;
    const sectionId = get().snapshotsPanelSectionId;
    if (!token || !sectionId) return;
    try {
      await window.api.snapshotsDelete(token, snapshotId);
      set({
        snapshots: get().snapshots.filter(s => s.id !== snapshotId),
        selectedSnapshotIds: get().selectedSnapshotIds.filter(id => id !== snapshotId),
      });
    } catch (e: any) {
      get().addToast("error", "Failed to delete snapshot", e.message);
    }
  },
});

function formatSnapshotLabel(s: { created_at: string; source: string }): string {
  const date = new Date(s.created_at + "Z");
  const time = date.toLocaleString();
  return `${time} (${s.source})`;
}
