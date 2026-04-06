import type { Section, TreeNode, SliceCreator } from "../types.js";
import { t } from "../../i18n.js";
import { selPreserveKey } from "../../components/Editor/tiptap/extensions.js";
import { patchNodeInTree, removeNodeFromTree, insertNodeInTree, moveNodeInTree } from "./tree-patch.js";

const SECTION_CACHE_MAX = 100;

/** Evict oldest entries if cache exceeds max size (Map preserves insertion order). */
function trimCache(cache: Map<string, Section>): void {
  while (cache.size > SECTION_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest); else break;
  }
}

function findNodeInTree(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children.length) {
      const found = findNodeInTree(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

let _renameTimer: ReturnType<typeof setTimeout> | null = null;
let _reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let selectSectionGen = 0;

/** Tag every node in a full tree as loaded (used after full-tree reconcile). */
function markAllLoaded(nodes: TreeNode[]): TreeNode[] {
  return nodes.map(n => ({
    ...n,
    childrenLoaded: true,
    hasChildren: n.children.length > 0,
    children: markAllLoaded(n.children),
  }));
}

/** Mark regular nodes as loaded; linked project children stay lazy-loadable. */
function markUnifiedTreeLoaded(nodes: TreeNode[]): TreeNode[] {
  return nodes.map(n => {
    if (n.linkedProjectMeta) {
      // Linked project root: its direct children are shallow stubs — mark as not loaded
      return {
        ...n,
        childrenLoaded: n.children.length > 0,
        hasChildren: n.hasChildren ?? n.children.length > 0,
        children: n.children.map(c => ({
          ...c,
          childrenLoaded: false,
          hasChildren: c.hasChildren ?? (c.children?.length ?? 0) > 0,
          children: c.children || [],
        })),
      };
    }
    // Regular node: only mark as loaded if children are actually present
    // (getUnifiedTree uses getRootTreeNodes which returns shallow nodes without children)
    const hasKids = n.hasChildren ?? n.children.length > 0;
    const kidsLoaded = n.children.length > 0;
    return {
      ...n,
      childrenLoaded: kidsLoaded,
      hasChildren: hasKids,
      children: kidsLoaded ? markUnifiedTreeLoaded(n.children) : [],
    };
  });
}

/** Walk tree to find if a node belongs to a linked project. Returns project_token if found. */
function findLinkedProjectToken(nodes: TreeNode[], targetId: string): string | null {
  for (const n of nodes) {
    if (n.linkedProjectMeta) {
      if (findNodeInTree(n.children, targetId)) {
        return n.linkedProjectMeta.project_token;
      }
    }
    if (n.children.length) {
      const found = findLinkedProjectToken(n.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

/** Resolve the correct project token for a section — linked project token or current project token. */
function resolveTokenForSection(tree: TreeNode[], sectionId: string, currentProjectToken: string): string {
  if (sectionId === "workspace-root") return currentProjectToken;
  const linkedToken = findLinkedProjectToken(tree, sectionId);
  return linkedToken || currentProjectToken;
}

/** Debounced full tree reload to reconcile optimistic patches with DB truth. */
function scheduleTreeReconcile(get: () => any) {
  if (_reconcileTimer) clearTimeout(_reconcileTimer);
  _reconcileTimer = setTimeout(() => get().loadTree(), 2000);
}

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
  /** Project token for the currently active section (may differ from currentProject for linked projects) */
  activeSectionToken: string | null;
  loadingSectionId: string | null;
  /** In-memory cache of fetched sections (id → Section). */
  _sectionCache: Map<string, Section>;
  editorSelectedText: string;
  _editorView: any;
  setEditorView: (view: any) => void;
  setEditorSelectedText: (text: string) => void;
  loadTree: () => Promise<void>;
  loadRootTree: () => Promise<void>;
  loadChildren: (parentId: string) => Promise<void>;
  expandToSection: (id: string) => Promise<void>;
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
  /** Set of section IDs with unsaved editor changes — guards against DB overwrites. */
  dirtyEditors: Set<string>;
  markEditorDirty: (sectionId: string) => void;
  markEditorClean: (sectionId: string) => void;
}

export const createSectionsSlice: SliceCreator<SectionsSlice> = (set, get) => ({
  tree: [],
  currentSection: null,
  activeSectionToken: null,
  loadingSectionId: null,
  _sectionCache: new Map(),
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
  dirtyEditors: new Set<string>(),
  markEditorDirty: (sectionId: string) => {
    set(s => {
      if (s.dirtyEditors.has(sectionId)) return {};
      const next = new Set(s.dirtyEditors);
      next.add(sectionId);
      return { dirtyEditors: next };
    });
  },
  markEditorClean: (sectionId: string) => {
    set(s => {
      if (!s.dirtyEditors.has(sectionId)) return {};
      const next = new Set(s.dirtyEditors);
      next.delete(sectionId);
      return { dirtyEditors: next };
    });
  },

  loadTree: async () => {
    const { currentProject, workspace, linkedProjects } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      let rawTree: TreeNode[];
      if (workspace) {
        rawTree = await window.api.getUnifiedTree(currentProject.token, true);
        set({ tree: markUnifiedTreeLoaded(rawTree) });
      } else {
        rawTree = await window.api.getTree(currentProject.token);
        set({ tree: markAllLoaded(rawTree) });
      }
    } catch (e: any) {
      get().addToast("error", "Failed to load tree", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  loadRootTree: async () => {
    const { currentProject, workspace, linkedProjects } = get();
    if (!currentProject) return;
    set({ treeLoading: true });
    try {
      let tree: TreeNode[];
      if (workspace) {
        tree = markUnifiedTreeLoaded(await window.api.getUnifiedTree(currentProject.token));
      } else {
        tree = await window.api.getRootTree(currentProject.token);
      }
      set({ tree });
    } catch (e: any) {
      get().addToast("error", "Failed to load tree", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  loadChildren: async (parentId) => {
    const { currentProject } = get();
    if (!currentProject || get().loadingNodes.has(parentId)) return;
    get().setNodeLoading(parentId, true);
    try {
      let children: TreeNode[];

      if (parentId.startsWith("linked:")) {
        // This is a linked project root node — load its top-level children
        const linkedNode = findNodeInTree(get().tree, parentId);
        const projectToken = linkedNode?.linkedProjectMeta?.project_token;
        if (projectToken) {
          children = await window.api.getLinkedChildren(projectToken);
        } else {
          children = [];
        }
      } else {
        // Check if this parentId belongs to a linked project subtree
        const parentToken = findLinkedProjectToken(get().tree, parentId);
        if (parentToken) {
          children = await window.api.getLinkedChildren(parentToken, parentId);
        } else {
          children = await window.api.getChildrenTree(currentProject.token, parentId);
        }
      }

      set({
        tree: patchNodeInTree(get().tree, parentId, {
          children,
          childrenLoaded: true,
          hasChildren: children.length > 0,
        }),
      });
    } catch (e: any) {
      console.warn("[sections] loadChildren failed:", e);
    } finally {
      get().setNodeLoading(parentId, false);
    }
  },

  expandToSection: async (id) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const expandToken = resolveTokenForSection(get().tree, id, currentProject.token);
      const chain = await window.api.getParentChain(expandToken, id);
      for (const ancestor of chain) {
        const node = findNodeInTree(get().tree, ancestor.id);
        if (node && node.childrenLoaded === false && node.hasChildren) {
          await get().loadChildren(ancestor.id);
        }
        get().expandNode(ancestor.id);
      }
    } catch { /* ignore — best effort */ }
  },

  selectSection: async (id) => {
    const { currentProject } = get();
    if (!currentProject) return;

    // Virtual node — no section to load, just toggle expand
    if (id === "workspace-root") return;

    // Close history view when selecting a section
    if (get().historyViewCommit) {
      get().closeHistoryView();
    }

    // Determine the correct project token — may be a linked project
    const sectionToken = resolveTokenForSection(get().tree, id, currentProject.token);
    set({ activeSectionToken: sectionToken, sectionSource: "project" });

    const gen = ++selectSectionGen;
    const t0 = performance.now();

    // Lazy-load section view prefs
    get().loadSectionPrefs(id);

    // ── Cache hit: show instantly, refresh in background ──
    const cached = get()._sectionCache.get(id);
    if (cached && get().currentSection?.id !== id) {
      if (get().editorSelectedText) set({ editorSelectedText: "" });
      const { navHistory: currentHistory, navIndex: currentNavIndex } = get();
      const trimmedHistory = currentHistory.slice(0, currentNavIndex + 1);
      trimmedHistory.push({ id, source: "project" });
      const newIndex = trimmedHistory.length - 1;
      set({
        currentSection: cached,
        navHistory: trimmedHistory,
        navIndex: newIndex,
        canGoBack: newIndex > 0,
        canGoForward: false,
        externalChangePending: false,
      });
      console.log(`[perf] selectSection CACHE-HIT +${(performance.now() - t0).toFixed(0)}ms id=${id.substring(0, 8)}`);
      // Refresh in background (silent update, no loading indicator)
      window.api.getSection(sectionToken, id).then(section => {
        if (section && selectSectionGen === gen) {
          const cache = new Map(get()._sectionCache);
          cache.set(id, section);
          const updates: any = { _sectionCache: cache };
          if (get().currentSection?.id === id) updates.currentSection = section;
          set(updates);
        }
      }).catch(() => {});
      return;
    }

    // ── Cache miss: fetch with loading indicator ──
    set({ sectionLoading: true, loadingSectionId: id });
    try {
      const section = await window.api.getSection(sectionToken, id);

      if (gen !== selectSectionGen) return;

      // Update cache
      const cache = new Map(get()._sectionCache);
      cache.set(id, section);
      trimCache(cache);

      if (get().currentSection?.id === id) {
        set({ currentSection: section, sectionLoading: false, loadingSectionId: null, externalChangePending: false, _sectionCache: cache });
        return;
      }

      if (get().editorSelectedText) set({ editorSelectedText: "" });

      const { navHistory: currentHistory, navIndex: currentNavIndex } = get();
      const trimmedHistory = currentHistory.slice(0, currentNavIndex + 1);
      trimmedHistory.push({ id, source: "project" });
      const newIndex = trimmedHistory.length - 1;

      set({
        currentSection: section,
        _sectionCache: cache,
        navHistory: trimmedHistory,
        navIndex: newIndex,
        canGoBack: newIndex > 0,
        canGoForward: false,
        externalChangePending: false,
      });
      console.log(`[perf] selectSection IPC +${(performance.now() - t0).toFixed(0)}ms id=${id.substring(0, 8)} contentLen=${section?.content?.length ?? 0}`);
    } catch (e: any) {
      if (gen !== selectSectionGen) return;
      get().addToast("error", "Failed to load section", e.message);
    } finally {
      if (gen === selectSectionGen) set({ sectionLoading: false, loadingSectionId: null });
    }
  },

  createSection: async (parentId, title, type, icon) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const section = await window.api.createSection(currentProject.token, parentId, title, type, icon);
      // Optimistic insert
      const newNode: TreeNode = {
        id: section.id,
        parent_id: section.parent_id,
        title: section.title,
        type: section.type,
        icon: section.icon,
        sort_key: section.sort_key,
        updated_at: section.updated_at,
        children: [],
        hasChildren: false,
        childrenLoaded: true,
      };
      let tree = insertNodeInTree(get().tree, newNode, parentId);
      // Mark parent as having children + loaded (we just added a child)
      if (parentId) {
        tree = patchNodeInTree(tree, parentId, { hasChildren: true, childrenLoaded: true });
      }
      set({ tree, currentSection: section });
      scheduleTreeReconcile(get);
      get().addToast("success", "Section created", title);
    } catch (e: any) {
      get().addToast("error", "Failed to create section", e.message);
    }
  },

  updateSection: async (id, title, content) => {
    const { currentProject, currentSection, sectionSource } = get();
    try {
      // Update store + cache immediately so UI reacts
      if (currentSection && currentSection.id === id) {
        set({ currentSection: { ...currentSection, title, content } });
      }
      // Update cache entry (whether current or not)
      const cache = new Map(get()._sectionCache);
      const existing = cache.get(id);
      if (existing) cache.set(id, { ...existing, title, content });
      set({ _sectionCache: cache });

      if (sectionSource === "user") {
        await window.api.user.update(id, title, content);
      } else {
        if (!currentProject) return;
        const token = resolveTokenForSection(get().tree, id, currentProject.token);
        await window.api.updateSection(token, id, title, content);
      }
      scheduleTreeReconcile(get);
    } catch (e: any) {
      get().addToast("error", "Failed to save", e.message);
    }
  },

  renameSection: async (id, title) => {
    const { currentProject, currentSection, sectionSource } = get();
    // Optimistic update: patch store + tree + cache immediately
    if (currentSection?.id === id) {
      set({ currentSection: { ...currentSection, title } });
    }
    const cache = new Map(get()._sectionCache);
    const cachedSec = cache.get(id);
    if (cachedSec) { cache.set(id, { ...cachedSec, title }); set({ _sectionCache: cache }); }

    if (sectionSource === "user") {
      // User folder rename — debounced, no tree patching needed (UserFolder has its own tree)
      if (_renameTimer) clearTimeout(_renameTimer);
      _renameTimer = setTimeout(async () => {
        try {
          const latestSection = get().currentSection;
          if (latestSection && latestSection.id === id) {
            await window.api.user.update(id, title, latestSection.content);
          } else {
            const section = await window.api.user.get(id);
            if (section) await window.api.user.update(id, title, section.content);
          }
          get().loadUserTree();
        } catch (e: any) {
          get().addToast("error", "Failed to rename section", e.message);
        }
      }, 400);
    } else {
      if (!currentProject) return;
      set({ tree: patchNodeInTree(get().tree, id, { title }) });
      // Debounced rename via IPC
      if (_renameTimer) clearTimeout(_renameTimer);
      _renameTimer = setTimeout(async () => {
        try {
          const project = get().currentProject;
          if (!project) return;
          const renameToken = resolveTokenForSection(get().tree, id, project.token);
          const latestSection = get().currentSection;
          if (latestSection && latestSection.id === id) {
            await window.api.updateSection(renameToken, id, title, latestSection.content);
          } else {
            const section = await window.api.getSection(renameToken, id);
            if (section) {
              await window.api.updateSection(renameToken, id, title, section.content);
            }
          }
          scheduleTreeReconcile(get);
        } catch (e: any) {
          get().addToast("error", "Failed to rename section", e.message);
          get().loadTree(); // revert on error
        }
      }, 400);
    }
  },

  updateIcon: async (id, icon) => {
    const { currentProject } = get();
    if (!currentProject) return;
    // Handle workspace-root icon: save to workspace record
    if (id === "workspace-root") {
      set({ tree: patchNodeInTree(get().tree, id, { icon }) });
      const { workspace } = get();
      if (workspace) {
        try { await window.api.updateWorkspaceIcon(workspace.id, icon); } catch {}
      }
      return;
    }
    // Handle linked project root icon: save via updateLinkedProject
    if (id.startsWith("linked:")) {
      set({ tree: patchNodeInTree(get().tree, id, { icon }) });
      const linkedProjectId = id.replace("linked:", "");
      const { workspace } = get();
      if (workspace) {
        try { await window.api.updateLinkedProject(workspace.id, linkedProjectId, { icon } as any); } catch {}
      }
      return;
    }
    // Optimistic patch
    set({ tree: patchNodeInTree(get().tree, id, { icon }) });
    try {
      const iconToken = resolveTokenForSection(get().tree, id, currentProject.token);
      await window.api.updateIcon(iconToken, id, icon);
      scheduleTreeReconcile(get);
    } catch (e: any) {
      get().addToast("error", "Failed to update icon", e.message);
      get().loadTree(); // revert on error
    }
  },

  duplicateSection: async (id) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const dupToken = resolveTokenForSection(get().tree, id, currentProject.token);
      const section = await window.api.duplicateSection(dupToken, id);
      // Optimistic insert: add duplicated node next to original
      const newNode: TreeNode = {
        id: section.id,
        parent_id: section.parent_id,
        title: section.title,
        type: section.type,
        icon: section.icon,
        sort_key: section.sort_key,
        updated_at: section.updated_at,
        children: [],
        hasChildren: false,
        childrenLoaded: true,
      };
      let tree = insertNodeInTree(get().tree, newNode, section.parent_id);
      if (section.parent_id) {
        tree = patchNodeInTree(tree, section.parent_id, { hasChildren: true, childrenLoaded: true });
      }
      set({ tree, currentSection: section });
      scheduleTreeReconcile(get);
      get().addToast("success", "Section duplicated");
    } catch (e: any) {
      get().addToast("error", "Failed to duplicate section", e.message);
    }
  },

  convertIdeaToKanban: async (ideaId) => {
    const { currentProject, language } = get();
    if (!currentProject) return;
    const cols = {
      backlog: t(language, "kanbanColBacklog"),
      inProgress: t(language, "kanbanColInProgress"),
      done: t(language, "kanbanColDone"),
    };
    try {
      const kanbanToken = resolveTokenForSection(get().tree, ideaId, currentProject.token);
      const section = await window.api.convertIdeaToKanban(kanbanToken, ideaId, cols);
      // Optimistic: patch type in tree, reconcile later for full structure
      set({
        tree: patchNodeInTree(get().tree, ideaId, { type: "kanban", title: section.title }),
        currentSection: section,
      });
      scheduleTreeReconcile(get);
      get().addToast("success", "Ideas converted to Kanban");
    } catch (e: any) {
      get().addToast("error", "Failed to convert ideas to Kanban", e.message);
    }
  },

  moveSection: async (id, newParentId, afterId) => {
    const { currentProject } = get();
    if (!currentProject) return;
    // Optimistic move
    set({ tree: moveNodeInTree(get().tree, id, newParentId) });
    try {
      const moveToken = resolveTokenForSection(get().tree, id, currentProject.token);
      await window.api.moveSection(moveToken, id, newParentId, afterId);
      scheduleTreeReconcile(get);
    } catch (e: any) {
      get().addToast("error", "Failed to move section", e.message);
      get().loadTree(); // revert on error
    }
  },

  deleteSection: async (id) => {
    const { currentProject, currentSection, sectionSource } = get();
    try {
      if (sectionSource === "user") {
        const deletedUserNode = findNodeInTree(get().userTree, id);
        await window.api.user.delete(id);
        if (currentSection && (currentSection.id === id ||
            (deletedUserNode && findNodeInTree(deletedUserNode.children, currentSection.id)))) {
          set({ currentSection: null, sectionSource: "project" });
        }
        const cache = new Map(get()._sectionCache);
        cache.delete(id);
        get().clearSectionPrefsCache(id);
        set({ _sectionCache: cache });
        get().loadUserTree();
        get().addToast("info", "Section deleted");
        return;
      }
      if (!currentProject) return;
      const delToken = resolveTokenForSection(get().tree, id, currentProject.token);
      const deletedNode = findNodeInTree(get().tree, id);
      await window.api.deleteSection(delToken, id);
      // Clear currentSection if it IS the deleted node or is a descendant of it
      if (currentSection && (currentSection.id === id ||
          (deletedNode && findNodeInTree(deletedNode.children, currentSection.id)))) {
        set({ currentSection: null });
      }
      // Evict from cache
      const cache = new Map(get()._sectionCache);
      cache.delete(id);
      // Clear section view prefs cache
      get().clearSectionPrefsCache(id);
      // Optimistic removal + update parent hasChildren
      let newTree = removeNodeFromTree(get().tree, id);
      if (deletedNode?.parent_id) {
        const parent = findNodeInTree(newTree, deletedNode.parent_id);
        if (parent && parent.children.length === 0) {
          newTree = patchNodeInTree(newTree, deletedNode.parent_id, { hasChildren: false });
        }
      }
      set({ tree: newTree, _sectionCache: cache });
      scheduleTreeReconcile(get);
      get().addToast("info", "Section deleted");
    } catch (e: any) {
      get().addToast("error", "Failed to delete section", e.message);
      if (sectionSource !== "user") get().loadTree();
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
      let folderId: string;

      // Create folder if it doesn't exist
      if (!folder) {
        const created = await window.api.createSection(
          currentProject.token,
          null,
          folderName,
          "folder",
          "\u{1F4A1}" // 💡
        );
        folderId = created.id;
        const folderNode: TreeNode = {
          id: created.id, parent_id: null, title: folderName,
          type: "folder", icon: "\u{1F4A1}", sort_key: created.sort_key,
          updated_at: created.updated_at, children: [],
        };
        set({ tree: insertNodeInTree(get().tree, folderNode, null) });
        folder = folderNode;
      } else {
        folderId = folder.id;
      }

      // Find existing idea section inside the folder
      // If children aren't loaded yet, load them first
      if (folder.childrenLoaded === false && folder.hasChildren) {
        await get().loadChildren(folderId);
        folder = findNodeInTree(get().tree, folderId) ?? folder;
      }
      let ideaSectionId: string | undefined = folder.children?.find(
        (n) => n.type === "idea"
      )?.id;

      // Create idea section if it doesn't exist
      if (!ideaSectionId) {
        const created = await window.api.createSection(
          currentProject.token,
          folderId,
          ideaTitle,
          "idea"
        );
        ideaSectionId = created.id;
        const ideaNode: TreeNode = {
          id: created.id, parent_id: folderId, title: ideaTitle,
          type: "idea", icon: null, sort_key: created.sort_key,
          updated_at: created.updated_at, children: [],
        };
        set({ tree: insertNodeInTree(get().tree, ideaNode, folderId) });
      }

      // Add message (with optional images) to the idea section
      await get().addIdeaMessage(ideaSectionId!, text.trim(), images);

      // Single reconcile at the end
      scheduleTreeReconcile(get);

      get().addToast("success", t(language, "quickIdeaSaved" as any));
    } catch (e: any) {
      get().addToast("error", "Failed to create quick idea", e.message);
    }
  },
});
