import type { FtsRepo, FtsSearchResult } from "../db/fts.repo.js";
import type { EmbeddingRepo } from "../db/embedding.repo.js";
import type { EmbeddingModel } from "./embedding.service.js";
import { cosineSimilarity } from "./embedding.service.js";

export interface FindResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  breadcrumbs: string;
}

const FTS_WEIGHT = 0.6;
const EMBEDDING_WEIGHT = 0.4;

export class FindService {
  constructor(
    private ftsRepo: FtsRepo,
    private embeddingRepo: EmbeddingRepo,
    private embeddingModel: EmbeddingModel | null
  ) {}

  async search(query: string, limit = 5): Promise<FindResult[]> {
    // Always run FTS5
    const ftsResults = await this.ftsRepo.search(query, limit * 2);

    // Try embedding search if model is available
    const embeddingAvailable = this.embeddingModel?.isAvailable() ?? false;
    let embeddingResults: { id: string; score: number }[] = [];

    if (embeddingAvailable && this.embeddingModel) {
      try {
        const loaded = await this.embeddingModel.load();
        if (loaded) {
          embeddingResults = await this.embeddingSearch(query, limit * 2);
        }
      } catch (err) {
        console.warn("[find] Embedding search failed, using FTS only:", err);
      }
    }

    // If no embedding results, return FTS as-is
    if (embeddingResults.length === 0) {
      return ftsResults.slice(0, limit).map(toFindResult);
    }

    // Merge: normalize scores and combine
    return this.mergeResults(ftsResults, embeddingResults, limit);
  }

  private async embeddingSearch(query: string, limit: number): Promise<{ id: string; score: number }[]> {
    const queryVec = await this.embeddingModel!.encodeQuery(query);
    const allEmbeddings = await this.embeddingRepo.getAll();

    const scored = allEmbeddings.map((row) => ({
      id: row.section_id,
      score: cosineSimilarity(queryVec, row.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  private mergeResults(
    ftsResults: FtsSearchResult[],
    embeddingResults: { id: string; score: number }[],
    limit: number
  ): FindResult[] {
    // Normalize FTS scores to [0, 1]
    const ftsMax = ftsResults.length > 0 ? Math.max(...ftsResults.map((r) => r.score)) : 1;
    const ftsNorm = ftsMax > 0 ? ftsMax : 1;

    // Cosine similarity is already in [-1, 1], shift to [0, 1]
    const embMap = new Map<string, number>();
    for (const r of embeddingResults) {
      embMap.set(r.id, (r.score + 1) / 2);
    }

    const ftsMap = new Map<string, { result: FtsSearchResult; normScore: number }>();
    for (const r of ftsResults) {
      ftsMap.set(r.id, { result: r, normScore: r.score / ftsNorm });
    }

    // Collect all unique IDs
    const allIds = new Set<string>([
      ...ftsResults.map((r) => r.id),
      ...embeddingResults.map((r) => r.id),
    ]);

    const merged: { id: string; score: number; ftsResult?: FtsSearchResult }[] = [];

    for (const id of allIds) {
      const ftsEntry = ftsMap.get(id);
      const embScore = embMap.get(id);

      let combinedScore: number;
      if (ftsEntry && embScore !== undefined) {
        combinedScore = FTS_WEIGHT * ftsEntry.normScore + EMBEDDING_WEIGHT * embScore;
      } else if (ftsEntry) {
        combinedScore = FTS_WEIGHT * ftsEntry.normScore;
      } else {
        combinedScore = EMBEDDING_WEIGHT * (embScore ?? 0);
      }

      merged.push({ id, score: combinedScore, ftsResult: ftsEntry?.result });
    }

    merged.sort((a, b) => b.score - a.score);

    return merged.slice(0, limit).map((m) => {
      if (m.ftsResult) {
        return { ...toFindResult(m.ftsResult), score: m.score };
      }
      // Embedding-only result — no snippet available
      return {
        id: m.id,
        title: "",
        snippet: "",
        score: m.score,
        breadcrumbs: "",
      };
    });
  }
}

function toFindResult(r: FtsSearchResult): FindResult {
  return {
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    score: r.score,
    breadcrumbs: r.breadcrumbs,
  };
}
