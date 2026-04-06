import { ipcMain } from "electron";
import { getProjectServices, suppressExternalChange } from "../services";
import { prosemirrorToMarkdown } from "@ccdoc/core";

/** Convert raw snapshot content to human-readable text for diff display */
function snapshotContentToText(content: string, type: string): string {
  if (type === "idea" || type === "kanban" || type === "drawing" || type === "knowledge_graph") {
    try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; }
  }
  try { return prosemirrorToMarkdown(JSON.parse(content)); } catch { return content; }
}

export function registerSectionSnapshotsIpc(): void {
  ipcMain.handle("section-snapshots:list", async (_e, token: string, sectionId: string, limit?: number, offset?: number) => {
    const { snapshots, sections, db } = await getProjectServices(token);

    // Check if this is a container (file) — aggregate child snapshots
    const section = await sections.getById(sectionId);
    if (section && section.type === "file") {
      const lim = limit ?? 50;
      const off = offset ?? 0;
      const result = await db.execute({
        sql: `SELECT ss.id, ss.section_id, ss.title AS title, ss.type, ss.source, ss.created_at, ss.byte_size,
                     s.title AS section_title
              FROM section_snapshots ss
              JOIN sections s ON s.id = ss.section_id
              WHERE ss.section_id IN (
                SELECT id FROM sections WHERE parent_id = ? AND deleted_at IS NULL
                UNION SELECT id FROM sections WHERE parent_id IN (
                  SELECT id FROM sections WHERE parent_id = ? AND deleted_at IS NULL
                ) AND deleted_at IS NULL
              )
              ORDER BY ss.created_at DESC
              LIMIT ? OFFSET ?`,
        args: [sectionId, sectionId, lim, off],
      });
      return result.rows;
    }

    return snapshots.getTimeline(sectionId, limit, offset);
  });

  ipcMain.handle("section-snapshots:get", async (_e, token: string, snapshotId: string) => {
    const { snapshots } = await getProjectServices(token);
    const snap = await snapshots.getSnapshot(snapshotId);
    if (!snap) return null;
    return { ...snap, content: snapshotContentToText(snap.content, snap.type) };
  });

  ipcMain.handle("section-snapshots:get-pair", async (_e, token: string, idA: string, idB: string) => {
    const { snapshots } = await getProjectServices(token);
    const pair = await snapshots.getSnapshotPair(idA, idB);
    if (!pair) return null;
    return {
      a: { ...pair.a, content: snapshotContentToText(pair.a.content, pair.a.type) },
      b: { ...pair.b, content: snapshotContentToText(pair.b.content, pair.b.type) },
    };
  });

  ipcMain.handle("section-snapshots:restore", async (_e, token: string, sectionId: string, snapshotId: string) => {
    suppressExternalChange(token);
    const { snapshots, sections, index } = await getProjectServices(token);

    // 1. Get the content to restore
    const restoreData = await snapshots.getRestoreContent(snapshotId);
    if (!restoreData) throw new Error("Snapshot not found");

    // 2. Capture current state as a "restore" snapshot before overwriting
    const current = await sections.getById(sectionId);
    if (current) {
      await snapshots.captureIfChanged(current, "restore");
    }

    // 3. Apply the restored content (skip auto-snapshot — we already captured above)
    await sections.updateRaw(sectionId, restoreData.title, restoreData.content, false as any);

    // 4. Reindex
    const updated = await sections.getById(sectionId);
    if (updated) {
      index.indexSection(updated).catch(err => console.warn("[index] snapshot restore:", err));
    }

    return { success: true };
  });

  ipcMain.handle("section-snapshots:delete", async (_e, token: string, snapshotId: string) => {
    const { snapshots } = await getProjectServices(token);
    await snapshots.deleteSnapshot(snapshotId);
  });

  ipcMain.handle("section-snapshots:stats", async (_e, token: string) => {
    const { snapshots } = await getProjectServices(token);
    return snapshots.getStats();
  });
}
