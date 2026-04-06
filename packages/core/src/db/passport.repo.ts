import type { Client } from "@libsql/client";

/** Keys that are internal (not user-facing passport fields). Hidden from UI and MCP overview. */
export const INTERNAL_PASSPORT_KEYS = new Set([
  "auto_commit_enabled",
  "fts_index_version",
  "fts_last_indexed_at",
  "semantic_last_indexed_at",
  "code_max_mtime",
  "indexing_auto_configured",
]);

/** Default user-facing passport fields in display order */
export const DEFAULT_PASSPORT_FIELDS = [
  "name", "description", "stack", "architecture",
  "conventions", "commands", "structure", "notes",
] as const;

export class ProjectPassportRepo {
  constructor(private db: Client) {}

  async getAll(): Promise<Record<string, string>> {
    const result = await this.db.execute("SELECT key, value FROM project_passport");
    const passport: Record<string, string> = {};
    for (const row of result.rows) {
      passport[row.key as string] = row.value as string;
    }
    return passport;
  }

  async get(key: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: "SELECT value FROM project_passport WHERE key = ?",
      args: [key],
    });
    return (result.rows[0]?.value as string) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO project_passport (key, value, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [key, value],
    });
  }

  async delete(key: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM project_passport WHERE key = ?",
      args: [key],
    });
  }

  /** Get only user-facing fields (excludes internal system keys) */
  async getUserFields(): Promise<Record<string, string>> {
    const all = await this.getAll();
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(all)) {
      if (!INTERNAL_PASSPORT_KEYS.has(key)) result[key] = value;
    }
    return result;
  }
}
