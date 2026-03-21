/**
 * Window creation, spell-check setup, context menu.
 */
import { BrowserWindow, Menu } from "electron";
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
      spellcheck: true,
    },
  });

  mainWindow.webContents.session.setSpellCheckerLanguages(["ru", "en-US"]);

  // Allow microphone and other safe permissions
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const blocked = ["geolocation", "notifications"];
      callback(!blocked.includes(permission));
    }
  );

  mainWindow.webContents.on("context-menu", (_event, params) => {
    if (params.misspelledWord) {
      const menuItems: Electron.MenuItemConstructorOptions[] = params.dictionarySuggestions.map((suggestion) => ({
        label: suggestion,
        click: () => mainWindow!.webContents.replaceMisspelling(suggestion),
      }));
      if (menuItems.length > 0) menuItems.push({ type: "separator" });
      menuItems.push({
        label: "Add to dictionary",
        click: () => mainWindow!.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      Menu.buildFromTemplate(menuItems).popup();
    }
  });

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
