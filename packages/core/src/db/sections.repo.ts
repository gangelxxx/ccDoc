import type { Client } from "@libsql/client";
import type { Section, SectionType, RichNode, TreeStats } from "../types.js";

export class SectionsRepo {
  constructor(private db: Client) {}

  async list(includeDeleted = false): Promise<Section[]> {
    const sql = includeDeleted
      ? "SELECT * FROM sections ORDER BY sort_key"
      : "SELECT * FROM sections WHERE deleted_at IS NULL ORDER BY sort_key";
    const result = await this.db.execute(sql);
    return result.rows as unknown as Section[];
  }

  /** Like list() but without the heavy `content` column (for tree building). */
  async listMeta(includeDeleted = false): Promise<Section[]> {
    const sql = includeDeleted
      ? "SELECT id, parent_id, title, type, sort_key, icon, summary, deleted_at, created_at, updated_at, '' as content FROM sections ORDER BY sort_key"
      : "SELECT id, parent_id, title, type, sort_key, icon, summary, deleted_at, created_at, updated_at, '' as content FROM sections WHERE deleted_at IS NULL ORDER BY sort_key";
    const result = await this.db.execute(sql);
    return result.rows as unknown as Section[];
  }

  async getById(id: string): Promise<Section | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM sections WHERE id = ?",
      args: [id],
    });
    return (result.rows[0] as unknown as Section) ?? null;
  }

  async getChildren(parentId: string | null): Promise<Section[]> {
    const sql = parentId === null
      ? "SELECT * FROM sections WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_key"
      : "SELECT * FROM sections WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_key";
    const args = parentId === null ? [] : [parentId];
    const result = await this.db.execute({ sql, args });
    return result.rows as unknown as Section[];
  }

  /** Like getChildren but without the heavy `content` column (for tree building). */
  async getChildrenMeta(parentId: string): Promise<Section[]> {
    const result = await this.db.execute({
      sql: "SELECT id, parent_id, title, type, sort_key, icon, summary, deleted_at, created_at, updated_at, '' as content FROM sections WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_key",
      args: [parentId],
    });
    return result.rows as unknown as Section[];
  }

  /** Root-level sections (metadata only) with has_children flag for lazy loading. */
  async getRootMeta(): Promise<(Section & { has_children: number })[]> {
    const result = await this.db.execute(
      "SELECT id, parent_id, title, type, sort_key, icon, summary, deleted_at, created_at, updated_at, '' as content, " +
      "EXISTS(SELECT 1 FROM sections c WHERE c.parent_id = s.id AND c.deleted_at IS NULL) as has_children " +
      "FROM sections s WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_key"
    );
    return result.rows as unknown as (Section & { has_children: number })[];
  }

  /** Children (metadata only) with has_children flag for lazy loading. */
  async getChildrenMetaWithFlag(parentId: string): Promise<(Section & { has_children: number })[]> {
    const result = await this.db.execute({
      sql: "SELECT id, parent_id, title, type, sort_key, icon, summary, deleted_at, created_at, updated_at, '' as content, " +
        "EXISTS(SELECT 1 FROM sections c WHERE c.parent_id = s.id AND c.deleted_at IS NULL) as has_children " +
        "FROM sections s WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_key",
      args: [parentId],
    });
    return result.rows as unknown as (Section & { has_children: number })[];
  }

  async create(section: {
    id: string;
    parent_id: string | null;
    title: string;
    content: string;
    type: SectionType;
    sort_key: string;
    icon?: string | null;
  }): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO sections (id, parent_id, title, content, type, sort_key, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        section.id,
        section.parent_id,
        section.title,
        section.content,
        section.type,
        section.sort_key,
        section.icon ?? null,
      ],
    });
  }

  async updateContent(id: string, title: string, content: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE sections SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?",
      args: [title, content, id],
    });
  }

  async updateIcon(id: string, icon: string | null): Promise<void> {
    await this.db.execute({
      sql: "UPDATE sections SET icon = ?, updated_at = datetime('now') WHERE id = ?",
      args: [icon, id],
    });
  }

  async updateSortKey(id: string, sortKey: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE sections SET sort_key = ?, updated_at = datetime('now') WHERE id = ?",
      args: [sortKey, id],
    });
  }

  async move(id: string, newParentId: string | null, sortKey: string): Promise<void> {
    await this.db.execute({
      sql: "UPDATE sections SET parent_id = ?, sort_key = ?, updated_at = datetime('now') WHERE id = ?",
      args: [newParentId, sortKey, id],
    });
  }

  async softDelete(id: string): Promise<void> {
    // Single recursive CTE to soft-delete the section and all its descendants
    await this.db.execute({
      sql: `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM sections WHERE id = ?
          UNION ALL
          SELECT s.id FROM sections s
          JOIN descendants d ON s.parent_id = d.id
          WHERE s.deleted_at IS NULL
        )
        UPDATE sections SET deleted_at = datetime('now')
        WHERE id IN (SELECT id FROM descendants)
          AND deleted_at IS NULL
      `,
      args: [id],
    });
  }

  async restore(id: string): Promise<void> {
    // Get the parent's deletion timestamp before clearing it
    const parent = await this.db.execute({
      sql: "SELECT deleted_at FROM sections WHERE id = ?",
      args: [id],
    });
    const parentDeletedAt = parent.rows[0]?.deleted_at as string | null;
    if (!parentDeletedAt) return; // not deleted, nothing to restore

    // Restore the section and descendants that were deleted at the same time
    // (i.e. deleted_at >= parent's deleted_at), not those deleted independently before
    await this.db.execute({
      sql: `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM sections WHERE id = ?
          UNION ALL
          SELECT s.id FROM sections s
          JOIN descendants d ON s.parent_id = d.id
          WHERE s.deleted_at IS NOT NULL
            AND s.deleted_at >= ?
        )
        UPDATE sections SET deleted_at = NULL
        WHERE id IN (SELECT id FROM descendants)
      `,
      args: [id, parentDeletedAt],
    });
  }

  async purgeOldDeleted(days: number): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM sections WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)",
      args: [`-${days} days`],
    });
  }

  async setSummary(id: string, summary: string | null): Promise<void> {
    await this.db.execute({
      sql: "UPDATE sections SET summary = ?, updated_at = datetime('now') WHERE id = ?",
      args: [summary, id],
    });
  }

  async getLatestByType(type: SectionType): Promise<Section | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM sections WHERE type = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      args: [type],
    });
    return (result.rows[0] as unknown as Section) ?? null;
  }

  async getLastSortKey(parentId: string | null): Promise<string | null> {
    const sql = parentId === null
      ? "SELECT sort_key FROM sections WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_key DESC LIMIT 1"
      : "SELECT sort_key FROM sections WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_key DESC LIMIT 1";
    const args = parentId === null ? [] : [parentId];
    const result = await this.db.execute({ sql, args });
    return (result.rows[0]?.sort_key as string) ?? null;
  }

  // ─── Rich node queries for LLM gt/read tools ──────────────────

  /** Children with rich metadata (content_length, children_count) and pagination. */
  async getChildrenRich(parentId: string | null, opts: {
    offset?: number; limit?: number;
    sort?: "default" | "updated" | "size" | "title";
  } = {}): Promise<{ total: number; rows: RichNode[] }> {
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 50;
    const where = parentId === null
      ? "parent_id IS NULL AND deleted_at IS NULL"
      : "parent_id = ? AND deleted_at IS NULL";
    const args = parentId === null ? [] : [parentId];

    // Total count
    const countResult = await this.db.execute({ sql: `SELECT COUNT(*) as cnt FROM sections WHERE ${where}`, args });
    const total = Number(countResult.rows[0]?.cnt ?? 0);

    // Sort clause
    let orderBy = "sort_key";
    switch (opts.sort) {
      case "updated": orderBy = "updated_at DESC"; break;
      case "size": orderBy = "LENGTH(content) DESC"; break;
      case "title": orderBy = "title COLLATE NOCASE"; break;
    }

    const sql = `SELECT s.id, s.parent_id, s.title, s.type, s.icon, s.summary, s.updated_at,
      LENGTH(s.content) as content_length,
      (SELECT COUNT(*) FROM sections c WHERE c.parent_id = s.id AND c.deleted_at IS NULL) as children_count
      FROM sections s WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;

    const result = await this.db.execute({ sql, args: [...args, limit, offset] });
    return { total, rows: result.rows as unknown as RichNode[] };
  }

  /** Single node with rich metadata. */
  async getNodeInfo(id: string): Promise<RichNode | null> {
    const result = await this.db.execute({
      sql: `SELECT s.id, s.parent_id, s.title, s.type, s.icon, s.summary, s.updated_at,
        LENGTH(s.content) as content_length,
        (SELECT COUNT(*) FROM sections c WHERE c.parent_id = s.id AND c.deleted_at IS NULL) as children_count
        FROM sections s WHERE s.id = ? AND s.deleted_at IS NULL`,
      args: [id],
    });
    return (result.rows[0] as unknown as RichNode) ?? null;
  }

  /** Tree-wide statistics. */
  async getTreeStats(): Promise<TreeStats> {
    const statsResult = await this.db.execute(
      `SELECT COUNT(*) as total_nodes, COALESCE(SUM(LENGTH(content)), 0) as total_content_length,
        MAX(updated_at) as last_updated,
        COUNT(CASE WHEN type='folder' THEN 1 END) as folders,
        COUNT(CASE WHEN type='file' THEN 1 END) as files,
        COUNT(CASE WHEN type='section' THEN 1 END) as sections,
        COUNT(CASE WHEN type='idea' THEN 1 END) as ideas,
        COUNT(CASE WHEN type='todo' THEN 1 END) as todos,
        COUNT(CASE WHEN type='kanban' THEN 1 END) as kanbans,
        COUNT(CASE WHEN type='drawing' THEN 1 END) as drawings
      FROM sections WHERE deleted_at IS NULL`
    );
    const r = statsResult.rows[0] as any;

    // max_depth via recursive CTE
    const depthResult = await this.db.execute(
      `WITH RECURSIVE d(id, lvl) AS (
        SELECT id, 0 FROM sections WHERE parent_id IS NULL AND deleted_at IS NULL
        UNION ALL
        SELECT s.id, d.lvl + 1 FROM sections s JOIN d ON s.parent_id = d.id WHERE s.deleted_at IS NULL
      ) SELECT MAX(lvl) as max_depth FROM d`
    );
    const maxDepth = Number(depthResult.rows[0]?.max_depth ?? 0);

    const types: Record<string, number> = {};
    if (r.folders > 0) types.folder = Number(r.folders);
    if (r.files > 0) types.file = Number(r.files);
    if (r.sections > 0) types.section = Number(r.sections);
    if (r.ideas > 0) types.idea = Number(r.ideas);
    if (r.todos > 0) types.todo = Number(r.todos);
    if (r.kanbans > 0) types.kanban = Number(r.kanbans);
    if (r.drawings > 0) types.drawing = Number(r.drawings);

    return {
      total_nodes: Number(r.total_nodes),
      total_content_length: Number(r.total_content_length),
      max_depth: maxDepth,
      types,
      last_updated: r.last_updated ?? "",
    };
  }
}
