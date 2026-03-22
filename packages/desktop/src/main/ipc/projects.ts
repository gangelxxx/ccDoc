import { ipcMain, dialog } from "electron";
import { InstallService } from "@ccdoc/core";
import { getProjectsService, getBackupService, getProjectDbsMap, unwatchProjectDb } from "../services";
import { getMainWindow } from "../window";

export function registerProjectsIpc(): void {
  const projectDbs = getProjectDbsMap();

  ipcMain.handle("projects:list", async () => {
    return getProjectsService().list();
  });

  ipcMain.handle("projects:add", async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const projectPath = result.filePaths[0];
    const name = projectPath.split(/[\\/]/).pop() || "Unnamed";
    return getProjectsService().addProject(name, projectPath);
  });

  ipcMain.handle("projects:remove", async (_e, token: string) => {
    // Uninstall Claude Code plugin files before removing the project
    const project = await getProjectsService().getByToken(token);
    if (project) {
      try {
        new InstallService().uninstall(project.path);
      } catch (e) {
        console.warn("Failed to uninstall plugin:", e);
      }
    }

    // Close watcher and cached DB connection before removing the project
    unwatchProjectDb(token);
    const cached = projectDbs.get(token);
    if (cached) {
      try {
        await cached.db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {}
      try { cached.db.close(); } catch (e) { console.warn("Failed to close project db:", e); }
      projectDbs.delete(token);
    }
    getBackupService().unregisterDb(token);
    await getProjectsService().removeProject(token);
  });

  ipcMain.handle("projects:rename", async (_e, token: string, name: string) => {
    await getProjectsService().updateName(token, name);
  });

  ipcMain.handle("projects:touch", async (_e, token: string) => {
    await getProjectsService().touchProject(token);
  });
}
