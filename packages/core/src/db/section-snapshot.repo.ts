import type { Client } from "@libsql/client";

export type SnapshotSource = "manual" | "assistant" | "mcp" | "import" | "restore";

export interface SectionSnapshot {
  id: string;
  section_id: string;
  content: string;
  title: string;
  type: string;
  source: SnapshotSource;
  created_at: string;
  byte_size: number;
}

export class SectionSnapshotRepo {
  constructor(private db: Client) {}

  async create(snapshot: Omit<SectionSnapshot, "byte_size" | "created_at">): Promise<void> {
    const byteSize = Buffer.byteLength(snapshot.content, "utf-8");
    await this.db.execute({
      sql: `INSERT INTO section_snapshots (id, section_id, content, title, type, source, created_at, byte_size)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      args: [snapshot.id, snapshot.section_id, snapshot.content, snapshot.title, snapshot.type, snapshot.source, byteSize],
    });
  }

  async updateContent(snapshotId: string, content: string, title: string): Promise<void> {
    const byteSize = Buffer.byteLength(content, "utf-8");
    await this.db.execute({
      sql: "UPDATE section_snapshots SET content = ?, title = ?, byte_size = ?, created_at = datetime('now') WHERE id = ?",
      args: [content, title, byteSize, snapshotId],
    });
  }

  async getLatest(sectionId: string): Promise<SectionSnapshot | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM section_snapshots WHERE section_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [sectionId],
    });
    return result.rows.length > 0 ? (result.rows[0] as unknown as SectionSnapshot) : null;
  }

  async listForSection(sectionId: string, limit = 50, offset = 0): Promise<SectionSnapshot[]> {
    const result = await this.db.execute({
      sql: "SELECT id, section_id, title, type, source, created_at, byte_size FROM section_snapshots WHERE section_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      args: [sectionId, limit, offset],
    });
    return result.rows as unknown as SectionSnapshot[];
  }

  async getById(snapshotId: string): Promise<SectionSnapshot | null> {
    const result = await this.db.execute({
      sql: "SELECT * FROM section_snapshots WHERE id = ?",
      args: [snapshotId],
    });
    return result.rows.length > 0 ? (result.rows[0] as unknown as SectionSnapshot) : null;
  }

  async countForSection(sectionId: string): Promise<number> {
    const result = await this.db.execute({
      sql: "SELECT COUNT(*) as cnt FROM section_snapshots WHERE section_id = ?",
      args: [sectionId],
    });
    return (result.rows[0].cnt as number) ?? 0;
  }

  async pruneOlderThan(sectionId: string, days: number): Promise<number> {
    const result = await this.db.execute({
      sql: "DELETE FROM section_snapshots WHERE section_id = ? AND created_at < datetime('now', ?)",
      args: [sectionId, `-${days} days`],
    });
    return result.rowsAffected;
  }

  async pruneExcess(sectionId: string, maxCount: number): Promise<number> {
    const result = await this.db.execute({
      sql: `DELETE FROM section_snapshots WHERE id IN (
              SELECT id FROM section_snapshots
              WHERE section_id = ?
              ORDER BY created_at DESC
              LIMIT -1 OFFSET ?
            )`,
      args: [sectionId, maxCount],
    });
    return result.rowsAffected;
  }

  async deleteForSection(sectionId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM section_snapshots WHERE section_id = ?",
      args: [sectionId],
    });
  }

  async deleteById(snapshotId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM section_snapshots WHERE id = ?",
      args: [snapshotId],
    });
  }

  async getTotalSize(): Promise<number> {
    const result = await this.db.execute("SELECT COALESCE(SUM(byte_size), 0) as total FROM section_snapshots");
    return (result.rows[0].total as number) ?? 0;
  }

  async getTotalCount(): Promise<number> {
    const result = await this.db.execute("SELECT COUNT(*) as cnt FROM section_snapshots");
    return (result.rows[0].cnt as number) ?? 0;
  }

  async getOldestDate(): Promise<string | null> {
    const result = await this.db.execute("SELECT MIN(created_at) as oldest FROM section_snapshots");
    return (result.rows[0].oldest as string) ?? null;
  }

  async pruneAllOlderThan(days: number): Promise<number> {
    const result = await this.db.execute({
      sql: "DELETE FROM section_snapshots WHERE created_at < datetime('now', ?)",
      args: [`-${days} days`],
    });
    return result.rowsAffected;
  }

  async pruneAllExcess(maxPerSection: number): Promise<number> {
    const result = await this.db.execute({
      sql: `DELETE FROM section_snapshots WHERE id IN (
              SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                  PARTITION BY section_id ORDER BY created_at DESC
                ) AS rn
                FROM section_snapshots
              ) WHERE rn > ?
            )`,
      args: [maxPerSection],
    });
    return result.rowsAffected;
  }
}
