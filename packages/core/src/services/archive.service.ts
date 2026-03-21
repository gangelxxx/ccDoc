import { existsSync } from "fs";
import { join } from "path";
import { projectDbPath, projectHistoryPath, PROJECTS_DIR } from "../constants.js";

// Archive is a zip containing docs.sqlite + history/ + meta.json
// For MVP, we export the paths needed — actual zip logic uses Electron's dialog + archiver

export interface ArchiveMeta {
  token: string;
  name: string;
  exported_at: string;
  version: string;
}

export class ArchiveService {
  getArchiveFiles(token: string): { dbPath: string; historyPath: string } | null {
    const dbPath = projectDbPath(token);
    const historyPath = projectHistoryPath(token);
    if (!existsSync(dbPath)) return null;
    return { dbPath, historyPath };
  }

  getImportTargetDir(token: string): string {
    return join(PROJECTS_DIR, token);
  }
}
