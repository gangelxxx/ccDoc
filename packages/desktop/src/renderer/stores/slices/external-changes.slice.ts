import type { AppState, TreeNode, SliceCreator } from "../types.js";

export interface ExternalChangesSlice {
  externalChangePending: boolean;
  externalChangeTimestamp: number | null;
  externallyChangedIds: Set<string>;
  quietLoadTree: () => Promise<void>;
  refreshCurrentSection: () => Promise<void>;
  dismissExternalChange: () => void;
  clearExternalChange: (id: string) => void;
}

/** Flatten a tree into a map of id → updated_at */
function buildTimestampMap(nodes: TreeNode[], out = new Map<string, string>()): Map<string, string> {
  for (const n of nodes) {
    out.set(n.id, n.updated_at);
    if (n.children.length) buildTimestampMap(n.children, out);
  }
  return out;
}

/** Find IDs of nodes that were added or modified compared to the old tree */
function detectChangedIds(oldTree: TreeNode[], newTree: TreeNode[]): Set<string> {
  const oldMap = buildTimestampMap(oldTree);
  const newMap = buildTimestampMap(newTree);
  const changed = new Set<string>();
  for (const [id, ts] of newMap) {
    const oldTs = oldMap.get(id);
    if (!oldTs || oldTs !== ts) {
      changed.add(id);
    }
  }
  return changed;
}

export const createExternalChangesSlice: SliceCreator<ExternalChangesSlice> = (set, get) => ({
  externalChangePending: false,
  externalChangeTimestamp: null,
  externallyChangedIds: new Set<string>(),

  quietLoadTree: async () => {
    const { currentProject, currentSection, tree: oldTree } = get();
    if (!currentProject) return;
    try {
      const tree = await window.api.getTree(currentProject.token);
      const changedIds = detectChangedIds(oldTree, tree);

      // Nothing changed — skip re-render
      if (changedIds.size === 0) return;

      const updates: Partial<AppState> = { tree };

      // Merge with any existing uncleared changed IDs
      const prev = get().externallyChangedIds;
      const merged = new Set(prev);
      for (const id of changedIds) merged.add(id);
      updates.externallyChangedIds = merged;

      if (currentSection) {
        // Check if the current section still exists in the new tree
        const findNode = (nodes: TreeNode[], id: string): boolean => {
          for (const n of nodes) {
            if (n.id === id) return true;
            if (n.children.length && findNode(n.children, id)) return true;
          }
          return false;
        };

        if (!findNode(tree, currentSection.id)) {
          // Current section was deleted externally — show banner
          updates.externalChangePending = true;
          updates.externalChangeTimestamp = Date.now();
        } else if (changedIds.has(currentSection.id)) {
          // Current section content changed — show banner
          updates.externalChangePending = true;
          updates.externalChangeTimestamp = Date.now();
        }
      }

      set(updates);
    } catch (e: any) {
      console.warn("[quietLoadTree] Failed:", e.message);
    }
  },

  refreshCurrentSection: async () => {
    const { currentProject, currentSection } = get();
    if (!currentProject || !currentSection) {
      set({ externalChangePending: false });
      return;
    }
    try {
      const section = await window.api.getSection(currentProject.token, currentSection.id);
      // Also clear this ID from the changed set
      const next = new Set(get().externallyChangedIds);
      next.delete(currentSection.id);
      set({ currentSection: section, externalChangePending: false, externallyChangedIds: next });
    } catch {
      // Section was deleted -- clear it
      set({ currentSection: null, externalChangePending: false });
    }
  },

  dismissExternalChange: () => {
    set({ externalChangePending: false, externalChangeTimestamp: null });
  },

  clearExternalChange: (id: string) => {
    const next = new Set(get().externallyChangedIds);
    next.delete(id);
    set({ externallyChangedIds: next });
  },
});
