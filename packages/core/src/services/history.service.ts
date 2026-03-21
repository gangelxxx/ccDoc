import git from "isomorphic-git";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { projectHistoryPath } from "../constants.js";
import { prosemirrorToMarkdown } from "../converters/prosemirror-to-markdown.js";
import { markdownToProsemirror } from "../converters/markdown-to-prosemirror.js";
import { kanbanToMarkdown, markdownToKanban } from "../converters/kanban.js";
import { ideaToPlain } from "../converters/idea.js";
import { sanitizeFilename } from "../utils.js";
import type { HistoryCommit, Section, StructureJson, StructureSection, ProseMirrorNode, KanbanData } from "../types.js";
import type { SectionsService } from "./sections.service.js";
import * as fs from "fs";

export class HistoryService {
  private dir: string;
  private hiddenFile: string;

  constructor(private token: string) {
    this.dir = projectHistoryPath(token);
    this.hiddenFile = join(this.dir, "..", "hidden-commits.json");
  }

  private getHiddenOids(): Set<string> {
    try {
      if (existsSync(this.hiddenFile)) {
        const data = JSON.parse(readFileSync(this.hiddenFile, "utf-8"));
        return new Set(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    return new Set();
  }

  private saveHiddenOids(oids: Set<string>): void {
    writeFileSync(this.hiddenFile, JSON.stringify([...oids]), "utf-8");
  }

  async init(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(join(this.dir, ".git"))) {
      await git.init({ fs, dir: this.dir, defaultBranch: "main" });
    }
  }

  async commit(
    sections: Section[],
    message: string,
    author: string = "CCDoc"
  ): Promise<string> {
    await this.init();

    // Skip empty commits — no point saving an empty snapshot
    const liveSections = sections.filter(s => !s.deleted_at);
    if (liveSections.length === 0) {
      return "";
    }

    const docsDir = join(this.dir, "docs");

    // Clean old files before writing new snapshot
    if (existsSync(docsDir)) {
      rmSync(docsDir, { recursive: true, force: true });
    }
    mkdirSync(docsDir, { recursive: true });

    // Build structure.json and export markdown files
    const structureSections = [];
    let sortIndex = 0;

    for (const section of sections) {
      if (section.deleted_at) continue;

      const sanitizedTitle = sanitizeFilename(section.title, section.id);
      const prefix = String(sortIndex++).padStart(2, "0");
      let fileName: string;
      let excalidrawBlocks: ReturnType<typeof extractExcalidrawBlocks> = [];

      if (section.type === "folder") {
        fileName = `${prefix}-${sanitizedTitle}/`;
        mkdirSync(join(docsDir, `${prefix}-${sanitizedTitle}`), { recursive: true });
      } else if (section.type === "excalidraw") {
        fileName = `${prefix}-${sanitizedTitle}.excalidraw`;
        const filePath = join(docsDir, fileName);
        mkdirSync(join(docsDir, fileName, ".."), { recursive: true });
        writeFileSync(filePath, section.content, "utf-8");
      } else if (section.type === "kanban") {
        fileName = `${prefix}-${sanitizedTitle}.md`;
        let data: KanbanData;
        try { data = JSON.parse(section.content); } catch (err) { console.warn(`[history] Failed to parse kanban content for ${section.id}:`, err); continue; }
        const markdown = kanbanToMarkdown(data);
        const filePath = join(docsDir, fileName);
        mkdirSync(join(docsDir, fileName, ".."), { recursive: true });
        writeFileSync(filePath, markdown, "utf-8");
      } else if (section.type === "idea") {
        fileName = `${prefix}-${sanitizedTitle}.md`;
        const markdown = ideaToPlain(section.content);
        const filePath = join(docsDir, fileName);
        mkdirSync(join(docsDir, fileName, ".."), { recursive: true });
        writeFileSync(filePath, markdown, "utf-8");
      } else {
        // file, section, todo — all ProseMirror-based
        fileName = `${prefix}-${sanitizedTitle}.md`;
        let doc: ProseMirrorNode;
        try { doc = JSON.parse(section.content); } catch (err) { console.warn(`[history] Failed to parse ProseMirror content for ${section.id}:`, err); continue; }
        const markdown = prosemirrorToMarkdown(doc);
        const filePath = join(docsDir, fileName);
        mkdirSync(join(docsDir, fileName, ".."), { recursive: true });
        writeFileSync(filePath, markdown, "utf-8");
        excalidrawBlocks = extractExcalidrawBlocks(doc);
      }

      structureSections.push({
        id: section.id,
        parent_id: section.parent_id,
        title: section.title,
        type: section.type,
        sort_key: section.sort_key,
        icon: section.icon,
        tags: [],
        file: fileName,
        excalidraw_blocks: excalidrawBlocks,
      });
    }

    const structure: StructureJson = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      sections: structureSections,
      tags: [],
    };

    writeFileSync(join(this.dir, "structure.json"), JSON.stringify(structure, null, 2), "utf-8");

    // Git add & commit
    await git.add({ fs, dir: this.dir, filepath: "." });

    // Remove deleted files from the git index (git.add doesn't handle deletions)
    const statusMatrix = await git.statusMatrix({ fs, dir: this.dir });
    for (const [filepath, headStatus, , stageStatus] of statusMatrix) {
      // headStatus=1 means file exists in HEAD; stageStatus=0 means absent from staging
      // This indicates a file that was deleted from disk but not removed from the index
      if (headStatus === 1 && stageStatus === 0) {
        await git.remove({ fs, dir: this.dir, filepath });
      }
    }

    const oid = await git.commit({
      fs,
      dir: this.dir,
      message,
      author: { name: author, email: "ccdoc@local" },
    });

    return oid;
  }

  async log(): Promise<HistoryCommit[]> {
    await this.init();
    try {
      const hidden = this.getHiddenOids();
      const commits = await git.log({ fs, dir: this.dir });
      return commits
        .filter((c) => !hidden.has(c.oid))
        .map((c) => ({
          oid: c.oid,
          message: c.commit.message,
          author: c.commit.author.name,
          timestamp: c.commit.author.timestamp,
        }));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "NotFoundError") {
        console.warn("[history] Failed to read git log:", err);
      }
      return [];
    }
  }

