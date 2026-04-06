import { describe, it, expect, vi } from "vitest";
import { FindService } from "../services/find.service.js";
import type { FtsRepo, FtsSearchResult } from "../db/fts.repo.js";
import type { EmbeddingRepo } from "../db/embedding.repo.js";
import type { IEmbeddingProvider } from "../services/embedding.service.js";

function makeFtsResult(overrides: Partial<FtsSearchResult> & { id: string }): FtsSearchResult {
  return {
    title: "Title",
    titleHighlighted: "Title",
    snippet: "snippet text",
    score: 1.0,
    breadcrumbs: "",
    ...overrides,
  };
}

function mockFtsRepo(results: FtsSearchResult[]): FtsRepo {
  return {
    search: vi.fn().mockResolvedValue(results),
    upsert: vi.fn(),
    delete: vi.fn(),
    reindexAll: vi.fn(),
    count: vi.fn().mockResolvedValue(results.length),
    getByIds: vi.fn().mockResolvedValue(new Map()),
  } as unknown as FtsRepo;
}

function mockEmbeddingRepo(embeddings: { section_id: string; embedding: Float32Array; text_hash: string }[] = []): EmbeddingRepo {
  return {
    getAll: vi.fn().mockResolvedValue(embeddings),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    count: vi.fn().mockResolvedValue(embeddings.length),
    getTextHash: vi.fn().mockResolvedValue(null),
  } as unknown as EmbeddingRepo;
}

function mockEmbeddingModel(queryVec: Float32Array): IEmbeddingProvider {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(true),
    encode: vi.fn().mockResolvedValue(queryVec),
    encodeQuery: vi.fn().mockResolvedValue(queryVec),
    dimension: queryVec.length,
  } as unknown as IEmbeddingProvider;
}

describe("FindService.search", () => {
  it("FTS-only: no embedding model → returns FTS results", async () => {
    const ftsResults = [
      makeFtsResult({ id: "id-1", title: "Kanban board", score: 2.0 }),
      makeFtsResult({ id: "id-2", title: "Kanban overview", score: 1.5 }),
    ];
    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), null);

    const results = await service.search("kanban", 5);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("id-1");
    expect(results[1].id).toBe("id-2");
  });

  it("FTS-only: limit is respected", async () => {
    const ftsResults = Array.from({ length: 10 }, (_, i) =>
      makeFtsResult({ id: `id-${i}`, title: `Section ${i}`, score: 10 - i })
    );
    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), null);

    const results = await service.search("section", 3);
    expect(results).toHaveLength(3);
  });

  it("empty FTS results → []", async () => {
    const service = new FindService(mockFtsRepo([]), mockEmbeddingRepo(), null);

    const results = await service.search("nothing", 5);
    expect(results).toHaveLength(0);
  });

  it("hybrid merge: combines FTS and embedding results", async () => {
    const ftsResults = [makeFtsResult({ id: "id-fts", title: "FTS result", score: 2.0 })];

    // Embedding returns a different section with high similarity
    // Vector [1, 0] will have cosine similarity 1.0 with itself
    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-emb", embedding: vec, text_hash: "hash1" },
    ]);
    const model = mockEmbeddingModel(vec);

    const service = new FindService(mockFtsRepo(ftsResults), embeddingRepo, model);
    const results = await service.search("query", 5);

    const ids = results.map((r) => r.id);
    expect(ids).toContain("id-fts");
    expect(ids).toContain("id-emb");
  });

  it("embedding-only result appears in merged list with empty title", async () => {
    // FTS found nothing, embedding found something
    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-emb-only", embedding: vec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(vec);

    const service = new FindService(mockFtsRepo([]), embeddingRepo, model);
    const results = await service.search("query", 5);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-emb-only");
    expect(results[0].title).toBe(""); // no FTS data — title is empty
  });

  it("cross-script via embedding: Cyrillic query finds Latin section", async () => {
    // Scenario: FTS cannot find Cyrillic query in a database with Latin text
    // Embedding model returns the same vector for both (semantically close)
    const sharedVec = new Float32Array([0.6, 0.8]); // normalized

    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-kanban", embedding: sharedVec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(sharedVec); // encodeQuery('kanban-cyrillic') → same vector

    const service = new FindService(mockFtsRepo([]), embeddingRepo, model);
    const results = await service.search("канбан", 5);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-kanban");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("FTS-only: score is passed without normalization (raw BM25)", async () => {
    const ftsResults = [
      makeFtsResult({ id: "id-1", score: 10.0 }),
      makeFtsResult({ id: "id-2", score: 5.0 }),
    ];
    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), null);
    const results = await service.search("query", 5);

    // In FTS-only mode FindService returns raw score without normalization
    expect(results[0].score).toBe(10.0);
    expect(results[1].score).toBe(5.0);
  });

  it("hybrid: section present in both sources gets both score components", async () => {
    const sharedId = "id-shared";
    const ftsResults = [makeFtsResult({ id: sharedId, title: "Shared", score: 2.0 })];

    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: sharedId, embedding: vec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(vec);

    const serviceHybrid = new FindService(mockFtsRepo(ftsResults), embeddingRepo, model);
    const hybridResults = await serviceHybrid.search("query", 5);

    // In hybrid mode score = FTS_WEIGHT * normFts + EMBEDDING_WEIGHT * normEmb
    // max = 0.6 + 0.4 = 1.0
    expect(hybridResults[0].score).toBeGreaterThan(0);
    expect(hybridResults[0].score).toBeLessThanOrEqual(1.0);
    // FTS weight 0.6, embedding weight 0.4 — total > FTS only (0.6 * 1.0 = 0.6)
    expect(hybridResults[0].score).toBeGreaterThan(0.6);
  });

  it("embedding error → fallback to FTS", async () => {
    const ftsResults = [makeFtsResult({ id: "id-fts", title: "FTS only", score: 1.0 })];

    const model = {
      isAvailable: vi.fn().mockReturnValue(true),
      load: vi.fn().mockResolvedValue(true),
      encodeQuery: vi.fn().mockRejectedValue(new Error("ONNX error")),
      dimension: 2,
    } as unknown as IEmbeddingProvider;

    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), model);
    const results = await service.search("query", 5);

    // Should return FTS results despite embedding error
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-fts");
  });
});

