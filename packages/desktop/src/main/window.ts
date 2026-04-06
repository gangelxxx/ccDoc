/**
 * Window creation, spell-check setup, context menu.
 */
import { BrowserWindow } from "electron";
import { join } from "path";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "CCDoc",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Block navigation to external URLs
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Detect renderer crashes
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[RENDERER CRASHED]", details.reason, details.exitCode);
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("[RENDERER UNRESPONSIVE]");
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const tag = level === 0 ? "log" : level === 1 ? "info" : level === 2 ? "warn" : "error";
    // Forward all renderer console output to main process terminal
    if (message.startsWith("[voice") || level >= 2) {
      console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
