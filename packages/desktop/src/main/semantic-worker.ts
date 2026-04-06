/**
 * Semantic Worker — runs SemanticIndex + embedding in a dedicated worker thread,
 * keeping the main (UI) Electron process responsive.
 *
 * Communication: structured messages via parentPort (worker_threads).
 */

import { parentPort } from "worker_threads";
import { join } from "path";
import { homedir } from "os";
import { EmbeddingModel, OnlineEmbeddingProvider } from "@ccdoc/core";
import type { IEmbeddingProvider } from "@ccdoc/core";
import {
  SemanticIndex,
  generateCodeSnapshot,
  generateDocSnapshot,
  formatSearchResults,
} from "./semantic-index";
import type { SearchResult, SemanticIndexStats, ProjectSnapshot, YieldFn, IndexingOptions } from "./semantic-index";
import type { IndexingConfigData } from "./services/settings.types";

// ── Types ─────────────────────────────────────────────────────────

export interface EmbeddingConfig {
  mode: string;        // "none" | "local" | "online"
  localModelId: string;
  onlineProvider: string;
  onlineModel: string;
  onlineApiKey: string;
}

export interface DocSectionInput {
  id: string;
  title: string;
  path: string;
  content: string;
  type: string;
}

export interface LinkedProjectSource {
  prefix: string;              // project name — prepended to file paths as [prefix]/
  projectPath: string | null;  // code source directory
  docSections: DocSectionInput[];
}

export interface LinkedSnapshotSource {
  prefix: string;
  projectPath: string | null;
  docTree: any[];
}

export interface LinkedUpdateSource {
  prefix: string;
  projectPath: string | null;
  codeSinceMs: number;
  changedDocSections: DocSectionInput[];
  changedDocIds: string[];
  deletedFilePaths: string[];
  deletedSectionIds: string[];
}

/** Main → Worker */
export type WorkerCommand =
  | { type: "init"; config: EmbeddingConfig }
  | { type: "update-config"; indexing: IndexingConfigData }
  | { type: "index"; token: string; projectPath: string | null; docSections: DocSectionInput[]; linkedSources?: LinkedProjectSource[] }
  | { type: "search"; reqId: number; token: string; query: string; topK: number; filter: string }
  | { type: "prefetch"; reqId: number; token: string; query: string; maxTokens: number; minScore: number }
  | { type: "stats"; reqId: number; token: string }
  | { type: "status"; reqId: number; token: string }
  | { type: "snapshot"; reqId: number; token: string; projectPath: string | null; docTree: any[]; linkedSources?: LinkedSnapshotSource[] }
  | { type: "clear"; token: string }
  | { type: "invalidate"; token: string }
  | { type: "invalidate-snapshot"; token: string }
  | { type: "reindex"; reqId: number; token: string; projectPath: string | null; docSections: DocSectionInput[]; linkedSources?: LinkedProjectSource[] }
  | { type: "index-update"; reqId: number; token: string;
      projectPath: string | null; codeSinceMs: number;
      changedDocSections: DocSectionInput[]; changedDocIds: string[];
      deletedFilePaths: string[]; deletedSectionIds: string[];
      linkedSources?: LinkedUpdateSource[] }
  | { type: "get-indexed-ids"; reqId: number; token: string }
  | { type: "load-cache"; token: string; chunks: Array<{ id: string; kind: string; embedding: ArrayBuffer; metadata: string; content?: string }> };

/** Subset of WorkerCommand that follows request/response pattern (has reqId). */
export type WorkerRequestCommand = Extract<WorkerCommand, { reqId: number }>;

/** Distributive Omit that preserves union branches. */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type WorkerRequestBody = DistributiveOmit<WorkerRequestCommand, "reqId">;