  async deleteCommit(oid: string): Promise<void> {
    const hidden = this.getHiddenOids();
    hidden.add(oid);
    this.saveHiddenOids(hidden);
  }

  async getStructureAtVersion(commitId: string): Promise<StructureSection[]> {
    await this.init();
    try {
      const { blob } = await git.readBlob({
        fs,
        dir: this.dir,
        oid: commitId,
        filepath: "structure.json",
      });
      const structure: StructureJson = JSON.parse(new TextDecoder().decode(blob));
      return structure.sections;
    } catch (err) {
      console.warn(`[history] Failed to read structure at commit ${commitId}:`, err);
      return [];
    }
  }

  async getSectionAtVersion(
    sectionId: string,
    commitId: string
  ): Promise<{ title: string; content: string } | null> {
    await this.init();

    // Read structure.json at that commit
    try {
      const { blob } = await git.readBlob({
        fs,
        dir: this.dir,
        oid: commitId,
        filepath: "structure.json",
      });
      const structure: StructureJson = JSON.parse(new TextDecoder().decode(blob));
      const sectionMeta = structure.sections.find((s) => s.id === sectionId);
      if (!sectionMeta || sectionMeta.type === "folder" || (sectionMeta.type as string) === "group") return null;

      // Read the file
      const { blob: fileBlob } = await git.readBlob({
        fs,
        dir: this.dir,
        oid: commitId,
        filepath: `docs/${sectionMeta.file}`,
      });
      const content = new TextDecoder().decode(fileBlob);

      return { title: sectionMeta.title, content };
    } catch (err) {
      console.warn(`[history] Failed to read section ${sectionId} at commit ${commitId}:`, err);
      return null;
    }
  }

