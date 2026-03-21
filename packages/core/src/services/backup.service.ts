import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Client } from "@libsql/client";
import { projectDbPath, projectBackupPath } from "../constants.js";

export class BackupService {
  private projectDbs: Map<string, Client>;

  constructor(projectDbs?: Map<string, Client>) {
    this.projectDbs = projectDbs ?? new Map();
  }

  /** Register a db client for a project so WAL can be flushed before backup */
  registerDb(token: string, db: Client): void {
    this.projectDbs.set(token, db);
  }

  /** Unregister a db client (e.g. before project removal) */
  unregisterDb(token: string): void {
    this.projectDbs.delete(token);
  }

  async backup(token: string): Promise<string> {
    const source = projectDbPath(token);
    if (!existsSync(source)) {
      throw new Error(`Project database not found: ${source}`);
    }

    // Flush WAL to main database file for atomic copy
    const db = this.projectDbs.get(token);
    if (db) {
      await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    }

    const backupDir = projectBackupPath(token);
    mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(backupDir, `docs-${timestamp}.sqlite`);
    copyFileSync(source, dest);
    return dest;
  }

  async listBackups(token: string): Promise<Array<{ filename: string; date: string; size: number }>> {
    const backupDir = projectBackupPath(token);
    if (!existsSync(backupDir)) return [];
    const files = readdirSync(backupDir).filter(f => f.endsWith(".sqlite")).sort().reverse();
    return files.map(f => {
      const stat = statSync(join(backupDir, f));
      return { filename: f, date: stat.mtime.toISOString(), size: stat.size };
    });
  }

  async backupBeforeMigration(token: string): Promise<string> {
    return this.backup(token);
  }
}
