import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import { FtsRepo } from "../db/fts.repo.js";
import { EmbeddingRepo } from "../db/embedding.repo.js";
import { IndexService } from "../services/index.service.js";
import type { IEmbeddingProvider } from "../services/embedding.service.js";
import { createTestDb, insertSection } from "./helpers/db.js";

let db: Client;
let ftsRepo: FtsRepo;
let embeddingRepo: EmbeddingRepo;
let indexService: IndexService;

beforeEach(async () => {
  db = await createTestDb();
  ftsRepo = new FtsRepo(db);
  embeddingRepo = new EmbeddingRepo(db);
  indexService = new IndexService(db, undefined, ftsRepo, null, embeddingRepo);
});

describe("IndexService.reindexAll", () => {
  it("после reindexAll FTS индекс содержит все секции", async () => {
    await insertSection(db, "id-1", "Kanban board", '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"workflow cards"}]}]}');
    await insertSection(db, "id-2", "API documentation");

    await indexService.reindexAll();

    expect(await ftsRepo.count()).toBe(2);
  });

  it("после reindexAll поиск по заголовку работает", async () => {
    await insertSection(db, "id-1", "Authentication service");
    await indexService.reindexAll();

    const results = await ftsRepo.search("Authentication");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
  });

  it("reindexAll не включает удалённые секции", async () => {
    await insertSection(db, "id-active", "Active section");
    await insertSection(db, "id-deleted", "Deleted section");
    await db.execute({
      sql: "UPDATE sections SET deleted_at = datetime('now') WHERE id = ?",
      args: ["id-deleted"],
    });

    await indexService.reindexAll();

    expect(await ftsRepo.count()).toBe(1);
    const results = await ftsRepo.search("Deleted");
    expect(results).toHaveLength(0);
  });

  it("reindexAll на пустой базе не падает", async () => {
    await expect(indexService.reindexAll()).resolves.not.toThrow();
    expect(await ftsRepo.count()).toBe(0);
  });
});

describe("IndexService.indexSection", () => {
  it("индексирует секцию — она находится через FTS", async () => {
    await insertSection(db, "id-1", "Sprint planning");

    const section = {
      id: "id-1",
      title: "Sprint planning",
      content: '{"type":"doc","content":[]}',
      parent_id: null,
      type: "file" as const,
      sort_key: "a0",
      icon: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      summary: null,
    };
    await indexService.indexSection(section);

    const results = await ftsRepo.search("Sprint");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
  });

  it("повторный indexSection обновляет запись (upsert)", async () => {
    await insertSection(db, "id-1", "Old title");

    const section = {
      id: "id-1",
      title: "Old title",
      content: '{"type":"doc","content":[]}',
      parent_id: null,
      type: "file" as const,
      sort_key: "a0",
      icon: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      summary: null,
    };
    await indexService.indexSection(section);

    // Обновляем заголовок в sections
    await db.execute({
      sql: "UPDATE sections SET title = ? WHERE id = ?",
      args: ["New title", "id-1"],
    });
    section.title = "New title";
    await indexService.indexSection(section);

    expect(await ftsRepo.count()).toBe(1); // не задублировалось
    const results = await ftsRepo.search("New");
    expect(results).toHaveLength(1);
  });
});

describe("IndexService.removeSection", () => {
  it("после removeSection секция не находится", async () => {
    await insertSection(db, "id-1", "Roadmap");
    const section = {
      id: "id-1",
      title: "Roadmap",
      content: '{"type":"doc","content":[]}',
      parent_id: null,
      type: "file" as const,
      sort_key: "a0",
      icon: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      summary: null,
    };

    await indexService.indexSection(section);
    await indexService.removeSection("id-1");

    const results = await ftsRepo.search("Roadmap");
    expect(results).toHaveLength(0);
  });
});

