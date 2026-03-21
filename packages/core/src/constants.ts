import { join } from "path";
import { homedir } from "os";

export const CCDOC_DIR = join(homedir(), ".ccdoc");
export const APP_DB_PATH = join(CCDOC_DIR, "app.sqlite");
export const PROJECTS_DIR = join(CCDOC_DIR, "projects");
export const BACKUPS_DIR = join(CCDOC_DIR, "backups");

export const PROJECT_MARKER_DIR = ".ccdoc";
export const PROJECT_TOKEN_FILE = "project.token";
export const CCDOC_IGNORE_FILE = ".ccdocignore";
export const EXPORT_DOCS_DIR = "docs";

export const SOFT_DELETE_DAYS = 30;
export const APP_SCHEMA_VERSION = 1;
export const PROJECT_SCHEMA_VERSION = 1;

const TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateToken(token: string): void {
  if (!TOKEN_REGEX.test(token)) {
    throw new Error(`Invalid project token: ${token}`);
  }
}

export function projectDbPath(token: string): string {
  validateToken(token);
  return join(PROJECTS_DIR, token, "docs.sqlite");
}

export function projectHistoryPath(token: string): string {
  validateToken(token);
  return join(PROJECTS_DIR, token, "history");
}

export function projectBackupPath(token: string): string {
  validateToken(token);
  return join(BACKUPS_DIR, token);
}
