import { v4 as uuid } from "uuid";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import type { Client } from "@libsql/client";
import { ProjectsRepo } from "../db/projects.repo.js";
import { openProjectDb } from "../db/database.js";
import {
  PROJECT_MARKER_DIR,
  PROJECT_TOKEN_FILE,
  projectHistoryPath,
  projectBackupPath,
  PROJECTS_DIR,
} from "../constants.js";
import type { Project } from "../types.js";

async function rmWithRetry(path: string, maxAttempts = 5): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if ((err.code === "EBUSY" || err.code === "EPERM") && i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      // On Windows, locked files cannot be removed while the process holds them.
      // Swallow the error — the directory will be orphaned but harmless.
      if (err.code === "EBUSY" || err.code === "EPERM") {
        console.warn(`[rmWithRetry] Could not remove ${path} after ${maxAttempts} attempts (${err.code}), skipping.`);
        return;
      }
      throw err;
    }
  }
}

export class ProjectsService {
  private repo: ProjectsRepo;

  constructor(private appDb: Client) {
    this.repo = new ProjectsRepo(appDb);
  }

  async list(): Promise<Project[]> {
    return this.repo.list();
  }

  /** Remove orphaned project directories that are not in the registry */
  async cleanupOrphans(): Promise<void> {
    if (!existsSync(PROJECTS_DIR)) return;
    const registered = new Set((await this.repo.list()).map((p) => p.token));
    for (const entry of readdirSync(PROJECTS_DIR)) {
      if (!registered.has(entry)) {
        try {
          rmSync(join(PROJECTS_DIR, entry), { recursive: true, force: true });
          console.log(`[cleanup] Removed orphaned project dir: ${entry}`);
        } catch (err: any) {
          console.warn(`[cleanup] Could not remove orphan ${entry}: ${err.code}`);
        }
      }
    }
  }

  async getByToken(token: string): Promise<Project | null> {
    return this.repo.getByToken(token);
  }

  async addProject(name: string, projectPath: string): Promise<Project> {
    // Check if project.token already exists
    const markerDir = join(projectPath, PROJECT_MARKER_DIR);
    const tokenFile = join(markerDir, PROJECT_TOKEN_FILE);

    let token: string;

    if (existsSync(tokenFile)) {
      token = readFileSync(tokenFile, "utf-8").trim();
      // Update path if project moved
      const existing = await this.repo.getByToken(token);
      if (existing) {
        await this.repo.updatePath(token, projectPath);
        return { ...existing, path: projectPath };
      }
    } else {
      token = uuid();
      mkdirSync(markerDir, { recursive: true });
      writeFileSync(tokenFile, token, "utf-8");
    }

    // Create project directories
    mkdirSync(join(PROJECTS_DIR, token), { recursive: true });
    mkdirSync(projectHistoryPath(token), { recursive: true });

    // Register in app db
    await this.repo.create({ token, name, path: projectPath });

    // Initialize project db
    const projectDb = await openProjectDb(token);
    projectDb.close();

    const project = await this.repo.getByToken(token);
    return project!;
  }

  async removeProject(token: string): Promise<void> {
    // Get project path before removing from DB (to clean up .ccdoc marker)
    const project = await this.repo.getByToken(token);

    // Remove from app registry
    await this.repo.remove(token);

    // Delete project data directory (~/.ccdoc/projects/{token}/)
    // On Windows, SQLite WAL may hold file locks briefly after close — retry
    const projectDir = join(PROJECTS_DIR, token);
    if (existsSync(projectDir)) {
      await rmWithRetry(projectDir);
    }

    // Delete project backups (~/.ccdoc/backups/{token}/)
    const backupDir = projectBackupPath(token);
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }

    // Remove .ccdoc/ marker directory from project working directory
    if (project?.path) {
      const markerDir = join(project.path, PROJECT_MARKER_DIR);
      if (existsSync(markerDir)) {
        rmSync(markerDir, { recursive: true, force: true });
      }
    }
  }

  async touchProject(token: string): Promise<void> {
    await this.repo.touch(token);
  }

  async updateName(token: string, name: string): Promise<void> {
    await this.repo.updateName(token, name);
  }

  detectToken(projectPath: string): string | null {
    const tokenFile = join(projectPath, PROJECT_MARKER_DIR, PROJECT_TOKEN_FILE);
    if (existsSync(tokenFile)) {
      return readFileSync(tokenFile, "utf-8").trim();
    }
    return null;
  }
}
