import type { Client } from "@libsql/client";
import type { Section } from "../types.js";
import { FtsRepo } from "../db/fts.repo.js";
import type { FtsSearchResult } from "../db/fts.repo.js";
import { IndexService, extractBody } from "./index.service.js";

export class FtsService {
  private repo: FtsRepo;
  private indexService: IndexService;

  constructor(db: Client) {
    this.repo = new FtsRepo(db);
    this.indexService = new IndexService(db, undefined, this.repo);
  }

  /** @deprecated Use IndexService.indexSection() instead */
  async indexSection(section: Section): Promise<void> {
    await this.indexService.indexSection(section);
  }

  async removeSection(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  /** @deprecated Use IndexService.reindexAll() instead */
  async reindexAll(sections: Section[]): Promise<void> {
    await this.indexService.reindexAll();
  }

  async search(query: string, limit?: number): Promise<FtsSearchResult[]> {
    return this.repo.search(query, limit);
  }

  async isIndexed(): Promise<boolean> {
    return (await this.repo.count()) > 0;
  }
}
