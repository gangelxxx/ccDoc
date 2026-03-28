/**
 * IPC handlers for Semantic Index — thin proxy to the worker thread.
 *
 * All heavy work (file I/O, embedding, search) runs in a dedicated worker
 * thread, keeping the main Electron process responsive.
 */

import { join } from "path";
import { ipcMain } from "electron";
import { Worker } from "worker_threads";
import { getProjectServices, getProjectsService, getProjectDbsMap, getSettingsService, trackBgTask } from "../services";
import { getMainWindow } from "../window";
import type { WorkerCommand, WorkerRequestBody, WorkerResponse, EmbeddingConfig, DocSectionInput } from "../semantic-worker";
import type { IndexingConfigData } from "../services/settings.types";
import { SETTINGS_DEFAULTS } from "../services/settings.types";

// ── Worker lifecycle ──────────────────────────────────────────────

let worker: Worker | null = null;
let workerReady = false;
let readyPromise: Promise<void> | null = null;

// State mirrors (updated by worker messages)
const indexedTokens = new Set<string>();
const indexingInProgress = new Map<string, Promise<void>>();

// Request/response correlation
let reqCounter = 0;
const pendingRequests = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void }>();

function getWorkerPath(): string {
  return join(__dirname, "semantic-worker.js");
}

function sendToWorker(cmd: WorkerCommand): void {
  worker?.postMessage(cmd);
}

const REQUEST_TIMEOUT = 60_000;

function request<T>(cmd: WorkerRequestBody): Promise<T> {
  if (!worker) return Promise.reject(new Error("Semantic worker not available"));
  const reqId = ++reqCounter;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(reqId)) {
        pendingRequests.delete(reqId);
        reject(new Error(`Semantic worker request ${cmd.type} timed out`));
      }
    }, REQUEST_TIMEOUT);
    pendingRequests.set(reqId, {
      resolve: (data) => { clearTimeout(timer); resolve(data); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });
    sendToWorker({ ...cmd, reqId } as WorkerCommand);
  });
}

function ensureWorker(): Promise<void> {
  if (workerReady) return Promise.resolve();
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    worker = new Worker(getWorkerPath());

    worker.on("message", (msg: WorkerResponse) => {
      switch (msg.type) {
        case "ready":
          workerReady = true;
          resolve();
          break;

        // index:done / index:error are handled by per-call listeners in triggerIndexing()

        case "index:progress": {
          try {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) win.webContents.send("semantic:progress", { token: msg.token, item: msg.item });
          } catch { /* window destroyed */ }
          break;
        }

        case "save-cache": {
          // Fire-and-forget: persist embedding cache to project DB
          (async () => {
            try {
              const services = await getProjectServices(msg.token);
              if (msg.deletedIds.length > 0) {
                await services.semanticCache.deleteBatch(msg.deletedIds);
              }
              if (msg.chunks.length > 0) {
                await services.semanticCache.upsertBatch(
                  msg.chunks.map(c => ({
                    id: c.id,
                    kind: c.kind,
                    embedding: new Float32Array(c.embedding),
                    textHash: c.textHash,
                    metadata: c.metadata,
                    content: c.content,
                  })),
                );
              }
              console.log(`[SemanticIPC] Saved ${msg.chunks.length} cache entries for ${msg.token.slice(0, 8)}`);
            } catch (err) {
              console.warn("[SemanticIPC] save-cache failed:", err);
            }
          })();
          break;
        }

        // Request/response messages
        case "search:result":
        case "prefetch:result":
        case "stats:result":
        case "status:result":
        case "snapshot:result":
        case "reindex:done":
        case "index-update:done":
        case "get-indexed-ids:result": {
          const reqId = msg.reqId;
          const pending = pendingRequests.get(reqId);
          if (pending) {
            pendingRequests.delete(reqId);
            pending.resolve("data" in msg ? msg.data : "stats" in msg ? msg.stats : null);
          }
          break;
        }
      }
    });

    worker.on("error", (err) => {
      console.error("[SemanticWorker] Worker error:", err);
    });

    worker.on("exit", (code) => {
      console.warn(`[SemanticWorker] Worker exited with code ${code}`);
      const wasReady = workerReady;
      worker = null;
      workerReady = false;
      readyPromise = null;
      // Reject all pending requests
      for (const [, { reject: rj }] of pendingRequests) {
        rj(new Error("Worker exited"));
      }
      pendingRequests.clear();
      // Reject readyPromise if worker died before sending "ready"
      if (!wasReady) {
        reject(new Error(`Semantic worker exited with code ${code} before ready`));
      }
    });

    // Send init with embedding config, then indexing config
    const cfg = getEmbeddingConfig();
    worker.postMessage({ type: "init", config: cfg } satisfies WorkerCommand);
    worker.postMessage({ type: "update-config", indexing: getIndexingConfig() } satisfies WorkerCommand);
  });

  return readyPromise;
}

