import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers/db.js";
import { SectionsService } from "../services/sections.service.js";
import type { Client } from "@libsql/client";

let db: Client;
let svc: SectionsService;

beforeEach(async () => {
  db = await createTestDb();
  svc = new SectionsService(db);
});

/* ────────────────── create: иерархия ────────────────── */
describe("create — иерархия", () => {
  it("создаёт folder в корне", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    expect(folder.type).toBe("folder");
    expect(folder.parent_id).toBeNull();
  });

  it("нельзя создать file в корне", async () => {
    await expect(svc.create({ parentId: null, title: "Page", type: "file" }))
      .rejects.toThrow("cannot be at root level");
  });

  it("нельзя создать idea в корне", async () => {
    await expect(svc.create({ parentId: null, title: "Idea", type: "idea" }))
      .rejects.toThrow("cannot be at root level");
  });

  it("создаёт file внутри folder", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    expect(file.parent_id).toBe(folder.id);
    expect(file.type).toBe("file");
  });

  it("создаёт section внутри file", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    const section = await svc.create({ parentId: file.id, title: "Section", type: "section" });
    expect(section.parent_id).toBe(file.id);
    expect(section.type).toBe("section");
  });

  it("создаёт вложенную section внутри section", async () => {
    const folder = await svc.create({ parentId: null, title: "F", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "P", type: "file" });
    const s1 = await svc.create({ parentId: file.id, title: "S1", type: "section" });
    const s2 = await svc.create({ parentId: s1.id, title: "S2", type: "section" });
    expect(s2.parent_id).toBe(s1.id);
  });

  it("нельзя создать file внутри file", async () => {
    const folder = await svc.create({ parentId: null, title: "F", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "P", type: "file" });
    await expect(svc.create({ parentId: file.id, title: "Bad", type: "file" }))
      .rejects.toThrow("cannot contain");
  });

  it("нельзя создать folder внутри file", async () => {
    const folder = await svc.create({ parentId: null, title: "F", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "P", type: "file" });
    await expect(svc.create({ parentId: file.id, title: "Bad", type: "folder" }))
      .rejects.toThrow("cannot contain");
  });

  it("ошибка если родитель не найден", async () => {
    await expect(svc.create({ parentId: "nonexistent", title: "Bad", type: "file" }))
      .rejects.toThrow("not found");
  });

  it("все типы внутри folder: file, idea, todo, kanban, drawing", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    for (const type of ["file", "idea", "todo", "kanban", "drawing"] as const) {
      const s = await svc.create({ parentId: folder.id, title: `${type} item`, type });
      expect(s.type).toBe(type);
    }
  });
});

/* ────────────────── create: типы контента ────────────────── */
describe("create — контент разных типов", () => {
  let folderId: string;

  beforeEach(async () => {
    const f = await svc.create({ parentId: null, title: "Root", type: "folder" });
    folderId = f.id;
  });

  it("file: markdown → ProseMirror JSON", async () => {
    const file = await svc.create({ parentId: folderId, title: "Page", type: "file", content: "Hello **bold**" });
    const doc = JSON.parse(file.content);
    expect(doc.type).toBe("doc");
    expect(doc.content).toBeDefined();
  });

  it("file без content: пустой ProseMirror doc", async () => {
    const file = await svc.create({ parentId: folderId, title: "Empty", type: "file" });
    const doc = JSON.parse(file.content);
    expect(doc.type).toBe("doc");
  });

  it("idea: текст → JSON с messages", async () => {
    const idea = await svc.create({ parentId: folderId, title: "Idea", type: "idea", content: "My idea" });
    const data = JSON.parse(idea.content);
    expect(data.messages).toBeDefined();
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].text).toBe("My idea");
  });

  it("idea без content: пустой messages", async () => {
    const idea = await svc.create({ parentId: folderId, title: "Empty Idea", type: "idea" });
    const data = JSON.parse(idea.content);
    expect(data.messages).toEqual([]);
  });

  it("kanban: markdown → JSON с columns", async () => {
    const kanban = await svc.create({
      parentId: folderId, title: "Board", type: "kanban",
      content: "## Todo\n- Task 1\n- Task 2\n\n## Done\n- Task 3",
    });
    const data = JSON.parse(kanban.content);
    expect(data.columns).toBeDefined();
    expect(data.columns.length).toBeGreaterThanOrEqual(2);
  });

  it("kanban без content: пустая доска", async () => {
    const kanban = await svc.create({ parentId: folderId, title: "Empty Board", type: "kanban" });
    const data = JSON.parse(kanban.content);
    expect(data.columns).toBeDefined();
  });

  it("todo: markdown → ProseMirror с taskList", async () => {
    const todo = await svc.create({
      parentId: folderId, title: "Checklist", type: "todo",
      content: "- [x] Done\n- [ ] Pending",
    });
    const doc = JSON.parse(todo.content);
    expect(doc.type).toBe("doc");
  });

  it("todo без content: пустой taskList", async () => {
    const todo = await svc.create({ parentId: folderId, title: "Empty Todo", type: "todo" });
    const doc = JSON.parse(todo.content);
    expect(doc.type).toBe("doc");
    expect(JSON.stringify(doc)).toContain("taskList");
  });

  it("drawing без content: пустые elements", async () => {
    const drawing = await svc.create({ parentId: folderId, title: "Canvas", type: "drawing" });
    const data = JSON.parse(drawing.content);
    expect(data.elements).toEqual([]);
  });
});

