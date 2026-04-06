import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers/db.js";
import { SectionsRepo } from "../db/sections.repo.js";
import type { Client } from "@libsql/client";

let db: Client;
let repo: SectionsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new SectionsRepo(db);
});

/* ── helpers ── */
async function createFolder(id: string, title: string, parentId: string | null = null, sortKey = "a0") {
  await repo.create({ id, parent_id: parentId, title, content: "", type: "folder", sort_key: sortKey });
}

async function createFile(id: string, title: string, parentId: string | null = null, sortKey = "a0") {
  await repo.create({
    id, parent_id: parentId, title,
    content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}',
    type: "file", sort_key: sortKey,
  });
}

async function createSection(id: string, title: string, parentId: string, sortKey = "a0") {
  await repo.create({
    id, parent_id: parentId, title,
    content: '{"type":"doc","content":[]}',
    type: "section", sort_key: sortKey,
  });
}

/* ────────────────── create & getById ────────────────── */
describe("create & getById", () => {
  it("creates a section and reads it by id", async () => {
    await createFile("s1", "Test Page");
    const s = await repo.getById("s1");
    expect(s).not.toBeNull();
    expect(s!.id).toBe("s1");
    expect(s!.title).toBe("Test Page");
    expect(s!.type).toBe("file");
    expect(s!.deleted_at).toBeNull();
  });

  it("getById returns null for a nonexistent id", async () => {
    const s = await repo.getById("nonexistent");
    expect(s).toBeNull();
  });

  it("saves parent_id", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Page", "f1");
    const s = await repo.getById("s1");
    expect(s!.parent_id).toBe("f1");
  });

  it("saves icon", async () => {
    await repo.create({
      id: "s1", parent_id: null, title: "Iconic",
      content: "", type: "folder", sort_key: "a0", icon: "🚀",
    });
    const s = await repo.getById("s1");
    expect(s!.icon).toBe("🚀");
  });
});

/* ────────────────── list & listMeta ────────────────── */
describe("list & listMeta", () => {
  it("list returns all non-deleted sections", async () => {
    await createFile("s1", "A", null, "a0");
    await createFile("s2", "B", null, "a1");
    const all = await repo.list();
    expect(all).toHaveLength(2);
  });

  it("list does not return deleted sections", async () => {
    await createFile("s1", "Live");
    await createFile("s2", "Will die");
    await repo.softDelete("s2");
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("s1");
  });

  it("list(includeDeleted=true) returns everything", async () => {
    await createFile("s1", "Live");
    await createFile("s2", "Dead");
    await repo.softDelete("s2");
    const all = await repo.list(true);
    expect(all).toHaveLength(2);
  });

  it("listMeta does not contain content", async () => {
    await createFile("s1", "Page");
    const meta = await repo.listMeta();
    expect(meta).toHaveLength(1);
    expect(meta[0].content).toBe("");
    expect(meta[0].title).toBe("Page");
  });

  it("sections are sorted by sort_key", async () => {
    await createFile("s2", "Second", null, "b0");
    await createFile("s1", "First", null, "a0");
    await createFile("s3", "Third", null, "c0");
    const all = await repo.list();
    expect(all.map(s => s.title)).toEqual(["First", "Second", "Third"]);
  });
});

/* ────────────────── getChildren ────────────────── */
describe("getChildren", () => {
  it("returns children of a specific parent", async () => {
    await createFolder("f1", "Folder 1");
    await createFolder("f2", "Folder 2");
    await createFile("s1", "Child of f1", "f1");
    await createFile("s2", "Child of f2", "f2");

    const children = await repo.getChildren("f1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Child of f1");
  });

  it("returns root elements when parent_id = null", async () => {
    await createFolder("f1", "Root 1", null, "a0");
    await createFolder("f2", "Root 2", null, "a1");
    await createFile("s1", "Child", "f1");

    const roots = await repo.getChildren(null);
    expect(roots).toHaveLength(2);
  });

  it("does not return deleted children", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Live", "f1", "a0");
    await createFile("s2", "Dead", "f1", "a1");
    await repo.softDelete("s2");

    const children = await repo.getChildren("f1");
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe("s1");
  });

  it("children are sorted by sort_key", async () => {
    await createFolder("f1", "Folder");
    await createFile("s3", "C", "f1", "c0");
    await createFile("s1", "A", "f1", "a0");
    await createFile("s2", "B", "f1", "b0");

    const children = await repo.getChildren("f1");
    expect(children.map(c => c.title)).toEqual(["A", "B", "C"]);
  });
});

/* ────────────────── getLastSortKey ────────────────── */
describe("getLastSortKey", () => {
  it("returns null for an empty parent", async () => {
    const key = await repo.getLastSortKey("empty-parent");
    expect(key).toBeNull();
  });

  it("returns the last sort_key", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "A", "f1", "a0");
    await createFile("s2", "B", "f1", "b0");
    await createFile("s3", "C", "f1", "c0");

    const key = await repo.getLastSortKey("f1");
    expect(key).toBe("c0");
  });

  it("ignores deleted entries", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "A", "f1", "a0");
    await createFile("s2", "B", "f1", "z0");
    await repo.softDelete("s2");

    const key = await repo.getLastSortKey("f1");
    expect(key).toBe("a0");
  });
});

/* ────────────────── updateContent ────────────────── */
describe("updateContent", () => {
  it("updates title and content", async () => {
    await createFile("s1", "Old");
    await repo.updateContent("s1", "New Title", '{"type":"doc","content":[]}');

    const s = await repo.getById("s1");
    expect(s!.title).toBe("New Title");
    expect(s!.content).toBe('{"type":"doc","content":[]}');
  });

  it("updates updated_at", async () => {
    // Set an old date manually to guarantee a difference
    await createFile("s1", "Title");
    await db.execute({ sql: "UPDATE sections SET updated_at = datetime('now', '-1 hour') WHERE id = ?", args: ["s1"] });
    const before = (await repo.getById("s1"))!.updated_at;

    await repo.updateContent("s1", "Title", '{"type":"doc","content":[]}');

    const after = (await repo.getById("s1"))!.updated_at;
    expect(after).not.toBe(before);
  });
});

