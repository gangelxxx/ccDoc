import { app, BrowserWindow } from "electron";

// Suppress Chromium GPU cache errors on Windows
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

import { initServices, setMainWindowGetter, getAppDb, getProjectDbsMap, unwatchProjectDb } from "./services";
import { stopAllPeriodicIndexing } from "./index-scheduler";
import { clearSemanticCaches } from "./ipc/semantic";
import { createWindow, getMainWindow } from "./window";
import { registerAllIpcHandlers } from "./ipc";
import { createSettingsService } from "./services/settings.service";

app.whenReady().then(async () => {
  // Settings service must be created after ready (safeStorage requires it)
  const settingsService = createSettingsService();

  await initServices(settingsService);
  setMainWindowGetter(getMainWindow);

  registerAllIpcHandlers(settingsService);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Flush settings to disk on quit (idempotent via dirty flags)
  app.on("before-quit", () => settingsService.flushSync());
  app.on("will-quit", () => settingsService.flushSync());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Stop all periodic index checks
  stopAllPeriodicIndexing();
  // Terminate semantic worker thread
  clearSemanticCaches();
  // Close all watchers and cached project DB connections
  const projectDbs = getProjectDbsMap();
  for (const [token, { db }] of projectDbs) {
    unwatchProjectDb(token);
    try { db.close(); } catch { /* ignore */ }
  }
  projectDbs.clear();
  try { getAppDb()?.close(); } catch { /* ignore */ }
});
