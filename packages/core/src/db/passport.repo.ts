import type { Client } from "@libsql/client";

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
}
