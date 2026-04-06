import { v4 as uuid } from "uuid";
import { SectionSnapshotRepo } from "../db/section-snapshot.repo.js";
import type { SectionSnapshot, SnapshotSource } from "../db/section-snapshot.repo.js";

export interface SnapshotConfig {
  maxSnapshotsPerSection: number;
  maxAgeDays: number;
  /** Minimum seconds between NEW manual snapshots (default 30).
   *  Within this window, the latest snapshot is UPDATED instead of creating a new one. */
  coalesceIntervalSec: number;
}

const DEFAULT_CONFIG: SnapshotConfig = {
  maxSnapshotsPerSection: 30,
  maxAgeDays: 30,
  coalesceIntervalSec: 30,
};

/** Sources that always create a new snapshot (no coalescing). */
const IMMEDIATE_SOURCES: Set<SnapshotSource> = new Set(["assistant", "mcp", "import", "restore"]);

export class SectionSnapshotService {
  private config: SnapshotConfig;
  /** In-memory: sectionId → { snapshotId, timestamp } of last capture. */
  private lastCapture = new Map<string, { id: string; time: number }>();

  constructor(
    private repo: SectionSnapshotRepo,
    config?: Partial<SnapshotConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Capture a snapshot if content actually changed.
   *
   * For manual edits within coalesceIntervalSec: UPDATES the latest snapshot
   * instead of creating a new one. This way the last edit is always captured,
   * even if the user navigates away or closes the app right after.
   *
   * Assistant/mcp/import/restore always create a new snapshot.
   */
  async captureIfChanged(
    section: { id: string; title: string; content: string; type: string },
    source: SnapshotSource,
  ): Promise<string | null> {
    // Dedup: skip if content identical to latest snapshot
    const latest = await this.repo.getLatest(section.id);
    if (latest && latest.content === section.content) {
      return null; // no change
    }

    // For manual edits: coalesce within time window (update existing snapshot)
    if (!IMMEDIATE_SOURCES.has(source)) {
      const last = this.lastCapture.get(section.id);
      if (last && Date.now() - last.time < this.config.coalesceIntervalSec * 1000) {
        // Update the existing snapshot with newer content
        await this.repo.updateContent(last.id, section.content, section.title);
        this.lastCapture.set(section.id, { id: last.id, time: Date.now() });
        return last.id;
      }
    }

    // Create new snapshot
    const snapshotId = uuid();
    await this.repo.create({
      id: snapshotId,
      section_id: section.id,
      content: section.content,
      title: section.title,
      type: section.type,
      source,
    });

    this.lastCapture.set(section.id, { id: snapshotId, time: Date.now() });

    // Prune excess and old snapshots (fire-and-forget)
    this.repo.pruneExcess(section.id, this.config.maxSnapshotsPerSection)
      .catch(err => console.warn("[snapshot] prune excess failed:", err));
    this.repo.pruneOlderThan(section.id, this.config.maxAgeDays)
      .catch(err => console.warn("[snapshot] prune old failed:", err));

    return snapshotId;
  }

  /** Get timeline for a section (without content for list view). */
  async getTimeline(
    sectionId: string,
    limit = 50,
    offset = 0,
  ): Promise<SectionSnapshot[]> {
    return this.repo.listForSection(sectionId, limit, offset);
  }

  /** Get a single snapshot with full content. */
  async getSnapshot(snapshotId: string): Promise<SectionSnapshot | null> {
    return this.repo.getById(snapshotId);
  }

  /** Get two snapshots for comparison. */
  async getSnapshotPair(
    idA: string,
    idB: string,
  ): Promise<{ a: SectionSnapshot; b: SectionSnapshot } | null> {
    const [a, b] = await Promise.all([
      this.repo.getById(idA),
      this.repo.getById(idB),
    ]);
    if (!a || !b) return null;
    return { a, b };
  }

  /** Get restore content from a snapshot. */
  async getRestoreContent(
    snapshotId: string,
  ): Promise<{ content: string; title: string } | null> {
    const snapshot = await this.repo.getById(snapshotId);
    if (!snapshot) return null;
    return { content: snapshot.content, title: snapshot.title };
  }

  /** Delete a specific snapshot. */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.repo.deleteById(snapshotId);
  }

  /** Run retention cleanup for all sections. */
  async pruneAll(sectionIds: string[]): Promise<{ deletedCount: number }> {
    let total = 0;
    for (const id of sectionIds) {
      total += await this.repo.pruneOlderThan(id, this.config.maxAgeDays);
      total += await this.repo.pruneExcess(id, this.config.maxSnapshotsPerSection);
    }
    return { deletedCount: total };
  }

  /** Get storage stats. */
  async getStats(): Promise<{ totalBytes: number }> {
    const totalBytes = await this.repo.getTotalSize();
    return { totalBytes };
  }

  /** Get global stats across all sections. */
  async getGlobalStats(): Promise<{ totalCount: number; totalSizeBytes: number; oldestDate: string | null }> {
    const [totalCount, totalSizeBytes, oldestDate] = await Promise.all([
      this.repo.getTotalCount(),
      this.repo.getTotalSize(),
      this.repo.getOldestDate(),
    ]);
    return { totalCount, totalSizeBytes, oldestDate };
  }

  /** Run global retention cleanup using current config. */
  async pruneAllGlobal(): Promise<{ deleted: number }> {
    let deleted = 0;
    deleted += await this.repo.pruneAllOlderThan(this.config.maxAgeDays);
    deleted += await this.repo.pruneAllExcess(this.config.maxSnapshotsPerSection);
    return { deleted };
  }

  /** Hot-update config without recreating service. */
  updateConfig(config: Partial<SnapshotConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