/* ────────────────── create: sort_key ────────────────── */
describe("create — автоматический sort_key", () => {
  it("каждая новая секция получает увеличивающийся sort_key", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const f1 = await svc.create({ parentId: folder.id, title: "A", type: "file" });
    const f2 = await svc.create({ parentId: folder.id, title: "B", type: "file" });
    const f3 = await svc.create({ parentId: folder.id, title: "C", type: "file" });

    expect(f1.sort_key < f2.sort_key).toBe(true);
    expect(f2.sort_key < f3.sort_key).toBe(true);
  });
});

/* ────────────────── create: icon ────────────────── */
describe("create — icon", () => {
  it("сохраняет переданную иконку", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder", icon: "📁" });
    expect(folder.icon).toBe("📁");
  });
});

/* ────────────────── update ────────────────── */
describe("update", () => {
  let folderId: string;

  beforeEach(async () => {
    const f = await svc.create({ parentId: null, title: "Root", type: "folder" });
    folderId = f.id;
  });

  it("обновляет file: markdown → ProseMirror", async () => {
    const file = await svc.create({ parentId: folderId, title: "Page", type: "file", content: "Old" });
    await svc.update(file.id, "New Title", "Updated content");

    const updated = await svc.getById(file.id);
    expect(updated!.title).toBe("New Title");
    const doc = JSON.parse(updated!.content);
    expect(doc.type).toBe("doc");
  });

  it("обновляет idea: добавляет новое сообщение", async () => {
    const idea = await svc.create({ parentId: folderId, title: "Idea", type: "idea", content: "First" });
    await svc.update(idea.id, "Idea", "Second message");

    const updated = await svc.getById(idea.id);
    const data = JSON.parse(updated!.content);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[1].text).toBe("Second message");
  });

  it("обновляет kanban: markdown → JSON", async () => {
    const kanban = await svc.create({ parentId: folderId, title: "Board", type: "kanban" });
    await svc.update(kanban.id, "Board", "## New Column\n- Card 1");

    const updated = await svc.getById(kanban.id);
    const data = JSON.parse(updated!.content);
    expect(data.columns).toBeDefined();
  });

  it("ошибка для несуществующей секции", async () => {
    await expect(svc.update("nonexistent", "Title", "Content"))
      .rejects.toThrow("not found");
  });
});

/* ────────────────── updateIcon ────────────────── */
describe("updateIcon", () => {
  it("меняет иконку", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    await svc.updateIcon(folder.id, "🚀");

    const updated = await svc.getById(folder.id);
    expect(updated!.icon).toBe("🚀");
  });
});

/* ────────────────── getTree ────────────────── */
describe("getTree", () => {
  it("возвращает дерево с вложенностью", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    await svc.create({ parentId: file.id, title: "Section", type: "section" });

    const tree = await svc.getTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Root");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].title).toBe("Page");
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].title).toBe("Section");
  });

  it("не включает удалённые", async () => {
    const f1 = await svc.create({ parentId: null, title: "Keep", type: "folder" });
    const f2 = await svc.create({ parentId: null, title: "Delete", type: "folder" });
    await svc.softDelete(f2.id);

    const tree = await svc.getTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Keep");
  });
});

