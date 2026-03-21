import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { APP_DB_PATH, projectDbPath, CCDOC_DIR, PROJECTS_DIR, BACKUPS_DIR } from "../constants.js";
import { migrateAppDb, migrateProjectDb } from "./migrations.js";

export function ensureDirs(): void {
  mkdirSync(CCDOC_DIR, { recursive: true });
  mkdirSync(PROJECTS_DIR, { recursive: true });
  mkdirSync(BACKUPS_DIR, { recursive: true });
}

export async function openAppDb(): Promise<Client> {
  ensureDirs();
  const db = createClient({ url: `file:${APP_DB_PATH}` });
  try {
    await migrateAppDb(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export async function openProjectDb(token: string): Promise<Client> {
  const dbPath = projectDbPath(token);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = createClient({ url: `file:${dbPath}` });
  try {
    await migrateProjectDb(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}
