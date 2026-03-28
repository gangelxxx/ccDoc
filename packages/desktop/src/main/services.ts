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
  FtsRepo,
  EmbeddingRepo,
  FindService,
  SemanticCacheRepo,
} from "@ccdoc/core";
import type { Client } from "@libsql/client";
import { EmbeddingManager } from "./embedding-manager";
import { startPeriodicIndexing, stopPeriodicIndexing } from "./index-scheduler";
import type { SettingsService } from "./services/settings.service";

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
  find: FindService;
  embeddingRepo: EmbeddingRepo;
  semanticCache: SemanticCacheRepo;
}

// ── Module state ───────────────────────────────────────────────────

let appDb: Client;
let projectsService: ProjectsService;
let searchService: SearchService;
let backupService: BackupService;
let embeddingManager: EmbeddingManager;
let _settingsService: SettingsService | null = null;

const projectDbs = new Map<string, ProjectServices>();
const pendingInits = new Map<string, Promise<ProjectServices>>();

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
export let getMainWindow: () => BrowserWindow | null = () => null;

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

export function unwatchProjectDb(token: string): void {
  dbWatchers.get(token)?.close();
  dbWatchers.delete(token);
  if (dbChangeTimers.has(token)) {
    clearTimeout(dbChangeTimers.get(token)!);
    dbChangeTimers.delete(token);
  }
  stopPeriodicIndexing(token);
}

// ── Background task tracking ───────────────────────────────────────

function safeSend(channel: string, data: any): void {
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  } catch { /* window destroyed */ }
}

export function trackBgTask<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const id = String(++bgTaskCounter);
  safeSend("bg-task:start", { id, label });
  return fn().finally(() => {
    safeSend("bg-task:finish", { id });
  });
}

// ── Project services (cached per token) ────────────────────────────

export function getProjectServices(token: string): Promise<ProjectServices> {
  if (projectDbs.has(token)) return Promise.resolve(projectDbs.get(token)!);

  if (!pendingInits.has(token)) {
    const initPromise = (async () => {
      try {
        const db = await openProjectDb(token);
        const sections = new SectionsService(db);
        const fts = new FtsService(db);
        const ftsRepo = new FtsRepo(db);
        const embeddingRepo = new EmbeddingRepo(db);
        const model = embeddingManager?.getProvider() ?? null;
        const index = new IndexService(db, undefined, ftsRepo, model, embeddingRepo);
        const passport = new ProjectPassportRepo(db);
        const find = new FindService(ftsRepo, embeddingRepo, model);
        const semanticCache = new SemanticCacheRepo(db);
        const services: ProjectServices = {
          db,
          sections,
          export_: new ExportService(db),
          import_: new ImportService(sections),
          history: new HistoryService(token),
          fts,
          index,
          passport,
          find,
          embeddingRepo,
          semanticCache,
        };
        projectDbs.set(token, services);
        backupService.registerDb(token, db);
        watchProjectDb(token);
        const idxIntervalMs = (_settingsService?.getAll().indexing?.stalenessIntervalMin ?? 5) * 60_000;
        startPeriodicIndexing(token, idxIntervalMs);

        // Trigger FTS reindex if not yet indexed or index version changed.
        // Runs in a worker thread to avoid blocking the main process.
        (async () => {
          try {
            const indexed = await fts.isIndexed();
            const storedVer = await passport.get("fts_index_version");
            if (!indexed || storedVer !== String(INDEX_VERSION)) {
              const { reindexFtsInWorker } = await import("./fts-reindex");
              await trackBgTask("Индексация поиска", () => reindexFtsInWorker(token));
              await passport.set("fts_index_version", String(INDEX_VERSION));
              await passport.set("fts_last_indexed_at", new Date().toISOString());
            }
          } catch (err) {
            console.warn("[fts] reindex on open failed:", err);
          }
        })();

        // Auto-configure then start semantic indexing
        (async () => {
          try {
            const { autoConfigureIndexing, triggerIndexing } = await import("./ipc/semantic");
            await autoConfigureIndexing(token);
            triggerIndexing(token);
          } catch (err) {
            console.warn("[semantic] proactive indexing failed:", err);
          }
        })();

        return services;
      } finally {
        pendingInits.delete(token);
      }
    })();
    pendingInits.set(token, initPromise);
  }
  return pendingInits.get(token)!;
}

// ── Service initialization ─────────────────────────────────────────

export async function initServices(settingsService?: SettingsService): Promise<void> {
  appDb = await openAppDb();
  projectsService = new ProjectsService(appDb);
  searchService = new SearchService();
  backupService = new BackupService();
  if (settingsService) {
    _settingsService = settingsService;
    embeddingManager = new EmbeddingManager(settingsService);
  }
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

export function getEmbeddingManager(): EmbeddingManager {
  return embeddingManager;
}

export function getSettingsService(): SettingsService | null {
  return _settingsService;
}

export function getProjectDbsMap(): Map<string, ProjectServices> {
  return projectDbs;
}
