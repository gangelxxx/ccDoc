import type { Client } from "@libsql/client";

export interface FtsSearchResult {
  id: string;
  title: string;
  titleHighlighted: string;
  snippet: string;
  score: number;
  breadcrumbs: string;
}

export class FtsRepo {
  constructor(private db: Client) {}

  async upsert(
    sectionId: string,
    title: string,
    tags: string,
    breadcrumbs: string,
    body: string
  ): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO sections_text (section_id, title, tags, breadcrumbs, body) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(section_id) DO UPDATE SET title = excluded.title, tags = excluded.tags, breadcrumbs = excluded.breadcrumbs, body = excluded.body`,
      args: [sectionId, title, tags, breadcrumbs, body],
    });
  }

  async delete(sectionId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM sections_text WHERE section_id = ?",
      args: [sectionId],
    });
  }

  async search(query: string, limit = 20): Promise<FtsSearchResult[]> {
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    const result = await this.db.execute({
      sql: `
        SELECT
          st.section_id AS id,
          st.title,
          st.breadcrumbs,
          highlight(sections_fts, 0, '<mark>', '</mark>') AS titleHighlighted,
          snippet(sections_fts, 3, '<mark>', '</mark>', '…', 40) AS snippet,
          bm25(sections_fts, 10, 5, 3, 1) AS rank
        FROM sections_fts
        JOIN sections_text st ON st.rowid = sections_fts.rowid
        JOIN sections s ON s.id = st.section_id
        WHERE sections_fts MATCH ?
          AND s.deleted_at IS NULL
        ORDER BY rank
        LIMIT ?
      `,
      args: [ftsQuery, limit],
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      titleHighlighted: row.titleHighlighted as string,
      snippet: row.snippet as string,
      breadcrumbs: row.breadcrumbs as string,
      score: -(row.rank as number),
    }));
  }

  async reindexAll(
    sections: { id: string; title: string; tags: string; breadcrumbs: string; body: string }[]
  ): Promise<void> {
    await this.db.execute("DELETE FROM sections_text");

    // Insert in small batches to avoid locking the DB for too long
    // (a single giant batch blocks all other queries until it completes).
    const BATCH = 50;
    for (let i = 0; i < sections.length; i += BATCH) {
      const chunk = sections.slice(i, i + BATCH);
      const statements = chunk.map((s) => ({
        sql: "INSERT INTO sections_text (section_id, title, tags, breadcrumbs, body) VALUES (?, ?, ?, ?, ?)",
        args: [s.id, s.title, s.tags, s.breadcrumbs, s.body] as any[],
      }));
      await this.db.batch(statements, "write");
    }
  }

  async getByIds(ids: string[]): Promise<Map<string, { title: string; breadcrumbs: string }>> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(",");
    const result = await this.db.execute({
      sql: `SELECT section_id, title, breadcrumbs FROM sections_text WHERE section_id IN (${placeholders})`,
      args: ids,
    });
    const map = new Map<string, { title: string; breadcrumbs: string }>();
    for (const row of result.rows) {
      map.set(row.section_id as string, {
        title: row.title as string,
        breadcrumbs: (row.breadcrumbs as string) ?? "",
      });
    }
    return map;
  }

  async count(): Promise<number> {
    const res = await this.db.execute("SELECT COUNT(*) as cnt FROM sections_text");
    return (res.rows[0]?.cnt as number) ?? 0;
  }
}

/**
 * Sanitize user input for FTS5 MATCH syntax.
 * Wraps each term in double quotes and appends * for prefix matching.
 */
function sanitizeFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      // Remove FTS5 special characters
      const clean = t.replace(/["""*^~(){}[\]:]/g, "");
      if (!clean) return null;
      return `"${clean}"*`;
    })
    .filter(Boolean);

  return terms.join(" ");
}