/** Worker → Main */
export type WorkerResponse =
  | { type: "ready" }
  | { type: "index:progress"; token: string; item: string }
  | { type: "index:done"; token: string; stats: SemanticIndexStats }
  | { type: "index:error"; token: string; error: string }
  | { type: "search:result"; reqId: number; data: any }
  | { type: "prefetch:result"; reqId: number; data: any }
  | { type: "stats:result"; reqId: number; data: SemanticIndexStats | null }
  | { type: "status:result"; reqId: number; data: { ready: boolean; indexing: boolean; stats: SemanticIndexStats | null } }
  | { type: "snapshot:result"; reqId: number; data: ProjectSnapshot | null }
  | { type: "reindex:done"; reqId: number; stats: SemanticIndexStats | null }
  | { type: "index-update:done"; reqId: number; stats: SemanticIndexStats }
  | { type: "get-indexed-ids:result"; reqId: number; data: { sectionIds: string[]; filePaths: string[] } }
  | { type: "save-cache"; token: string; chunks: Array<{ id: string; kind: string; embedding: ArrayBuffer; textHash: string; metadata: string; content: string }>; deletedIds: string[] };

// ── State ─────────────────────────────────────────────────────────

let provider: IEmbeddingProvider | null = null;
const indexCache = new Map<string, SemanticIndex>();
const indexedTokens = new Set<string>();
const indexingInProgress = new Set<string>();
const snapshotCache = new Map<string, { snapshot: ProjectSnapshot; ts: number }>();

const SNAPSHOT_TTL = 120_000;

/** Indexing config — kept in sync with settings via "update-config" messages. */
let indexingConfig: IndexingConfigData = {
  enabled: true,
  intensity: "low",
  excludedDirs: [
    "node_modules", ".git", ".ccdoc", "dist", "build", ".next", "vendor",
    "__pycache__", ".vscode", ".idea", ".svn", "coverage", ".nyc_output",
    ".cache", ".turbo", "release", "out", ".output", "logs",
  ],
  codeExtensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".go", ".rs"],
  maxFileSizeKB: 500,
  stalenessIntervalMin: 5,
};

// ── Helpers ───────────────────────────────────────────────────────

/** Convert user-facing IndexingConfigData to internal IndexingOptions. */
function toIndexingOptions(cfg: IndexingConfigData): IndexingOptions {
  const { intensity } = cfg;
  return {
    codeExts: new Set(cfg.codeExtensions),
    excludedDirs: new Set(cfg.excludedDirs),
    maxFileSize: cfg.maxFileSizeKB * 1024,
    codeChunkSize: intensity === "low" ? 3 : intensity === "high" ? 200 : 50,
    docChunkSize: intensity === "low" ? 3 : intensity === "high" ? 100 : 30,
  };
}

/** Return a yield function based on intensity (low = throttle, medium = cooperative, high = none). */
function getYieldFn(): YieldFn | undefined {
  if (indexingConfig.intensity === "low") return () => new Promise(r => setTimeout(r, 200));
  if (indexingConfig.intensity === "medium") return () => new Promise(r => setImmediate(r));
  return undefined; // high — no yield, maximum throughput
}

function getOrCreateIndex(token: string): SemanticIndex | null {
  if (indexCache.has(token)) return indexCache.get(token)!;
  if (!provider) return null;

  const index = new SemanticIndex(provider);
  indexCache.set(token, index);
  return index;
}

function send(msg: WorkerResponse): void {
  parentPort!.postMessage(msg);
}

// ── Command Handlers ──────────────────────────────────────────────

function handleInit(config: EmbeddingConfig): void {
  const hadProvider = !!provider;

  if (config.mode === "local") {
    const modelDir = join(homedir(), ".ccdoc", "models", config.localModelId);
    const numThreads = indexingConfig.intensity === "low" ? 1 : indexingConfig.intensity === "medium" ? 2 : undefined;
    provider = new EmbeddingModel(modelDir, numThreads);
  } else if (config.mode === "online") {
    provider = new OnlineEmbeddingProvider(
      config.onlineProvider as "openai" | "voyage",
      config.onlineModel,
      config.onlineApiKey,
    );
  } else {
    provider = null;
  }

  // If provider changed, all existing embeddings are incompatible — clear everything
  if (hadProvider) {
    for (const token of indexCache.keys()) handleClear(token);
  }

  send({ type: "ready" });
}

const EMPTY_STATS: SemanticIndexStats = { totalChunks: 0, codeChunks: 0, docChunks: 0, indexSizeBytes: 0, indexingTimeMs: 0 };