/* ────────────────── getParentChain ────────────────── */
describe("getParentChain", () => {
  it("возвращает цепь предков от корня", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    const section = await svc.create({ parentId: file.id, title: "Section", type: "section" });

    const chain = await svc.getParentChain(section.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].title).toBe("Root");
    expect(chain[1].title).toBe("Page");
  });

  it("пустая цепь для корневого элемента", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const chain = await svc.getParentChain(folder.id);
    expect(chain).toHaveLength(0);
  });
});

/* ────────────────── findChildByTitle ────────────────── */
describe("findChildByTitle", () => {
  it("находит дочернюю секцию по title", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    await svc.create({ parentId: folder.id, title: "Target", type: "file" });

    const found = await svc.findChildByTitle(folder.id, "Target");
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Target");
  });

  it("возвращает null если не найдено", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const found = await svc.findChildByTitle(folder.id, "Missing");
    expect(found).toBeNull();
  });

  it("фильтрует по type", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    await svc.create({ parentId: folder.id, title: "Same Name", type: "file" });
    await svc.create({ parentId: folder.id, title: "Same Name", type: "idea" });

    const file = await svc.findChildByTitle(folder.id, "Same Name", "file");
    expect(file!.type).toBe("file");

    const idea = await svc.findChildByTitle(folder.id, "Same Name", "idea");
    expect(idea!.type).toBe("idea");
  });
});

/* ────────────────── move ────────────────── */
describe("move", () => {
  it("перемещает файл между папками", async () => {
    const f1 = await svc.create({ parentId: null, title: "F1", type: "folder" });
    const f2 = await svc.create({ parentId: null, title: "F2", type: "folder" });
    const file = await svc.create({ parentId: f1.id, title: "Page", type: "file" });

    await svc.move(file.id, f2.id, null);
    const moved = await svc.getById(file.id);
    expect(moved!.parent_id).toBe(f2.id);
  });

  it("перемещает файл после указанного сиблинга", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const a = await svc.create({ parentId: folder.id, title: "A", type: "file" });
    const b = await svc.create({ parentId: folder.id, title: "B", type: "file" });
    const c = await svc.create({ parentId: folder.id, title: "C", type: "file" });

    // Переместить C после A (между A и B)
    await svc.move(c.id, folder.id, a.id);

    const children = await svc.getTree();
    const names = children[0].children.map(c => c.title);
    expect(names).toEqual(["A", "C", "B"]);
  });

  it("запрещает перемещение в собственного потомка (circular)", async () => {
    const folder = await svc.create({ parentId: null, title: "Parent", type: "folder" });
    const child = await svc.create({ parentId: folder.id, title: "Child", type: "folder" });

    await expect(svc.move(folder.id, child.id, null))
      .rejects.toThrow("Cannot move section into its own descendant");
  });

  it("валидирует иерархию при перемещении", async () => {
    const folder = await svc.create({ parentId: null, title: "Folder", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    const section = await svc.create({ parentId: file.id, title: "Section", type: "section" });

    // section нельзя переместить в folder (только в file/section)
    await expect(svc.move(section.id, folder.id, null))
      .rejects.toThrow("cannot contain");
  });
});

/* ────────────────── duplicate ────────────────── */
describe("duplicate", () => {
  it("создаёт копию с (copy) в названии", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Original", type: "file", content: "Content here" });

    const copy = await svc.duplicate(file.id);
    expect(copy.title).toBe("Original (copy)");
    expect(copy.parent_id).toBe(folder.id);
    expect(copy.id).not.toBe(file.id);
  });

  it("дублирует вместе с детьми", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    await svc.create({ parentId: file.id, title: "Section 1", type: "section" });
    await svc.create({ parentId: file.id, title: "Section 2", type: "section" });

    const copy = await svc.duplicate(file.id);

    // У копии должны быть свои дети
    const tree = await svc.getTree();
    const rootChildren = tree[0].children;
    expect(rootChildren).toHaveLength(2); // оригинал + копия

    const copyNode = rootChildren.find(c => c.id === copy.id)!;
    expect(copyNode.children).toHaveLength(2);
    expect(copyNode.children[0].title).toBe("Section 1");
    expect(copyNode.children[1].title).toBe("Section 2");
  });

  it("сохраняет icon при дублировании", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder", icon: "📁" });
    const copy = await svc.duplicate(folder.id);
    expect(copy.icon).toBe("📁");
  });
});

