import { ipcMain } from "electron";
import { getBackupService } from "../services";

export function registerBackupIpc(): void {
  ipcMain.handle("backup:create", async (_e, token: string) => {
    return getBackupService().backup(token);
  });

  ipcMain.handle("backup:list", async (_e, token: string) => {
    return getBackupService().listBackups(token);
  });
}