/** Prefix doc section IDs and paths for linked projects to avoid collisions. */
function prefixDocSections(prefix: string, sections: DocSectionInput[]): DocSectionInput[] {
  return sections.map(s => ({
    ...s,
    id: `${prefix}::${s.id}`,
    path: `[${prefix}] ${s.path}`,
  }));
}

async function handleIndex(token: string, projectPath: string | null, docSections: DocSectionInput[], linkedSources?: LinkedProjectSource[]): Promise<void> {
  // If indexing is disabled, immediately report empty stats
  if (!indexingConfig.enabled) {
    send({ type: "index:done", token, stats: EMPTY_STATS });
    return;
  }

  if (indexedTokens.has(token)) {
    const existing = indexCache.get(token);
    send({ type: "index:done", token, stats: existing?.getStats() ?? EMPTY_STATS });
    return;
  }
  if (indexingInProgress.has(token)) return; // already running, caller will get notified when it finishes

  const index = getOrCreateIndex(token);
  if (!index) {
    send({ type: "index:error", token, error: "Embedding provider not available" });
    return;
  }

  indexingInProgress.add(token);
  const yieldFn = getYieldFn();
  const opts = toIndexingOptions(indexingConfig);
  index.setYieldFn(yieldFn);
  index.setOnProgress(item => send({ type: "index:progress", token, item }));

  try {
    // Index main project code files
    if (projectPath) {
      await index.indexCodeProject(projectPath, yieldFn, opts);
    }

    // Index main project documentation
    if (docSections.length > 0) {
      await index.indexDocSections(docSections, yieldFn, opts.docChunkSize);
    }

    // Index linked project sources
    if (linkedSources) {
      for (const ls of linkedSources) {
        if (ls.projectPath) {
          await index.indexCodeProject(ls.projectPath, yieldFn, opts, ls.prefix);
        }
        if (ls.docSections.length > 0) {
          await index.indexDocSections(prefixDocSections(ls.prefix, ls.docSections), yieldFn, opts.docChunkSize);
        }
      }
    }

    indexedTokens.add(token);
    sendSaveCache(token);
    send({ type: "index:done", token, stats: index.getStats() });
  } catch (err) {
    send({ type: "index:error", token, error: String(err) });
  } finally {
    index.setOnProgress(undefined);
    indexingInProgress.delete(token);
  }
}

async function handleSearch(reqId: number, token: string, query: string, topK: number, filter: string): Promise<void> {
  const index = indexedTokens.has(token) ? indexCache.get(token) : null;

  if (!index || index.size === 0) {
    const isIndexing = indexingInProgress.has(token);
    const hasProvider = !!provider;
    send({
      type: "search:result",
      reqId,
      data: {
        results: [],
        formatted: isIndexing
          ? "Semantic index is being built in background. Results will be available shortly."
          : hasProvider
            ? "Semantic index is empty."
            : "Semantic index not available (embedding model may not be configured).",
        indexing: isIndexing,
      },
    });
    return;
  }

  const normalizedFilter = filter === "docs" ? "doc" : (filter as "code" | "doc" | "all") || "all";
  const results = await index.search(query, topK, normalizedFilter);

  send({
    type: "search:result",
    reqId,
    data: {
      results: results.map(r => ({ score: r.score, chunk: r.chunk })),
      formatted: formatSearchResults(results),
      indexing: false,
    },
  });
}

async function handlePrefetch(reqId: number, token: string, query: string, maxTokens: number, minScore: number): Promise<void> {
  const index = indexedTokens.has(token) ? indexCache.get(token) : null;

  if (!index || index.size === 0) {
    send({ type: "prefetch:result", reqId, data: null });
    return;
  }

  const results = await index.search(query, 20, "all");
  const filtered = results.filter(r => r.score >= minScore);

  let tokenBudget = maxTokens;
  const selected: SearchResult[] = [];
  for (const r of filtered) {
    const chunkTokens = Math.ceil(r.chunk.content.length / 4);
    if (tokenBudget - chunkTokens < 0) break;
    selected.push(r);
    tokenBudget -= chunkTokens;
  }

  if (selected.length === 0) {
    send({ type: "prefetch:result", reqId, data: null });
    return;
  }

  send({
    type: "prefetch:result",
    reqId,
    data: {
      chunks: selected.map(r => ({ score: r.score, chunk: r.chunk })),
      totalTokens: maxTokens - tokenBudget,
    },
  });
}

