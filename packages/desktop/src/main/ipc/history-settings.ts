import { ipcMain } from "electron";
import { getProjectServices, getProjectDbsMap } from "../services";

export function registerHistorySettingsIpc(): void {
  // Git history stats
  ipcMain.handle("history-settings:getStats", async (_e, token: string) => {
    const { history } = await getProjectServices(token);
    return history.getStats();
  });

  // Git history cleanup
  ipcMain.handle("history-settings:cleanup", async (_e, token: string, retainDays: number) => {
    const { history } = await getProjectServices(token);
    return history.cleanupOlderThan(retainDays);
  });

  // Snapshot global stats
  ipcMain.handle("history-settings:snapshotsStats", async (_e, token: string) => {
    const { snapshots } = await getProjectServices(token);
    return snapshots.getGlobalStats();
  });

  // Snapshot global cleanup
  ipcMain.handle("history-settings:snapshotsCleanup", async (_e, token: string) => {
    const { snapshots } = await getProjectServices(token);
    return snapshots.pruneAllGlobal();
  });

  // Semantic cache stats
  ipcMain.handle("history-settings:cacheStats", async (_e, token: string) => {
    const { semanticCache } = await getProjectServices(token);
    const count = await semanticCache.count();
    return { count };
  });

  // Semantic cache clear
  ipcMain.handle("history-settings:cacheClear", async (_e, token: string) => {
    const { semanticCache } = await getProjectServices(token);
    await semanticCache.deleteAll();
  });

  // Apply snapshot config to all running services
  ipcMain.handle("history-settings:applyConfig", async (_e, config: {
    maxSnapshotsPerSection: number;
    snapshotMaxAgeDays: number;
    snapshotCoalesceIntervalSec: number;
  }) => {
    for (const [, services] of getProjectDbsMap()) {
      services.snapshots.updateConfig({
        maxSnapshotsPerSection: config.maxSnapshotsPerSection,
        maxAgeDays: config.snapshotMaxAgeDays,
        coalesceIntervalSec: config.snapshotCoalesceIntervalSec,
      });
    }
  });
}