function getEmbeddingConfig(): EmbeddingConfig {
  try {
    const settingsService = getSettingsService();
    if (settingsService) {
      const cfg = settingsService.getAll().embedding;
      return {
        mode: cfg.mode,
        localModelId: cfg.localModelId,
        onlineProvider: cfg.onlineProvider,
        onlineModel: cfg.onlineModel,
        onlineApiKey: cfg.onlineApiKey,
      };
    }
  } catch { /* */ }
  return { mode: "none", localModelId: "", onlineProvider: "", onlineModel: "", onlineApiKey: "" };
}

function getIndexingConfig(): IndexingConfigData {
  try {
    const s = getSettingsService();
    if (s) return s.getAll().indexing;
  } catch { /* */ }
  return SETTINGS_DEFAULTS.indexing;
}

// ── Helper: collect doc sections for indexing ─────────────────────

async function collectDocSections(token: string): Promise<DocSectionInput[]> {
  const services = await getProjectServices(token);
  const allSections = await services.sections.listAll();
  const docSections: DocSectionInput[] = [];

  for (const sec of allSections) {
    if (sec.type === "folder" || sec.deleted_at) continue;
    try {
      const content = await services.sections.getContent(sec.id, "plain");
      if (content && typeof content === "string" && content.length > 0) {
        docSections.push({
          id: sec.id,
          title: sec.title,
          path: sec.title,
          content,
          type: sec.type,
        });
      }
    } catch { /* skip */ }
  }

  return docSections;
}

// ── Public API (used by index-scheduler and services.ts) ──────────

/**
 * Start background indexing (fire-and-forget). Deduplicates concurrent calls.
 */
export function triggerIndexing(token: string): void {
  if (indexedTokens.has(token) || indexingInProgress.has(token)) return;

  let resolveIndexing: () => void;
  const promise = new Promise<void>((r) => { resolveIndexing = r; });
  indexingInProgress.set(token, promise);

  const run = async () => {
    try {
      await ensureWorker();

      const project = await getProjectsService().getByToken(token);
      const projectPath = project?.path ?? null;
      const docSections = await collectDocSections(token);

      // Try loading from persistent cache first (instant restore, no re-embedding)
      let cachePayload: WorkerCommand | null = null;
      try {
        const services = await getProjectServices(token);
        const cached = await services.semanticCache.getAll();
        if (cached.length > 0) {
          cachePayload = {
            type: "load-cache",
            token,
            chunks: cached.map(r => {
              const buf = new ArrayBuffer(r.embedding.byteLength);
              new Float32Array(buf).set(r.embedding);
              return { id: r.id, kind: r.kind, embedding: buf, metadata: r.metadata, content: r.content };
            }),
          };
        }
      } catch (err) {
        console.warn("[SemanticIPC] cache load failed, falling back to full index:", err);
      }

      // Wait for index:done or index:error from the worker.
      // IMPORTANT: register listener BEFORE sending any message to avoid race condition
      // (worker's handleLoadCache is synchronous and sends index:done immediately).
      await new Promise<void>((resolve, reject) => {
        if (!worker) {
          reject(new Error("Worker not available"));
          return;
        }
        const w = worker; // capture non-null ref
        const cleanup = () => {
          w.off("message", onMessage);
          w.off("exit", onExit);
        };
        const onMessage = (msg: WorkerResponse) => {
          if ((msg.type === "index:done" || msg.type === "index:error") && msg.token === token) {
            cleanup();
            if (msg.type === "index:done") {
              indexedTokens.add(token);
              saveIndexTimestamps(token, projectPath).catch(() => {});
            }
            resolve();
          }
        };
        const onExit = () => {
          cleanup();
          reject(new Error("Worker exited during indexing"));
        };
        w.on("message", onMessage);
        w.on("exit", onExit);

        // Now send the actual command (listener is already attached)
        if (cachePayload) {
          sendToWorker(cachePayload);
        } else {
          sendToWorker({ type: "index", token, projectPath, docSections });
        }
      });
    } catch (err) {
      console.error("[SemanticIPC] triggerIndexing error:", err);
    } finally {
      if (indexingInProgress.get(token) === promise) {
        indexingInProgress.delete(token);
      }
      resolveIndexing!();
    }
  };

  trackBgTask("Semantic indexing", run);
}

