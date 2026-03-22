import { v4 as uuid } from "uuid";
import { generateKeyBetween } from "fractional-indexing";
import type { Client } from "@libsql/client";
import { SectionsRepo } from "../db/sections.repo.js";
import { markdownToProsemirror } from "../converters/markdown-to-prosemirror.js";
import { prosemirrorToMarkdown } from "../converters/prosemirror-to-markdown.js";
import { prosemirrorToPlain } from "../converters/prosemirror-to-plain.js";
import { prosemirrorToStructured } from "../converters/prosemirror-to-structured.js";
import { kanbanToMarkdown, kanbanToPlain, markdownToKanban, emptyKanbanData } from "../converters/kanban.js";
import { excalidrawToText, excalidrawToPlain, textToExcalidraw } from "../converters/excalidraw/index.js";
import type { Section, SectionType, TreeNode, OutputFormat, ProseMirrorNode, StructuredOutput, KanbanData, KanbanCard, FileSectionNode, ExcalidrawElement, IdeaData, IdeaMessage } from "../types.js";
import { SOFT_DELETE_DAYS } from "../constants.js";
import { validateHierarchy } from "../hierarchy.js";

export class SectionsService {
  private repo: SectionsRepo;

  constructor(private db: Client) {
    this.repo = new SectionsRepo(db);
  }

  async getTree(): Promise<TreeNode[]> {
    // Use listMeta (excludes content) — tree only needs id/title/type/parent/sort_key.
    const sections = await this.repo.listMeta();
    return buildTree(sections);
  }

  async getById(id: string): Promise<Section | null> {
    return this.repo.getById(id);
  }

  async findChildByTitle(parentId: string | null, title: string, type?: SectionType): Promise<Section | null> {
    const children = await this.repo.getChildren(parentId);
    return children.find(c => c.title === title && (!type || c.type === type)) ?? null;
  }

  async deleteChildren(parentId: string): Promise<void> {
    const children = await this.repo.getChildren(parentId);
    for (const child of children) {
      await this.repo.softDelete(child.id);
    }
  }

  async getParentChain(id: string): Promise<Array<{ id: string; title: string; type: string }>> {
    const chain: Array<{ id: string; title: string; type: string }> = [];
    const visited = new Set<string>();
    let current = await this.repo.getById(id);
    while (current?.parent_id) {
      if (visited.has(current.parent_id)) break; // cycle protection
      visited.add(current.parent_id);
      current = await this.repo.getById(current.parent_id);
      if (current) chain.unshift({ id: current.id, title: current.title, type: current.type });
    }
    return chain;
  }

  async getContent(id: string, format: OutputFormat = "markdown"): Promise<string> {
    const section = await this.repo.getById(id);
    if (!section) throw new Error(`Section ${id} not found`);

    // Excalidraw — convert JSON elements to text DSL
    if (section.type === "excalidraw") {
      let state: { elements: ExcalidrawElement[] };
      try { state = JSON.parse(section.content); } catch { state = { elements: [] }; }
      if (format === "plain") return excalidrawToPlain(state.elements);
      if (format === "markdown") return excalidrawToText(state.elements);
      return JSON.stringify({ title: section.title, blocks: [{ type: "whiteboard", text: excalidrawToPlain(state.elements) }] });
    }

    // Kanban — own JSON format
    if (section.type === "kanban") {
      let data: KanbanData;
      try { data = JSON.parse(section.content); } catch (err) { console.warn(`[sections] Failed to parse kanban content for ${id}:`, err); data = { columns: [] }; }
      if (format === "plain") return kanbanToPlain(data);
      if (format === "markdown") return kanbanToMarkdown(data);
      return JSON.stringify({ title: section.title, blocks: [{ type: "kanban", text: kanbanToPlain(data) }] });
    }

    // Idea — messages JSON
    if (section.type === "idea") {
      let data: IdeaData;
      try {
        const parsed = JSON.parse(section.content);
        if (parsed.type === "doc") {
          const text = prosemirrorToPlain(parsed);
          data = { messages: [{ id: "legacy", text, createdAt: Date.parse(section.created_at) }] };
        } else {
          data = parsed;
        }
      } catch { data = { messages: [] }; }

      if (format === "plain") return data.messages.map(m => m.text).join("\n\n");
      if (format === "markdown") return data.messages.map((m, i) => `${i + 1}. ${m.text}`).join("\n");
      return JSON.stringify({ title: section.title, blocks: [{ type: "ideas", text: data.messages.map(m => m.text).join("\n\n") }] });
    }

    // ProseMirror-based types: file, folder, section, todo
    let doc: ProseMirrorNode;
    try { doc = JSON.parse(section.content); } catch (err) { console.warn(`[sections] Failed to parse ProseMirror content for ${id}:`, err); doc = { type: "doc", content: [{ type: "paragraph" }] }; }

    switch (format) {
      case "markdown":
        return prosemirrorToMarkdown(doc);
      case "plain":
        return prosemirrorToPlain(doc);
      case "structured":
        return JSON.stringify(prosemirrorToStructured(doc, section.title));
      default:
        return prosemirrorToMarkdown(doc);
    }
  }

