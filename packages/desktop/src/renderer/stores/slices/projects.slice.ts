import type { Project, SliceCreator } from "../types.js";

export interface ProjectsSlice {
  projects: Project[];
  currentProject: Project | null;
  loadProjects: () => Promise<void>;
  addProject: () => Promise<void>;
  selectProject: (project: Project) => Promise<void>;
  removeProject: (token: string) => Promise<void>;
}

export const createProjectsSlice: SliceCreator<ProjectsSlice> = (set, get) => ({
  projects: [],
  currentProject: null,

  loadProjects: async () => {
    try {
      const projects = await window.api.listProjects();
      set({ projects });
    } catch (e: any) {
      get().addToast("error", "Failed to load projects", e.message);
    }
  },

  addProject: async () => {
    try {
      const project = await window.api.addProject();
      if (project) {
        await get().loadProjects();
        await get().selectProject(project);
        get().addToast("success", "Project added", project.name);
        // Auto-install Claude Code plugin
        try {
          await window.api.installClaudePlugin(project.token);
        } catch {
          // Plugin install is optional — fail silently
        }
      }
    } catch (e: any) {
      get().addToast("error", "Failed to add project", e.message);
    }
  },

  selectProject: async (project) => {
    set({ treeLoading: true });
    try {
      set({ currentProject: project, currentSection: null, navHistory: [], navIndex: -1, canGoBack: false, canGoForward: false, historyViewCommit: null, historyViewSections: [], historyViewSectionId: null, historyViewContent: null, historyViewCurrentContent: null, history: [] });
      await window.api.touchProject(project.token);
      const tree = await window.api.getTree(project.token);
      set({ tree });
      get().loadHistory();
      get().loadPassport();
      get().loadProjects();
    } catch (e: any) {
      get().addToast("error", "Failed to load project", e.message);
    } finally {
      set({ treeLoading: false });
    }
  },

  removeProject: async (token) => {
    const taskId = get().startBgTask("Удаление проекта");
    try {
      await window.api.removeProject(token);
      const { currentProject } = get();
      if (currentProject?.token === token) {
        set({ currentProject: null, tree: [], currentSection: null });
      }
      await get().loadProjects();
      get().addToast("info", "Project removed");
    } catch (e: any) {
      get().addToast("error", "Failed to remove project", e.message);
    } finally {
      get().finishBgTask(taskId);
    }
  },
});