async function saveIndexTimestamps(token: string, projectPath: string | null): Promise<void> {
  const services = await getProjectServices(token);
  await services.passport.set("semantic_last_indexed_at", new Date().toISOString());
  if (projectPath) {
    const { scanCodeMaxMtime } = await import("../index-scheduler");
    const cfg = getIndexingConfig();
    const mtime = await scanCodeMaxMtime(projectPath, new Set(cfg.excludedDirs), new Set(cfg.codeExtensions));
    await services.passport.set("code_max_mtime", String(mtime));
  }
}

/**
 * Incremental update: re-index only changed docs + changed code files.
 * Falls back to full triggerIndexing if project was never indexed.
 */
export async function triggerIncrementalUpdate(token: string): Promise<void> {
  if (!indexedTokens.has(token)) {
    triggerIndexing(token);
    return;
  }
  if (indexingInProgress.has(token)) return;
  if (!workerReady) return;

  try {
    const services = await getProjectServices(token);
    const project = await getProjectsService().getByToken(token);
    const projectPath = project?.path ?? null;

    // Determine watermarks
    const lastIndexedStr = await services.passport.get("semantic_last_indexed_at");
    const lastIndexedMs = lastIndexedStr ? new Date(lastIndexedStr).getTime() : 0;
    const codeSinceMs = Number(await services.passport.get("code_max_mtime") || "0");

    // Find changed doc sections (updated_at > lastIndexedMs)
    const allSections = await services.sections.listAll();
    const activeSectionIds = new Set<string>();
    const changedDocSections: DocSectionInput[] = [];
    const changedDocIds: string[] = [];

    for (const sec of allSections) {
      activeSectionIds.add(sec.id);
      if (sec.type === "folder" || sec.deleted_at) continue;
      const updatedMs = new Date(sec.updated_at).getTime();
      if (updatedMs > lastIndexedMs) {
        try {
          const content = await services.sections.getContent(sec.id, "plain");
          if (content && typeof content === "string" && content.length > 0) {
            changedDocSections.push({ id: sec.id, title: sec.title, path: sec.title, content, type: sec.type });
            changedDocIds.push(sec.id);
          }
        } catch { /* skip */ }
      }
    }

    // Detect deleted sections (in index but not in DB)
    const indexed = await request<{ sectionIds: string[]; filePaths: string[] }>(
      { type: "get-indexed-ids", token },
    );
    const deletedSectionIds = indexed.sectionIds.filter(id => !activeSectionIds.has(id));

    // Detect restored sections (in DB but not in index, and not already in changed list)
    const indexedSectionSet = new Set(indexed.sectionIds);
    const changedIdSet = new Set(changedDocIds);
    for (const sec of allSections) {
      if (sec.type === "folder" || sec.deleted_at) continue;
      if (!indexedSectionSet.has(sec.id) && !changedIdSet.has(sec.id)) {
        try {
          const content = await services.sections.getContent(sec.id, "plain");
          if (content && typeof content === "string" && content.length > 0) {
            changedDocSections.push({ id: sec.id, title: sec.title, path: sec.title, content, type: sec.type });
            changedDocIds.push(sec.id);
          }
        } catch { /* skip */ }
      }
    }

    // Skip only if truly nothing to do (no doc changes AND no project path for code scan)
    if (changedDocSections.length === 0 && deletedSectionIds.length === 0 && !projectPath) {
      return;
    }

    // Send incremental update to worker
    await trackBgTask("Semantic update", async () => {
      await request({ type: "index-update", token, projectPath, codeSinceMs,
        changedDocSections, changedDocIds, deletedFilePaths: [], deletedSectionIds });
    });

    // Update watermarks
    await saveIndexTimestamps(token, projectPath);
  } catch (err) {
    console.error("[SemanticIPC] triggerIncrementalUpdate error:", err);
  }
}

/**
 * Invalidate semantic index for a project (used by scheduler for re-indexing).
 */