async function handleSnapshot(reqId: number, token: string, projectPath: string | null, docTree: any[], linkedSources?: LinkedSnapshotSource[]): Promise<void> {
  const cached = snapshotCache.get(token);
  if (cached && (Date.now() - cached.ts) < SNAPSHOT_TTL) {
    send({ type: "snapshot:result", reqId, data: cached.snapshot });
    return;
  }

  const excludedDirs = new Set(indexingConfig.excludedDirs);
  const codeExts = new Set(indexingConfig.codeExtensions);

  let codeTree = "";
  if (projectPath) {
    codeTree = await generateCodeSnapshot(projectPath, excludedDirs, codeExts);
  }
  let docTreeStr = generateDocSnapshot(docTree);

  // Append linked project snapshots
  if (linkedSources) {
    for (const ls of linkedSources) {
      if (ls.projectPath) {
        const linkedCode = await generateCodeSnapshot(ls.projectPath, excludedDirs, codeExts);
        if (linkedCode) codeTree += `\n\n--- [${ls.prefix}] ---\n${linkedCode}`;
      }
      if (ls.docTree?.length) {
        const linkedDoc = generateDocSnapshot(ls.docTree);
        if (linkedDoc) docTreeStr += `\n\n--- [${ls.prefix}] ---\n${linkedDoc}`;
      }
    }
  }

  const snapshot: ProjectSnapshot = { codeTree, docTree: docTreeStr };
  snapshotCache.set(token, { snapshot, ts: Date.now() });
  send({ type: "snapshot:result", reqId, data: snapshot });
}

function handleStats(reqId: number, token: string): void {
  const index = indexCache.get(token);
  send({ type: "stats:result", reqId, data: index?.getStats() ?? null });
}

function handleStatus(reqId: number, token: string): void {
  send({
    type: "status:result",
    reqId,
    data: {
      ready: indexedTokens.has(token),
      indexing: indexingInProgress.has(token),
      stats: indexCache.get(token)?.getStats() ?? null,
    },
  });
}

function handleClear(token: string): void {
  indexCache.get(token)?.clear();
  indexCache.delete(token);
  indexedTokens.delete(token);
  snapshotCache.delete(token);
}

function handleInvalidate(token: string): void {
  indexCache.get(token)?.clear();
  indexCache.delete(token);
  indexedTokens.delete(token);
  indexingInProgress.delete(token);
  snapshotCache.delete(token);
}

async function handleReindex(reqId: number, token: string, projectPath: string | null, docSections: DocSectionInput[], linkedSources?: LinkedProjectSource[]): Promise<void> {
  if (!indexingConfig.enabled) {
    send({ type: "reindex:done", reqId, stats: null });
    return;
  }

  // Clear existing
  handleClear(token);

  const index = getOrCreateIndex(token);
  if (!index) {
    send({ type: "reindex:done", reqId, stats: null });
    return;
  }

  indexingInProgress.add(token);
  const yieldFn = getYieldFn();
  const opts = toIndexingOptions(indexingConfig);
  index.setYieldFn(yieldFn);
  index.setOnProgress(item => send({ type: "index:progress", token, item }));

  try {
    if (projectPath) await index.indexCodeProject(projectPath, yieldFn, opts);
    if (docSections.length > 0) await index.indexDocSections(docSections, yieldFn, opts.docChunkSize);

    // Index linked project sources
    if (linkedSources) {
      for (const ls of linkedSources) {
        if (ls.projectPath) await index.indexCodeProject(ls.projectPath, yieldFn, opts, ls.prefix);
        if (ls.docSections.length > 0) await index.indexDocSections(prefixDocSections(ls.prefix, ls.docSections), yieldFn, opts.docChunkSize);
      }
    }

    indexedTokens.add(token);
    sendSaveCache(token);
    send({ type: "reindex:done", reqId, stats: index.getStats() });
  } catch {
    send({ type: "reindex:done", reqId, stats: null });
  } finally {
    index.setOnProgress(undefined);
    indexingInProgress.delete(token);
  }
}

