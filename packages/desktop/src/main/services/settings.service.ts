import { app, safeStorage } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, fsyncSync, closeSync } from "fs";
import writeFileAtomic from "write-file-atomic";
import { type Settings, SETTINGS_DEFAULTS, validateSettings } from "./settings.types";

// ─── Encryption helpers ─────────────────────────────────────

function encryptField(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  return "enc:" + safeStorage.encryptString(value).toString("base64");
}

function decryptField(value: string): string {
  if (!value || !value.startsWith("enc:")) return value; // plain text (legacy/migration)
  if (!safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), "base64"));
  } catch {
    return ""; // corrupted cipher
  }
}

/** Deep clone sensitive branches and encrypt fields. Does NOT mutate input. */
function encryptSensitive(data: Settings): Settings {
  const clone: Settings = { ...data, embedding: { ...data.embedding } };
  clone.llmApiKey = encryptField(clone.llmApiKey);
  clone.webSearchApiKey = encryptField(clone.webSearchApiKey);
  clone.embedding.onlineApiKey = encryptField(clone.embedding.onlineApiKey);
  return clone;
}

/** Deep clone sensitive branches and decrypt fields. Does NOT mutate input. */
function decryptSensitive(data: any): any {
  const clone = { ...data, embedding: data.embedding ? { ...data.embedding } : undefined };
  if (clone.llmApiKey) clone.llmApiKey = decryptField(clone.llmApiKey);
  if (clone.webSearchApiKey) clone.webSearchApiKey = decryptField(clone.webSearchApiKey);
  if (clone.embedding?.onlineApiKey) clone.embedding.onlineApiKey = decryptField(clone.embedding.onlineApiKey);
  return clone;
}

// ─── Deep patch (max 2 levels) ──────────────────────────────

/** INVARIANT: Settings is max 2 levels deep. This merge handles exactly that. */
function deepPatch(target: Settings, source: Partial<Settings>): Settings {
  const result: any = { ...target };
  for (const key of Object.keys(source)) {
    const val = (source as any)[key];
    if (val && typeof val === "object" && !Array.isArray(val)
        && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = { ...result[key], ...val };
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ─── Service ────────────────────────────────────────────────

export interface SettingsService {
  getAll(): Settings;
  patch(partial: Partial<Settings>): void;
  getSessions(): any[];
  saveSessions(sessions: any[]): void;
  flushSync(): void;
}

export function createSettingsService(): SettingsService {
  const userDataDir = app.getPath("userData");
  const settingsPath = join(userDataDir, "settings.json");
  const sessionsPath = join(userDataDir, "llm-sessions.json");

  let cache: Settings;
  let dirtySettings = false;
  let dirtySessions = false;
  let sessionsCache: any[] = [];
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionsTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Load from disk ──

  function loadSettings(): Settings {
    if (!existsSync(settingsPath)) return { ...SETTINGS_DEFAULTS };
    try {
      const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const decrypted = decryptSensitive(raw);
      return validateSettings({ ...SETTINGS_DEFAULTS, ...decrypted });
    } catch (err) {
      console.error("[settings] corrupted settings.json, backing up:", err);
      try { renameSync(settingsPath, settingsPath + ".bak"); } catch {}
      return { ...SETTINGS_DEFAULTS };
    }
  }

  function loadSessions(): any[] {
    if (!existsSync(sessionsPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(sessionsPath, "utf-8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      console.error("[settings] corrupted llm-sessions.json, resetting");
      return [];
    }
  }

  // ── Flush to disk ──

  function flushSettings() {
    if (!dirtySettings) return;
    dirtySettings = false;
    const encrypted = encryptSensitive(cache);
    const json = JSON.stringify(encrypted, null, 2);
    writeFileAtomic(settingsPath, json, (err) => {
      if (err) {
        console.error("[settings] flush error:", err);
        dirtySettings = true; // restore flag so next flush retries
      }
    });
  }

  function flushSessions() {
    if (!dirtySessions) return;
    dirtySessions = false;
    const json = JSON.stringify(sessionsCache);
    writeFileAtomic(sessionsPath, json, (err) => {
      if (err) {
        console.error("[settings] sessions flush error:", err);
        dirtySessions = true;
      }
    });
  }

  function flushSettingsSync() {
    if (!dirtySettings) return;
    try {
      const encrypted = encryptSensitive(cache);
      const json = JSON.stringify(encrypted, null, 2);
      writeFileSync(settingsPath, json, "utf-8");
      const fd = openSync(settingsPath, "r+");
      fsyncSync(fd);
      closeSync(fd);
      dirtySettings = false;
    } catch (err) {
      console.error("[settings] sync flush error:", err);
    }
  }

  function flushSessionsSync() {
    if (!dirtySessions) return;
    try {
      const json = JSON.stringify(sessionsCache);
      writeFileSync(sessionsPath, json, "utf-8");
      const fd = openSync(sessionsPath, "r+");
      fsyncSync(fd);
      closeSync(fd);
      dirtySessions = false;
    } catch (err) {
      console.error("[settings] sessions sync flush error:", err);
    }
  }

  function scheduleSettingsFlush() {
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      settingsTimer = null;
      flushSettings();
    }, 500);
  }

  function scheduleSessionsFlush() {
    if (sessionsTimer) clearTimeout(sessionsTimer);
    sessionsTimer = setTimeout(() => {
      sessionsTimer = null;
      flushSessions();
    }, 2000);
  }

  // ── Init ──

  cache = loadSettings();
  sessionsCache = loadSessions();
  console.log(`[settings] loaded from ${settingsPath}, _version=${cache._version}`);

  // ── Public API ──

  return {
    /** Returns current settings (plaintext). Safe via IPC structured clone. */
    getAll(): Settings {
      return cache;
    },

    patch(partial: Partial<Settings>): void {
      cache = validateSettings(deepPatch(cache, partial));
      dirtySettings = true;
      scheduleSettingsFlush();
    },

    getSessions(): any[] {
      return sessionsCache;
    },

    saveSessions(sessions: any[]): void {
      sessionsCache = sessions;
      dirtySessions = true;
      scheduleSessionsFlush();
    },

    flushSync(): void {
      if (settingsTimer) { clearTimeout(settingsTimer); settingsTimer = null; }
      if (sessionsTimer) { clearTimeout(sessionsTimer); sessionsTimer = null; }
      flushSettingsSync();
      flushSessionsSync();
    },
  };
}
