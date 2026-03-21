import { describe, it, expect, vi } from "vitest";
import { FindService } from "../services/find.service.js";
import type { FtsRepo, FtsSearchResult } from "../db/fts.repo.js";
import type { EmbeddingRepo } from "../db/embedding.repo.js";
import type { EmbeddingModel } from "../services/embedding.service.js";

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

function mockEmbeddingModel(queryVec: Float32Array): EmbeddingModel {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(true),
    encode: vi.fn().mockResolvedValue(queryVec),
    encodeQuery: vi.fn().mockResolvedValue(queryVec),
  } as unknown as EmbeddingModel;
}

describe("FindService.search", () => {
  it("FTS-only: нет embedding model → возвращает FTS результаты", async () => {
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

  it("FTS-only: лимит соблюдается", async () => {
    const ftsResults = Array.from({ length: 10 }, (_, i) =>
      makeFtsResult({ id: `id-${i}`, title: `Section ${i}`, score: 10 - i })
    );
    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), null);

    const results = await service.search("section", 3);
    expect(results).toHaveLength(3);
  });

  it("пустые результаты из FTS → []", async () => {
    const service = new FindService(mockFtsRepo([]), mockEmbeddingRepo(), null);

    const results = await service.search("ничего", 5);
    expect(results).toHaveLength(0);
  });

  it("hybrid merge: объединяет FTS и embedding результаты", async () => {
    const ftsResults = [makeFtsResult({ id: "id-fts", title: "FTS result", score: 2.0 })];

    // Embedding возвращает другой раздел с высоким сходством
    // Вектор [1, 0] будет иметь cosine similarity 1.0 с собой
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

  it("embedding-only результат появляется в merged списке с пустым title", async () => {
    // FTS ничего не нашёл, embedding нашёл
    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-emb-only", embedding: vec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(vec);

    const service = new FindService(mockFtsRepo([]), embeddingRepo, model);
    const results = await service.search("query", 5);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-emb-only");
    expect(results[0].title).toBe(""); // нет FTS данных — title пустой
  });

  it("кросс-скрипт через embedding: 'канбан' → находит 'kanban' раздел", async () => {
    // Сценарий: FTS не находит 'канбан' в базе с 'kanban'
    // Embedding модель возвращает одинаковый вектор для обоих (семантически близки)
    const sharedVec = new Float32Array([0.6, 0.8]); // нормализованный

    const embeddingRepo = mockEmbeddingRepo([
      { section_id: "id-kanban", embedding: sharedVec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(sharedVec); // encodeQuery('канбан') → тот же вектор

    const service = new FindService(mockFtsRepo([]), embeddingRepo, model);
    const results = await service.search("канбан", 5);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-kanban");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("FTS-only: score передаётся без нормализации (raw BM25)", async () => {
    const ftsResults = [
      makeFtsResult({ id: "id-1", score: 10.0 }),
      makeFtsResult({ id: "id-2", score: 5.0 }),
    ];
    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), null);
    const results = await service.search("query", 5);

    // В FTS-only режиме FindService возвращает raw score без нормализации
    expect(results[0].score).toBe(10.0);
    expect(results[1].score).toBe(5.0);
  });

  it("hybrid: раздел присутствующий в обоих источниках получает оба компонента score", async () => {
    const sharedId = "id-shared";
    const ftsResults = [makeFtsResult({ id: sharedId, title: "Shared", score: 2.0 })];

    const vec = new Float32Array([1, 0]);
    const embeddingRepo = mockEmbeddingRepo([
      { section_id: sharedId, embedding: vec, text_hash: "hash" },
    ]);
    const model = mockEmbeddingModel(vec);

    const serviceHybrid = new FindService(mockFtsRepo(ftsResults), embeddingRepo, model);
    const hybridResults = await serviceHybrid.search("query", 5);

    // В hybrid режиме score = FTS_WEIGHT * normFts + EMBEDDING_WEIGHT * normEmb
    // max = 0.6 + 0.4 = 1.0
    expect(hybridResults[0].score).toBeGreaterThan(0);
    expect(hybridResults[0].score).toBeLessThanOrEqual(1.0);
    // FTS вес 0.6, embedding вес 0.4 — суммарный > только FTS (0.6 * 1.0 = 0.6)
    expect(hybridResults[0].score).toBeGreaterThan(0.6);
  });

  it("embedding ошибка → fallback на FTS", async () => {
    const ftsResults = [makeFtsResult({ id: "id-fts", title: "FTS only", score: 1.0 })];

    const model = {
      isAvailable: vi.fn().mockReturnValue(true),
      load: vi.fn().mockResolvedValue(true),
      encodeQuery: vi.fn().mockRejectedValue(new Error("ONNX error")),
    } as unknown as EmbeddingModel;

    const service = new FindService(mockFtsRepo(ftsResults), mockEmbeddingRepo(), model);
    const results = await service.search("query", 5);

    // Должен вернуть FTS результаты несмотря на ошибку embedding
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-fts");
  });
});