async function handleIndexUpdate(
  reqId: number, token: string, projectPath: string | null,
  codeSinceMs: number,
  changedDocSections: DocSectionInput[], changedDocIds: string[],
  deletedFilePaths: string[], deletedSectionIds: string[],
  linkedSources?: LinkedUpdateSource[],
): Promise<void> {
  if (!indexingConfig.enabled) {
    send({ type: "index-update:done", reqId, stats: { totalChunks: 0, codeChunks: 0, docChunks: 0, indexSizeBytes: 0, indexingTimeMs: 0 } });
    return;
  }
  const index = indexCache.get(token);
  if (!index) {
    send({ type: "index-update:done", reqId, stats: { totalChunks: 0, codeChunks: 0, docChunks: 0, indexSizeBytes: 0, indexingTimeMs: 0 } });
    return;
  }

  index.setYieldFn(getYieldFn());
  index.setOnProgress(item => send({ type: "index:progress", token, item }));
  const opts = toIndexingOptions(indexingConfig);

  try {
    // 1. Remove deleted items (main project)
    for (const fp of deletedFilePaths) index.removeFileChunks(fp);
    for (const sid of deletedSectionIds) index.removeSectionChunks(sid);

    // 2. Incremental code re-index (main project)
    if (projectPath && codeSinceMs > 0) {
      await index.indexCodeProjectIncremental(projectPath, codeSinceMs, opts);
    }

    // 3. Incremental doc re-index (main project)
    if (changedDocSections.length > 0) {
      await index.indexDocSectionsIncremental(changedDocSections, new Set(changedDocIds));
    }

    // 4. Incremental updates for linked projects
    if (linkedSources) {
      for (const ls of linkedSources) {
        try {
          // Remove deleted items from linked project
          for (const fp of ls.deletedFilePaths) index.removeFileChunks(`[${ls.prefix}]/${fp}`);
          for (const sid of ls.deletedSectionIds) index.removeSectionChunks(`${ls.prefix}::${sid}`);

          // Incremental code re-index for linked project
          if (ls.projectPath && ls.codeSinceMs > 0) {
            await index.indexCodeProjectIncremental(ls.projectPath, ls.codeSinceMs, opts, ls.prefix);
          }

          // Incremental doc re-index for linked project
          if (ls.changedDocSections.length > 0) {
            const prefixed = prefixDocSections(ls.prefix, ls.changedDocSections);
            const prefixedIds = ls.changedDocIds.map(id => `${ls.prefix}::${id}`);
            await index.indexDocSectionsIncremental(prefixed, new Set(prefixedIds));
          }
        } catch (err) {
          console.warn(`[SemanticWorker] Incremental update for linked project [${ls.prefix}] failed:`, err);
        }
      }
    }

    // Persist updated cache (include deleted IDs so main process cleans DB)
    const allDeleted = [...deletedFilePaths, ...deletedSectionIds];
    if (linkedSources) {
      for (const ls of linkedSources) {
        allDeleted.push(...ls.deletedFilePaths.map(fp => `[${ls.prefix}]/${fp}`));
        allDeleted.push(...ls.deletedSectionIds.map(sid => `${ls.prefix}::${sid}`));
      }
    }
    sendSaveCache(token, allDeleted);

    send({ type: "index-update:done", reqId, stats: index.getStats() });
  } finally {
    index.setOnProgress(undefined);
  }
}

function handleGetIndexedIds(reqId: number, token: string): void {
  const index = indexCache.get(token);
  if (!index) {
    send({ type: "get-indexed-ids:result", reqId, data: { sectionIds: [], filePaths: [] } });
    return;
  }
  send({
    type: "get-indexed-ids:result", reqId,
    data: { sectionIds: index.getIndexedSectionIds(), filePaths: index.getIndexedFilePaths() },
  });
}

// ── Cache helpers ────────────────────────────────────────────────