  async searchAtVersion(
    commitId: string,
    query: string
  ): Promise<string[]> {
    await this.init();
    try {
      const { blob } = await git.readBlob({
        fs, dir: this.dir, oid: commitId, filepath: "structure.json",
      });
      const structure: StructureJson = JSON.parse(new TextDecoder().decode(blob));
      const fileToId = new Map<string, string>();
      for (const s of structure.sections) {
        if (s.type === "folder" || (s.type as string) === "group") continue;
        fileToId.set(`docs/${s.file}`, s.id);
      }

      // Use native git grep — blazing fast even for thousands of files
      const output = execSync(
        `git grep -l -i -F -- ${JSON.stringify(query)} ${commitId} -- docs/`,
        { cwd: this.dir, encoding: "utf-8", timeout: 10000 }
      ).trim();
      if (!output) return [];

      const matchingIds: string[] = [];
      for (const line of output.split("\n")) {
        // git grep output format: "commitOid:docs/filename"
        const filepath = line.replace(`${commitId}:`, "");
        if (fileToId.has(filepath)) {
          matchingIds.push(fileToId.get(filepath)!);
        }
      }
      return matchingIds;
    } catch (err: any) {
      // git grep exits with code 1 when no matches found
      if (err?.status === 1) return [];
      console.warn(`[history] searchAtVersion failed:`, err);
      return [];
    }
  }

  async getAllContentsAtVersion(
    commitId: string
  ): Promise<Record<string, string>> {
    await this.init();
    const result: Record<string, string> = {};
    try {
      console.time("[history] getAllContentsAtVersion");
      const { blob } = await git.readBlob({
        fs, dir: this.dir, oid: commitId, filepath: "structure.json",
      });
      const structure: StructureJson = JSON.parse(new TextDecoder().decode(blob));

      const sections = structure.sections.filter(
        s => s.type !== "folder" && (s.type as string) !== "group"
      );
      console.log(`[history] Reading ${sections.length} sections from commit ${commitId}`);

      for (const s of sections) {
        try {
          const { blob: fileBlob } = await git.readBlob({
            fs, dir: this.dir, oid: commitId, filepath: `docs/${s.file}`,
          });
          result[s.id] = new TextDecoder().decode(fileBlob);
        } catch (e) {
          console.warn(`[history] Failed to read docs/${s.file}:`, e);
        }
      }
      console.timeEnd("[history] getAllContentsAtVersion");
    } catch (err) {
      console.warn(`[history] getAllContentsAtVersion failed:`, err);
    }
    console.log(`[history] Loaded ${Object.keys(result).length} section contents`);
    return result;
  }

