import type { Client } from "@libsql/client";
import type { Section, SectionType } from "../types.js";

export class SectionsRepo {
  constructor(private db: Client) {}

  async list(includeDeleted = false): Promise<Section[]> {
    const sql = includeDeleted
      ? "SELECT * FROM sections ORDER BY sort_key"
      : "SELECT * FROM sections WHERE deleted_at IS NULL ORDER BY sort_key";
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
}