/** Serialize index state and send to main process for DB persistence. */
function sendSaveCache(token: string, deletedIds: string[] = []): void {
  const index = indexCache.get(token);
  if (!index) return;

  const cached = index.serializeForCache();
  send({
    type: "save-cache",
    token,
    chunks: cached.map(c => {
      // Copy to a standalone ArrayBuffer (avoids SharedArrayBuffer issue with postMessage)
      const buf = new ArrayBuffer(c.embedding.byteLength);
      new Float32Array(buf).set(c.embedding);
      return { id: c.id, kind: c.kind, embedding: buf, textHash: c.textHash, metadata: c.metadata, content: c.content };
    }),
    deletedIds,
  });
}

function handleLoadCache(
  token: string,
  chunks: Array<{ id: string; kind: string; embedding: ArrayBuffer; metadata: string; content?: string }>,
): void {
  const index = getOrCreateIndex(token);
  if (!index) {
    send({ type: "index:error", token, error: "Embedding provider not available (cache load)" });
    return;
  }

  const converted = chunks.map(c => ({
    id: c.id,
    kind: c.kind,
    embedding: new Float32Array(c.embedding),
    metadata: c.metadata,
    content: c.content,
  }));

  const count = index.restoreFromCache(converted);
  if (count > 0) indexedTokens.add(token);
  console.log(`[SemanticWorker] Restored ${count} chunks from cache for ${token.slice(0, 8)}`);
  send({ type: "index:done", token, stats: index.getStats() });
}

// ── Message Loop ──────────────────────────────────────────────────

parentPort!.on("message", (msg: WorkerCommand) => {
  switch (msg.type) {
    case "init":
      handleInit(msg.config);
      break;
    case "update-config":
      indexingConfig = msg.indexing;
      // Update live excluded dirs on any running index (mid-indexing exclusion)
      for (const index of indexCache.values()) {
        index.setExcludedDirs(new Set(msg.indexing.excludedDirs));
      }
      break;
    case "index":
      handleIndex(msg.token, msg.projectPath, msg.docSections, msg.linkedSources)
        .catch(err => send({ type: "index:error", token: msg.token, error: String(err) }));
      break;
    case "search":
      handleSearch(msg.reqId, msg.token, msg.query, msg.topK, msg.filter)
        .catch(err => send({ type: "search:result", reqId: msg.reqId, data: { results: [], formatted: String(err), indexing: false } }));
      break;
    case "prefetch":
      handlePrefetch(msg.reqId, msg.token, msg.query, msg.maxTokens, msg.minScore)
        .catch(err => send({ type: "prefetch:result", reqId: msg.reqId, data: null }));
      break;
    case "snapshot":
      handleSnapshot(msg.reqId, msg.token, msg.projectPath, msg.docTree, msg.linkedSources)
        .catch(err => send({ type: "snapshot:result", reqId: msg.reqId, data: null }));
      break;
    case "stats":
      handleStats(msg.reqId, msg.token);
      break;
    case "status":
      handleStatus(msg.reqId, msg.token);
      break;
    case "clear":
      handleClear(msg.token);
      break;
    case "invalidate":
      handleInvalidate(msg.token);
      break;
    case "invalidate-snapshot":
      snapshotCache.delete(msg.token);
      break;
    case "reindex":
      handleReindex(msg.reqId, msg.token, msg.projectPath, msg.docSections, msg.linkedSources)
        .catch(() => send({ type: "reindex:done", reqId: msg.reqId, stats: null }));
      break;
    case "index-update":
      handleIndexUpdate(msg.reqId, msg.token, msg.projectPath, msg.codeSinceMs,
        msg.changedDocSections, msg.changedDocIds, msg.deletedFilePaths, msg.deletedSectionIds,
        msg.linkedSources)
        .catch(err => send({ type: "index-update:done", reqId: msg.reqId, stats: { totalChunks: 0, codeChunks: 0, docChunks: 0, indexSizeBytes: 0, indexingTimeMs: 0 } }));
      break;
    case "get-indexed-ids":
      handleGetIndexedIds(msg.reqId, msg.token);
      break;
    case "load-cache":
      handleLoadCache(msg.token, msg.chunks);
      break;
  }
});