describe("FindService — titleHighlighted", () => {
  it("FTS result contains titleHighlighted", async () => {
    const ftsResults = [
      makeFtsResult({
        id: "id-1",
        title: "Kanban board",
        titleHighlighted: "<mark>Kanban</mark> board",
        score: 2.0,
      }),
    ];
    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), null);
    const results = await service.search("kanban", 5);

    expect(results).toHaveLength(1);
    expect(results[0].titleHighlighted).toBe("<mark>Kanban</mark> board");
  });

  it("embedding-only result has empty titleHighlighted", async () => {
    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-emb", embedding: vec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(vec);

    const service = new FindService(mockFtsRepo([]), embeddingRepo, model);
    const results = await service.search("query", 5);

    expect(results).toHaveLength(1);
    expect(results[0].titleHighlighted).toBe("");
  });
});

describe("FindService — enrichment via getByIds", () => {
  it("embedding-only result is enriched with title/breadcrumbs via getByIds", async () => {
    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-emb", embedding: vec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(vec);

    const enrichedMap = new Map([
      ["id-emb", { title: "Enriched Title", breadcrumbs: "Folder > Subfolder" }],
    ]);

    const fts = {
      ...mockFtsRepo([]),
      getByIds: vi.fn().mockResolvedValue(enrichedMap),
    } as unknown as FtsRepo;

    const service = new FindService(fts, embeddingRepo, model);
    const results = await service.search("query", 5);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Enriched Title");
    expect(results[0].breadcrumbs).toBe("Folder > Subfolder");
    expect(fts.getByIds).toHaveBeenCalledWith(["id-emb"]);
  });

  it("FTS results do NOT call getByIds", async () => {
    const ftsResults = [
      makeFtsResult({ id: "id-fts", title: "FTS result", score: 1.0 }),
    ];

    const fts = mockFtsRepo(ftsResults);
    const service = new FindService(fts, mockEmbeddingRepo(), null);
    await service.search("query", 5);

    // getByIds is not called if there are no embedding-only results
    expect(fts.getByIds).not.toHaveBeenCalled();
  });
});
