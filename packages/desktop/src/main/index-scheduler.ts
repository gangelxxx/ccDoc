/**
 * IndexScheduler — staleness detection and periodic background re-indexing.
 *
 * Tracks last-indexed timestamps (via project passport) vs. actual content
 * modification times. Periodically checks for stale indexes and triggers
 * background re-indexing when needed.
 */

import { statSync } from "fs";
import { readdir } from "fs/promises";
import { join, extname } from "path";
import { getProjectServices, getProjectsService, getSettingsService, trackBgTask } from "./services";
import { triggerIndexing, invalidateSemanticIndex, triggerIncrementalUpdate } from "./ipc/semantic";
import { CODE_EXTS } from "./source-tools";
import { SOURCE_EXCLUDED } from "./semantic-index";
import { SETTINGS_DEFAULTS } from "./services/settings.types";

// ── Constants ──────────────────────────────────────────────────────

const STALENESS_CHECK_INTERVAL = 5 * 60_000; // 5 minutes
const MTIME_SCAN_TIMEOUT = 500; // max ms for mtime scanning
// ── State ──────────────────────────────────────────────────────────

const reindexTimers = new Map<string, ReturnType<typeof setInterval>>();

// ── Staleness Detection ────────────────────────────────────────────

export interface StalenessResult {
  ftsStale: boolean;
  semanticStale: boolean;
  docsChangedSince: Date | null;
  codeChangedSince: Date | null;
}

/**
 * Check whether FTS and semantic indexes are stale for a given project.
 */
export async function checkStaleness(token: string): Promise<StalenessResult> {
  const services = await getProjectServices(token);
  const { passport, sections } = services;

  // 1. Doc staleness: compare max(updated_at) vs last indexed timestamps
  const allSections = await sections.listAll();
  let maxDocUpdated = 0;
  for (const s of allSections) {
    if (s.deleted_at) continue;
    const t = new Date(s.updated_at).getTime();
    if (t > maxDocUpdated) maxDocUpdated = t;
  }

  const ftsLastIndexed = await passport.get("fts_last_indexed_at");
  const semanticLastIndexed = await passport.get("semantic_last_indexed_at");

  const ftsTs = ftsLastIndexed ? new Date(ftsLastIndexed).getTime() : 0;
  const semTs = semanticLastIndexed ? new Date(semanticLastIndexed).getTime() : 0;

  // 2. Code staleness: compare directory mtimes with stored value
  const project = await getProjectsService().getByToken(token);
  let codeMaxMtime = 0;
  if (project?.path) {
    const idxCfg = getSettingsService()?.getAll().indexing ?? SETTINGS_DEFAULTS.indexing;
    codeMaxMtime = await scanCodeMaxMtime(project.path, new Set(idxCfg.excludedDirs), new Set(idxCfg.codeExtensions));
  }
  const storedCodeMtime = Number(await passport.get("code_max_mtime") || "0");

  return {
    ftsStale: maxDocUpdated > ftsTs,
    semanticStale: maxDocUpdated > semTs || codeMaxMtime > storedCodeMtime,
    docsChangedSince: maxDocUpdated > ftsTs ? new Date(maxDocUpdated) : null,
    codeChangedSince: codeMaxMtime > storedCodeMtime ? new Date(codeMaxMtime) : null,
  };
}

/**
 * Lightweight scan: find the most recent mtime across source code directories.
 * Uses directory mtimes as a fast heuristic, then only scans files in changed dirs.
 * Caps total scan time at MTIME_SCAN_TIMEOUT ms.
 *
 * @param excludedDirs Directories to skip (defaults to SOURCE_EXCLUDED).
 * @param codeExts File extensions to scan (defaults to CODE_EXTS).
 */
export async function scanCodeMaxMtime(
  projectPath: string,
  excludedDirs: Set<string> = SOURCE_EXCLUDED,
  codeExts: Set<string> = CODE_EXTS,
): Promise<number> {
  const deadline = Date.now() + MTIME_SCAN_TIMEOUT;
  let maxMtime = 0;

  async function walkDirs(dir: string): Promise<void> {
    if (Date.now() > deadline) return;

    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (Date.now() > deadline) return;

      if (e.isDirectory()) {
        if (excludedDirs.has(e.name)) continue;
        const fullPath = join(dir, e.name);
        try {
          const st = statSync(fullPath);
          if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        } catch { /* skip */ }
        await walkDirs(fullPath);
      } else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        if (!codeExts.has(ext)) continue;
        try {
          const st = statSync(join(dir, e.name));
          if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        } catch { /* skip */ }
      }
    }
  }

  await walkDirs(projectPath);
  return maxMtime;
}

// ── Periodic Scheduler ─────────────────────────────────────────────

/**
 * Start periodic staleness checks for a project.
 * When stale, triggers background FTS/semantic re-indexing.
 *
 * @param intervalMs Check interval in milliseconds (defaults to STALENESS_CHECK_INTERVAL).
 */
export function startPeriodicIndexing(token: string, intervalMs = STALENESS_CHECK_INTERVAL): void {
  if (reindexTimers.has(token)) return;

  const timer = setInterval(async () => {
    try {
      const staleness = await checkStaleness(token);

      if (staleness.ftsStale) {
        const services = await getProjectServices(token);
        await trackBgTask("Фоновое обновление поиска", async () => {
          await services.index.reindexAll();
          await services.passport.set("fts_last_indexed_at", new Date().toISOString());
        });
      }

      if (staleness.semanticStale) {
        // Incremental update: only re-index changed items
        await triggerIncrementalUpdate(token);
      }
    } catch (err) {
      console.warn(`[index-scheduler] Periodic check failed for ${token}:`, err);
    }
  }, intervalMs);

  reindexTimers.set(token, timer);
}

/**
 * Stop periodic staleness checks for a project.
 */
export function stopPeriodicIndexing(token: string): void {
  const timer = reindexTimers.get(token);
  if (timer) {
    clearInterval(timer);
    reindexTimers.delete(token);
  }
}

/**
 * Restart periodic indexing for all active projects with a new interval.
 * Used when indexing settings change (e.g. stalenessIntervalMin updated).
 */
export function restartAllPeriodicIndexing(intervalMs: number): void {
  const tokens = [...reindexTimers.keys()];
  for (const token of tokens) {
    stopPeriodicIndexing(token);
    startPeriodicIndexing(token, intervalMs);
  }
}

/**
 * Stop all periodic checks (for app shutdown).
 */
export function stopAllPeriodicIndexing(): void {
  for (const timer of reindexTimers.values()) {
    clearInterval(timer);
  }
  reindexTimers.clear();
}
