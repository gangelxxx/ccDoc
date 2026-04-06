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
  it("finds a section by exact match in title", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "workflow cards columns");

    const results = await fts.search("Kanban");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
    expect(results[0].title).toBe("Kanban board");
  });

  it("finds by prefix — 'kan' → 'Kanban board'", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "");

    const results = await fts.search("kan");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-1");
  });

  it("finds by text in body, not just in title", async () => {
    await insertSection(db, "id-2", "Project management");
    await fts.upsert("id-2", "Project management", "", "", "workflow cards swim lanes");

    const results = await fts.search("workflow");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-2");
  });

  it("finds by tags", async () => {
    await insertSection(db, "id-3", "Architecture");
    await fts.upsert("id-3", "Architecture", "backend microservices", "", "");

    const results = await fts.search("microservices");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("id-3");
  });

  it("excludes deleted sections (deleted_at IS NOT NULL)", async () => {
    await insertSection(db, "id-del", "Kanban deleted");
    await fts.upsert("id-del", "Kanban deleted", "", "", "");
    // Soft-delete the section
    await db.execute({
      sql: "UPDATE sections SET deleted_at = datetime('now') WHERE id = ?",
      args: ["id-del"],
    });

    const results = await fts.search("deleted");
    expect(results).toHaveLength(0);
  });

  it("empty query returns []", async () => {
    await insertSection(db, "id-1", "Kanban");
    await fts.upsert("id-1", "Kanban", "", "", "");

    const results = await fts.search("");
    expect(results).toHaveLength(0);
  });

  it("special characters in query do not cause an error", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "");

    // sanitizeFtsQuery should clean FTS5 special characters
    await expect(fts.search("(kanban)")).resolves.toBeDefined();
    await expect(fts.search('"kanban"')).resolves.toBeDefined();
    await expect(fts.search("kan*ban")).resolves.toBeDefined();
  });

  it("does NOT find 'kanban' by query 'kanban-cyrillic' — FTS5 unicode61 does not do cross-script matching", async () => {
    await insertSection(db, "id-1", "Kanban board");
    await fts.upsert("id-1", "Kanban board", "", "", "kanban workflow");

    // This is an expected FTS5 limitation. This is why embedding is needed.
    const results = await fts.search("канбан");
    expect(results).toHaveLength(0);
  });

  it("returns score > 0 for found results", async () => {
    await insertSection(db, "id-1", "API documentation");
    await fts.upsert("id-1", "API documentation", "", "", "endpoints REST");

    const results = await fts.search("API");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("ranks by relevance — exact match in title ranks higher than in body", async () => {
    await insertSection(db, "id-title", "Authentication guide");
    await fts.upsert("id-title", "Authentication guide", "", "", "login security");

    await insertSection(db, "id-body", "Security overview");
    await fts.upsert("id-body", "Security overview", "", "", "authentication tokens JWT");

    const results = await fts.search("authentication");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Title with exact match should come first
    expect(results[0].id).toBe("id-title");
  });

  it("returns no more than limit results", async () => {
    for (let i = 1; i <= 8; i++) {
      await insertSection(db, `id-${i}`, `Section ${i} about kanban`);
      await fts.upsert(`id-${i}`, `Section ${i} about kanban`, "", "", "workflow");
    }

    const results = await fts.search("kanban", 3);
    expect(results).toHaveLength(3);
  });

  it("count() returns the number of indexed entries", async () => {
    expect(await fts.count()).toBe(0);

    await insertSection(db, "id-1", "First");
    await fts.upsert("id-1", "First", "", "", "");
    await insertSection(db, "id-2", "Second");
    await fts.upsert("id-2", "Second", "", "", "");

    expect(await fts.count()).toBe(2);
  });

  it("delete() removes an entry from the index", async () => {
    await insertSection(db, "id-1", "Kanban");
    await fts.upsert("id-1", "Kanban", "", "", "");
    await fts.delete("id-1");

    const results = await fts.search("Kanban");
    expect(results).toHaveLength(0);
  });

  it("reindexAll() rebuilds the entire index", async () => {
    await insertSection(db, "id-old", "Old entry");
    await fts.upsert("id-old", "Old entry", "", "", "");

    await insertSection(db, "id-new", "New entry");
    await fts.reindexAll([
      { id: "id-new", title: "New entry", tags: "", breadcrumbs: "", body: "fresh content" },
    ]);

    // Old entry should be gone
    expect(await fts.search("Old")).toHaveLength(0);
    // New entry should exist
    expect(await fts.search("fresh")).toHaveLength(1);
  });
});

describe("FtsRepo.getByIds", () => {
  it("returns title and breadcrumbs by ID", async () => {
    await insertSection(db, "id-1", "First Section");
    await fts.upsert("id-1", "First Section", "", "Parent Folder", "body text");

    await insertSection(db, "id-2", "Second Section");
    await fts.upsert("id-2", "Second Section", "", "Other Folder", "more text");

    const result = await fts.getByIds(["id-1", "id-2"]);
    expect(result.size).toBe(2);

    const first = result.get("id-1");
    expect(first?.title).toBe("First Section");
    expect(first?.breadcrumbs).toBe("Parent Folder");

    const second = result.get("id-2");
    expect(second?.title).toBe("Second Section");
    expect(second?.breadcrumbs).toBe("Other Folder");
  });

  it("returns an empty Map for nonexistent IDs", async () => {
    const result = await fts.getByIds(["nonexistent-1", "nonexistent-2"]);
    expect(result.size).toBe(0);
  });

  it("returns an empty Map for an empty array", async () => {
    const result = await fts.getByIds([]);
    expect(result.size).toBe(0);
  });
});
