import type { Client } from "@libsql/client";

export interface SectionPrefRow {
  section_id: string;
  pref_key: string;
  pref_value: string;
  updated_at: number;
}

export class SectionPrefsRepo {
  constructor(private db: Client) {}

  async getAllForSection(sectionId: string): Promise<Record<string, unknown>> {
    const result = await this.db.execute({
      sql: "SELECT pref_key, pref_value FROM section_view_prefs WHERE section_id = ?",
      args: [sectionId],
    });
    const prefs: Record<string, unknown> = {};
    for (const row of result.rows) {
      try {
        prefs[row.pref_key as string] = JSON.parse(row.pref_value as string);
      } catch {
        prefs[row.pref_key as string] = row.pref_value;
      }
    }
    return prefs;
  }

  async get(sectionId: string, key: string): Promise<unknown | undefined> {
    const result = await this.db.execute({
      sql: "SELECT pref_value FROM section_view_prefs WHERE section_id = ? AND pref_key = ?",
      args: [sectionId, key],
    });
    if (result.rows.length === 0) return undefined;
    try {
      return JSON.parse(result.rows[0].pref_value as string);
    } catch {
      return result.rows[0].pref_value;
    }
  }

  async set(sectionId: string, key: string, value: unknown): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO section_view_prefs (section_id, pref_key, pref_value, updated_at)
            VALUES (?, ?, ?, unixepoch())
            ON CONFLICT(section_id, pref_key) DO UPDATE SET pref_value = excluded.pref_value, updated_at = excluded.updated_at`,
      args: [sectionId, key, JSON.stringify(value)],
    });
  }

  async delete(sectionId: string, key: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM section_view_prefs WHERE section_id = ? AND pref_key = ?",
      args: [sectionId, key],
    });
  }

  async deleteAll(sectionId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM section_view_prefs WHERE section_id = ?",
      args: [sectionId],
    });
  }
}