export function invalidateSemanticIndex(token: string): void {
  indexingInProgress.delete(token);
  indexedTokens.delete(token);
  if (workerReady) {
    sendToWorker({ type: "invalidate", token });
  }
  // Clear persisted embedding cache
  getProjectServices(token)
    .then(s => s.semanticCache.deleteAll())
    .catch(() => {});
}

/**
 * Push current indexing config to the worker (e.g. after settings change).
 */
export function updateWorkerIndexingConfig(): void {
  if (!workerReady) return;
  sendToWorker({ type: "update-config", indexing: getIndexingConfig() });
}

// ── Known code file extensions ─────────────────────────────────────

const KNOWN_CODE_EXTENSIONS = new Set([
  // JavaScript / TypeScript
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs",
  // Python
  ".py", ".pyw", ".pyi",
  // Systems
  ".go", ".rs", ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".hxx", ".m", ".mm",
  // JVM
  ".java", ".kt", ".kts", ".scala", ".groovy", ".gradle", ".clj", ".cljs",
  // .NET
  ".cs", ".fs", ".vb",
  // Web
  ".vue", ".svelte", ".astro", ".html", ".css", ".scss", ".sass", ".less",
  // Ruby / PHP / Perl
  ".rb", ".php", ".pl", ".pm",
  // Other languages
  ".swift", ".dart", ".lua", ".r", ".jl", ".ex", ".exs", ".erl", ".hrl",
  ".hs", ".ml", ".mli", ".elm", ".purs", ".zig", ".nim", ".d", ".v",
  // Shell / scripts
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  // Data / config (sometimes useful)
  ".sql", ".graphql", ".gql", ".proto", ".tf", ".hcl",
  // Misc
  ".sol", ".asm", ".s", ".nix", ".rkt",
]);

// ── Known non-indexable directories ────────────────────────────────

const KNOWN_EXCLUDABLE = new Set([
  // Dependencies
  "node_modules", ".venv", "venv", "env", "__pycache__", "vendor", ".bundle", "bower_components", "jspm_packages", ".pnp",
  // Build outputs
  "dist", "build", "out", ".output", "release", ".next", ".nuxt", ".svelte-kit", "target", "bin", "obj", ".parcel-cache",
  // IDE/tools
  ".vscode", ".idea", ".vs", ".fleet", ".eclipse",
  // VCS
  ".git", ".svn", ".hg",
  // Cache
  ".cache", ".turbo", ".eslintcache", ".nyc_output", "coverage", ".tox", ".mypy_cache", ".ruff_cache", ".pytest_cache", ".webpack",
  // Other
  "logs", "tmp", "temp", ".tmp", ".docker", ".ccdoc",
]);

// ── IPC Registration ───────────────────────────────────────────────

export function registerSemanticIpc(): void {
  // semantic:search
  ipcMain.handle("semantic:search", async (_e, token: string, query: string, topK?: number, filter?: string) => {
    triggerIndexing(token);
    await ensureWorker();
    return request({ type: "search", token, query, topK: topK || 10, filter: filter || "all" });
  });

  // semantic:prefetch
  ipcMain.handle("semantic:prefetch", async (_e, token: string, userMessage: string, maxTokens?: number, minScore?: number) => {
    triggerIndexing(token);
    await ensureWorker();
    return request({ type: "prefetch", token, query: userMessage, maxTokens: maxTokens || 3000, minScore: minScore || 0.35 });
  });

  // semantic:snapshot
  ipcMain.handle("semantic:snapshot", async (_e, token: string) => {
    await ensureWorker();
    const project = await getProjectsService().getByToken(token);
    if (!project) return null;

    const services = await getProjectServices(token);
    const tree = await services.sections.getTree();

    return request({
      type: "snapshot",
      token,
      projectPath: project.path ?? null,
      docTree: tree,
    });
  });

  // semantic:status
  ipcMain.handle("semantic:status", async (_e, token: string) => {
    // Fast path: answer from main process state (no worker roundtrip needed)
    return {
      ready: indexedTokens.has(token),
      indexing: indexingInProgress.has(token),
      stats: null, // stats require worker roundtrip — omit for fast response
    };
  });

  // semantic:stats
  ipcMain.handle("semantic:stats", async (_e, token: string) => {
    if (!workerReady) return null;
    return request({ type: "stats", token });
  });

  // semantic:reindex
  ipcMain.handle("semantic:reindex", async (_e, token: string) => {
    // Wait for any in-flight indexing
    if (indexingInProgress.has(token)) {
      await indexingInProgress.get(token);
    }

    indexedTokens.delete(token);
    await ensureWorker();

    const project = await getProjectsService().getByToken(token);
    const projectPath = project?.path ?? null;
    const docSections = await collectDocSections(token);

    const stats = await trackBgTask("Semantic indexing", async () => {
      const result = await request<any>({ type: "reindex", token, projectPath, docSections });
      if (result) indexedTokens.add(token);
      return result;
    });

    // Save timestamps
    saveIndexTimestamps(token, projectPath).catch(() => {});

    return stats;
  });

  // semantic:invalidate-snapshot
  ipcMain.handle("semantic:invalidate-snapshot", async (_e, token: string) => {
    if (workerReady) {
      sendToWorker({ type: "invalidate-snapshot", token });
    }
  });

  // semantic:clear-index — clear index for a single project (including persisted cache)
  ipcMain.handle("semantic:clear-index", async (_e, token: string) => {
    invalidateSemanticIndex(token);
  });

  // indexing:apply-config — push new indexing config to worker + restart scheduler
  ipcMain.handle("indexing:apply-config", async () => {
    updateWorkerIndexingConfig();
    // Restart scheduler with new interval for all active projects
    const { restartAllPeriodicIndexing } = await import("../index-scheduler");
    const cfg = getIndexingConfig();
    restartAllPeriodicIndexing(cfg.stalenessIntervalMin * 60_000);
  });

  // indexing:scan-suggestions
  ipcMain.handle("indexing:scan-suggestions", async (_e, token: string) => scanExclusionSuggestions(token));

  // indexing:scan-extensions
  ipcMain.handle("indexing:scan-extensions", async (_e, token: string) => scanExtensionSuggestions(token));

  // indexing:scan-file-sizes
  ipcMain.handle("indexing:scan-file-sizes", async (_e, token: string) => scanFileSizeSuggestion(token));
}

