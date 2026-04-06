import type { Client } from "@libsql/client";
import { FtsRepo } from "../db/fts.repo.js";
import type { FtsSearchResult } from "../db/fts.repo.js";

export interface CrossProjectSearchResult {
  id: string;
  title: string;
  titleHighlighted: string;
  snippet: string;
  score: number;
  breadcrumbs: string;
  project_token: string;
  project_name: string;
  is_linked: boolean;
}

export type CrossProjectScope = "all" | "current_only";

/** Root project score multiplier — boosts root results above linked projects. */
const ROOT_BOOST = 1.5;

export class CrossProjectSearch {
  /**
   * Search across multiple project databases.
   *
   * Root project results are boosted by 1.5x so they appear higher
   * when relevance is similar. Linked projects get half the per-project
   * limit to keep the result set balanced.
   */
  async search(
    rootDb: Client,
    rootToken: string,
    rootName: string,
    linkedDbs: ReadonlyArray<{ db: Client; token: string; name: string }>,
    query: string,
    scope: CrossProjectScope = "all",
    limit = 20,
  ): Promise<CrossProjectSearchResult[]> {
    // Search root project
    const rootFts = new FtsRepo(rootDb);
    const rootResults = await rootFts.search(query, limit);

    const results: CrossProjectSearchResult[] = rootResults.map((r) => ({
      ...r,
      score: r.score * ROOT_BOOST,
      project_token: rootToken,
      project_name: rootName,
      is_linked: false,
    }));

    // Search linked projects in parallel
    if (scope === "all" && linkedDbs.length > 0) {
      const linkedLimit = Math.ceil(limit / 2);

      const settled = await Promise.allSettled(
        linkedDbs.map(async (linked) => {
          const fts = new FtsRepo(linked.db);
          const ftsResults = await fts.search(query, linkedLimit);
          return ftsResults.map((r): CrossProjectSearchResult => ({
            ...r,
            project_token: linked.token,
            project_name: linked.name,
            is_linked: true,
          }));
        }),
      );

      for (const result of settled) {
        if (result.status === "fulfilled") {
          results.push(...result.value);
        } else {
          console.warn("[cross-search] Linked project search failed:", result.reason);
        }
      }
    }

    // Sort by score descending, take top N
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
