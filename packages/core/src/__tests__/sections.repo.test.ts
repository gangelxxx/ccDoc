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
  it("создаёт секцию и читает по id", async () => {
    await createFile("s1", "Test Page");
    const s = await repo.getById("s1");
    expect(s).not.toBeNull();
    expect(s!.id).toBe("s1");
    expect(s!.title).toBe("Test Page");
    expect(s!.type).toBe("file");
    expect(s!.deleted_at).toBeNull();
  });

  it("getById возвращает null для несуществующего id", async () => {
    const s = await repo.getById("nonexistent");
    expect(s).toBeNull();
  });

  it("сохраняет parent_id", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Page", "f1");
    const s = await repo.getById("s1");
    expect(s!.parent_id).toBe("f1");
  });

  it("сохраняет icon", async () => {
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
  it("list возвращает все неудалённые секции", async () => {
    await createFile("s1", "A", null, "a0");
    await createFile("s2", "B", null, "a1");
    const all = await repo.list();
    expect(all).toHaveLength(2);
  });

  it("list не возвращает удалённые секции", async () => {
    await createFile("s1", "Live");
    await createFile("s2", "Will die");
    await repo.softDelete("s2");
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("s1");
  });

  it("list(includeDeleted=true) возвращает всё", async () => {
    await createFile("s1", "Live");
    await createFile("s2", "Dead");
    await repo.softDelete("s2");
    const all = await repo.list(true);
    expect(all).toHaveLength(2);
  });

  it("listMeta не содержит content", async () => {
    await createFile("s1", "Page");
    const meta = await repo.listMeta();
    expect(meta).toHaveLength(1);
    expect(meta[0].content).toBe("");
    expect(meta[0].title).toBe("Page");
  });

  it("секции отсортированы по sort_key", async () => {
    await createFile("s2", "Second", null, "b0");
    await createFile("s1", "First", null, "a0");
    await createFile("s3", "Third", null, "c0");
    const all = await repo.list();
    expect(all.map(s => s.title)).toEqual(["First", "Second", "Third"]);
  });
});