// ── Scan functions (reusable from IPC + autoConfigureIndexing) ────

export async function scanExclusionSuggestions(token: string): Promise<string[]> {
  const project = await getProjectsService().getByToken(token);
  if (!project?.path) return [];
  const excluded = new Set(getIndexingConfig().excludedDirs);
  const suggestions: string[] = [];
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(project.path, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (excluded.has(e.name)) continue;
      if (KNOWN_EXCLUDABLE.has(e.name)) suggestions.push(e.name);
    }
  } catch { /* can't read */ }
  return suggestions.sort();
}

export async function scanExtensionSuggestions(token: string): Promise<string[]> {
  const project = await getProjectsService().getByToken(token);
  if (!project?.path) return [];
  const cfg = getIndexingConfig();
  const alreadyConfigured = new Set(cfg.codeExtensions.map(e => e.toLowerCase()));
  const excludedDirs = new Set(cfg.excludedDirs);
  const foundExtensions = new Set<string>();

  const { readdir } = await import("fs/promises");
  const { join: pathJoin, extname } = await import("path");

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (excludedDirs.has(e.name) || e.name.startsWith(".")) continue;
          await scan(pathJoin(dir, e.name), depth + 1);
        } else if (e.isFile()) {
          const ext = extname(e.name).toLowerCase();
          if (ext && KNOWN_CODE_EXTENSIONS.has(ext) && !alreadyConfigured.has(ext)) {
            foundExtensions.add(ext);
          }
        }
      }
    } catch { /* permission denied etc */ }
  }

  await scan(project.path, 0);
  return [...foundExtensions].sort();
}

