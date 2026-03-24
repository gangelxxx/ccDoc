import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Section } from "../types.js";

/* ── mock projectHistoryPath → temp directory ── */
let tempBase: string;
let tempDir: string;

vi.mock("../constants.js", () => ({
  projectHistoryPath: () => tempDir,
  validateToken: () => {},
}));

import { HistoryService } from "../services/history.service.js";

/* ── helpers ── */
const PM_HELLO = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello world"}]}]}';
const PM_UPDATED = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated content"}]}]}';

function makeSection(overrides: Partial<Section> & { id: string; title: string }): Section {
  return {
    parent_id: null,
    content: PM_HELLO,
    type: "file",
    sort_key: "a0",
    icon: null,
    summary: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeFolder(id: string, title: string): Section {
  return makeSection({ id, title, type: "folder", content: "" });
}

function makeDrawing(id: string, title: string, dsl = "## Shapes\n- rect \"Box\""): Section {
  return makeSection({ id, title, type: "drawing", content: dsl });
}

function makeKanban(id: string, title: string): Section {
  return makeSection({
    id, title, type: "kanban",
    content: JSON.stringify({
      columns: [
        { id: "col1", title: "Todo", cards: [{ id: "c1", title: "Task 1", description: "", labels: [], checked: false, properties: {}, createdAt: "", updatedAt: "" }] },
        { id: "col2", title: "Done", cards: [] },
      ],
    }),
  });
}

function makeIdea(id: string, title: string, text = "Idea text"): Section {
  return makeSection({
    id, title, type: "idea",
    content: JSON.stringify({ messages: [{ id: "m1", text, createdAt: Date.now() }] }),
  });
}

function makeMockDb() {
  const rows: any[] = [];
  return {
    execute: vi.fn().mockResolvedValue({ rows }),
    _rows: rows,
  };
}

function makeMockSectionsService(db: ReturnType<typeof makeMockDb>) {
  return { repo: { db } } as any;
}

/* ── tests ── */
describe("HistoryService", () => {
  let svc: HistoryService;

  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), "ccdoc-hist-"));
    tempDir = join(tempBase, "history");
    svc = new HistoryService("00000000-0000-0000-0000-000000000000");
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  /* ────────────────── init ────────────────── */
  describe("init", () => {
    it("создаёт директорию и .git", async () => {
      await svc.init();
      expect(existsSync(join(tempDir, ".git"))).toBe(true);
    });

    it("повторный init не ломает репозиторий", async () => {
      await svc.init();
      await svc.init();
      expect(existsSync(join(tempDir, ".git"))).toBe(true);
    });
  });

  /* ────────────────── commit ────────────────── */
  describe("commit", () => {
    it("создаёт коммит и возвращает oid", async () => {
      const sections = [makeSection({ id: "s1", title: "Page 1" })];
      const oid = await svc.commit(sections, "first commit");
      expect(oid).toBeTruthy();
      expect(typeof oid).toBe("string");
      expect(oid.length).toBeGreaterThan(10);
    });

    it("сохраняет structure.json", async () => {
      const sections = [
        makeFolder("f1", "Folder"),
        makeSection({ id: "s1", title: "Page 1", parent_id: "f1" }),
      ];
      const oid = await svc.commit(sections, "with folder");
      const structure = await svc.getStructureAtVersion(oid);

      expect(structure).toHaveLength(2);
      expect(structure.find(s => s.id === "f1")?.type).toBe("folder");
      expect(structure.find(s => s.id === "s1")?.parent_id).toBe("f1");
    });

    it("пропускает soft-deleted секции", async () => {
      const sections = [
        makeSection({ id: "s1", title: "Live" }),
        makeSection({ id: "s2", title: "Deleted", deleted_at: new Date().toISOString() }),
      ];
      const oid = await svc.commit(sections, "skip deleted");
      const structure = await svc.getStructureAtVersion(oid);

      expect(structure).toHaveLength(1);
      expect(structure[0].id).toBe("s1");
    });

    it("возвращает пустую строку для пустого списка секций", async () => {
      const oid = await svc.commit([], "empty");
      expect(oid).toBe("");
    });

    it("возвращает пустую строку если все секции удалены", async () => {
      const sections = [
        makeSection({ id: "s1", title: "Del", deleted_at: new Date().toISOString() }),
      ];
      const oid = await svc.commit(sections, "all deleted");
      expect(oid).toBe("");
    });

    it("коммитит разные типы секций", async () => {
      const sections = [
        makeFolder("f1", "Root"),
        makeSection({ id: "s1", title: "Doc" }),
        makeDrawing("d1", "Diagram"),
        makeKanban("k1", "Board"),
        makeIdea("i1", "Idea"),
      ];
      const oid = await svc.commit(sections, "all types");
      const structure = await svc.getStructureAtVersion(oid);

      expect(structure).toHaveLength(5);
      const types = structure.map(s => s.type).sort();
      expect(types).toEqual(["drawing", "file", "folder", "idea", "kanban"]);
    });

    it("сохраняет иконку секции", async () => {
      const sections = [makeSection({ id: "s1", title: "Iconic", icon: "🚀" })];
      const oid = await svc.commit(sections, "icon test");
      const structure = await svc.getStructureAtVersion(oid);

      expect(structure[0].icon).toBe("🚀");
    });

    it("последовательные коммиты создают разные oid", async () => {
      const oid1 = await svc.commit([makeSection({ id: "s1", title: "V1" })], "v1");
      const oid2 = await svc.commit([makeSection({ id: "s1", title: "V2" })], "v2");
      expect(oid1).not.toBe(oid2);
    });
  });

  /* ────────────────── log ────────────────── */
  describe("log", () => {
    it("пустой лог для нового репозитория", async () => {
      const log = await svc.log();
      expect(log).toEqual([]);
    });

    it("возвращает коммиты в порядке от нового к старому", async () => {
      await svc.commit([makeSection({ id: "s1", title: "V1" })], "first");
      await svc.commit([makeSection({ id: "s1", title: "V2" })], "second");
      await svc.commit([makeSection({ id: "s1", title: "V3" })], "third");

      const log = await svc.log();
      expect(log).toHaveLength(3);
      expect(log[0].message.trim()).toBe("third");
      expect(log[1].message.trim()).toBe("second");
      expect(log[2].message.trim()).toBe("first");
    });

    it("коммит содержит author и timestamp", async () => {
      await svc.commit([makeSection({ id: "s1", title: "T" })], "msg", "TestUser");
      const log = await svc.log();

      expect(log[0].author.trim()).toBe("TestUser");
      expect(log[0].timestamp).toBeGreaterThan(0);
    });
  });

  /* ────────────────── deleteCommit ────────────────── */
  describe("deleteCommit", () => {
    it("скрывает коммит из лога", async () => {
      const oid = await svc.commit([makeSection({ id: "s1", title: "T" })], "to hide");
      await svc.deleteCommit(oid);

      const log = await svc.log();
      expect(log.find(c => c.oid === oid)).toBeUndefined();
    });

    it("не влияет на другие коммиты", async () => {
      const oid1 = await svc.commit([makeSection({ id: "s1", title: "Keep" })], "keep");
      const oid2 = await svc.commit([makeSection({ id: "s1", title: "Hide" })], "hide");

      await svc.deleteCommit(oid2);
      const log = await svc.log();

      expect(log).toHaveLength(1);
      expect(log[0].oid).toBe(oid1);
    });

    it("можно скрыть несколько коммитов", async () => {
      const oid1 = await svc.commit([makeSection({ id: "s1", title: "A" })], "a");
      const oid2 = await svc.commit([makeSection({ id: "s1", title: "B" })], "b");
      const oid3 = await svc.commit([makeSection({ id: "s1", title: "C" })], "c");

      await svc.deleteCommit(oid1);
      await svc.deleteCommit(oid3);

      const log = await svc.log();
      expect(log).toHaveLength(1);
      expect(log[0].oid).toBe(oid2);
    });
  });

  /* ────────────────── getStructureAtVersion ────────────────── */
  describe("getStructureAtVersion", () => {
    it("возвращает метаданные секций", async () => {
      const sections = [
        makeFolder("f1", "Folder 1"),
        makeSection({ id: "s1", title: "Page", parent_id: "f1", sort_key: "a1" }),
      ];
      const oid = await svc.commit(sections, "test");
      const structure = await svc.getStructureAtVersion(oid);

      expect(structure).toHaveLength(2);
      const page = structure.find(s => s.id === "s1")!;
      expect(page.title).toBe("Page");
      expect(page.parent_id).toBe("f1");
      expect(page.type).toBe("file");
      expect(page.sort_key).toBe("a1");
    });

    it("возвращает [] для несуществующего коммита", async () => {
      await svc.init();
      const structure = await svc.getStructureAtVersion("deadbeef");
      expect(structure).toEqual([]);
    });
  });

  /* ────────────────── getSectionAtVersion ────────────────── */
  describe("getSectionAtVersion", () => {
    it("возвращает содержимое файловой секции в markdown", async () => {
      const sections = [makeSection({ id: "s1", title: "Page" })];
      const oid = await svc.commit(sections, "test");

      const result = await svc.getSectionAtVersion("s1", oid);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Page");
      expect(result!.content).toContain("Hello world");
    });

    it("возвращает null для папки", async () => {
      const sections = [makeFolder("f1", "Folder")];
      const oid = await svc.commit(sections, "test");

      const result = await svc.getSectionAtVersion("f1", oid);
      expect(result).toBeNull();
    });

    it("возвращает null для несуществующей секции", async () => {
      const sections = [makeSection({ id: "s1", title: "Page" })];
      const oid = await svc.commit(sections, "test");

      const result = await svc.getSectionAtVersion("nonexistent", oid);
      expect(result).toBeNull();
    });

    it("возвращает содержимое drawing", async () => {
      const dsl = "## Shapes\n- rect \"Hello\"";
      const sections = [makeDrawing("d1", "Diagram", dsl)];
      const oid = await svc.commit(sections, "test");

      const result = await svc.getSectionAtVersion("d1", oid);
      expect(result).not.toBeNull();
      expect(result!.content).toBe(dsl);
    });

    it("возвращает содержимое kanban в markdown", async () => {
      const sections = [makeKanban("k1", "Board")];
      const oid = await svc.commit(sections, "test");

      const result = await svc.getSectionAtVersion("k1", oid);
      expect(result).not.toBeNull();
      expect(result!.content).toContain("## Todo");
      expect(result!.content).toContain("Task 1");
    });

    it("возвращает содержимое idea как raw JSON", async () => {
      const sections = [makeIdea("i1", "My Idea", "Great idea")];
      const oid = await svc.commit(sections, "test");

      const result = await svc.getSectionAtVersion("i1", oid);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content);
      expect(parsed.messages).toBeDefined();
      expect(parsed.messages[0].text).toBe("Great idea");
    });
  });

  /* ────────────────── getAllContentsAtVersion ────────────────── */
  describe("getAllContentsAtVersion", () => {
    it("возвращает содержимое всех секций (кроме папок)", async () => {
      const sections = [
        makeFolder("f1", "Root"),
        makeSection({ id: "s1", title: "Page 1" }),
        makeSection({ id: "s2", title: "Page 2" }),
      ];
      const oid = await svc.commit(sections, "test");

      const contents = await svc.getAllContentsAtVersion(oid);
      expect(Object.keys(contents)).toHaveLength(2);
      expect(contents["s1"]).toContain("Hello world");
      expect(contents["s2"]).toContain("Hello world");
      expect(contents["f1"]).toBeUndefined();
    });

    it("пустой объект для невалидного коммита", async () => {
      await svc.init();
      const contents = await svc.getAllContentsAtVersion("deadbeef");
      expect(contents).toEqual({});
    });
  });

  /* ────────────────── getDiff ────────────────── */
  describe("getDiff", () => {
    it("первый коммит — всё новое", async () => {
      const sections = [
        makeSection({ id: "s1", title: "Page 1" }),
        makeSection({ id: "s2", title: "Page 2" }),
      ];
      const diff = await svc.getDiff(sections);
      expect(diff).toContain("New project");
      expect(diff).toContain("Page 1");
      expect(diff).toContain("Page 2");
    });

    it("обнаруживает добавленные секции", async () => {
      const v1 = [makeSection({ id: "s1", title: "Page 1" })];
      await svc.commit(v1, "v1");

      const v2 = [
        makeSection({ id: "s1", title: "Page 1" }),
        makeSection({ id: "s2", title: "New Page" }),
      ];
      const diff = await svc.getDiff(v2);
      expect(diff).toContain("Added");
      expect(diff).toContain("New Page");
    });

    it("обнаруживает удалённые секции", async () => {
      const v1 = [
        makeSection({ id: "s1", title: "Page 1" }),
        makeSection({ id: "s2", title: "Page 2" }),
      ];
      await svc.commit(v1, "v1");

      const v2 = [makeSection({ id: "s1", title: "Page 1" })];
      const diff = await svc.getDiff(v2);
      expect(diff).toContain("Removed");
      expect(diff).toContain("Page 2");
    });

    it("обнаруживает изменённое содержимое", async () => {
      const v1 = [makeSection({ id: "s1", title: "Page 1" })];
      await svc.commit(v1, "v1");

      const v2 = [makeSection({ id: "s1", title: "Page 1", content: PM_UPDATED })];
      const diff = await svc.getDiff(v2);
      expect(diff).toContain("Changed");
      expect(diff).toContain("Page 1");
    });

    it("обнаруживает переименование", async () => {
      const v1 = [makeSection({ id: "s1", title: "Old Title" })];
      await svc.commit(v1, "v1");

      const v2 = [makeSection({ id: "s1", title: "New Title" })];
      const diff = await svc.getDiff(v2);
      expect(diff).toContain("renamed");
      expect(diff).toContain("Old Title");
      expect(diff).toContain("New Title");
    });

    it("'No changes detected' когда ничего не менялось", async () => {
      const v1 = [makeSection({ id: "s1", title: "Page 1" })];
      await svc.commit(v1, "v1");

      const diff = await svc.getDiff(v1);
      expect(diff).toContain("No changes");
    });
  });

  /* ────────────────── getDiffIds ────────────────── */
  describe("getDiffIds", () => {
    it("возвращает added/removed/changed IDs", async () => {
      const v1 = [
        makeSection({ id: "s1", title: "Stays" }),
        makeSection({ id: "s2", title: "Will be removed" }),
        makeSection({ id: "s3", title: "Will change" }),
      ];
      const oid = await svc.commit(v1, "v1");

      const v2 = [
        makeSection({ id: "s1", title: "Stays" }),
        makeSection({ id: "s3", title: "Will change", content: PM_UPDATED }),
        makeSection({ id: "s4", title: "Brand new" }),
      ];

      const diff = await svc.getDiffIds(oid, v2);
      expect(diff.added).toContain("s4");
      expect(diff.removed).toContain("s2");
      expect(diff.changed).toContain("s3");
      expect(diff.added).not.toContain("s1");
      expect(diff.changed).not.toContain("s1");
    });

    it("пустой diff если ничего не менялось", async () => {
      const v1 = [makeSection({ id: "s1", title: "Page" })];
      const oid = await svc.commit(v1, "v1");

      const diff = await svc.getDiffIds(oid, v1);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });

    it("переименование попадает в changed", async () => {
      const v1 = [makeSection({ id: "s1", title: "Old" })];
      const oid = await svc.commit(v1, "v1");

      const v2 = [makeSection({ id: "s1", title: "New" })];
      const diff = await svc.getDiffIds(oid, v2);
      expect(diff.changed).toContain("s1");
    });

    it("пропускает soft-deleted в текущих секциях", async () => {
      const v1 = [makeSection({ id: "s1", title: "Page" })];
      const oid = await svc.commit(v1, "v1");

      const v2 = [makeSection({ id: "s1", title: "Page", deleted_at: new Date().toISOString() })];
      const diff = await svc.getDiffIds(oid, v2);
      expect(diff.removed).toContain("s1");
    });

    it("возвращает пустой результат для невалидного коммита", async () => {
      await svc.init();
      const diff = await svc.getDiffIds("deadbeef", [makeSection({ id: "s1", title: "X" })]);
      expect(diff).toEqual({ added: [], removed: [], changed: [] });
    });
  });

  /* ────────────────── restore ────────────────── */
  describe("restore", () => {
    it("восстанавливает секции в БД", async () => {
      const sections = [
        makeFolder("f1", "Root"),
        makeSection({ id: "s1", title: "Page 1", parent_id: "f1" }),
      ];
      const oid = await svc.commit(sections, "snapshot");

      const db = makeMockDb();
      const mockService = makeMockSectionsService(db);

      await svc.restore(oid, mockService);

      // PRAGMA OFF + DELETE FROM sections + INSERTs + PRAGMA ON + DELETE FROM sections_text
      const calls = db.execute.mock.calls;
      expect(calls[0][0]).toBe("PRAGMA foreign_keys = OFF");
      expect(calls[1][0]).toBe("DELETE FROM sections");

      const inserts = calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT INTO sections")
      );
      expect(inserts).toHaveLength(2);

      // Проверяем данные первого INSERT (folder)
      const folderInsert = inserts.find((c: any) => c[0].args[0] === "f1");
      expect(folderInsert).toBeDefined();
      expect(folderInsert![0].args[2]).toBe("Root"); // title
      expect(folderInsert![0].args[4]).toBe("folder"); // type

      // Проверяем что пытался очистить FTS
      const ftsDelete = calls.find((c: any) =>
        typeof c[0] === "string" && c[0].includes("sections_text")
      );
      expect(ftsDelete).toBeDefined();
    });

    it("восстанавливает drawing как raw DSL", async () => {
      const dsl = "## Shapes\n- rect \"Test\"";
      const sections = [makeDrawing("d1", "Diagram", dsl)];
      const oid = await svc.commit(sections, "drawing snapshot");

      const db = makeMockDb();
      await svc.restore(oid, makeMockSectionsService(db));

      const inserts = db.execute.mock.calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      expect(inserts).toHaveLength(1);
      expect(inserts[0][0].args[3]).toBe(dsl); // content = raw DSL
    });

    it("восстанавливает kanban как JSON", async () => {
      const sections = [makeKanban("k1", "Board")];
      const oid = await svc.commit(sections, "kanban snapshot");

      const db = makeMockDb();
      await svc.restore(oid, makeMockSectionsService(db));

      const inserts = db.execute.mock.calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      const content = inserts[0][0].args[3];
      const parsed = JSON.parse(content);
      expect(parsed.columns).toBeDefined();
      expect(parsed.columns[0].title).toBe("Todo");
    });

    it("восстанавливает idea с сохранением всех сообщений", async () => {
      // Idea с двумя сообщениями
      const ideaContent = JSON.stringify({
        messages: [
          { id: "m1", text: "First idea", createdAt: 1000 },
          { id: "m2", text: "Second idea", createdAt: 2000 },
        ],
      });
      const sections = [makeSection({ id: "i1", title: "Idea", type: "idea", content: ideaContent })];
      const oid = await svc.commit(sections, "idea snapshot");

      const db = makeMockDb();
      await svc.restore(oid, makeMockSectionsService(db));

      const inserts = db.execute.mock.calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      const content = inserts[0][0].args[3];
      const parsed = JSON.parse(content);
      expect(parsed.messages).toBeDefined();
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].text).toBe("First idea");
      expect(parsed.messages[1].text).toBe("Second idea");
    });

    it("восстанавливает file как ProseMirror JSON", async () => {
      const sections = [makeSection({ id: "s1", title: "Page" })];
      const oid = await svc.commit(sections, "pm snapshot");

      const db = makeMockDb();
      await svc.restore(oid, makeMockSectionsService(db));

      const inserts = db.execute.mock.calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      const content = inserts[0][0].args[3];
      const parsed = JSON.parse(content);
      expect(parsed.type).toBe("doc");
    });

    it("восстанавливает секции с FK-зависимостями (дети перед родителями)", async () => {
      // Порядок в structure.json может быть произвольным —
      // дети могут идти перед родителями, что вызывает FK constraint.
      // restore() должен отключать FK на время вставки.
      const sections = [
        makeFolder("f1", "Root"),
        makeSection({ id: "s1", title: "File", parent_id: "f1" }),
        makeSection({ id: "sub1", title: "Section", parent_id: "s1", type: "section" }),
      ];
      const oid = await svc.commit(sections, "with hierarchy");

      const db = makeMockDb();
      await svc.restore(oid, makeMockSectionsService(db));

      // Проверяем PRAGMA foreign_keys = OFF перед INSERT
      const pragmaOff = db.execute.mock.calls.findIndex((c: any) =>
        typeof c[0] === "string" && c[0].includes("foreign_keys = OFF")
      );
      const firstInsert = db.execute.mock.calls.findIndex((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      const pragmaOn = db.execute.mock.calls.findIndex((c: any) =>
        typeof c[0] === "string" && c[0].includes("foreign_keys = ON")
      );

      expect(pragmaOff).toBeGreaterThanOrEqual(0);
      expect(pragmaOn).toBeGreaterThan(firstInsert);
      expect(pragmaOff).toBeLessThan(firstInsert);
    });

    it("сохраняет icon и sort_key при восстановлении", async () => {
      const sections = [makeSection({ id: "s1", title: "P", icon: "📝", sort_key: "b5" })];
      const oid = await svc.commit(sections, "test");

      const db = makeMockDb();
      await svc.restore(oid, makeMockSectionsService(db));

      const inserts = db.execute.mock.calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      const args = inserts[0][0].args;
      expect(args[5]).toBe("b5"); // sort_key
      expect(args[6]).toBe("📝"); // icon
    });
  });

  /* ────────────────── searchAtVersion ────────────────── */
  describe("searchAtVersion", () => {
    it("находит секции по содержимому", async () => {
      const sections = [
        makeSection({ id: "s1", title: "Page 1" }), // contains "Hello world"
        makeSection({
          id: "s2", title: "Page 2",
          content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Unique keyword"}]}]}',
        }),
      ];
      const oid = await svc.commit(sections, "test");

      const results = await svc.searchAtVersion(oid, "Unique");
      expect(results).toContain("s2");
      expect(results).not.toContain("s1");
    });

    it("пустой массив если ничего не найдено", async () => {
      const sections = [makeSection({ id: "s1", title: "Page" })];
      const oid = await svc.commit(sections, "test");

      const results = await svc.searchAtVersion(oid, "nonexistent_xyz_12345");
      expect(results).toEqual([]);
    });

    it("регистронезависимый поиск", async () => {
      const sections = [makeSection({ id: "s1", title: "Page" })]; // "Hello world"
      const oid = await svc.commit(sections, "test");

      const results = await svc.searchAtVersion(oid, "hello");
      expect(results).toContain("s1");
    });
  });

  /* ────────────────── сценарий: полный цикл ────────────────── */
  describe("полный цикл: commit → log → view → modify → diff → restore", () => {
    it("работает end-to-end", async () => {
      // 1. Создаём начальную версию
      const v1Sections = [
        makeFolder("f1", "Docs"),
        makeSection({ id: "s1", title: "Guide", parent_id: "f1" }),
        makeSection({ id: "s2", title: "FAQ", parent_id: "f1" }),
      ];
      const oid1 = await svc.commit(v1Sections, "Initial version");

      // 2. Проверяем лог
      let log = await svc.log();
      expect(log).toHaveLength(1);
      expect(log[0].message.trim()).toBe("Initial version");

      // 3. Создаём вторую версию (изменяем + добавляем + удаляем)
      const v2Sections = [
        makeFolder("f1", "Docs"),
        makeSection({ id: "s1", title: "Guide (Updated)", parent_id: "f1", content: PM_UPDATED }),
        makeSection({ id: "s3", title: "API Reference", parent_id: "f1" }),
      ];
      const oid2 = await svc.commit(v2Sections, "Updated docs");

      // 4. Проверяем diff
      const diffIds = await svc.getDiffIds(oid1, v2Sections);
      expect(diffIds.added).toContain("s3");
      expect(diffIds.removed).toContain("s2");
      expect(diffIds.changed).toContain("s1");

      // 5. Проверяем что можно прочитать содержимое старой версии
      const oldContent = await svc.getSectionAtVersion("s2", oid1);
      expect(oldContent).not.toBeNull();
      expect(oldContent!.title).toBe("FAQ");

      // 6. Проверяем getAllContents
      const allV1 = await svc.getAllContentsAtVersion(oid1);
      expect(Object.keys(allV1)).toHaveLength(2); // s1 + s2 (folder excluded)

      // 7. Восстанавливаем на v1
      const db = makeMockDb();
      await svc.restore(oid1, makeMockSectionsService(db));

      const inserts = db.execute.mock.calls.filter((c: any) =>
        typeof c[0] === "object" && c[0].sql?.includes("INSERT")
      );
      // folder + s1 + s2 = 3 секции
      expect(inserts).toHaveLength(3);

      // 8. Лог содержит обе версии
      log = await svc.log();
      expect(log).toHaveLength(2);
    });
  });

  /* ────────────────── edge cases ────────────────── */
  describe("edge cases", () => {
    it("коммит с drawing_blocks в ProseMirror", async () => {
      const content = JSON.stringify({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before drawing" }] },
          { type: "drawing", attrs: { name: "Sketch", elements: [{ id: "e1" }], appState: { zoom: 1 } } },
          { type: "paragraph", content: [{ type: "text", text: "After drawing" }] },
        ],
      });
      const sections = [makeSection({ id: "s1", title: "With Drawing", content })];
      const oid = await svc.commit(sections, "drawing blocks");

      const structure = await svc.getStructureAtVersion(oid);
      expect(structure[0].drawing_blocks).toHaveLength(1);
      expect(structure[0].drawing_blocks[0].name).toBe("Sketch");
      expect(structure[0].drawing_blocks[0].position).toBe(1);
    });

    it("коммит после очистки docs/ от предыдущих файлов", async () => {
      // Первый коммит с 3 файлами
      await svc.commit([
        makeSection({ id: "s1", title: "A" }),
        makeSection({ id: "s2", title: "B" }),
        makeSection({ id: "s3", title: "C" }),
      ], "v1");

      // Второй коммит с 1 файлом — старые файлы не должны остаться
      const oid2 = await svc.commit([makeSection({ id: "s4", title: "D" })], "v2");
      const structure = await svc.getStructureAtVersion(oid2);

      expect(structure).toHaveLength(1);
      expect(structure[0].id).toBe("s4");
    });

    it("спецсимволы в заголовках секций", async () => {
      const sections = [
        makeSection({ id: "s1", title: "Файл с пробелами & символами!" }),
      ];
      const oid = await svc.commit(sections, "special chars");
      const structure = await svc.getStructureAtVersion(oid);

      expect(structure[0].title).toBe("Файл с пробелами & символами!");
    });

    it("getDiff с drawing/kanban/idea типами", async () => {
      const v1 = [
        makeDrawing("d1", "Diag", "old dsl"),
        makeKanban("k1", "Board"),
        makeIdea("i1", "Idea", "old text"),
      ];
      await svc.commit(v1, "v1");

      const v2 = [
        makeDrawing("d1", "Diag", "new dsl"),
        makeKanban("k1", "Board"),
        makeIdea("i1", "Idea", "new text"),
      ];
      const diff = await svc.getDiff(v2);
      expect(diff).toContain("Changed");
      expect(diff).toContain("Diag");
    });
  });
});
