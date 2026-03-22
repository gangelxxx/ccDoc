import type { Client } from "@libsql/client";
import type { Section, ProseMirrorNode, KanbanData } from "../types.js";
import { SectionsRepo } from "../db/sections.repo.js";
import { FtsRepo } from "../db/fts.repo.js";
import { EmbeddingRepo } from "../db/embedding.repo.js";
import { extractTextForSearch } from "../converters/prosemirror-text-extractor.js";
import { kanbanToPlain } from "../converters/kanban.js";
import { ideaToPlain } from "../converters/idea.js";
import type { EmbeddingModel } from "./embedding.service.js";
import { textHash } from "./embedding.service.js";

/** Bump this when extractBody() logic changes to trigger automatic reindex. */
export const INDEX_VERSION = 2;

export class IndexService {
  private sectionsRepo: SectionsRepo;
  private ftsRepo: FtsRepo;
  private embeddingRepo: EmbeddingRepo;

  constructor(
    private db: Client,
    sectionsRepo?: SectionsRepo,
    ftsRepo?: FtsRepo,
    private embeddingModel?: EmbeddingModel | null,
    embeddingRepo?: EmbeddingRepo
  ) {
    this.sectionsRepo = sectionsRepo ?? new SectionsRepo(db);
    this.ftsRepo = ftsRepo ?? new FtsRepo(db);
    this.embeddingRepo = embeddingRepo ?? new EmbeddingRepo(db);
  }

  async indexSection(section: Section): Promise<void> {
    const breadcrumbs = await this.buildBreadcrumbs(section.parent_id);
    const tags = await this.buildTags(section.id);
    const body = extractBody(section);
    await this.ftsRepo.upsert(section.id, section.title, tags, breadcrumbs, body);

    // Update embedding if model is available
    if (this.embeddingModel?.isAvailable()) {
      await this.updateEmbedding(section.id, breadcrumbs, section.title, tags, body);
    }
  }

  async removeSection(id: string): Promise<void> {
    await this.ftsRepo.delete(id);
    await this.embeddingRepo.delete(id);
  }

  async reindexDescendants(parentId: string): Promise<void> {
    const children = await this.sectionsRepo.getChildren(parentId);
    for (const child of children) {
      await this.indexSection(child);
      await this.reindexDescendants(child.id);
    }
  }

  async reindexAll(): Promise<void> {
    const allSections = await this.sectionsRepo.list(false);

    // Pre-build breadcrumbs map for efficiency
    const parentMap = new Map<string, { title: string; parent_id: string | null }>();
    for (const s of allSections) {
      parentMap.set(s.id, { title: s.title, parent_id: s.parent_id });
    }

    // Pre-fetch all tags
    const tagsMap = await this.buildAllTags();

    const items = allSections.map((s) => ({
      id: s.id,
      title: s.title,
      tags: tagsMap.get(s.id) ?? "",
      breadcrumbs: this.buildBreadcrumbsFromMap(s.parent_id, parentMap),
      body: extractBody(s),
    }));

    await this.ftsRepo.reindexAll(items);

    // Reindex embeddings if model available
    if (this.embeddingModel?.isAvailable()) {
      const loaded = await this.embeddingModel.load();
      if (loaded) {
        console.log(`[index] Reindexing embeddings for ${items.length} sections...`);
        await this.embeddingRepo.deleteAll();
        for (const item of items) {
          try {
            const text = [item.breadcrumbs, item.title, item.tags, item.body]
              .filter(Boolean)
              .join(" ");
            const hash = textHash(text);
            const embedding = await this.embeddingModel.encode(text);
            await this.embeddingRepo.upsert(item.id, embedding, hash);
          } catch (err) {
            console.warn(`[index] Failed to compute embedding for ${item.id}:`, err);
          }
        }
        console.log("[index] Embedding reindex complete");
      }
    }
  }

  private async updateEmbedding(
    sectionId: string,
    breadcrumbs: string,
    title: string,
    tags: string,
    body: string
  ): Promise<void> {
    try {
      const text = [breadcrumbs, title, tags, body].filter(Boolean).join(" ");
      const hash = textHash(text);

      // Skip if text hasn't changed
      const existingHash = await this.embeddingRepo.getTextHash(sectionId);
      if (existingHash === hash) return;

      const loaded = await this.embeddingModel!.load();
      if (!loaded) return;

      const embedding = await this.embeddingModel!.encode(text);
      await this.embeddingRepo.upsert(sectionId, embedding, hash);
    } catch (err) {
      console.warn(`[index] Failed to update embedding for ${sectionId}:`, err);
    }
  }

  private async buildBreadcrumbs(parentId: string | null): Promise<string> {
    const titles: string[] = [];
    const visited = new Set<string>();
    let currentId = parentId;
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const parent = await this.sectionsRepo.getById(currentId);
      if (!parent) break;
      titles.unshift(parent.title);
      currentId = parent.parent_id;
    }
    return titles.join(" ");
  }

  private buildBreadcrumbsFromMap(
    parentId: string | null,
    map: Map<string, { title: string; parent_id: string | null }>
  ): string {
    const titles: string[] = [];
    const visited = new Set<string>();
    let currentId = parentId;
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const entry = map.get(currentId);
      if (!entry) break;
      titles.unshift(entry.title);
      currentId = entry.parent_id;
    }
    return titles.join(" ");
  }

  private async buildTags(sectionId: string): Promise<string> {
    const result = await this.db.execute({
      sql: `SELECT t.name FROM tags t
            JOIN section_tags st ON st.tag_id = t.id
            WHERE st.section_id = ?`,
      args: [sectionId],
    });
    return result.rows.map((r) => r.name as string).join(" ");
  }

  private async buildAllTags(): Promise<Map<string, string>> {
    const result = await this.db.execute(
      `SELECT st.section_id, GROUP_CONCAT(t.name, ' ') AS tags
       FROM section_tags st
       JOIN tags t ON t.id = st.tag_id
       GROUP BY st.section_id`
    );
    const map = new Map<string, string>();
    for (const row of result.rows) {
      map.set(row.section_id as string, row.tags as string);
    }
    return map;
  }
}

export function extractBody(section: Section): string {
  try {
    if (section.type === "kanban") {
      const data: KanbanData = JSON.parse(section.content);
      return kanbanToPlain(data);
    }
    if (section.type === "drawing") {
      return section.title;
    }
    if (section.type === "idea") {
      return ideaToPlain(section.content);
    }
    const doc: ProseMirrorNode = JSON.parse(section.content);
    return extractTextForSearch(doc);
  } catch (err) {
    console.warn(`[index] Failed to extract text for section ${section.id}:`, err);
    return section.title;
  }
}
