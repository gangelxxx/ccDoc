import type { AppState, TreeNode, SliceCreator } from "../types.js";

export interface ExternalChangesSlice {
  externalChangePending: boolean;
  externalChangeTimestamp: number | null;
  quietLoadTree: () => Promise<void>;
  refreshCurrentSection: () => Promise<void>;
  dismissExternalChange: () => void;
}

export const createExternalChangesSlice: SliceCreator<ExternalChangesSlice> = (set, get) => ({
  externalChangePending: false,
  externalChangeTimestamp: null,

  quietLoadTree: async () => {
    const { currentProject, currentSection } = get();
    if (!currentProject) return;
    try {
      const tree = await window.api.getTree(currentProject.token);
      const updates: Partial<AppState> = {
        tree,
        externalChangePending: true,
        externalChangeTimestamp: Date.now(),
      };

      // If current section was deleted externally, mark but don't switch
      if (currentSection) {
        const findNode = (nodes: TreeNode[], id: string): boolean => {
          for (const n of nodes) {
            if (n.id === id) return true;
            if (n.children.length && findNode(n.children, id)) return true;
          }
          return false;
        };
        if (!findNode(tree, currentSection.id)) {
          updates.externalChangePending = true;
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
      set({ currentSection: section, externalChangePending: false });
    } catch {
      // Section was deleted -- clear it
      set({ currentSection: null, externalChangePending: false });
    }
  },

  dismissExternalChange: () => {
    set({ externalChangePending: false, externalChangeTimestamp: null });
  },
});
