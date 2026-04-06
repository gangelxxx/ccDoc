import type { TreeNode, Section, SliceCreator } from "../types.js";

const USER_FOLDER_EXPANDED_KEY = "ccdoc:userFolderExpanded";

export interface UserSlice {
  userTree: TreeNode[];
  userTreeLoading: boolean;
  userFolderExpanded: boolean;
  /** 'project' | 'user' — identifies where the active section lives */
  sectionSource: "project" | "user";

  loadUserTree: () => Promise<void>;
  createUserSection: (parentId: string | null, title: string, type: string, icon?: string | null) => Promise<void>;
  updateUserSection: (id: string, title: string, content: string) => Promise<void>;
  updateUserSectionMarkdown: (id: string, title: string, markdown: string) => Promise<void>;
  updateUserIcon: (id: string, icon: string | null) => Promise<void>;
  moveUserSection: (id: string, newParentId: string | null, afterId: string | null) => Promise<void>;
  duplicateUserSection: (id: string) => Promise<void>;
  deleteUserSection: (id: string) => Promise<void>;
  restoreUserSection: (id: string) => Promise<void>;
  selectUserSection: (id: string) => Promise<void>;
  toggleUserFolder: () => void;
  setSectionSource: (source: "project" | "user") => void;
}

export const createUserSlice: SliceCreator<UserSlice> = (set, get) => ({
  userTree: [],
  userTreeLoading: false,
  userFolderExpanded: (() => {
    try { return localStorage.getItem(USER_FOLDER_EXPANDED_KEY) !== "false"; } catch { return true; }
  })(),
  sectionSource: "project",

  loadUserTree: async () => {
    set({ userTreeLoading: true });
    try {
      const tree = await window.api.user.getTree();
      set({ userTree: tree, userTreeLoading: false });
    } catch (e: any) {
      set({ userTreeLoading: false });
      console.warn("[user] loadUserTree failed:", e);
    }
  },

  createUserSection: async (parentId, title, type, icon) => {
    try {
      const section = await window.api.user.create(parentId, title, type, icon);
      await get().loadUserTree();
      if (section) {
        get().selectUserSection(section.id);
      }
    } catch (e: any) {
      get().addToast("error", "Failed to create section", e.message);
    }
  },

  updateUserSection: async (id, title, content) => {
    try {
      await window.api.user.update(id, title, content);
      // Refresh current section if it's the one we just updated
      if (get().currentSection?.id === id && get().sectionSource === "user") {
        const updated = await window.api.user.get(id);
        if (updated) set({ currentSection: updated });
      }
    } catch (e: any) {
      get().addToast("error", "Failed to update section", e.message);
    }
  },

  updateUserSectionMarkdown: async (id, title, markdown) => {
    try {
      await window.api.user.updateMarkdown(id, title, markdown);
      if (get().currentSection?.id === id && get().sectionSource === "user") {
        const updated = await window.api.user.get(id);
        if (updated) set({ currentSection: updated });
      }
    } catch (e: any) {
      get().addToast("error", "Failed to update section", e.message);
    }
  },

  updateUserIcon: async (id, icon) => {
    try {
      await window.api.user.updateIcon(id, icon);
      await get().loadUserTree();
    } catch (e: any) {
      get().addToast("error", "Failed to update icon", e.message);
    }
  },

  moveUserSection: async (id, newParentId, afterId) => {
    try {
      await window.api.user.move(id, newParentId, afterId);
      await get().loadUserTree();
    } catch (e: any) {
      get().addToast("error", "Failed to move section", e.message);
    }
  },

  duplicateUserSection: async (id) => {
    try {
      await window.api.user.duplicate(id);
      await get().loadUserTree();
    } catch (e: any) {
      get().addToast("error", "Failed to duplicate section", e.message);
    }
  },

  deleteUserSection: async (id) => {
    try {
      await window.api.user.delete(id);
      // If the deleted section is currently open, clear it
      if (get().currentSection?.id === id && get().sectionSource === "user") {
        set({ currentSection: null, sectionSource: "project" });
      }
      await get().loadUserTree();
    } catch (e: any) {
      get().addToast("error", "Failed to delete section", e.message);
    }
  },

  restoreUserSection: async (id) => {
    try {
      await window.api.user.restore(id);
      await get().loadUserTree();
    } catch (e: any) {
      get().addToast("error", "Failed to restore section", e.message);
    }
  },

  selectUserSection: async (id) => {
    set({ sectionLoading: true, loadingSectionId: id });
    try {
      const section = await window.api.user.get(id);
      if (!section) {
        set({ sectionLoading: false, loadingSectionId: null });
        return;
      }

      // Close history view
      if (get().historyViewCommit) {
        get().closeHistoryView();
      }

      if (get().editorSelectedText) set({ editorSelectedText: "" });

      // Update section cache
      const cache = new Map(get()._sectionCache);
      cache.set(id, section);
      // Trim cache if too large (same logic as sections.slice)
      while (cache.size > 100) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest); else break;
      }

      const { navHistory: currentHistory, navIndex: currentNavIndex } = get();
      const trimmedHistory = currentHistory.slice(0, currentNavIndex + 1);
      trimmedHistory.push({ id, source: "user" });
      const newIndex = trimmedHistory.length - 1;

      set({
        currentSection: section,
        _sectionCache: cache,
        sectionSource: "user",
        activeSectionToken: null,
        sectionLoading: false,
        loadingSectionId: null,
        externalChangePending: false,
        navHistory: trimmedHistory,
        navIndex: newIndex,
        canGoBack: newIndex > 0,
        canGoForward: false,
      });
    } catch (e: any) {
      set({ sectionLoading: false, loadingSectionId: null });
      get().addToast("error", "Failed to load section", e.message);
    }
  },

  toggleUserFolder: () => {
    const next = !get().userFolderExpanded;
    set({ userFolderExpanded: next });
    try { localStorage.setItem(USER_FOLDER_EXPANDED_KEY, String(next)); } catch {}
  },

  setSectionSource: (source) => set({ sectionSource: source }),
});