/* ────────────────── softDelete & restore ────────────────── */
describe("softDelete & restore", () => {
  it("softDelete скрывает из дерева", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    await svc.softDelete(folder.id);

    const tree = await svc.getTree();
    expect(tree).toHaveLength(0);
  });

  it("restore возвращает в дерево", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    await svc.softDelete(folder.id);
    await svc.restore(folder.id);

    const tree = await svc.getTree();
    expect(tree).toHaveLength(1);
  });

  it("deleteChildren удаляет всех детей", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    await svc.create({ parentId: folder.id, title: "A", type: "file" });
    await svc.create({ parentId: folder.id, title: "B", type: "file" });

    await svc.deleteChildren(folder.id);
    const tree = await svc.getTree();
    expect(tree).toHaveLength(1); // folder остаётся
    expect(tree[0].children).toHaveLength(0); // дети удалены
  });
});

/* ────────────────── getContent ────────────────── */
describe("getContent", () => {
  let folderId: string;

  beforeEach(async () => {
    const f = await svc.create({ parentId: null, title: "Root", type: "folder" });
    folderId = f.id;
  });

  it("file → markdown", async () => {
    const file = await svc.create({ parentId: folderId, title: "Page", type: "file", content: "Hello **bold**" });
    const md = await svc.getContent(file.id, "markdown");
    expect(md).toContain("Hello");
    expect(md).toContain("**bold**");
  });

  it("file → plain", async () => {
    const file = await svc.create({ parentId: folderId, title: "Page", type: "file", content: "Hello **bold**" });
    const plain = await svc.getContent(file.id, "plain");
    expect(plain).toContain("Hello");
    expect(plain).not.toContain("**");
  });

  it("idea → markdown (нумерованный список)", async () => {
    const idea = await svc.create({ parentId: folderId, title: "Idea", type: "idea", content: "Message 1" });
    const md = await svc.getContent(idea.id, "markdown");
    expect(md).toContain("1.");
    expect(md).toContain("Message 1");
  });

  it("kanban → markdown", async () => {
    const kanban = await svc.create({
      parentId: folderId, title: "Board", type: "kanban",
      content: "## Todo\n- Task 1",
    });
    const md = await svc.getContent(kanban.id, "markdown");
    expect(md).toContain("## Todo");
  });

  it("ошибка для несуществующей секции", async () => {
    await expect(svc.getContent("nonexistent"))
      .rejects.toThrow("not found");
  });
});

/* ────────────────── getFileWithSections ────────────────── */
describe("getFileWithSections", () => {
  it("возвращает файл с секциями", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    await svc.create({ parentId: file.id, title: "S1", type: "section" });
    await svc.create({ parentId: file.id, title: "S2", type: "section" });

    const result = await svc.getFileWithSections(file.id);
    expect(result.file.id).toBe(file.id);
    expect(result.sections).toHaveLength(2);
  });

  it("ошибка если секция не file", async () => {
    const folder = await svc.create({ parentId: null, title: "Folder", type: "folder" });
    await expect(svc.getFileWithSections(folder.id))
      .rejects.toThrow("is not a file");
  });
});

/* ────────────────── convertIdeaToKanban ────────────────── */
describe("convertIdeaToKanban", () => {
  it("конвертирует idea в kanban с карточками", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const idea = await svc.create({ parentId: folder.id, title: "My Idea", type: "idea", content: "Task 1" });
    // Добавляем ещё сообщение
    await svc.update(idea.id, "My Idea", "Task 2");

    const kanban = await svc.convertIdeaToKanban(idea.id);
    expect(kanban.type).toBe("kanban");
    expect(kanban.parent_id).toBe(folder.id);

    const data = JSON.parse(kanban.content);
    expect(data.columns).toHaveLength(3); // Backlog, In progress, Done
    expect(data.columns[0].cards.length).toBe(2);
    expect(data.sourceIdeaId).toBe(idea.id);
  });

  it("ошибка если секция не idea", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });
    await expect(svc.convertIdeaToKanban(file.id))
      .rejects.toThrow("is not an idea");
  });

  it("ошибка если idea пустая", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const idea = await svc.create({ parentId: folder.id, title: "Empty", type: "idea" });
    await expect(svc.convertIdeaToKanban(idea.id))
      .rejects.toThrow("No messages");
  });

  it("связывает kanbanId обратно к idea", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const idea = await svc.create({ parentId: folder.id, title: "Idea", type: "idea", content: "Task" });
    const kanban = await svc.convertIdeaToKanban(idea.id);

    const updatedIdea = await svc.getById(idea.id);
    const ideaData = JSON.parse(updatedIdea!.content);
    expect(ideaData.kanbanId).toBe(kanban.id);
  });
});

