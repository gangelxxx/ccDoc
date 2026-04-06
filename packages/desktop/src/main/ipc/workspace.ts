import { ipcMain, dialog } from "electron";
import {
  WorkspaceService, UnifiedTreeBuilder,
  ProjectScanner, DocGenerationQueue, DocOutlineGenerator, IncrementalUpdater,
  ProjectsService, openProjectDb, SectionsService, WorkspaceRepo,
  CrossProjectSearch, ProjectsRepo,
} from "@ccdoc/core";
import type { LinkType, GenerationJob, GenerationMode } from "@ccdoc/core";
import { getAppDb, getProjectServices, getMainWindow } from "../services";
import { invalidateSemanticIndex, triggerIndexing } from "./semantic";

let workspaceService: WorkspaceService | null = null;
const generationQueue = new DocGenerationQueue();
const scanner = new ProjectScanner();
const outlineGenerator = new DocOutlineGenerator();

/** Invalidate the main project's semantic index when linked projects change. */
function invalidateMainProjectIndex(workspaceId: string): void {
  const repo = new WorkspaceRepo(getAppDb());
  repo.getById(workspaceId).then(ws => {
    if (ws) {
      invalidateSemanticIndex(ws.root_project_token);
      triggerIndexing(ws.root_project_token);
    }
  }).catch(() => {});
}

/** Invalidate main project's semantic index by linked project ID (for post-generation). */
function invalidateMainProjectByLinkedId(linkedProjectId: string): void {
  const repo = new WorkspaceRepo(getAppDb());
  repo.getLinkedProject(linkedProjectId).then(lp => {
    if (lp) invalidateMainProjectIndex(lp.workspace_id);
  }).catch(() => {});
}

