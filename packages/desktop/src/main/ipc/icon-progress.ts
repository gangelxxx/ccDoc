import { ipcMain, app } from "electron";
import { getMainWindow } from "../services";

export interface IconProgressPayload {
  /** 0..1 = determinate, -1 = remove, 2 = indeterminate */
  progress: number;
  /** Number of active tasks (for dock badge on macOS) */
  activeCount: number;
}

export function registerIconProgressIpc(): void {
  ipcMain.on("app:set-icon-progress", (_event, data: IconProgressPayload) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;

    if (data.progress === -1) {
      win.setProgressBar(-1);
    } else if (data.progress === 2) {
      win.setProgressBar(2, { mode: "indeterminate" });
    } else {
      win.setProgressBar(data.progress, { mode: "normal" });
    }

    if (process.platform === "darwin") {
      if (data.activeCount <= 0) {
        app.dock.setBadge("");
      } else if (data.activeCount > 9) {
        app.dock.setBadge("9+");
      } else {
        app.dock.setBadge(String(data.activeCount));
      }
    }
  });
}

/** Clean up icon artifacts on quit */
export function cleanupIconProgress(): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.setProgressBar(-1);
  }
  if (process.platform === "darwin") {
    try { app.dock.setBadge(""); } catch { /* dock may not exist */ }
  }
}
