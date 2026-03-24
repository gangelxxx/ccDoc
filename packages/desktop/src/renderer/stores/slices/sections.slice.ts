import type { Section, TreeNode, SliceCreator } from "../types.js";
import { t } from "../../i18n.js";
import { selPreserveKey } from "../../components/Editor/tiptap/extensions.js";

let _renameTimer: ReturnType<typeof setTimeout> | null = null;
let selectSectionGen = 0;

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
  quickCreateIdea: (text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => Promise<void>;
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
  /** Counter that increments to toggle IdeaChat local search open */
  ideaSearchTrigger: number;
  /** Counter that increments to toggle editor search bar */
  editorSearchTrigger: number;
}

export const createSectionsSlice: SliceCreator<SectionsSlice> = (set, get) => ({
  tree: [],
  currentSection: null,
  editorSelectedText: "",
  _editorView: null as any,
  setEditorView: (view: any) => set({ _editorView: view }),
  setEditorSelectedText: (text: string) => {
    const prev = get().editorSelectedText;
    set({ editorSelectedText: text });
    // Clear preserved selection decoration when cleared externally
    if (!text && prev) {
      // Remove highlight spans from DOM directly (ProseMirror won't re-render without focus)
      document.querySelectorAll(".selection-preserved").forEach((el) => {
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        }
      });
      // Also update plugin state so it doesn't re-apply on next render
      const view = get()._editorView;
      if (view) {
        try {
          view.dispatch(view.state.tr.setMeta(selPreserveKey, { from: 0, to: 0, hasFocus: true }));
        } catch {}
      }
    }
  },
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
    const { currentProject } = get();
    if (!currentProject) return;

    // Close history view when selecting a section
    if (get().historyViewCommit) {
      get().closeHistoryView();
    }

    const gen = ++selectSectionGen;
    const t0 = performance.now();
    console.log(`[perf] selectSection START id=${id.substring(0, 8)} gen=${gen}`);

    set({ sectionLoading: true });
    try {
      const section = await window.api.getSection(currentProject.token, id);
      const t1 = performance.now();
      console.log(`[perf] selectSection IPC done +${(t1 - t0).toFixed(0)}ms id=${id.substring(0, 8)} type=${section?.type} contentLen=${section?.content?.length ?? 0}`);

      if (gen !== selectSectionGen) {
        console.log(`[perf] selectSection DISCARDED (stale gen=${gen} current=${selectSectionGen})`);
        return;
      }

      if (get().currentSection?.id === id) {
        set({ currentSection: section, sectionLoading: false, externalChangePending: false });
        console.log(`[perf] selectSection SAME-RESELECT +${(performance.now() - t0).toFixed(0)}ms`);
        return;
      }

      // Clear editor selection when switching sections
      if (get().editorSelectedText) set({ editorSelectedText: "" });

      const { navHistory: currentHistory, navIndex: currentNavIndex } = get();
      const trimmedHistory = currentHistory.slice(0, currentNavIndex + 1);
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
      console.log(`[perf] selectSection SET-STATE +${(performance.now() - t0).toFixed(0)}ms`);
    } catch (e: any) {
      if (gen !== selectSectionGen) return;
      console.error(`[perf] selectSection ERROR +${(performance.now() - t0).toFixed(0)}ms`, e.message);
      get().addToast("error", "Failed to load section", e.message);
    } finally {
      if (gen === selectSectionGen) set({ sectionLoading: false });
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
      try {
        // Re-read currentProject from store (may have changed during debounce)
        const project = get().currentProject;
        if (!project) return;
        const latestSection = get().currentSection;
        if (latestSection && latestSection.id === id) {
          await window.api.updateSection(project.token, id, title, latestSection.content);
        } else {
          const section = await window.api.getSection(project.token, id);
          if (section) {
            await window.api.updateSection(project.token, id, title, section.content);
          }
        }
        await get().loadTree();
      } catch (e: any) {
        get().addToast("error", "Failed to rename section", e.message);
      }
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

  quickCreateIdea: async (text: string, images?: { id: string; name: string; mediaType: string; data: string }[]) => {
    const { currentProject, tree, language } = get();
    if (!currentProject?.token || !text.trim()) return;

    const folderName = t(language, "quickIdeaFolderName" as any);
    const ideaTitle = t(language, "quickIdeaTitle" as any);

    try {
      // Find existing Quick Ideas folder at root level
      let folder = tree.find(
        (n) => n.type === "folder" && n.title === folderName
      );

      // Create folder if it doesn't exist
      if (!folder) {
        const created = await window.api.createSection(
          currentProject.token,
          null,
          folderName,
          "folder",
          "\u{1F4A1}" // 💡
        );
        await get().loadTree();
        folder = get().tree.find((n) => n.id === created.id) ?? undefined;
      }

      if (!folder) return;

      // Find existing idea section inside the folder
      let ideaSection = folder.children?.find(
        (n) => n.type === "idea"
      );

      // Create idea section if it doesn't exist
      if (!ideaSection) {
        const created = await window.api.createSection(
          currentProject.token,
          folder.id,
          ideaTitle,
          "idea"
        );
        await get().loadTree();
        ideaSection = get().tree
          .find((n) => n.id === folder!.id)
          ?.children?.find((n) => n.id === created.id);
        if (!ideaSection) return;
      }

      // Add message (with optional images) to the idea section
      await get().addIdeaMessage(ideaSection.id, text.trim(), images);

      // Reload tree so IdeaChat's useEffect [section.id, tree] triggers
      await get().loadTree();

      get().addToast("success", t(language, "quickIdeaSaved" as any));
    } catch (e: any) {
      get().addToast("error", "Failed to create quick idea", e.message);
    }
  },
});