function getWorkspaceService(): WorkspaceService {
  if (!workspaceService) {
    workspaceService = new WorkspaceService(getAppDb());
  }
  return workspaceService;
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle("workspace:get", async (_e, projectToken: string) => {
    return getWorkspaceService().getWorkspace(projectToken);
  });

  ipcMain.handle("workspace:getOrCreate", async (_e, projectToken: string, projectName: string) => {
    return getWorkspaceService().getOrCreateWorkspace(projectToken, projectName);
  });

  ipcMain.handle("workspace:link", async (_e, workspaceId: string, sourcePath: string, linkType: string, alias?: string) => {
    const result = await getWorkspaceService().addLinkedProject(workspaceId, sourcePath, linkType as LinkType, alias);
    // Invalidate main project's semantic index so it rebuilds with the new linked project
    invalidateMainProjectIndex(workspaceId);
    return result;
  });

  ipcMain.handle("workspace:unlink", async (_e, workspaceId: string, linkedId: string) => {
    const result = await getWorkspaceService().removeLinkedProject(workspaceId, linkedId);
    // Invalidate main project's semantic index since a linked project was removed
    invalidateMainProjectIndex(workspaceId);
    return result;
  });

  ipcMain.handle("workspace:updateLink", async (_e, workspaceId: string, linkedId: string, fields: { alias?: string; icon?: string | null; sort_order?: number }) => {
    return getWorkspaceService().updateLinkedProject(workspaceId, linkedId, fields);
  });

  ipcMain.handle("workspace:listLinks", async (_e, workspaceId: string) => {
    return getWorkspaceService().listLinkedProjects(workspaceId);
  });

  ipcMain.handle("workspace:updateIcon", async (_e, workspaceId: string, icon: string | null) => {
    const appDb = getAppDb();
    const repo = new WorkspaceRepo(appDb);
    await repo.updateIcon(workspaceId, icon);
  });

  ipcMain.handle("workspace:detect", async (_e, projectPath: string) => {
    return getWorkspaceService().detectCcdoc(projectPath);
  });

  ipcMain.handle("workspace:resolve", async (_e, source: string, basePath: string) => {
    return getWorkspaceService().resolveProject(source, basePath, [basePath]);
  });

  ipcMain.handle("workspace:scanDeps", async (_e, projectPath: string) => {
    return getWorkspaceService().scanDependencies(projectPath);
  });

  ipcMain.handle("workspace:pickFolder", async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("workspace:unifiedTree", async (_e, projectToken: string, full?: boolean) => {
    const ws = getWorkspaceService();
    const workspace = await ws.getWorkspace(projectToken);

    // Get root project tree (lazy or full)
    const { sections } = await getProjectServices(projectToken);
    const rootTree = full
      ? await sections.getTree()
      : await sections.getRootTreeNodes();

    if (!workspace) return rootTree;

    // Get linked projects and build unified tree (always wrap in workspace-root)
    const linkedProjects = await ws.listLinkedProjects(workspace.id);

    const builder = new UnifiedTreeBuilder(async (token: string) => {
      const services = await getProjectServices(token);
      return services.db;
    });

    // Get project name and workspace icon for the root wrapper node
    const projectsRepo = new ProjectsRepo(getAppDb());
    const project = await projectsRepo.getByToken(projectToken);
    const rootProjectName = project?.name || "Project";
    const rootProjectIcon = workspace.icon || null;

    return builder.build(rootTree, linkedProjects, { rootProjectName, rootProjectIcon });
  });

  ipcMain.handle("workspace:linkedChildren", async (_e, projectToken: string, parentId?: string) => {
    const builder = new UnifiedTreeBuilder(async (token: string) => {
      const services = await getProjectServices(token);
      return services.db;
    });
    return builder.loadLinkedProjectChildren(projectToken, parentId);
  });

  // --- Doc generation ---

  ipcMain.handle("workspace:scanProject", async (_e, projectPath: string) => {
    return scanner.scan(projectPath);
  });

  ipcMain.handle("workspace:checkLimits", async (_e, projectPath: string) => {
    const result = scanner.scan(projectPath);
    return {
      ...scanner.checkLimits(result),
      totalFiles: result.totalFiles,
      totalLoc: result.totalLoc,
      language: result.language,
      frameworks: result.frameworks,
    };
  });

  ipcMain.handle("workspace:generateDocs", async (_e, linkedProjectId: string, _workspaceId: string, mode: string = "full") => {
    const appDb = getAppDb();
    const repo = new WorkspaceRepo(appDb);
    const lp = await repo.getLinkedProject(linkedProjectId);
    if (!lp) throw new Error("Linked project not found");

    const existingJob = generationQueue.getJobForProject(linkedProjectId);
    if (existingJob) throw new Error("Generation already in progress");

    const generationMode = (mode === "incremental" ? "incremental" : "full") as GenerationMode;
    const job = generationQueue.enqueue(linkedProjectId, generationMode);
    await repo.updateLinkedProject(linkedProjectId, { doc_status: "generating" });

    // Run generation in background (don't await)
    runGeneration(job, lp.source_path, linkedProjectId, appDb).catch(err => {
      console.error("[workspace:generateDocs] generation failed:", err);
    });

    return job;
  });

  ipcMain.handle("workspace:generationStatus", async (_e, jobId: string) => {
    return generationQueue.getJob(jobId);
  });

  ipcMain.handle("workspace:cancelGeneration", async (_e, jobId: string) => {
    generationQueue.cancel(jobId);
  });

  ipcMain.handle("workspace:crossSearch", async (_e, projectToken: string, query: string, scope: string) => {
    const ws = getWorkspaceService();
    const workspace = await ws.getWorkspace(projectToken);
    const { db: rootDb } = await getProjectServices(projectToken);

    // Get project name
    const appDb = getAppDb();
    const projectsRepo = new ProjectsRepo(appDb);
    const project = await projectsRepo.getByToken(projectToken);
    const rootName = project?.name || "Current Project";

    // Get linked project DBs
    const linkedDbs: Array<{ db: import("@libsql/client").Client; token: string; name: string }> = [];
    if (workspace && scope !== "current_only") {
      const links = await ws.listLinkedProjects(workspace.id);
      for (const lp of links) {
        if (lp.doc_status === "loaded" && lp.project_token) {
          try {
            const { db } = await getProjectServices(lp.project_token);
            linkedDbs.push({
              db,
              token: lp.project_token,
              name: lp.alias || lp.source_path.split(/[\\/]/).pop() || "unnamed",
            });
          } catch (err) {
            console.warn(`[workspace:crossSearch] Failed to open linked project ${lp.source_path}:`, err);
          }
        }
      }
    }

    const search = new CrossProjectSearch();
    const validScope = scope === "current_only" ? "current_only" : "all";
    return search.search(rootDb, projectToken, rootName, linkedDbs, query, validScope);
  });
}

async function runGeneration(
  job: GenerationJob,
  sourcePath: string,
  linkedProjectId: string,
  appDb: import("@libsql/client").Client,
): Promise<void> {
  const repo = new WorkspaceRepo(appDb);
  const projectsService = new ProjectsService(appDb);
  let createdProject: { token: string; name: string } | null = null;

  const rollbackProject = async () => {
    if (createdProject) {
      try { await projectsService.removeProject(createdProject.token); } catch {}
      await repo.updateLinkedProject(linkedProjectId, { doc_status: "none", project_token: null, has_ccdoc: false });
    }
  };

  try {
    // Phase 1: Scan
    generationQueue.updateJob(job.id, { status: "running", phase: "scanning", progress_pct: 10 });
    const scanResult = scanner.scan(sourcePath);

    if (job.status === "cancelled") {
      await repo.updateLinkedProject(linkedProjectId, { doc_status: "none" });
      return;
    }

    // Incremental mode: detect changes and apply to existing docs
    if (job.mode === "incremental") {
      const lp = await repo.getLinkedProject(linkedProjectId);
      if (lp?.project_token) {
        generationQueue.updateJob(job.id, { phase: "detecting_changes", progress_pct: 30 });
        const projectDb = await openProjectDb(lp.project_token);
        const sectionsService = new SectionsService(projectDb);
        const existingSections = await sectionsService.listAll();

        const updater = new IncrementalUpdater();
        const changes = updater.detectChanges(
          scanResult,
          existingSections.map(s => ({ title: s.title, updated_at: s.updated_at })),
        );

        if (changes.added.length === 0 && changes.removed.length === 0) {
          generationQueue.updateJob(job.id, { status: "completed", phase: "no_changes", progress_pct: 100, current_file: null });
          await repo.updateLinkedProject(linkedProjectId, { doc_status: "loaded" });
          getMainWindow()?.webContents.send("workspace:generation-complete", { linkedProjectId, jobId: job.id });
          invalidateMainProjectByLinkedId(linkedProjectId);
          return;
        }

        // Find root folder for inserting new sections
        const roots = existingSections.filter(s => !s.parent_id);
        const rootFolderId = roots[0]?.id;
        if (!rootFolderId) throw new Error("No root folder found in existing docs");

        generationQueue.updateJob(job.id, { phase: "applying_changes", progress_pct: 50 });
        await updater.applyChanges(projectDb, rootFolderId, changes, (pct, title) => {
          generationQueue.updateJob(job.id, { progress_pct: 50 + Math.round(pct * 0.4), current_file: title });
        });

        generationQueue.updateJob(job.id, { status: "completed", phase: "done", progress_pct: 100, current_file: null });
        await repo.updateLinkedProject(linkedProjectId, { doc_status: "loaded" });
        getMainWindow()?.webContents.send("workspace:generation-complete", { linkedProjectId, jobId: job.id });
        invalidateMainProjectByLinkedId(linkedProjectId);
        return;
      }
      // No existing project_token — fall through to full generation
    }

    // Phase 2: Create ccDoc project for the linked project
    generationQueue.updateJob(job.id, { phase: "creating_project", progress_pct: 20 });
    const projectName = scanResult.name;
    const project = await projectsService.addProject(projectName + " (docs)", sourcePath);
    createdProject = project;

    await repo.updateLinkedProject(linkedProjectId, {
      project_token: project.token,
      has_ccdoc: true,
    });

    if (job.status === "cancelled") { await rollbackProject(); return; }

    // Phase 3: Generate outline
    generationQueue.updateJob(job.id, { phase: "generating_outline", progress_pct: 40 });
    const outline = outlineGenerator.generateOutline(scanResult);

    if (job.status === "cancelled") { await rollbackProject(); return; }

    // Phase 4: Create sections
    generationQueue.updateJob(job.id, { phase: "creating_sections", progress_pct: 50 });
    const projectDb = await openProjectDb(project.token);

    const sections = new SectionsService(projectDb);
    const rootFolder = await sections.create({
      parentId: null,
      title: projectName,
      type: "folder",
      icon: "\uD83D\uDCC1",
    });

    if (!rootFolder) throw new Error("Failed to create root folder");

    await outlineGenerator.createOutlineSections(
      projectDb,
      outline,
      rootFolder.id,
      (pct, title) => {
        generationQueue.updateJob(job.id, {
          progress_pct: 50 + Math.round(pct * 0.4),
          current_file: title,
        });
      },
    );

    // Phase 5: Done
    generationQueue.updateJob(job.id, {
      status: "completed",
      phase: "done",
      progress_pct: 100,
      current_file: null,
    });

    await repo.updateLinkedProject(linkedProjectId, { doc_status: "loaded" });

    getMainWindow()?.webContents.send("workspace:generation-complete", {
      linkedProjectId,
      jobId: job.id,
    });
    invalidateMainProjectByLinkedId(linkedProjectId);
  } catch (err: any) {
    generationQueue.updateJob(job.id, {
      status: "failed",
      phase: "error",
      error: err.message,
    });
    if (createdProject) {
      await rollbackProject();
    } else {
      await repo.updateLinkedProject(linkedProjectId, { doc_status: "error" });
    }
  }
}
