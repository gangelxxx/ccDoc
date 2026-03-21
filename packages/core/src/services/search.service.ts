import MiniSearch from "minisearch";
import { extractBody } from "./index.service.js";
import type { Section, SearchResult, SearchDocument } from "../types.js";

export class SearchService {
  private index: MiniSearch<SearchDocument>;

  constructor() {
    this.index = new MiniSearch<SearchDocument>({
      fields: ["title", "content"],
      storeFields: ["title", "content", "type", "project_token"],
      searchOptions: {
        boost: { title: 2 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  indexSection(section: Section, projectToken: string, projectName: string): void {
    const textContent = extractBody(section);

    // Remove existing document if present
    try {
      this.index.discard(section.id);
    } catch {
      // not indexed yet
    }

    this.index.add({
      id: section.id,
      project_token: projectToken,
      project_name: projectName,
      title: section.title,
      content: textContent,
      type: section.type,
      tags: [],
      updated_at: Date.now(),
    });
  }

  /** Tracks which document IDs belong to which project */
  private projectDocIds = new Map<string, Set<string>>();

  indexAll(sections: Section[], projectToken: string, projectName: string): void {
    // Remove only this project's existing documents
    const existingIds = this.projectDocIds.get(projectToken);
    if (existingIds) {
      for (const docId of existingIds) {
        try {
          this.index.discard(docId);
        } catch {
          // already removed
        }
      }
    }

    const newIds = new Set<string>();
    for (const section of sections) {
      if (!section.deleted_at) {
        this.indexSection(section, projectToken, projectName);
        newIds.add(section.id);
      }
    }
    this.projectDocIds.set(projectToken, newIds);
  }

  search(query: string, projectToken?: string): SearchResult[] {
    const results = this.index.search(query, {
      filter: projectToken
        ? (r) => (r as unknown as SearchDocument).project_token === projectToken
        : undefined,
    });

    return results.map((r) => ({
      id: r.id,
      title: (r as unknown as SearchDocument).title,
      content: (r as unknown as SearchDocument).content,
      type: (r as unknown as SearchDocument).type,
      score: r.score,
    }));
  }

  removeSection(id: string): void {
    try {
      this.index.discard(id);
    } catch {
      // not indexed
    }
    // Remove from project tracking
    for (const ids of this.projectDocIds.values()) {
      ids.delete(id);
    }
  }
}