/* ────────────────── setSummary ────────────────── */
describe("setSummary", () => {
  it("устанавливает и читает summary", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Page", type: "file" });

    await svc.setSummary(file.id, "Brief description");
    const updated = await svc.getById(file.id);
    expect(updated!.summary).toBe("Brief description");
  });
});

/* ────────────────── buildSectionMarkdown ────────────────── */
describe("buildSectionMarkdown", () => {
  it("строит markdown из секции и детей", async () => {
    const folder = await svc.create({ parentId: null, title: "Root", type: "folder" });
    const file = await svc.create({ parentId: folder.id, title: "Guide", type: "file", content: "Intro text" });
    await svc.create({ parentId: file.id, title: "Chapter 1", type: "section", content: "Chapter content" });

    const md = await svc.buildSectionMarkdown(file.id, 1);
    expect(md).toContain("# Guide");
    expect(md).toContain("Intro text");
    expect(md).toContain("## Chapter 1");
    expect(md).toContain("Chapter content");
  });
});

/* ────────────────── e2e сценарий ────────────────── */
describe("полный цикл: создание структуры проекта", () => {
  it("создаёт полноценную структуру документации", async () => {
    // Создаём корневые папки
    const docs = await svc.create({ parentId: null, title: "Documentation", type: "folder", icon: "📚" });
    const ideas = await svc.create({ parentId: null, title: "Ideas", type: "folder", icon: "💡" });

    // Файлы в документации
    const guide = await svc.create({ parentId: docs.id, title: "Getting Started", type: "file", content: "Welcome to the app" });
    const api = await svc.create({ parentId: docs.id, title: "API Reference", type: "file", content: "## Endpoints\n\n### GET /users" });

    // Секции в файле
    const s1 = await svc.create({ parentId: guide.id, title: "Installation", type: "section", content: "npm install" });
    const s2 = await svc.create({ parentId: guide.id, title: "Configuration", type: "section", content: "Edit config.json" });

    // Idea + kanban + todo
    const idea = await svc.create({ parentId: ideas.id, title: "Feature Request", type: "idea", content: "Add dark mode" });
    const todo = await svc.create({ parentId: ideas.id, title: "Release Checklist", type: "todo", content: "- [ ] Run tests\n- [ ] Update docs" });

    // Проверяем дерево
    const tree = await svc.getTree();
    expect(tree).toHaveLength(2); // docs + ideas

    const docsNode = tree.find(n => n.title === "Documentation")!;
    expect(docsNode.children).toHaveLength(2); // guide + api
    expect(docsNode.icon).toBe("📚");

    const guideNode = docsNode.children.find(n => n.title === "Getting Started")!;
    expect(guideNode.children).toHaveLength(2); // s1 + s2

    const ideasNode = tree.find(n => n.title === "Ideas")!;
    expect(ideasNode.children).toHaveLength(2); // idea + todo

    // Проверяем parent chain
    const chain = await svc.getParentChain(s1.id);
    expect(chain.map(c => c.title)).toEqual(["Documentation", "Getting Started"]);

    // Дублируем файл
    const guideCopy = await svc.duplicate(guide.id);
    expect(guideCopy.title).toBe("Getting Started (copy)");

    // Проверяем что дети тоже скопировались
    const copyTree = await svc.getTree();
    const docsCopy = copyTree.find(n => n.title === "Documentation")!;
    const copyNode = docsCopy.children.find(c => c.id === guideCopy.id)!;
    expect(copyNode.children).toHaveLength(2);

    // Мягкое удаление + восстановление
    await svc.softDelete(guide.id);
    let treeAfterDelete = await svc.getTree();
    let docsAfterDelete = treeAfterDelete.find(n => n.title === "Documentation")!;
    // guide удалён, но copy остаётся + api
    expect(docsAfterDelete.children.find(c => c.id === guide.id)).toBeUndefined();

    await svc.restore(guide.id);
    let treeAfterRestore = await svc.getTree();
    let docsAfterRestore = treeAfterRestore.find(n => n.title === "Documentation")!;
    expect(docsAfterRestore.children.find(c => c.id === guide.id)).toBeDefined();
  });
});