/* ────────────────── getChildren ────────────────── */
describe("getChildren", () => {
  it("возвращает детей конкретного родителя", async () => {
    await createFolder("f1", "Folder 1");
    await createFolder("f2", "Folder 2");
    await createFile("s1", "Child of f1", "f1");
    await createFile("s2", "Child of f2", "f2");

    const children = await repo.getChildren("f1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Child of f1");
  });

  it("возвращает корневые элементы при parent_id = null", async () => {
    await createFolder("f1", "Root 1", null, "a0");
    await createFolder("f2", "Root 2", null, "a1");
    await createFile("s1", "Child", "f1");

    const roots = await repo.getChildren(null);
    expect(roots).toHaveLength(2);
  });

  it("не возвращает удалённых детей", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Live", "f1", "a0");
    await createFile("s2", "Dead", "f1", "a1");
    await repo.softDelete("s2");

    const children = await repo.getChildren("f1");
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe("s1");
  });

  it("дети отсортированы по sort_key", async () => {
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
  it("возвращает null для пустого родителя", async () => {
    const key = await repo.getLastSortKey("empty-parent");
    expect(key).toBeNull();
  });

  it("возвращает последний sort_key", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "A", "f1", "a0");
    await createFile("s2", "B", "f1", "b0");
    await createFile("s3", "C", "f1", "c0");

    const key = await repo.getLastSortKey("f1");
    expect(key).toBe("c0");
  });

  it("игнорирует удалённые", async () => {
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
  it("обновляет title и content", async () => {
    await createFile("s1", "Old");
    await repo.updateContent("s1", "New Title", '{"type":"doc","content":[]}');

    const s = await repo.getById("s1");
    expect(s!.title).toBe("New Title");
    expect(s!.content).toBe('{"type":"doc","content":[]}');
  });

  it("обновляет updated_at", async () => {
    // Ставим старую дату вручную, чтобы разница была гарантирована
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
  it("устанавливает иконку", async () => {
    await createFile("s1", "Page");
    await repo.updateIcon("s1", "📝");

    const s = await repo.getById("s1");
    expect(s!.icon).toBe("📝");
  });

  it("сбрасывает иконку на null", async () => {
    await repo.create({ id: "s1", parent_id: null, title: "P", content: "", type: "folder", sort_key: "a0", icon: "🚀" });
    await repo.updateIcon("s1", null);

    const s = await repo.getById("s1");
    expect(s!.icon).toBeNull();
  });
});

/* ────────────────── move ────────────────── */
describe("move", () => {
  it("перемещает секцию к новому родителю", async () => {
    await createFolder("f1", "Folder 1");
    await createFolder("f2", "Folder 2");
    await createFile("s1", "Page", "f1");

    await repo.move("s1", "f2", "a0");
    const s = await repo.getById("s1");
    expect(s!.parent_id).toBe("f2");
  });

  it("обновляет sort_key при перемещении", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Page", "f1", "a0");

    await repo.move("s1", "f1", "z0");
    const s = await repo.getById("s1");
    expect(s!.sort_key).toBe("z0");
  });
});

/* ────────────────── softDelete ────────────────── */
describe("softDelete", () => {
  it("ставит deleted_at", async () => {
    await createFile("s1", "Page");
    await repo.softDelete("s1");

    const s = (await repo.list(true)).find(x => x.id === "s1")!;
    expect(s.deleted_at).not.toBeNull();
  });

  it("рекурсивно удаляет потомков", async () => {
    await createFolder("f1", "Root");
    await createFile("s1", "Child", "f1");
    await createSection("sub1", "Sub", "s1");

    await repo.softDelete("f1");

    const all = await repo.list(true);
    for (const s of all) {
      expect(s.deleted_at).not.toBeNull();
    }
  });

  it("не трогает другие ветки", async () => {
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
  it("восстанавливает секцию и потомков", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Page", "f1");
    await createSection("sub1", "Sub", "s1");

    await repo.softDelete("f1");
    expect(await repo.list()).toHaveLength(0);

    await repo.restore("f1");
    expect(await repo.list()).toHaveLength(3);
  });

  it("не восстанавливает ранее независимо удалённых потомков", async () => {
    await createFolder("f1", "Folder");
    await createFile("s1", "Will survive", "f1", "a0");
    await createFile("s2", "Already dead", "f1", "a1");

    // Удалить s2 раньше
    await repo.softDelete("s2");
    // Потом удалить папку целиком
    await new Promise(r => setTimeout(r, 1100)); // deleted_at difference
    await repo.softDelete("f1");

    // Восстановить папку — s2 НЕ должен восстановиться
    await repo.restore("f1");
    const live = await repo.list();
    const ids = live.map(s => s.id);
    expect(ids).toContain("f1");
    expect(ids).toContain("s1");
    expect(ids).not.toContain("s2");
  });

  it("ничего не делает для неудалённой секции", async () => {
    await createFile("s1", "Live");
    await repo.restore("s1"); // no-op
    const s = await repo.getById("s1");
    expect(s!.deleted_at).toBeNull();
  });
});

/* ────────────────── purgeOldDeleted ────────────────── */
describe("purgeOldDeleted", () => {
  it("окончательно удаляет старые записи", async () => {
    await createFile("s1", "Old dead");
    // Ручная установка старого deleted_at
    await db.execute({
      sql: "UPDATE sections SET deleted_at = datetime('now', '-60 days') WHERE id = ?",
      args: ["s1"],
    });

    await repo.purgeOldDeleted(30);
    const all = await repo.list(true);
    expect(all).toHaveLength(0);
  });

  it("не удаляет недавно удалённые", async () => {
    await createFile("s1", "Fresh dead");
    await repo.softDelete("s1");

    await repo.purgeOldDeleted(30);
    const all = await repo.list(true);
    expect(all).toHaveLength(1);
  });
});

/* ────────────────── getLatestByType ────────────────── */
describe("getLatestByType", () => {
  it("возвращает последнюю секцию типа", async () => {
    await createFolder("f1", "Folder 1");
    await createFolder("f2", "Folder 2");
    const latest = await repo.getLatestByType("folder");
    expect(latest).not.toBeNull();
  });

  it("возвращает null если нет секций типа", async () => {
    const latest = await repo.getLatestByType("kanban");
    expect(latest).toBeNull();
  });

  it("игнорирует удалённые", async () => {
    await createFolder("f1", "Dead folder");
    await repo.softDelete("f1");

    const latest = await repo.getLatestByType("folder");
    expect(latest).toBeNull();
  });
});

/* ────────────────── setSummary ────────────────── */
describe("setSummary", () => {
  it("устанавливает summary", async () => {
    await createFile("s1", "Page");
    await repo.setSummary("s1", "Brief summary");

    const s = await repo.getById("s1");
    expect(s!.summary).toBe("Brief summary");
  });

  it("сбрасывает summary на null", async () => {
    await createFile("s1", "Page");
    await repo.setSummary("s1", "Summary");
    await repo.setSummary("s1", null);

    const s = await repo.getById("s1");
    expect(s!.summary).toBeNull();
  });
});
