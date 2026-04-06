import type { Client } from "@libsql/client";

// ─── Types ─────────────────────────────────────────────────────

export interface RevisionInfo {
  revision: number;
  source: string;
  created_at: string;
  keys: string[];
}

export interface VaultBackend {
  getLatest(key: string): Promise<string | null>;
  getAllLatest(): Promise<Record<string, string>>;
  commit(entries: Record<string, string>, source: string): Promise<number>;
  getRevisions(limit: number): Promise<RevisionInfo[]>;
  /** Point-in-time snapshot: latest value for each key as of the given revision. */
  getRevision(rev: number): Promise<Record<string, string>>;
  /** Delete revisions older than the newest `keepCount`. Returns number of deleted revisions. */
  prune(keepCount: number): Promise<number>;
}

// ─── SQLite implementation ─────────────────────────────────────

export class VaultRepo implements VaultBackend {
  constructor(private db: Client) {}

  async getLatest(key: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: "SELECT value FROM vault_entries WHERE key = ? ORDER BY revision DESC LIMIT 1",
      args: [key],
    });
    return (result.rows[0]?.value as string) ?? null;
  }

  async getAllLatest(): Promise<Record<string, string>> {
    const result = await this.db.execute(
      `SELECT e.key, e.value FROM vault_entries e
       INNER JOIN (SELECT key, MAX(revision) AS max_rev FROM vault_entries GROUP BY key) g
       ON e.key = g.key AND e.revision = g.max_rev`
    );
    const out: Record<string, string> = {};
    for (const row of result.rows) {
      out[row.key as string] = row.value as string;
    }
    return out;
  }

  async commit(entries: Record<string, string>, source: string): Promise<number> {
    const keys = Object.keys(entries);
    if (keys.length === 0) return -1;

    // Transaction: insert revision, then entries
    const revResult = await this.db.execute({
      sql: "INSERT INTO vault_revisions (source) VALUES (?)",
      args: [source],
    });
    const revision = Number(revResult.lastInsertRowid);

    // Batch insert entries
    const stmts = keys.map((key) => ({
      sql: "INSERT INTO vault_entries (revision, key, value) VALUES (?, ?, ?)",
      args: [revision, key, entries[key]],
    }));
    await this.db.batch(stmts);

    return revision;
  }

  async getRevisions(limit: number): Promise<RevisionInfo[]> {
    const result = await this.db.execute({
      sql: `SELECT r.revision, r.source, r.created_at,
                   GROUP_CONCAT(e.key) AS keys_csv
            FROM vault_revisions r
            LEFT JOIN vault_entries e ON e.revision = r.revision
            GROUP BY r.revision
            ORDER BY r.revision DESC
            LIMIT ?`,
      args: [limit],
    });
    return result.rows.map((row) => ({
      revision: row.revision as number,
      source: row.source as string,
      created_at: row.created_at as string,
      keys: (row.keys_csv as string)?.split(",") ?? [],
    }));
  }

  async getRevision(rev: number): Promise<Record<string, string>> {
    const result = await this.db.execute({
      sql: `SELECT e.key, e.value FROM vault_entries e
            INNER JOIN (
              SELECT key, MAX(revision) AS max_rev
              FROM vault_entries WHERE revision <= ?
              GROUP BY key
            ) g ON e.key = g.key AND e.revision = g.max_rev`,
      args: [rev],
    });
    const out: Record<string, string> = {};
    for (const row of result.rows) {
      out[row.key as string] = row.value as string;
    }
    return out;
  }

  async prune(keepCount: number): Promise<number> {
    // Find the cutoff revision
    const cutoffResult = await this.db.execute({
      sql: `SELECT revision FROM vault_revisions ORDER BY revision DESC LIMIT 1 OFFSET ?`,
      args: [keepCount - 1],
    });
    if (cutoffResult.rows.length === 0) return 0; // nothing to prune

    const cutoffRev = cutoffResult.rows[0].revision as number;

    // Delete old entries and revisions
    await this.db.execute({
      sql: "DELETE FROM vault_entries WHERE revision < ?",
      args: [cutoffRev],
    });
    const delResult = await this.db.execute({
      sql: "DELETE FROM vault_revisions WHERE revision < ?",
      args: [cutoffRev],
    });
    return delResult.rowsAffected;
  }
}
