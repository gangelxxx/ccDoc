import { ipcMain } from "electron";
import type { SettingsService } from "../services/settings.service";

export function registerSettingsIpc(service: SettingsService): void {
  ipcMain.handle("settings:getAll", () => {
    return service.getAll();
  });

  ipcMain.handle("settings:patch", (_e, partial: Record<string, any>, source?: string) => {
    service.patch(partial, source);
  });

  ipcMain.handle("settings:getSessions", () => {
    return service.getSessions();
  });

  ipcMain.handle("settings:saveSessions", (_e, sessions: any[]) => {
    service.saveSessions(sessions);
  });

  // Vault history
  ipcMain.handle("vault:history", (_e, limit?: number) => {
    return service.getVaultHistory(limit);
  });

  ipcMain.handle("vault:snapshot", (_e, revision: number) => {
    return service.getVaultSnapshot(revision);
  });

  ipcMain.handle("vault:rollback", (_e, revision: number) => {
    return service.rollbackVault(revision);
  });
}
