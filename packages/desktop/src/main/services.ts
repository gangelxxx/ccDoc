/**
 * Service initialization, project DB caching, DB file watchers, background task tracking.
 */
import { existsSync, watch as fsWatch } from "fs";
import type { FSWatcher } from "fs";
import type { BrowserWindow } from "electron";
import {
  openAppDb,
  openProjectDb,
  openUserDb,
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
  UserService,
  SectionPrefsRepo,
  SectionSnapshotRepo,
  SectionSnapshotService,
} from "@ccdoc/core";
import type { Client } from "@libsql/client";
import { EmbeddingManager } from "./embedding-manager";
import { GitService } from "./services/git.service";
import { startPeriodicIndexing, stopPeriodicIndexing } from "./index-scheduler";
import { reindexFtsInWorker } from "./fts-reindex";
import { autoConfigureIndexing, triggerIndexing, clearSemanticCaches } from "./ipc/semantic";
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
  sectionPrefs: SectionPrefsRepo;
  snapshots: SectionSnapshotService;
}

// ── Module state ───────────────────────────────────────────────────

let appDb: Client;
let userDb: Client;
let userService: UserService;
let projectsService: ProjectsService;
let searchService: SearchService;
let backupService: BackupService;
let embeddingManager: EmbeddingManager;
let _settingsService: SettingsService | null = null;

const projectDbs = new Map<string, ProjectServices>();
const pendingInits = new Map<string, Promise<ProjectServices>>();

// Active project tracking — only one project has background processes at a time
let activeProjectToken: string | null = null;
let switchQueue: Promise<void> = Promise.resolve();

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

export function trackBgTask<T>(label: string, fn: (sendProgress?: (progress: number) => void) => Promise<T>): Promise<T> {
  const id = String(++bgTaskCounter);
  safeSend("bg-task:start", { id, label });
  const sendProgress = (progress: number) => {
    safeSend("bg-task:progress", { id, progress });
  };
  return fn(sendProgress).finally(() => {
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
        const sectionPrefs = new SectionPrefsRepo(db);
        const snapshotRepo = new SectionSnapshotRepo(db);
        const historySettings = _settingsService?.getAll().history;
        const snapshots = new SectionSnapshotService(snapshotRepo, historySettings ? {
          maxSnapshotsPerSection: historySettings.maxSnapshotsPerSection,
          maxAgeDays: historySettings.snapshotMaxAgeDays,
          coalesceIntervalSec: historySettings.snapshotCoalesceIntervalSec,
        } : undefined);
        sections.setSnapshotService(snapshots);
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
          sectionPrefs,
          snapshots,
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
              await trackBgTask("Search indexing", () => reindexFtsInWorker(token));
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

/** Phase 1: open databases, create core services. Returns appDb for vault init. */
export async function initServices(): Promise<{ appDb: Client }> {
  appDb = await openAppDb();
  userDb = await openUserDb();
  userService = new UserService(userDb);
  projectsService = new ProjectsService(appDb);
  searchService = new SearchService();
  backupService = new BackupService();
  // Clean up orphaned project directories from previous failed removals
  projectsService.cleanupOrphans().catch((e) => console.warn("[init] orphan cleanup failed:", e));
  return { appDb };
}

/** Phase 2: set settings service and create embedding manager (requires vault to be ready). */
export function completeInit(settingsService: SettingsService): void {
  _settingsService = settingsService;
  embeddingManager = new EmbeddingManager(settingsService);
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

export function getUserService(): UserService {
  return userService;
}

export function getUserDb(): Client {
  return userDb;
}

let gitService: GitService | null = null;
export function getGitService(): GitService {
  if (!gitService) gitService = new GitService();
  return gitService;
}

export function getProjectDbsMap(): Map<string, ProjectServices> {
  return projectDbs;
}

// ── Active project lifecycle ──────────────────────────────────────

function deactivateProject(token: string): void {
  unwatchProjectDb(token);
  clearSemanticCaches(token);
}

function reactivateProject(token: string): void {
  if (!projectDbs.has(token)) return;
  watchProjectDb(token);
  const idxIntervalMs = (_settingsService?.getAll().indexing?.stalenessIntervalMin ?? 5) * 60_000;
  startPeriodicIndexing(token, idxIntervalMs);
  triggerIndexing(token);
}

export function switchActiveProject(newToken: string): Promise<void> {
  switchQueue = switchQueue.then(() => doSwitch(newToken));
  return switchQueue;
}

function doSwitch(newToken: string): void {
  if (activeProjectToken === newToken) return;
  if (activeProjectToken && projectDbs.has(activeProjectToken)) {
    deactivateProject(activeProjectToken);
  }
  activeProjectToken = newToken;
  if (projectDbs.has(newToken)) {
    reactivateProject(newToken);
  }
}

export function clearActiveToken(token: string): void {
  if (activeProjectToken === token) activeProjectToken = null;
}