describe("IndexService — breadcrumbs", () => {
  it("дочерняя секция индексируется с breadcrumbs родителя", async () => {
    await insertSection(db, "parent-id", "Backend");
    await db.execute({
      sql: "INSERT INTO sections (id, parent_id, title, content, type, sort_key) VALUES (?, ?, ?, ?, 'file', 'a0')",
      args: ["child-id", "parent-id", "Authentication", '{"type":"doc","content":[]}'],
    });

    const section = {
      id: "child-id",
      title: "Authentication",
      content: '{"type":"doc","content":[]}',
      parent_id: "parent-id",
      type: "file" as const,
      sort_key: "a0",
      icon: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      summary: null,
    };
    await indexService.indexSection(section);

    // Поиск по имени родителя должен находить дочернюю секцию через breadcrumbs
    const results = await ftsRepo.search("Backend");
    expect(results.some((r) => r.id === "child-id")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Тесты для IndexService с embedding                                 */
/* ------------------------------------------------------------------ */

function makeMockEmbeddingModel(): IEmbeddingProvider {
  const enc = vi.fn().mockImplementation(async (_text: string) => {
    return new Float32Array([0.6, 0.8]);
  });
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(true),
    encode: enc,
    encodeQuery: enc,
    dimension: 2,
  } as unknown as IEmbeddingProvider;
}

function makeSection(id: string, title: string) {
  return {
    id,
    title,
    content: '{"type":"doc","content":[]}',
    parent_id: null,
    type: "file" as const,
    sort_key: "a0",
    icon: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    summary: null,
  };
}

describe("IndexService — embedding через indexSection", () => {
  it("indexSection() с embeddingModel вычисляет embedding", async () => {
    const mockModel = makeMockEmbeddingModel();
    const embDb = await createTestDb();
    const embFtsRepo = new FtsRepo(embDb);
    const embEmbeddingRepo = new EmbeddingRepo(embDb);
    const embIndexService = new IndexService(embDb, undefined, embFtsRepo, mockModel, embEmbeddingRepo);

    await insertSection(embDb, "s1", "Sprint planning");
    await embIndexService.indexSection(makeSection("s1", "Sprint planning"));

    expect(mockModel.encode).toHaveBeenCalled();
    expect(await embEmbeddingRepo.count()).toBe(1);
  });

  it("updateEmbedding пропускает если textHash не изменился", async () => {
    const mockModel = makeMockEmbeddingModel();
    const embDb = await createTestDb();
    const embFtsRepo = new FtsRepo(embDb);
    const embEmbeddingRepo = new EmbeddingRepo(embDb);
    const embIndexService = new IndexService(embDb, undefined, embFtsRepo, mockModel, embEmbeddingRepo);

    await insertSection(embDb, "s1", "Stable section");
    const section = makeSection("s1", "Stable section");

    // Первый вызов — encode вызывается
    await embIndexService.indexSection(section);
    expect(mockModel.encode).toHaveBeenCalledTimes(1);

    // Второй вызов с тем же контентом — encode НЕ вызывается повторно
    await embIndexService.indexSection(section);
    expect(mockModel.encode).toHaveBeenCalledTimes(1);
  });
});

describe("IndexService — embedding через reindexAll", () => {
  it("reindexAll() с embeddingModel заполняет section_embeddings", async () => {
    const mockModel = makeMockEmbeddingModel();
    const embDb = await createTestDb();
    const embFtsRepo = new FtsRepo(embDb);
    const embEmbeddingRepo = new EmbeddingRepo(embDb);
    const embIndexService = new IndexService(embDb, undefined, embFtsRepo, mockModel, embEmbeddingRepo);

    await insertSection(embDb, "s1", "Section One");
    await insertSection(embDb, "s2", "Section Two");

    await embIndexService.reindexAll();

    expect(await embEmbeddingRepo.count()).toBe(2);
    expect(mockModel.encode).toHaveBeenCalledTimes(2);
  });
});

describe("IndexService — removeSection с embedding", () => {
  it("removeSection() удаляет embedding", async () => {
    const mockModel = makeMockEmbeddingModel();
    const embDb = await createTestDb();
    const embFtsRepo = new FtsRepo(embDb);
    const embEmbeddingRepo = new EmbeddingRepo(embDb);
    const embIndexService = new IndexService(embDb, undefined, embFtsRepo, mockModel, embEmbeddingRepo);

    await insertSection(embDb, "s1", "To be removed");
    await embIndexService.indexSection(makeSection("s1", "To be removed"));
    expect(await embEmbeddingRepo.count()).toBe(1);

    await embIndexService.removeSection("s1");
    expect(await embEmbeddingRepo.count()).toBe(0);
  });
});
