import { randomUUID } from "crypto";
import type { Client } from "@libsql/client";
import { WorkspaceRepo } from "../db/workspace.repo.js";
import type { Workspace, LinkedProject, LinkType } from "../types.js";
import { CcdocDetector } from "./ccdoc-detector.js";
import type { CcdocDetectionResult } from "./ccdoc-detector.js";
import { ProjectResolver } from "./project-resolver.js";
import type { ResolvedProject } from "./project-resolver.js";
import { DependencyScanner } from "./dependency-scanner.js";
import type { SuggestedLink } from "./dependency-scanner.js";

export class WorkspaceService {
  private repo: WorkspaceRepo;
  private detector = new CcdocDetector();
  private resolver = new ProjectResolver();
  private scanner = new DependencyScanner();

  constructor(db: Client) {
    this.repo = new WorkspaceRepo(db);
  }

  async getOrCreateWorkspace(projectToken: string, projectName: string): Promise<Workspace> {
    const existing = await this.repo.getByProjectToken(projectToken);
    if (existing) return existing;

    const workspace: Omit<Workspace, "created_at" | "updated_at"> = {
      id: randomUUID(),
      name: projectName,
      icon: null,
      root_project_token: projectToken,
    };
    await this.repo.create(workspace);
    const created = await this.repo.getByProjectToken(projectToken);
    if (!created) throw new Error("Failed to create workspace");
    return created;
  }

  async getWorkspace(projectToken: string): Promise<Workspace | null> {
    return this.repo.getByProjectToken(projectToken);
  }

  async addLinkedProject(
    workspaceId: string,
    sourcePath: string,
    linkType: LinkType = "dependency",
    alias?: string,
  ): Promise<LinkedProject> {
    if (await this.repo.linkedProjectExists(workspaceId, sourcePath)) {
      throw new Error(`Project at "${sourcePath}" is already linked to this workspace`);
    }

    // Detect ccDoc in the target directory
    const detection = this.detector.detect(sourcePath);

    // Check circular dependency: if the target project has a workspace that links back to us
    if (detection.token) {
      const targetWorkspace = await this.repo.getByProjectToken(detection.token);
      if (targetWorkspace) {
        const currentWorkspace = await this.repo.getById(workspaceId);
        if (currentWorkspace) {
          const targetLinks = await this.repo.listLinkedProjects(targetWorkspace.id);
          const isCircular = targetLinks.some(
            link => link.project_token === currentWorkspace.root_project_token,
          );
          if (isCircular) {
            throw new Error("Circular dependency detected: the target project already links back to this workspace's root project");
          }
        }
      }
    }

    const id = randomUUID();
    const lp: Omit<LinkedProject, "added_at"> = {
      id,
      workspace_id: workspaceId,
      project_token: detection.token,
      source_path: sourcePath,
      alias: alias ?? null,
      icon: null,
      has_ccdoc: detection.has_ccdoc,
      doc_status: detection.has_ccdoc ? "loaded" : "none",
      link_type: linkType,
      sort_order: 0,
    };
    await this.repo.addLinkedProject(lp);
    const created = await this.repo.getLinkedProject(id);
    if (!created) throw new Error("Failed to read back linked project after insert");
    return created;
  }

  async removeLinkedProject(workspaceId: string, linkedId: string): Promise<void> {
    const lp = await this.repo.getLinkedProject(linkedId);
    if (!lp || lp.workspace_id !== workspaceId) {
      throw new Error("Linked project not found in this workspace");
    }
    await this.repo.removeLinkedProject(linkedId);
  }

  async updateLinkedProject(
    workspaceId: string,
    linkedId: string,
    fields: { alias?: string; icon?: string | null; sort_order?: number },
  ): Promise<void> {
    const lp = await this.repo.getLinkedProject(linkedId);
    if (!lp || lp.workspace_id !== workspaceId) {
      throw new Error("Linked project not found in this workspace");
    }
    await this.repo.updateLinkedProject(linkedId, fields);
  }

  async listLinkedProjects(workspaceId: string): Promise<LinkedProject[]> {
    return this.repo.listLinkedProjects(workspaceId);
  }

  detectCcdoc(projectPath: string): CcdocDetectionResult {
    return this.detector.detect(projectPath);
  }

  resolveProject(source: string, basePath: string, allowedRoots?: string[]): ResolvedProject {
    return this.resolver.resolve(source, basePath, allowedRoots);
  }

  scanDependencies(projectPath: string): SuggestedLink[] {
    return this.scanner.scan(projectPath);
  }

  /** Check for circular dependency: the linked project's workspace must not link back to root */
  async checkCircular(
    rootProjectToken: string,
    _targetSourcePath: string,
    allWorkspaces: Workspace[],
  ): Promise<boolean> {
    for (const ws of allWorkspaces) {
      const links = await this.repo.listLinkedProjects(ws.id);
      for (const link of links) {
        if (link.project_token === rootProjectToken) return true;
      }
    }
    return false;
  }
}
