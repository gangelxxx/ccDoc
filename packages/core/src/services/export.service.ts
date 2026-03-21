import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { Client } from "@libsql/client";
import { prosemirrorToMarkdown } from "../converters/prosemirror-to-markdown.js";
import { kanbanToMarkdown } from "../converters/kanban.js";
import { ideaToPlain } from "../converters/idea.js";
import { EXPORT_DOCS_DIR } from "../constants.js";
import { sanitizeFilename } from "../utils.js";
import type { Section, ProseMirrorNode, KanbanData } from "../types.js";

export class ExportService {
  constructor(private db: Client) {}

  async exportToMarkdown(sections: Section[], projectPath: string): Promise<void> {
    const docsDir = join(projectPath, EXPORT_DOCS_DIR);
    await this.writeToDir(sections, docsDir);
  }

  async writeToDir(sections: Section[], dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });

    for (const section of sections) {
      if (section.deleted_at || section.type === "folder" || (section.type as string) === "group") continue;

      const sanitized = sanitizeFilename(section.title, section.id);
      let markdown: string;

      if (section.type === "excalidraw") {
        // Export .excalidraw file directly, no frontmatter
        const filePath = join(dir, `${sanitized}.excalidraw`);
        writeFileSync(filePath, section.content, "utf-8");
        continue;
      } else if (section.type === "kanban") {
        let data: KanbanData;
        try { data = JSON.parse(section.content); } catch (err) { console.warn(`[export] Failed to parse kanban content for ${section.id}:`, err); continue; }
        markdown = kanbanToMarkdown(data);
      } else if (section.type === "idea") {
        markdown = ideaToPlain(section.content);
      } else {
        let doc: ProseMirrorNode;
        try { doc = JSON.parse(section.content); } catch (err) { console.warn(`[export] Failed to parse ProseMirror content for ${section.id}:`, err); continue; }
        markdown = prosemirrorToMarkdown(doc);
      }

      const safeTitle = section.title.replace(/"/g, '\\"');
      const frontmatter = [
        "---",
        `id: ${section.id}`,
        `title: "${safeTitle}"`,
        `type: ${section.type}`,
        `updated: ${section.updated_at}`,
        "---",
        "",
      ].join("\n");

      const fullContent = frontmatter + markdown;
      const filePath = join(dir, `${sanitized}.md`);
      writeFileSync(filePath, fullContent, "utf-8");

      const hash = createHash("md5").update(fullContent).digest("hex");
      await this.db.execute({
        sql: `INSERT OR REPLACE INTO export_hashes (file_path, hash, exported_at) VALUES (?, ?, datetime('now'))`,
        args: [filePath, hash],
      });
    }
  }
}
