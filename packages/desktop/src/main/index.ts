import { app, BrowserWindow } from "electron";

// Suppress Chromium GPU cache errors on Windows
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

import { initServices, completeInit, setMainWindowGetter, getAppDb, getUserDb, getProjectDbsMap, unwatchProjectDb } from "./services";
import { stopAllPeriodicIndexing } from "./index-scheduler";
import { clearSemanticCaches } from "./ipc/semantic";
import { cleanupIconProgress } from "./ipc/icon-progress";
import { createWindow, getMainWindow } from "./window";
import { registerAllIpcHandlers } from "./ipc";
import { createSettingsService, migrateSettingsToVault } from "./services/settings.service";
import { VaultRepo, Vault } from "@ccdoc/core";

app.whenReady().then(async () => {
  // Phase 1: open databases (runs vault table migration v5)
  const { appDb } = await initServices();
  setMainWindowGetter(getMainWindow);

  // Phase 2: create vault on top of app DB
  const vaultRepo = new VaultRepo(appDb);
  const vault = new Vault(vaultRepo, { maxRevisions: 50 });

  // Phase 3: migrate settings.json → vault (one-time, if vault is empty)
  await migrateSettingsToVault(vault);

  // Phase 4: create settings service (safeStorage requires app.whenReady)
  const settingsService = createSettingsService(vault);
  await (settingsService as any)._initPromise;
  completeInit(settingsService);

  registerAllIpcHandlers(settingsService);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Flush settings to vault on quit (idempotent via dirty flags)
  app.on("before-quit", () => settingsService.flushSync());
  app.on("will-quit", () => settingsService.flushSync());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Clean up icon progress bar and badge
  cleanupIconProgress();
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
  try { getUserDb()?.close(); } catch { /* ignore */ }
  try { getAppDb()?.close(); } catch { /* ignore */ }
});