/* ────────────────── updateIcon ────────────────── */
describe("updateIcon", () => {
  it("sets the icon", async () => {
    await createFile("s1", "Page");
    await repo.updateIcon("s1", "📝");

    const s = await repo.getById("s1");
    expect(s!.icon).toBe("📝");
  });

  it("resets icon to null", async () => {
    await repo.create({ id: "s1", parent_id: null, title: "P", content: "", type: "folder", sort_key: "a0", icon: "🚀" });
    await repo.updateIcon("s1", null);

    const s = await repo.getById("s1");
    expect(s!.icon).toBeNull();
  });
});

/* ────────────────── move ────────────────── */
describe("move", () => {
  it("moves a section to a new parent", async () => {
    await createFolder("f1", "Folder 1");
    await createFolder("f2", "Folder 2");
    await createFile("s1", "Page", "f1");

    await repo.move("s1", "f2", "a0");
    const s = await repo.getById("s1");
    expect(s!.parent_id).toBe("f2");
  });

  it("updates sort_key on move", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Page", "f1", "a0");

    await repo.move("s1", "f1", "z0");
    const s = await repo.getById("s1");
    expect(s!.sort_key).toBe("z0");
  });
});

/* ────────────────── softDelete ────────────────── */
describe("softDelete", () => {
  it("sets deleted_at", async () => {
    await createFile("s1", "Page");
    await repo.softDelete("s1");

    const s = (await repo.list(true)).find(x => x.id === "s1")!;
    expect(s.deleted_at).not.toBeNull();
  });

  it("recursively deletes descendants", async () => {
    await createFolder("f1", "Root");
    await createFile("s1", "Child", "f1");
    await createSection("sub1", "Sub", "s1");

    await repo.softDelete("f1");

    const all = await repo.list(true);
    for (const s of all) {
      expect(s.deleted_at).not.toBeNull();
    }
  });

  it("does not affect other branches", async () => {
    await createFolder("f1", "Delete me", null, "a0");
    await createFolder("f2", "Keep me", null, "a1");

    await repo.softDelete("f1");

    const live = await repo.list();
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe("f2");
  });
});

/* ────────────────── restore ────────────────── */
describe("restore", () => {
  it("restores a section and its descendants", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Page", "f1");
    await createSection("sub1", "Sub", "s1");

    await repo.softDelete("f1");
    expect(await repo.list()).toHaveLength(0);

    await repo.restore("f1");
    expect(await repo.list()).toHaveLength(3);
  });

  it("does not restore previously independently deleted descendants", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Will survive", "f1", "a0");
    await createFile("s2", "Already dead", "f1", "a1");

    // Delete s2 first
    await repo.softDelete("s2");
    // Then delete the entire folder
    await new Promise(r => setTimeout(r, 1100)); // deleted_at difference
    await repo.softDelete("f1");

    // Restore the folder — s2 should NOT be restored
    await repo.restore("f1");
    const live = await repo.list();
    const ids = live.map(s => s.id);
    expect(ids).toContain("f1");
    expect(ids).toContain("s1");
    expect(ids).not.toContain("s2");
  });

  it("does nothing for a non-deleted section", async () => {
    await createFile("s1", "Live");
    await repo.restore("s1"); // no-op
    const s = await repo.getById("s1");
    expect(s!.deleted_at).toBeNull();
  });
});

/* ────────────────── purgeOldDeleted ────────────────── */
describe("purgeOldDeleted", () => {
  it("permanently deletes old entries", async () => {
    await createFile("s1", "Old dead");
    // Manually set an old deleted_at
    await db.execute({
      sql: "UPDATE sections SET deleted_at = datetime('now', '-60 days') WHERE id = ?",
      args: ["s1"],
    });

    await repo.purgeOldDeleted(30);
    const all = await repo.list(true);
    expect(all).toHaveLength(0);
  });

  it("does not delete recently deleted entries", async () => {
    await createFile("s1", "Fresh dead");
    await repo.softDelete("s1");

    await repo.purgeOldDeleted(30);
    const all = await repo.list(true);
    expect(all).toHaveLength(1);
  });
});

/* ────────────────── getLatestByType ────────────────── */
describe("getLatestByType", () => {
  it("returns the latest section of a type", async () => {
    await createFolder("f1", "Folder 1");
    await createFolder("f2", "Folder 2");
    const latest = await repo.getLatestByType("folder");
    expect(latest).not.toBeNull();
  });

  it("returns null if no sections of that type exist", async () => {
    const latest = await repo.getLatestByType("kanban");
    expect(latest).toBeNull();
  });

  it("ignores deleted entries", async () => {
    await createFolder("f1", "Dead folder");
    await repo.softDelete("f1");

    const latest = await repo.getLatestByType("folder");
    expect(latest).toBeNull();
  });
});

/* ────────────────── setSummary ────────────────── */
describe("setSummary", () => {
  it("sets summary", async () => {
    await createFile("s1", "Page");
    await repo.setSummary("s1", "Brief summary");

    const s = await repo.getById("s1");
    expect(s!.summary).toBe("Brief summary");
  });

  it("resets summary to null", async () => {
    await createFile("s1", "Page");
    await repo.setSummary("s1", "Summary");
    await repo.setSummary("s1", null);

    const s = await repo.getById("s1");
    expect(s!.summary).toBeNull();
  });
});
