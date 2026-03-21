/**
 * Service initialization, project DB caching, DB file watchers, background task tracking.
 */
import { existsSync, watch as fsWatch } from "fs";
import type { FSWatcher } from "fs";
import type { BrowserWindow } from "electron";
import {
  openAppDb,
  openProjectDb,
  ProjectsService,
  SectionsService,
  HistoryService,
  ExportService,
  ImportService,
  SearchService,
  BackupService,
  FtsService,
  IndexService,
  INDEX_VERSION,
  ProjectPassportRepo,
  projectDbPath,
} from "@ccdoc/core";
import type { Client } from "@libsql/client";

// ── Types ──────────────────────────────────────────────────────────

export interface ProjectServices {
  db: Client;
  sections: SectionsService;
  export_: ExportService;
  import_: ImportService;
  history: HistoryService;
  fts: FtsService;
  index: IndexService;
  passport: ProjectPassportRepo;
}

// ── Module state ───────────────────────────────────────────────────

let appDb: Client;
let projectsService: ProjectsService;
let searchService: SearchService;
let backupService: BackupService;

const projectDbs = new Map<string, ProjectServices>();

// Watch project DB files for external changes (e.g. MCP server writes)
const dbWatchers = new Map<string, FSWatcher>();
const dbChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Suppress external-change notifications for app's own writes
const suppressedTokens = new Map<string, number>();
const SUPPRESS_WINDOW_MS = 3000;

export function suppressExternalChange(token: string): void {
  suppressedTokens.set(token, Date.now());
}

let bgTaskCounter = 0;

// We need a reference to mainWindow for sending IPC events.
// Set via setMainWindowGetter from index.ts after window creation.
let getMainWindow: () => BrowserWindow | null = () => null;

export function setMainWindowGetter(fn: () => BrowserWindow | null): void {
  getMainWindow = fn;
}

// ── DB file watchers ───────────────────────────────────────────────

function watchProjectDb(token: string): void {
  if (dbWatchers.has(token)) return;
  const dbPath = projectDbPath(token);
  if (!existsSync(dbPath)) return;
  try {
    const watcher = fsWatch(dbPath, () => {
      // Debounce: MCP bulk operations trigger many FS events
      if (dbChangeTimers.has(token)) clearTimeout(dbChangeTimers.get(token)!);
      dbChangeTimers.set(token, setTimeout(() => {
        dbChangeTimers.delete(token);
        // Skip if the app itself wrote recently
        const lastSuppress = suppressedTokens.get(token);
        if (lastSuppress && Date.now() - lastSuppress < SUPPRESS_WINDOW_MS) return;
        getMainWindow()?.webContents.send("db:external-change", { token });
      }, 1500));
    });
    dbWatchers.set(token, watcher);
  } catch (err) {
    console.warn(`[watch] Failed to watch ${dbPath}:`, err);
  }
}

function unwatchProjectDb(token: string): void {
  dbWatchers.get(token)?.close();
  dbWatchers.delete(token);
  if (dbChangeTimers.has(token)) {
    clearTimeout(dbChangeTimers.get(token)!);
    dbChangeTimers.delete(token);
  }
}

// ── Background task tracking ───────────────────────────────────────

export function trackBgTask<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const id = String(++bgTaskCounter);
  getMainWindow()?.webContents.send("bg-task:start", { id, label });
  return fn().finally(() => {
    getMainWindow()?.webContents.send("bg-task:finish", { id });
  });
}

// ── Project services (cached per token) ────────────────────────────

export async function getProjectServices(token: string): Promise<ProjectServices> {
  if (!projectDbs.has(token)) {
    const db = await openProjectDb(token);
    const sections = new SectionsService(db);
    const fts = new FtsService(db);
    const index = new IndexService(db);
    const passport = new ProjectPassportRepo(db);
    projectDbs.set(token, {
      db,
      sections,
      export_: new ExportService(db),
      import_: new ImportService(sections),
      history: new HistoryService(token),
      fts,
      index,
      passport,
    });
    backupService.registerDb(token, db);
    watchProjectDb(token);

    // Trigger FTS reindex if not yet indexed or index version changed
    (async () => {
      try {
        const indexed = await fts.isIndexed();
        const storedVer = await passport.get("fts_index_version");
        if (!indexed || storedVer !== String(INDEX_VERSION)) {
          await trackBgTask("Индексация поиска", () => index.reindexAll());
          await passport.set("fts_index_version", String(INDEX_VERSION));
        }
      } catch (err) {
        console.warn("[fts] reindex on open failed:", err);
      }
    })();
  }
  return projectDbs.get(token)!;
}

// ── Service initialization ─────────────────────────────────────────

export async function initServices(): Promise<void> {
  appDb = await openAppDb();
  projectsService = new ProjectsService(appDb);
  searchService = new SearchService();
  backupService = new BackupService();
  // Clean up orphaned project directories from previous failed removals
  projectsService.cleanupOrphans().catch((e) => console.warn("[init] orphan cleanup failed:", e));
}

// ── Getters for top-level services ─────────────────────────────────

export function getAppDb(): Client {
  return appDb;
}

export function getProjectsService(): ProjectsService {
  return projectsService;
}

export function getSearchService(): SearchService {
  return searchService;
}

export function getBackupService(): BackupService {
  return backupService;
}

export function getProjectDbsMap(): Map<string, ProjectServices> {
  return projectDbs;
}
