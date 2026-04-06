import { randomUUID } from "crypto";
import type { Client } from "@libsql/client";
import type { SectionType } from "../types.js";
import { SectionsService } from "./sections.service.js";
import type { ProjectScanResult } from "./project-scanner.js";

export type GenerationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type GenerationMode = "full" | "incremental";

export interface GenerationJob {
  id: string;
  linked_project_id: string;
  mode: GenerationMode;
  status: GenerationStatus;
  phase: string;
  progress_pct: number;
  current_file: string | null;
  error: string | null;
  created_at: number;
}

export interface OutlineSection {
  title: string;
  type: SectionType;
  icon?: string;
  children?: OutlineSection[];
}

export class DocGenerationQueue {
  private jobs = new Map<string, GenerationJob>();

  enqueue(linkedProjectId: string, mode: GenerationMode = "full"): GenerationJob {
    this.cleanup();

    for (const job of this.jobs.values()) {
      if (job.linked_project_id === linkedProjectId && (job.status === "pending" || job.status === "running")) {
        throw new Error("A generation job is already active for this project");
      }
    }

    const job: GenerationJob = {
      id: randomUUID(),
      linked_project_id: linkedProjectId,
      mode,
      status: "pending",
      phase: "queued",
      progress_pct: 0,
      current_file: null,
      error: null,
      created_at: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(jobId: string): GenerationJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  getJobForProject(linkedProjectId: string): GenerationJob | null {
    for (const job of this.jobs.values()) {
      if (job.linked_project_id === linkedProjectId && (job.status === "pending" || job.status === "running")) {
        return job;
      }
    }
    return null;
  }

  updateJob(jobId: string, update: Partial<GenerationJob>): void {
    const job = this.jobs.get(jobId);
    if (job) Object.assign(job, update);
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && (job.status === "pending" || job.status === "running")) {
      job.status = "cancelled";
      job.phase = "cancelled";
    }
  }

  cleanup(maxAge = 3600_000): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.created_at > maxAge && job.status !== "running") {
        this.jobs.delete(id);
      }
    }
  }
}

export class DocOutlineGenerator {
  /** Generate a default documentation outline based on project scan results. */
  generateOutline(scan: ProjectScanResult): OutlineSection[] {
    const sections: OutlineSection[] = [];

    // Overview — always present
    sections.push({
      title: "Overview",
      type: "file",
      icon: "📋",
      children: [
        { title: "About", type: "section" },
        { title: "Tech Stack", type: "section" },
        { title: "Getting Started", type: "section" },
      ],
    });

    // Architecture — for projects with meaningful structure
    if (scan.totalFiles > 5) {
      sections.push({
        title: "Architecture",
        type: "file",
        icon: "🏗️",
        children: [
          { title: "Project Structure", type: "section" },
          { title: "Key Components", type: "section" },
          ...(scan.entryPoints.length > 0
            ? [{ title: "Entry Points", type: "section" as SectionType }]
            : []),
        ],
      });
    }

    // API Reference — for larger projects
    if (scan.totalFiles > 10) {
      sections.push({
        title: "API Reference",
        type: "file",
        icon: "📖",
      });
    }

    // Configuration — if config files discovered
    if (scan.configFiles.length > 0) {
      sections.push({
        title: "Configuration",
        type: "file",
        icon: "⚙️",
        children: scan.configFiles.slice(0, 5).map(f => ({
          title: f,
          type: "section" as SectionType,
        })),
      });
    }

    return sections;
  }

  /** Create the outline as sections in a project's database. */
  async createOutlineSections(
    projectDb: Client,
    outline: OutlineSection[],
    rootFolderId: string,
    onProgress?: (pct: number, title: string) => void,
  ): Promise<number> {
    const sections = new SectionsService(projectDb);
    let created = 0;
    const total = this.countSections(outline);

    for (const item of outline) {
      await this.createRecursive(sections, rootFolderId, item, () => {
        created++;
        onProgress?.(Math.round((created / total) * 100), item.title);
      });
    }
    return created;
  }

  private async createRecursive(
    sections: SectionsService,
    parentId: string,
    item: OutlineSection,
    onCreated: () => void,
  ): Promise<void> {
    const section = await sections.create({
      parentId,
      title: item.title,
      type: item.type,
      icon: item.icon,
    });
    onCreated();

    if (item.children && section) {
      for (const child of item.children) {
        await this.createRecursive(sections, section.id, child, onCreated);
      }
    }
  }

  private countSections(outline: OutlineSection[]): number {
    let count = 0;
    for (const item of outline) {
      count++;
      if (item.children) count += this.countSections(item.children);
    }
    return count;
  }
}

export class IncrementalUpdater {
  /**
   * Compare current project scan with existing documentation sections.
   * Returns lists of added/removed config file names that need doc updates.
   */
  detectChanges(
    scan: ProjectScanResult,
    existingSections: Array<{ title: string; updated_at: string }>,
  ): { added: string[]; modified: string[]; removed: string[] } {
    const existingTitles = new Set(existingSections.map(s => s.title.toLowerCase()));
    const currentFiles = new Set(scan.configFiles.map(f => f.toLowerCase()));

    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    // New config files not yet documented
    for (const file of scan.configFiles) {
      if (!existingTitles.has(file.toLowerCase())) {
        added.push(file);
      }
    }

    // Sections that look like config filenames but no longer exist on disk
    for (const section of existingSections) {
      if (section.title.includes(".") && !currentFiles.has(section.title.toLowerCase())) {
        removed.push(section.title);
      }
    }

    return { added, modified, removed };
  }

  /**
   * Apply incremental changes: create sections for new files, soft-delete for removed.
   */
  async applyChanges(
    projectDb: Client,
    rootFolderId: string,
    changes: { added: string[]; modified: string[]; removed: string[] },
    onProgress?: (pct: number, title: string) => void,
  ): Promise<{ added: number; removed: number }> {
    const sections = new SectionsService(projectDb);
    let addedCount = 0;
    const total = changes.added.length + changes.removed.length;
    let progress = 0;

    // Add sections for new config files
    for (const file of changes.added) {
      await sections.create({
        parentId: rootFolderId,
        title: file,
        type: "section",
      });
      addedCount++;
      progress++;
      onProgress?.(total > 0 ? Math.round((progress / total) * 100) : 100, file);
    }

    // Remove sections for deleted config files
    if (changes.removed.length > 0) {
      const allSections = await sections.listAll();
      for (const title of changes.removed) {
        const section = allSections.find(s => s.title.toLowerCase() === title.toLowerCase());
        if (section) {
          await sections.softDelete(section.id);
        }
        progress++;
        onProgress?.(total > 0 ? Math.round((progress / total) * 100) : 100, title);
      }
    }

    return { added: addedCount, removed: changes.removed.length };
  }
}
