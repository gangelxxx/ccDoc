import type { Section, TreeNode, SliceCreator } from "../types.js";
import { t } from "../../i18n.js";

let _renameTimer: ReturnType<typeof setTimeout> | null = null;

export function resolveTargetFolder(tree: TreeNode[], currentSection: Section | null): string | null {
  if (!currentSection) {
    const first = tree.find((n) => n.type === "folder");
    return first?.id ?? null;
  }
  if (currentSection.type === "folder") return currentSection.id;
  // Walk up: find parent folder in tree
  const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  };
  if (currentSection.parent_id) {
    const parent = findNode(tree, currentSection.parent_id);
    if (parent?.type === "folder") return parent.id;
    if (parent?.parent_id) {
      const grandparent = findNode(tree, parent.parent_id);
      if (grandparent?.type === "folder") return grandparent.id;
    }
  }
  const first = tree.find((n) => n.type === "folder");
  return first?.id ?? null;
}

export interface SectionsSlice {
  tree: TreeNode[];
  currentSection: Section | null;
  editorSelectedText: string;
  setEditorSelectedText: (text: string) => void;
  loadTree: () => Promise<void>;
  selectSection: (id: string) => Promise<void>;
  createSection: (parentId: string | null, title: string, type: string, icon?: string | null) => Promise<void>;
  updateSection: (id: string, title: string, content: string) => Promise<void>;
  renameSection: (id: string, title: string) => Promise<void>;
  updateIcon: (id: string, icon: string | null) => Promise<void>;
  duplicateSection: (id: string) => Promise<void>;
  convertIdeaToKanban: (ideaId: string) => Promise<void>;
  moveSection: (id: string, newParentId: string | null, afterId: string | null) => Promise<void>;
  deleteSection: (id: string) => Promise<void>;
  /** When set, IdeaChat scrolls to the message linked to this plan and clears it */
  scrollToPlanId: string | null;
  setScrollToPlanId: (id: string | null) => void;
  /** When set, IdeaChat scrolls to the message with this ID and highlights it */
  scrollToMessageId: string | null;
  setScrollToMessageId: (id: string | null) => void;
  /** When set, IdeaChat scrolls to the first message matching this query and highlights it */
  highlightQuery: string | null;
  setHighlightQuery: (q: string | null) => void;
}

export const createSectionsSlice: SliceCreator<SectionsSlice> = (set, get) => ({
  tree: [],
  currentSection: null,
  editorSelectedText: "",
  setEditorSelectedText: (text: string) => set({ editorSelectedText: text }),
  scrollToPlanId: null,
  setScrollToPlanId: (id: string | null) => set({ scrollToPlanId: id }),
  scrollToMessageId: null,
  setScrollToMessageId: (id: string | null) => set({ scrollToMessageId: id }),
  highlightQuery: null,
  setHighlightQuery: (q: string | null) => set({ highlightQuery: q }),
  ideaSearchTrigger: 0,
  editorSearchTrigger: 0,

  loadTree: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      const tree = await window.api.getTree(currentProject.token);
      set({ tree });
    } catch (e: any) {
      get().addToast("error", "Failed to load tree", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  selectSection: async (id) => {
    const { currentProject, navHistory, navIndex, currentSection } = get();
    if (!currentProject) return;

    // Close history view when selecting a section
    if (get().historyViewCommit) {
      get().closeHistoryView();
    }

    set({ sectionLoading: true });
    try {
      const section = await window.api.getSection(currentProject.token, id);

      if (currentSection?.id === id) {
        set({ sectionLoading: false });
        return;
      }

      // Push to navigation history
      const trimmedHistory = navHistory.slice(0, navIndex + 1);
      trimmedHistory.push(id);
      const newIndex = trimmedHistory.length - 1;

      set({
        currentSection: section,
        navHistory: trimmedHistory,
        navIndex: newIndex,
        canGoBack: newIndex > 0,
        canGoForward: false,
        externalChangePending: false,
      });
    } catch (e: any) {
      get().addToast("error", "Failed to load section", e.message);
    } finally {
      set({ sectionLoading: false });
    }
  },

  createSection: async (parentId, title, type, icon) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      const section = await window.api.createSection(currentProject.token, parentId, title, type, icon);
      await get().loadTree();
      set({ currentSection: section });
      get().addToast("success", "Section created", title);
    } catch (e: any) {
      get().addToast("error", "Failed to create section", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  updateSection: async (id, title, content) => {
    const { currentProject, currentSection } = get();
    if (!currentProject) return;
    try {
      // Update store immediately so UI (e.g. todo progress bar) reacts
      if (currentSection && currentSection.id === id) {
        set({ currentSection: { ...currentSection, title, content } });
      }
      await window.api.updateSection(currentProject.token, id, title, content);
    } catch (e: any) {
      get().addToast("error", "Failed to save", e.message);
    }
  },

  renameSection: async (id, title) => {
    const { currentProject, currentSection } = get();
    if (!currentProject) return;
    // Update title in store immediately for responsive UI
    if (currentSection?.id === id) {
      set({ currentSection: { ...currentSection, title } });
    }
    // Debounced rename via IPC
    if (_renameTimer) clearTimeout(_renameTimer);
    _renameTimer = setTimeout(async () => {
      const latestSection = get().currentSection;
      if (latestSection && latestSection.id === id) {
        // Renaming current section -- use its latest content
        await window.api.updateSection(currentProject.token, id, title, latestSection.content);
      } else {
        // Renaming a non-current section -- fetch its content first
        const section = await window.api.getSection(currentProject.token, id);
        if (section) {
          await window.api.updateSection(currentProject.token, id, title, section.content);
        }
      }
      await get().loadTree();
    }, 400);
  },

  updateIcon: async (id, icon) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      await window.api.updateIcon(currentProject.token, id, icon);
      await get().loadTree();
    } catch (e: any) {
      get().addToast("error", "Failed to update icon", e.message);
    }
  },

  duplicateSection: async (id) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      const section = await window.api.duplicateSection(currentProject.token, id);
      await get().loadTree();
      set({ currentSection: section });
      get().addToast("success", "Section duplicated");
    } catch (e: any) {
      get().addToast("error", "Failed to duplicate section", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  convertIdeaToKanban: async (ideaId) => {
    const { currentProject, language } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    const cols = {
      backlog: t(language, "kanbanColBacklog"),
      inProgress: t(language, "kanbanColInProgress"),
      done: t(language, "kanbanColDone"),
    };
    try {
      const section = await window.api.convertIdeaToKanban(currentProject.token, ideaId, cols);
      await get().loadTree();
      set({ currentSection: section });
      get().addToast("success", "Ideas converted to Kanban");
    } catch (e: any) {
      get().addToast("error", "Failed to convert ideas to Kanban", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  moveSection: async (id, newParentId, afterId) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      await window.api.moveSection(currentProject.token, id, newParentId, afterId);
      await get().loadTree();
    } catch (e: any) {
      get().addToast("error", "Failed to move section", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  deleteSection: async (id) => {
    const { currentProject, currentSection } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      await window.api.deleteSection(currentProject.token, id);
      if (currentSection?.id === id) set({ currentSection: null });
      await get().loadTree();
      get().addToast("info", "Section deleted");
    } catch (e: any) {
      get().addToast("error", "Failed to delete section", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },
});
