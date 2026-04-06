import type { SliceCreator, Workspace, LinkedProject, LinkType, SuggestedLink, TreeNode } from "../types.js";

export interface WorkspaceSlice {
  workspace: Workspace | null;
  linkedProjects: LinkedProject[];
  workspaceLoading: boolean;

  loadWorkspace: (projectToken: string) => Promise<void>;
  ensureWorkspace: (projectToken: string, projectName: string) => Promise<Workspace>;
  linkProject: (sourcePath: string, linkType: LinkType, alias?: string) => Promise<LinkedProject | null>;
  unlinkProject: (linkedId: string) => Promise<void>;
  updateLinkedProject: (linkedId: string, fields: { alias?: string; sort_order?: number }) => Promise<void>;
  clearWorkspace: () => void;
  suggestedLinks: SuggestedLink[];
  scanning: boolean;
  scanDependencies: (projectPath: string) => Promise<void>;

  loadLinkedChildren: (linkedProjectToken: string, parentId?: string) => Promise<TreeNode[]>;

  crossSearchResults: Array<{
    id: string;
    title: string;
    titleHighlighted: string;
    snippet: string;
    score: number;
    breadcrumbs?: string;
    project_token: string;
    project_name: string;
    is_linked: boolean;
  }>;
  crossSearchLoading: boolean;
  crossProjectSearch: (query: string, scope?: string) => Promise<void>;
}

export const createWorkspaceSlice: SliceCreator<WorkspaceSlice> = (set, get) => ({
  workspace: null,
  linkedProjects: [],
  workspaceLoading: false,

  loadWorkspace: async (projectToken: string) => {
    set({ workspaceLoading: true });
    try {
      const ws = await window.api.getWorkspace(projectToken);
      if (ws) {
        const links = await window.api.listLinkedProjects(ws.id);
        set({ workspace: ws, linkedProjects: links });
      } else {
        set({ workspace: null, linkedProjects: [] });
      }
    } catch (e: any) {
      console.warn("[workspace] loadWorkspace failed:", e);
      get().addToast("error", "Failed to load workspace", e.message);
    } finally {
      set({ workspaceLoading: false });
    }
  },

  ensureWorkspace: async (projectToken: string, projectName: string) => {
    const ws = await window.api.getOrCreateWorkspace(projectToken, projectName);
    const links = await window.api.listLinkedProjects(ws.id);
    set({ workspace: ws, linkedProjects: links });
    return ws;
  },

  linkProject: async (sourcePath: string, linkType: LinkType, alias?: string) => {
    const { workspace } = get();
    if (!workspace) return null;
    try {
      const lp = await window.api.linkProject(workspace.id, sourcePath, linkType, alias);
      const links = await window.api.listLinkedProjects(workspace.id);
      set({ linkedProjects: links });
      return lp;
    } catch (e: any) {
      console.warn("[workspace] linkProject failed:", e);
      get().addToast("error", "Failed to link project", e.message);
      return null;
    }
  },

  unlinkProject: async (linkedId: string) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      await window.api.unlinkProject(workspace.id, linkedId);
      set({ linkedProjects: get().linkedProjects.filter((lp) => lp.id !== linkedId) });
      // Refresh tree to remove the linked project node
      get().loadRootTree();
    } catch (e: any) {
      console.warn("[workspace] unlinkProject failed:", e);
      get().addToast("error", "Failed to unlink project", e.message);
    }
  },

  updateLinkedProject: async (linkedId: string, fields: { alias?: string; sort_order?: number }) => {
    const { workspace } = get();
    if (!workspace) return;
    try {
      await window.api.updateLinkedProject(workspace.id, linkedId, fields);
      const links = await window.api.listLinkedProjects(workspace.id);
      set({ linkedProjects: links });
    } catch (e: any) {
      console.warn("[workspace] updateLinkedProject failed:", e);
      get().addToast("error", "Failed to update linked project", e.message);
    }
  },

  clearWorkspace: () => {
    set({
      workspace: null, linkedProjects: [], workspaceLoading: false,
      suggestedLinks: [], scanning: false,
      crossSearchResults: [], crossSearchLoading: false,
    });
  },

  loadLinkedChildren: async (linkedProjectToken: string, parentId?: string) => {
    try {
      return await window.api.getLinkedChildren(linkedProjectToken, parentId);
    } catch (e: any) {
      console.warn("[workspace] loadLinkedChildren failed:", e);
      return [];
    }
  },

  suggestedLinks: [],
  scanning: false,

  scanDependencies: async (projectPath: string) => {
    set({ scanning: true, suggestedLinks: [] });
    try {
      const links = await window.api.scanDependencies(projectPath);
      set({ suggestedLinks: links });
    } catch (e: any) {
      console.warn("[workspace] scanDependencies failed:", e);
    } finally {
      set({ scanning: false });
    }
  },

  crossSearchResults: [],
  crossSearchLoading: false,

  crossProjectSearch: async (query: string, scope?: string) => {
    const { currentProject } = get();
    if (!currentProject) return;
    if (!query.trim()) {
      set({ crossSearchResults: [], crossSearchLoading: false });
      return;
    }
    set({ crossSearchLoading: true });
    try {
      const results = await window.api.crossProjectSearch(currentProject.token, query, scope);
      set({ crossSearchResults: results, crossSearchLoading: false });
    } catch (e: any) {
      set({ crossSearchLoading: false });
      console.warn("[workspace] crossProjectSearch failed:", e);
    }
  },
});