  /**
   * Compare current sections with last committed version.
   * Returns a human-readable diff summary (added/removed/changed titles + content snippets).
   */
  async getDiff(currentSections: Section[]): Promise<string> {
    await this.init();

    // Get last commit
    let lastOid: string | null = null;
    try {
      const commits = await git.log({ fs, dir: this.dir, depth: 1 });
      if (commits.length > 0) lastOid = commits[0].oid;
    } catch { /* no commits yet */ }

    const current = currentSections.filter(s => !s.deleted_at);
    const currentMap = new Map(current.map(s => [s.id, s]));

    if (!lastOid) {
      // No previous commit — everything is new
      const titles = current.map(s => s.title).slice(0, 30);
      return `New project. Sections: ${titles.join(", ")}`;
    }

    // Read previous structure
    let prevSections: StructureSection[] = [];
    try {
      const { blob } = await git.readBlob({
        fs, dir: this.dir, oid: lastOid, filepath: "structure.json",
      });
      const structure: StructureJson = JSON.parse(new TextDecoder().decode(blob));
      prevSections = structure.sections;
    } catch { return "Unable to read previous version"; }

    const prevMap = new Map(prevSections.map(s => [s.id, s]));
    const prevContents = new Map<string, string>();

    // Read previous file contents for changed sections
    for (const s of prevSections) {
      if (s.type === "folder" || (s.type as string) === "group") continue;
      try {
        const { blob } = await git.readBlob({
          fs, dir: this.dir, oid: lastOid, filepath: `docs/${s.file}`,
        });
        prevContents.set(s.id, new TextDecoder().decode(blob));
      } catch { /* skip */ }
    }

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    // Find added and changed
    for (const s of current) {
      if (s.type === "folder" || (s.type as string) === "group") continue;
      const prev = prevMap.get(s.id);
      if (!prev) {
        added.push(`${s.title} [${s.type}]`);
      } else {
        // Compare content: convert current to markdown for comparison
        const prevContent = prevContents.get(s.id) || "";
        let currentMd = "";
        try {
          if (s.type === "excalidraw") {
            currentMd = s.content;
          } else if (s.type === "kanban") {
            currentMd = kanbanToMarkdown(JSON.parse(s.content));
          } else if (s.type === "idea") {
            currentMd = ideaToPlain(s.content);
          } else {
            currentMd = prosemirrorToMarkdown(JSON.parse(s.content));
          }
        } catch { currentMd = s.content; }

        if (currentMd.trim() !== prevContent.trim()) {
          changed.push(`${s.title} [${s.type}]`);
        }
        if (prev.title !== s.title) {
          changed.push(`renamed: "${prev.title}" → "${s.title}"`);
        }
      }
    }

    // Find removed
    for (const s of prevSections) {
      if (!currentMap.has(s.id)) {
        removed.push(`${s.title} [${s.type}]`);
      }
    }

    const parts: string[] = [];
    if (added.length) parts.push(`Added: ${added.join(", ")}`);
    if (removed.length) parts.push(`Removed: ${removed.join(", ")}`);
    if (changed.length) parts.push(`Changed: ${changed.join(", ")}`);
    if (parts.length === 0) parts.push("No changes detected");

    return parts.join("\n");
  }

  /**
   * Return IDs of sections that differ between a given commit and current state.
   */
  async getDiffIds(commitOid: string, currentSections: Section[]): Promise<{ added: string[]; removed: string[]; changed: string[] }> {
    await this.init();
    const current = currentSections.filter(s => !s.deleted_at);
    const currentMap = new Map(current.map(s => [s.id, s]));

    let prevSections: StructureSection[] = [];
    try {
      const { blob } = await git.readBlob({ fs, dir: this.dir, oid: commitOid, filepath: "structure.json" });
      prevSections = (JSON.parse(new TextDecoder().decode(blob)) as StructureJson).sections;
    } catch { return { added: [], removed: [], changed: [] }; }

    const prevMap = new Map(prevSections.map(s => [s.id, s]));
    const prevContents = new Map<string, string>();

    for (const s of prevSections) {
      if (s.type === "folder" || (s.type as string) === "group") continue;
      try {
        const { blob } = await git.readBlob({ fs, dir: this.dir, oid: commitOid, filepath: `docs/${s.file}` });
        prevContents.set(s.id, new TextDecoder().decode(blob));
      } catch { /* skip */ }
    }

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const s of current) {
      if (s.type === "folder" || (s.type as string) === "group") continue;
      const prev = prevMap.get(s.id);
      if (!prev) { added.push(s.id); continue; }
      const prevContent = prevContents.get(s.id) || "";
      let currentMd = "";
      try {
        if (s.type === "excalidraw") currentMd = s.content;
        else if (s.type === "kanban") currentMd = kanbanToMarkdown(JSON.parse(s.content));
        else if (s.type === "idea") currentMd = ideaToPlain(s.content);
        else currentMd = prosemirrorToMarkdown(JSON.parse(s.content));
      } catch { currentMd = s.content; }
      if (currentMd.trim() !== prevContent.trim() || prev.title !== s.title) changed.push(s.id);
    }