  async getStructured(id: string): Promise<StructuredOutput> {
    const section = await this.repo.getById(id);
    if (!section) throw new Error(`Section ${id} not found`);
    let doc: ProseMirrorNode;
    try { doc = JSON.parse(section.content); } catch (err) { console.warn(`[sections] Failed to parse content for structured output ${id}:`, err); doc = { type: "doc", content: [{ type: "paragraph" }] }; }
    return prosemirrorToStructured(doc, section.title);
  }

  async create(params: {
    parentId: string | null;
    title: string;
    content?: string; // markdown
    type: SectionType;
    icon?: string | null;
  }): Promise<Section> {
    // Validate hierarchy rules
    if (params.parentId) {
      const parent = await this.repo.getById(params.parentId);
      if (!parent) throw new Error(`Parent ${params.parentId} not found`);
      validateHierarchy(params.type, parent.type as SectionType);
    } else {
      validateHierarchy(params.type, null);
    }

    const id = uuid();
    const lastKey = await this.repo.getLastSortKey(params.parentId);
    const sortKey = generateKeyBetween(lastKey, null);

    let prosemirrorContent: string;

    if (params.type === "excalidraw") {
      if (params.content) {
        const result = await textToExcalidraw(params.content);
        prosemirrorContent = JSON.stringify({ elements: result.elements, appState: { viewBackgroundColor: "#ffffff", gridSize: null, zoom: 1, scrollX: 0, scrollY: 0 } });
      } else {
        prosemirrorContent = JSON.stringify({ elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
      }
    } else if (params.type === "kanban") {
      prosemirrorContent = params.content
        ? JSON.stringify(markdownToKanban(params.content))
        : JSON.stringify(emptyKanbanData());
    } else if (params.type === "idea") {
      if (params.content) {
        const msg: IdeaMessage = { id: uuid(), text: params.content, createdAt: Date.now() };
        prosemirrorContent = JSON.stringify({ messages: [msg] });
      } else {
        prosemirrorContent = JSON.stringify({ messages: [] });
      }
    } else if (params.type === "todo") {
      prosemirrorContent = params.content
        ? JSON.stringify(markdownToProsemirror(params.content))
        : '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph"}]}]}]}';
    } else {
      prosemirrorContent = params.content
        ? JSON.stringify(markdownToProsemirror(params.content))
        : '{"type":"doc","content":[{"type":"paragraph"}]}';
    }

    await this.repo.create({
      id,
      parent_id: params.parentId,
      title: params.title,
      content: prosemirrorContent,
      type: params.type,
      sort_key: sortKey,
      icon: params.icon,
    });

    return (await this.repo.getById(id))!;
  }

  async update(id: string, title: string, content: string): Promise<void> {
    const section = await this.repo.getById(id);
    if (!section) throw new Error(`Section ${id} not found`);
    let storedContent: string;

    if (section.type === "kanban") {
      storedContent = JSON.stringify(markdownToKanban(content));
    } else if (section.type === "excalidraw") {
      // If content looks like raw JSON (from canvas save), pass through; otherwise parse text DSL
      if (content.trimStart().startsWith("{")) {
        storedContent = content;
      } else {
        let existing: { elements: ExcalidrawElement[]; appState: Record<string, unknown> };
        try { existing = JSON.parse(section.content); } catch { existing = { elements: [], appState: { viewBackgroundColor: "#ffffff" } }; }
        const result = await textToExcalidraw(content, existing.elements);
        storedContent = JSON.stringify({ elements: result.elements, appState: existing.appState });
      }
    } else if (section.type === "idea") {
      if (content.trimStart().startsWith("{")) {
        storedContent = content;
      } else {
        let existing: IdeaData;
        try { existing = JSON.parse(section.content); } catch { existing = { messages: [] }; }
        existing.messages.push({ id: uuid(), text: content, createdAt: Date.now() });
        storedContent = JSON.stringify(existing);
      }
    } else {
      storedContent = JSON.stringify(markdownToProsemirror(content));
    }

    await this.repo.updateContent(id, title, storedContent);
  }

  async setSummary(id: string, summary: string | null): Promise<void> {
    await this.repo.setSummary(id, summary);
  }

  async updateIcon(id: string, icon: string | null): Promise<void> {
    await this.repo.updateIcon(id, icon);
  }

  async updateRaw(id: string, title: string, prosemirrorJson: string): Promise<void> {
    await this.repo.updateContent(id, title, prosemirrorJson);
  }

  async move(id: string, newParentId: string | null, afterId: string | null): Promise<void> {
    // Validate hierarchy rules
    const section = await this.repo.getById(id);
    if (!section) throw new Error(`Section ${id} not found`);
    if (newParentId) {
      // Prevent circular reference: ensure newParentId is not a descendant of id
      let ancestor = await this.repo.getById(newParentId);
      const visited = new Set<string>();
      while (ancestor) {
        if (ancestor.id === id) throw new Error("Cannot move section into its own descendant");
        if (visited.has(ancestor.id)) break;
        visited.add(ancestor.id);
        ancestor = ancestor.parent_id ? await this.repo.getById(ancestor.parent_id) : null;
      }

      const parent = await this.repo.getById(newParentId);
      if (!parent) throw new Error(`Parent ${newParentId} not found`);
      validateHierarchy(section.type as SectionType, parent.type as SectionType);
    } else {
      validateHierarchy(section.type as SectionType, null);
    }

    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (afterId) {
      const afterSection = await this.repo.getById(afterId);
      if (afterSection) afterKey = afterSection.sort_key;
    }

    // Get the next sibling after afterId, excluding the section being moved
    const allSiblings = await this.repo.getChildren(newParentId);
    const siblings = allSiblings.filter((s) => s.id !== id);
    if (afterId) {
      const idx = siblings.findIndex((s) => s.id === afterId);
      if (idx >= 0 && idx + 1 < siblings.length) {
        beforeKey = siblings[idx + 1].sort_key;
      }
    } else if (siblings.length > 0) {
      beforeKey = siblings[0].sort_key;
    }

    const sortKey = generateKeyBetween(afterKey, beforeKey);
    await this.repo.move(id, newParentId, sortKey);
  }

  async duplicate(id: string): Promise<Section> {
    const source = await this.repo.getById(id);
    if (!source) throw new Error(`Section ${id} not found`);

    // Create the copy at the same level
    const newId = uuid();
    const lastKey = await this.repo.getLastSortKey(source.parent_id);
    const sortKey = generateKeyBetween(lastKey, null);

    await this.repo.create({
      id: newId,
      parent_id: source.parent_id,
      title: source.title + " (copy)",
      content: source.content,
      type: source.type as SectionType,
      sort_key: sortKey,
      icon: source.icon,
    });

    // Recursively duplicate children
    const children = await this.repo.getChildren(source.id);
    for (const child of children) {
      await this.duplicateChild(child.id, newId);
    }

    return (await this.repo.getById(newId))!;
  }

  private async duplicateChild(sourceId: string, newParentId: string): Promise<void> {
    const source = await this.repo.getById(sourceId);
    if (!source) return;

    const newId = uuid();
    const lastKey = await this.repo.getLastSortKey(newParentId);
    const sortKey = generateKeyBetween(lastKey, null);

    await this.repo.create({
      id: newId,
      parent_id: newParentId,
      title: source.title,
      content: source.content,
      type: source.type as SectionType,
      sort_key: sortKey,
      icon: source.icon,
    });

    const children = await this.repo.getChildren(source.id);
    for (const child of children) {
      await this.duplicateChild(child.id, newId);
    }
  }

  async convertIdeaToKanban(ideaId: string, columnNames?: { backlog: string; inProgress: string; done: string }): Promise<Section> {
    const idea = await this.repo.getById(ideaId);
    if (!idea) throw new Error(`Section ${ideaId} not found`);
    if (idea.type !== "idea") throw new Error(`Section ${ideaId} is not an idea`);

    let messages: IdeaMessage[] = [];
    try {
      const parsed = JSON.parse(idea.content);
      if (parsed.type === "doc") {
        const text = prosemirrorToPlain(parsed);
        if (text.trim()) {
          messages = [{ id: "legacy", text, createdAt: Date.now() }];
        }
      } else {
        messages = (parsed as IdeaData).messages ?? [];
      }
    } catch {
      /* unparseable */
    }

    if (messages.length === 0) throw new Error("No messages in idea");

    const cards: KanbanCard[] = messages
      .filter((m) => m.text?.trim())
      .map((m) => {
        const lines = m.text.trim().split("\n");
        const title = lines[0];
        const description = lines.slice(1).join("\n").trim();
        return {
          id: uuid(),
          title,
          description,
          labels: [],
          checked: false,
          properties: {},
          createdAt: new Date(m.createdAt).toISOString(),
          updatedAt: new Date(m.createdAt).toISOString(),
          sourceIdeaId: ideaId,
          sourceMessageId: m.id,
        };
      });

    const cols = columnNames ?? { backlog: "Backlog", inProgress: "In progress", done: "Done" };
    const id = uuid();
    const kanbanData: KanbanData = {
      columns: [
        { id: "col-1", title: cols.backlog, cards },
        { id: "col-2", title: cols.inProgress, cards: [] },
        { id: "col-3", title: cols.done, cards: [], isDone: true },
      ],
      properties: [],
      settings: {
        cardSize: "medium",
        cardPreview: "none",
        colorColumns: false,
        hideEmptyGroups: false,
      },
      sourceIdeaId: ideaId,
    };

    const lastKey = await this.repo.getLastSortKey(idea.parent_id);
    const sortKey = generateKeyBetween(lastKey, null);

    await this.repo.create({
      id,
      parent_id: idea.parent_id,
      title: idea.title,
      content: JSON.stringify(kanbanData),
      type: "kanban",
      sort_key: sortKey,
      icon: null,
    });

    // Link kanbanId back to the idea
    let ideaData: IdeaData;
    try {
      const parsed = JSON.parse(idea.content);
      if (parsed.type === "doc") {
        // Legacy ProseMirror format — convert to IdeaData
        ideaData = { messages };
      } else {
        ideaData = parsed as IdeaData;
      }
    } catch {
      ideaData = { messages };
    }
    ideaData.kanbanId = id;
    await this.repo.updateContent(ideaId, idea.title, JSON.stringify(ideaData));

    return (await this.repo.getById(id))!;
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  async restore(id: string): Promise<void> {
    await this.repo.restore(id);
  }

  async purgeDeleted(): Promise<void> {
    await this.repo.purgeOldDeleted(SOFT_DELETE_DAYS);
  }

  async getFileWithSections(fileId: string): Promise<{ file: Section; sections: FileSectionNode[] }> {
    const file = await this.repo.getById(fileId);
    if (!file || file.type !== "file") throw new Error(`Section ${fileId} is not a file`);
    // Limit depth to 2 levels (direct children + their children) to keep
    // IPC payload small. Deep nesting is accessed via section navigation.
    const sections = await this.buildSectionTree(fileId, 2);
    return { file, sections };
  }

  async getSectionChildren(parentId: string): Promise<FileSectionNode[]> {
    return this.buildSectionTree(parentId, 2);
  }

  private async buildSectionTree(parentId: string, maxDepth = 20): Promise<FileSectionNode[]> {
    // Only load direct children (1 level) to avoid loading the entire tree.
    // For large PDFs (304 sections), recursive loading produces 19+ MB of JSON.
    const children = await this.repo.getChildren(parentId);
    const sections = children.filter(c => c.type === "section" && !c.deleted_at);
    const result: FileSectionNode[] = [];
    for (const sec of sections) {
      const subChildren = maxDepth > 1 ? await this.buildSectionTree(sec.id, maxDepth - 1) : [];
      result.push({ ...sec, children: subChildren });
    }
    return result;
  }

  /**
   * Recursively builds a Markdown document from a section and all its children.
   * Heading levels increase with depth (capped at h6).
   */
  async buildSectionMarkdown(id: string, headingLevel: number = 1): Promise<string> {
    const section = await this.repo.getById(id);
    if (!section) return "";

    const parts: string[] = [];

    // Title as heading
    const heading = "#".repeat(Math.min(headingLevel, 6));
    parts.push(`${heading} ${section.title}`);

    // Section content → markdown
    try {
      const md = await this.getContent(id, "markdown");
      if (md.trim()) parts.push(md);
    } catch { /* empty content */ }

    // Recurse into children
    const children = await this.repo.getChildren(id);
    const activeChildren = children.filter(c => !c.deleted_at);
    for (const child of activeChildren) {
      const childMd = await this.buildSectionMarkdown(child.id, headingLevel + 1);
      if (childMd.trim()) parts.push(childMd);
    }

    return parts.join("\n\n");
  }

  async listAll(): Promise<Section[]> {
    return this.repo.list();
  }

  async getLatestByType(type: SectionType): Promise<Section | null> {
    return this.repo.getLatestByType(type);
  }
}

function buildTree(sections: Section[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const s of sections) {
    map.set(s.id, {
      id: s.id,
      parent_id: s.parent_id,
      title: s.title,
      type: s.type,
      icon: s.icon,
      sort_key: s.sort_key,
      summary: s.summary ?? null,
      children: [],
    });
  }

  for (const s of sections) {
    const node = map.get(s.id)!;
    if (s.parent_id && map.has(s.parent_id)) {
      map.get(s.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
