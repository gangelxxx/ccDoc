import { describe, it, expect, beforeEach } from "vitest";
import type { Client } from "@libsql/client";
import { FtsRepo } from "../db/fts.repo.js";
import { createTestDb, insertSection } from "./helpers/db.js";

let db: Client;
let fts: FtsRepo;

beforeEach(async () => {
  db = await createTestDb();
  fts = new FtsRepo(db);
});

describe("FtsRepo.search", () => {
  it("находит раздел по точному совпадению в заголовке", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "workflow cards columns");

    const results = await fts.search("Kanban");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
    expect(results[0].title).toBe("Kanban board");
  });

  it("находит по префиксу — 'kan' → 'Kanban board'", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "");

    const results = await fts.search("kan");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
  });

  it("находит по тексту в теле (body), не только в заголовке", async () => {
    await insertSection(db, "id-2", "Project management");
    await fts.upsert("id-2", "Project management", "", "", "workflow cards swim lanes");

    const results = await fts.search("workflow");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-2");
  });

  it("находит по тегам", async () => {
    await insertSection(db, "id-3", "Architecture");
    await fts.upsert("id-3", "Architecture", "backend microservices", "", "");

    const results = await fts.search("microservices");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-3");
  });

  it("исключает удалённые секции (deleted_at IS NOT NULL)", async () => {
    await insertSection(db, "id-del", "Kanban deleted");
    await fts.upsert("id-del", "Kanban deleted", "", "", "");
    // Мягко удаляем секцию
    await db.execute({
      sql: "UPDATE sections SET deleted_at = datetime('now') WHERE id = ?",
      args: ["id-del"],
    });

    const results = await fts.search("deleted");
    expect(results).toHaveLength(0);
  });

  it("пустой запрос возвращает []", async () => {
    await insertSection(db, "id-1", "Kanban");
    await fts.upsert("id-1", "Kanban", "", "", "");

    const results = await fts.search("");
    expect(results).toHaveLength(0);
  });

  it("спецсимволы в запросе не вызывают ошибку", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "");

    // sanitizeFtsQuery должен почистить спецсимволы FTS5
    await expect(fts.search("(kanban)")).resolves.toBeDefined();
    await expect(fts.search('"kanban"')).resolves.toBeDefined();
    await expect(fts.search("kan*ban")).resolves.toBeDefined();
  });

  it("НЕ находит 'kanban' по запросу 'канбан' — FTS5 unicode61 не делает кросс-скрипт матчинг", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "kanban workflow");

    // Это ожидаемое ограничение FTS5. Именно поэтому нужен embedding.
    const results = await fts.search("канбан");
    expect(results).toHaveLength(0);
  });

  it("возвращает score > 0 для найденных результатов", async () => {
    await insertSection(db, "id-1", "API documentation");
    await fts.upsert("id-1", "API documentation", "", "", "endpoints REST");

    const results = await fts.search("API");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("ранжирует по релевантности — точное совпадение в заголовке выше чем в теле", async () => {
    await insertSection(db, "id-title", "Authentication guide");
    await fts.upsert("id-title", "Authentication guide", "", "", "login security");

    await insertSection(db, "id-body", "Security overview");
    await fts.upsert("id-body", "Security overview", "", "", "authentication tokens JWT");

    const results = await fts.search("authentication");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Заголовок с точным совпадением должен быть первым
    expect(results[0].id).toBe("id-title");
  });

  it("возвращает не больше limit результатов", async () => {
    for (let i = 1; i <= 8; i++) {
      await insertSection(db, `id-${i}`, `Section ${i} about kanban`);
      await fts.upsert(`id-${i}`, `Section ${i} about kanban`, "", "", "workflow");
    }

    const results = await fts.search("kanban", 3);
    expect(results).toHaveLength(3);
  });

  it("count() возвращает число проиндексированных записей", async () => {
    expect(await fts.count()).toBe(0);

    await insertSection(db, "id-1", "First");
    await fts.upsert("id-1", "First", "", "", "");
    await insertSection(db, "id-2", "Second");
    await fts.upsert("id-2", "Second", "", "", "");

    expect(await fts.count()).toBe(2);
  });

  it("delete() удаляет запись из индекса", async () => {
    await insertSection(db, "id-1", "Kanban");
    await fts.upsert("id-1", "Kanban", "", "", "");
    await fts.delete("id-1");

    const results = await fts.search("Kanban");
    expect(results).toHaveLength(0);
  });

  it("reindexAll() перестраивает весь индекс", async () => {
    await insertSection(db, "id-old", "Old entry");
    await fts.upsert("id-old", "Old entry", "", "", "");

    await insertSection(db, "id-new", "New entry");
    await fts.reindexAll([
      { id: "id-new", title: "New entry", tags: "", breadcrumbs: "", body: "fresh content" },
    ]);

    // Старая запись должна исчезнуть
    expect(await fts.search("Old")).toHaveLength(0);
    // Новая должна быть
    expect(await fts.search("fresh")).toHaveLength(1);
  });
});
