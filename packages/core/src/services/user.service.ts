import type { Client } from "@libsql/client";
import type { Section, SectionType, TreeNode, OutputFormat, FileSectionNode, HistoryCommit } from "../types.js";
import { SectionsService } from "./sections.service.js";
import { FtsService } from "./fts.service.js";
import { IndexService } from "./index.service.js";
import { FindService } from "./find.service.js";
import { HistoryService } from "./history.service.js";
import { FtsRepo } from "../db/fts.repo.js";
import { EmbeddingRepo } from "../db/embedding.repo.js";
import { USER_TOKEN, USER_HISTORY_PATH } from "../constants.js";
import type { FindResult } from "./find.service.js";

export class UserService {
  readonly sections: SectionsService;
  readonly fts: FtsService;
  readonly index: IndexService;
  readonly find: FindService;
  readonly history: HistoryService;

  constructor(private db: Client) {
    this.sections = new SectionsService(db);
    this.fts = new FtsService(db);
    const ftsRepo = new FtsRepo(db);
    const embeddingRepo = new EmbeddingRepo(db);
    this.index = new IndexService(db, undefined, ftsRepo, null, embeddingRepo);
    this.find = new FindService(ftsRepo, embeddingRepo, null);
    this.history = new HistoryService(USER_TOKEN, USER_HISTORY_PATH);
  }

  // ── Tree ──────────────────────────────────────────────────

  getTree(): Promise<TreeNode[]> {
    return this.sections.getTree();
  }

  getRootTreeNodes(): Promise<TreeNode[]> {
    return this.sections.getRootTreeNodes();
  }

  getChildTreeNodes(parentId: string): Promise<TreeNode[]> {
    return this.sections.getChildTreeNodes(parentId);
  }

  // ── Read ──────────────────────────────────────────────────

  getById(id: string): Promise<Section | null> {
    return this.sections.getById(id);
  }

  getContent(id: string, format?: OutputFormat): Promise<string> {
    return this.sections.getContent(id, format);
  }

  getParentChain(id: string) {
    return this.sections.getParentChain(id);
  }

  getFileWithSections(fileId: string): Promise<{ file: Section; sections: FileSectionNode[] }> {
    return this.sections.getFileWithSections(fileId);
  }

  getSectionChildren(parentId: string): Promise<FileSectionNode[]> {
    return this.sections.getSectionChildren(parentId);
  }

  // ── Write ─────────────────────────────────────────────────

  async create(params: {
    parentId: string | null;
    title: string;
    type: SectionType;
    icon?: string | null;
    content?: string;
  }): Promise<Section | null> {
    const result = await this.sections.create(params);
    if (result) {
      this.index.indexSection(result).catch((err) => console.warn("[user-index]", err));
    }
    return result;
  }

  async update(id: string, title: string, content: string): Promise<void> {
    await this.sections.update(id, title, content);
    const updated = await this.sections.getById(id);
    if (updated) {
      this.index.indexSection(updated).catch((err) => console.warn("[user-index]", err));
    }
  }

  async updateRaw(id: string, title: string, prosemirrorJson: string): Promise<void> {
    await this.sections.updateRaw(id, title, prosemirrorJson);
    const updated = await this.sections.getById(id);
    if (updated) {
      this.index.indexSection(updated).catch((err) => console.warn("[user-index]", err));
    }
  }

  async updateIcon(id: string, icon: string | null): Promise<void> {
    await this.sections.updateIcon(id, icon);
  }

  async move(id: string, newParentId: string | null, afterId: string | null): Promise<void> {
    await this.sections.move(id, newParentId, afterId);
    const moved = await this.sections.getById(id);
    if (moved) {
      this.index.indexSection(moved).catch((err) => console.warn("[user-index]", err));
      this.index.reindexDescendants(id).catch((err) => console.warn("[user-index]", err));
    }
  }

  async duplicate(id: string): Promise<Section> {
    const result = await this.sections.duplicate(id);
    this.index.indexSection(result).catch((err) => console.warn("[user-index]", err));
    return result;
  }

  async softDelete(id: string): Promise<void> {
    await this.sections.softDelete(id);
    this.index.removeSection(id).catch((err) => console.warn("[user-index]", err));
  }

  async restore(id: string): Promise<void> {
    await this.sections.restore(id);
    const restored = await this.sections.getById(id);
    if (restored) {
      this.index.indexSection(restored).catch((err) => console.warn("[user-index]", err));
    }
  }

  // ── Markdown ──────────────────────────────────────────────

  buildSectionMarkdown(id: string): Promise<string> {
    return this.sections.buildSectionMarkdown(id);
  }

  // ── Search ────────────────────────────────────────────────

  search(query: string, limit?: number): Promise<FindResult[]> {
    return this.find.search(query, limit);
  }

  // ── Todos ─────────────────────────────────────────────────

  async getTodos(): Promise<TreeNode[]> {
    const tree = await this.sections.getTree();
    const result: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "todo") result.push(node);
        if (node.children?.length) walk(node.children);
      }
    };
    walk(tree);
    return result;
  }
}
