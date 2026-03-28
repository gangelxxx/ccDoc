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

interface SectionNode extends Section {
  children: SectionNode[];
}

function buildExportTree(sections: Section[]): SectionNode[] {
  const map = new Map<string, SectionNode>();
  const roots: SectionNode[] = [];

  for (const s of sections) {
    if (s.deleted_at) continue;
    map.set(s.id, { ...s, children: [] });
  }

  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: SectionNode[]) => {
    nodes.sort((a, b) => a.sort_key.localeCompare(b.sort_key));
    for (const n of nodes) sortNodes(n.children);
  };
  sortNodes(roots);

  return roots;
}

function renderNodeMarkdown(node: SectionNode, headingLevel: number): string {
  if (node.type === "drawing" || node.type === "knowledge_graph") return "";

  const parts: string[] = [];
  const heading = "#".repeat(Math.min(headingLevel, 6));

  // For folders, only add heading (no content of their own)
  if (node.type === "folder" || (node.type as string) === "group") {
    parts.push(`${heading} ${node.title}`);
  } else {
    parts.push(`${heading} ${node.title}`);

    try {
      if (node.type === "kanban") {
        const data: KanbanData = JSON.parse(node.content);
        parts.push(kanbanToMarkdown(data));
      } else if (node.type === "idea") {
        const text = ideaToPlain(node.content);
        if (text.trim()) parts.push(text);
      } else {
        const doc: ProseMirrorNode = JSON.parse(node.content);
        const md = prosemirrorToMarkdown(doc);
        if (md.trim()) parts.push(md);
      }
    } catch { /* skip unparseable content */ }
  }

  for (const child of node.children) {
    const childMd = renderNodeMarkdown(child, headingLevel + 1);
    if (childMd.trim()) parts.push(childMd);
  }

  return parts.join("\n\n");
}

export class ExportService {
  constructor(private db: Client) {}

  async exportToMarkdown(sections: Section[], projectPath: string): Promise<void> {
    const docsDir = join(projectPath, EXPORT_DOCS_DIR);
    await this.writeToDir(sections, docsDir);
  }

  async writeToDir(sections: Section[], dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    const roots = buildExportTree(sections);
    await this.exportNodes(roots, dir);
  }

  private async exportNodes(nodes: SectionNode[], dir: string): Promise<void> {
    // Resolve unique names within this directory
    const usedNames = new Set<string>();

    const resolveName = (node: SectionNode): string => {
      let name = sanitizeFilename(node.title, node.id, false);
      if (!usedNames.has(name)) { usedNames.add(name); return name; }
      // Disambiguate with type
      const withType = `${name}-${node.type}`;
      if (!usedNames.has(withType)) { usedNames.add(withType); return withType; }
      // Still collides — add number
      let i = 2;
      while (usedNames.has(`${withType}-${i}`)) i++;
      const final = `${withType}-${i}`;
      usedNames.add(final);
      return final;
    };

    for (const node of nodes) {
      if (node.type === "knowledge_graph") continue;

      const name = resolveName(node);

      if (node.type === "drawing") {
        writeFileSync(join(dir, `${name}.drawing`), node.content, "utf-8");
        continue;
      }

      if (node.type === "folder" || (node.type as string) === "group") {
        const subdir = join(dir, name);
        mkdirSync(subdir, { recursive: true });
        await this.exportNodes(node.children, subdir);
        continue;
      }

      if (node.type === "idea") {
        await this.exportIdea(node, dir, name);
        continue;
      }

      // file, kanban, todo → .md in current dir
      await this.exportFileNode(node, dir, name);
    }
  }

  /** Idea → .md with idea text only; children (plans) → subfolder */
  private async exportIdea(node: SectionNode, dir: string, fileName: string): Promise<void> {
    // Idea text — without children
    const text = ideaToPlain(node.content);
    if (text.trim()) {
      await this.writeMd(dir, fileName, node, text);
    }

    // Plans (children) → subfolder with same name
    if (node.children.length) {
      const subdir = join(dir, fileName);
      mkdirSync(subdir, { recursive: true });
      await this.exportNodes(node.children, subdir);
    }
  }

  /** File/kanban/todo → single .md with all nested sections as headings */
  private async exportFileNode(node: SectionNode, dir: string, fileName: string): Promise<void> {
    const bodyParts: string[] = [];

    // Own content
    try {
      if (node.type === "kanban") {
        const data: KanbanData = JSON.parse(node.content);
        bodyParts.push(kanbanToMarkdown(data));
      } else {
        const doc: ProseMirrorNode = JSON.parse(node.content);
        const md = prosemirrorToMarkdown(doc);
        if (md.trim()) bodyParts.push(md);
      }
    } catch { /* skip unparseable content */ }

    // Children as ## headings
    for (const child of node.children) {
      const childMd = renderNodeMarkdown(child, 2);
      if (childMd.trim()) bodyParts.push(childMd);
    }

    if (!bodyParts.length) return;
    await this.writeMd(dir, fileName, node, bodyParts.join("\n\n"));
  }

  private async writeMd(dir: string, fileName: string, node: SectionNode, markdown: string): Promise<void> {
    const safeTitle = node.title.replace(/"/g, '\\"');
    const frontmatter = `---\nid: ${node.id}\ntitle: "${safeTitle}"\ntype: ${node.type}\nupdated: ${node.updated_at}\n---\n\n`;
    const fullContent = frontmatter + markdown;
    const filePath = join(dir, `${fileName}.md`);
    writeFileSync(filePath, fullContent, "utf-8");

    const hash = createHash("md5").update(fullContent).digest("hex");
    await this.db.execute({
      sql: `INSERT OR REPLACE INTO export_hashes (file_path, hash, exported_at) VALUES (?, ?, datetime('now'))`,
      args: [filePath, hash],
    });
  }
}