export async function scanFileSizeSuggestion(token: string): Promise<{
  fileCount: number; maxSizeKB: number; maxFile: string;
  p99SizeKB: number; recommendedKB: number; coverAllKB: number;
} | null> {
  const project = await getProjectsService().getByToken(token);
  if (!project?.path) return null;
  const cfg = getIndexingConfig();
  const extensions = new Set(cfg.codeExtensions.map(e => e.toLowerCase()));
  const excludedDirs = new Set(cfg.excludedDirs);
  const sizes: number[] = [];
  let maxFile = "";
  let maxSize = 0;

  const { readdir, stat } = await import("fs/promises");
  const { join: pathJoin, extname, relative } = await import("path");

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 10) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (excludedDirs.has(e.name) || e.name.startsWith(".")) continue;
          await scan(pathJoin(dir, e.name), depth + 1);
        } else if (e.isFile()) {
          const ext = extname(e.name).toLowerCase();
          if (!ext || !extensions.has(ext)) continue;
          try {
            const st = await stat(pathJoin(dir, e.name));
            const kb = st.size / 1024;
            sizes.push(kb);
            if (kb > maxSize) {
              maxSize = kb;
              maxFile = relative(project!.path!, pathJoin(dir, e.name)).replace(/\\/g, "/");
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* permission denied */ }
  }

  await scan(project.path, 0);
  if (sizes.length === 0) return null;

  sizes.sort((a, b) => a - b);
  const p99Index = Math.min(Math.ceil(sizes.length * 0.99) - 1, sizes.length - 1);
  const p99 = sizes[p99Index];
  const rawRecommended = Math.ceil((p99 * 1.5) / 50) * 50;
  const recommended = Math.max(50, Math.min(2000, rawRecommended));
  const rawCoverAll = Math.ceil((maxSize * 1.1) / 50) * 50;
  const coverAll = Math.max(recommended, Math.min(2000, rawCoverAll));

  return {
    fileCount: sizes.length,
    maxSizeKB: Math.round(maxSize),
    maxFile,
    p99SizeKB: Math.round(p99),
    recommendedKB: recommended,
    coverAllKB: coverAll,
  };
}

// ── Auto-configure indexing for a project (first open) ────────────

/**
 * Scan project, merge found dirs/extensions/filesize into global indexing config.
 * Runs only once per project (passport flag `indexing_auto_configured`).
 */
export async function autoConfigureIndexing(token: string): Promise<void> {
  try {
    const services = await getProjectServices(token);
    const alreadyDone = await services.passport.get("indexing_auto_configured");
    if (alreadyDone) return;

    console.log(`[SemanticIPC] Auto-configuring indexing for ${token.slice(0, 8)}...`);

    const settingsService = getSettingsService();
    if (!settingsService) return;

    // Sequential: dirs → exts → sizes. Each scan reads fresh config,
    // so later scans benefit from earlier patches (e.g. size scan uses updated extensions).
    const dirs = await scanExclusionSuggestions(token);
    if (dirs.length > 0) {
      const cfg = settingsService.getAll().indexing;
      settingsService.patch({ indexing: { ...cfg, excludedDirs: [...new Set([...cfg.excludedDirs, ...dirs])] } });
    }

    const exts = await scanExtensionSuggestions(token);
    if (exts.length > 0) {
      const cfg = settingsService.getAll().indexing;
      settingsService.patch({ indexing: { ...cfg, codeExtensions: [...new Set([...cfg.codeExtensions, ...exts])] } });
    }

    const sizes = await scanFileSizeSuggestion(token);
    if (sizes) {
      const cfg = settingsService.getAll().indexing;
      settingsService.patch({ indexing: { ...cfg, maxFileSizeKB: sizes.recommendedKB } });
    }

    // Push updated config to worker
    updateWorkerIndexingConfig();

    await services.passport.set("indexing_auto_configured", "1");
    console.log(`[SemanticIPC] Auto-configured: +${dirs.length} dirs, +${exts.length} exts${sizes ? `, maxFile=${sizes.recommendedKB}KB` : ""}`);
  } catch (err) {
    console.warn("[SemanticIPC] autoConfigureIndexing failed:", err);
  }
}

/**
 * Cleanup: terminate worker (call on app quit).
 */
export function clearSemanticCaches(token?: string): void {
  if (token) {
    indexedTokens.delete(token);
    indexingInProgress.delete(token);
    if (workerReady) sendToWorker({ type: "clear", token });
  } else {
    indexedTokens.clear();
    indexingInProgress.clear();
    for (const [, { reject }] of pendingRequests) {
      reject(new Error("Semantic caches cleared"));
    }
    pendingRequests.clear();
    if (worker) {
      worker.terminate();
      worker = null;
      workerReady = false;
      readyPromise = null;
    }
  }
}

/**
 * Reinitialize the worker's embedding provider (e.g. after settings change).
 */
export async function refreshWorkerEmbedding(): Promise<void> {
  if (!workerReady) return;
  const cfg = getEmbeddingConfig();
  // Worker clears all indexes on init (embeddings become incompatible).
  // Clear main-process state so triggerIndexing re-runs full build.
  indexedTokens.clear();
  sendToWorker({ type: "init", config: cfg });
  // Clear all persisted caches — embeddings are model-specific
  const projectDbs = getProjectDbsMap();
  for (const [, services] of projectDbs) {
    services.semanticCache.deleteAll().catch(() => {});
  }
}