    for (const s of prevSections) {
      if (!currentMap.has(s.id)) removed.push(s.id);
    }

    return { added, removed, changed };
  }

  async restore(
    commitId: string,
    sectionsService: SectionsService
  ): Promise<void> {
    await this.init();

    const { blob } = await git.readBlob({
      fs,
      dir: this.dir,
      oid: commitId,
      filepath: "structure.json",
    });
    const structure: StructureJson = JSON.parse(new TextDecoder().decode(blob));

    // Step 1: Hard-delete ALL current sections (clean slate)
    const db = (sectionsService as any).repo.db;
    await db.execute("DELETE FROM sections");

    // Step 2: Re-create all sections from the snapshot
    for (const sectionMeta of structure.sections) {
      try {
        let content = "";

        if (sectionMeta.type === "folder" || (sectionMeta.type as string) === "group") {
          // Folders have no file content
          content = "";
        } else {
          const { blob: fileBlob } = await git.readBlob({
            fs,
            dir: this.dir,
            oid: commitId,
            filepath: `docs/${sectionMeta.file}`,
          });
          const fileContent = new TextDecoder().decode(fileBlob);

          if (sectionMeta.type === "excalidraw") {
            content = fileContent;
          } else if (sectionMeta.type === "kanban") {
            content = JSON.stringify(markdownToKanban(fileContent));
          } else if (sectionMeta.type === "idea") {
            // Ideas stored as plain text — restore as single-message IdeaData
            const msgId = `restored-${Date.now()}`;
            content = JSON.stringify({ messages: [{ id: msgId, text: fileContent, createdAt: Date.now() }] });
          } else {
            // ProseMirror-based (file, section, todo)
            const doc = markdownToProsemirror(fileContent);

            // Re-insert excalidraw blocks (reverse order to preserve positions)
            if (sectionMeta.excalidraw_blocks.length > 0) {
              const sorted = [...sectionMeta.excalidraw_blocks].sort((a, b) => b.position - a.position);
              for (const eb of sorted) {
                if (doc.content && eb.position <= doc.content.length) {
                  doc.content.splice(eb.position, 0, {
                    type: "excalidraw",
                    attrs: {
                      name: eb.name,
                      elements: eb.elements,
                      appState: eb.appState,
                    },
                  });
                }
              }
            }

            content = JSON.stringify(doc);
          }
        }

        // Insert section directly into DB (bypass hierarchy validation — we trust the snapshot)
        await db.execute({
          sql: `INSERT INTO sections (id, parent_id, title, content, type, sort_key, icon)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            sectionMeta.id,
            sectionMeta.parent_id,
            sectionMeta.title,
            content,
            sectionMeta.type,
            sectionMeta.sort_key,
            sectionMeta.icon ?? null,
          ],
        });
      } catch (err) {
        console.warn(`[history] Failed to restore section ${sectionMeta.id}:`, err);
      }
    }

    // Step 3: Clear FTS text table (triggers will handle sections_fts)
    try {
      await db.execute("DELETE FROM sections_text");
    } catch (err) {
      console.warn("[history] Failed to clear FTS index:", err);
    }
  }
}

function extractExcalidrawBlocks(doc: ProseMirrorNode) {
  const blocks: { name: string; position: number; elements: unknown[]; appState: Record<string, unknown> }[] = [];
  if (!doc.content) return blocks;

  doc.content.forEach((node, index) => {
    if (node.type === "excalidraw" && node.attrs) {
      blocks.push({
        name: (node.attrs.name as string) || "Untitled",
        position: index,
        elements: (node.attrs.elements as unknown[]) || [],
        appState: (node.attrs.appState as Record<string, unknown>) || {},
      });
    }
  });

  return blocks;
}
