import { app, safeStorage } from "electron";
import { join } from "path";
import { readFileSync, unlinkSync, existsSync } from "fs";
import type { Vault, RevisionInfo } from "@ccdoc/core";
import { type Settings, SETTINGS_DEFAULTS, validateSettings } from "./settings.types";

// ─── Encryption helpers ─────────────────────────────────────

function encryptField(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  return "enc:" + safeStorage.encryptString(value).toString("base64");
}

function decryptField(value: string): string {
  if (!value || !value.startsWith("enc:")) return value;
  if (!safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), "base64"));
  } catch {
    return "";
  }
}

const SENSITIVE_KEYS = ["llmApiKey", "webSearchApiKey"] as const;

const MODEL_TIER_KEYS = ["strong", "medium", "weak"] as const;

/** Encrypt sensitive top-level fields. Handles nested embedding.onlineApiKey and modelTiers.*.apiKey. */
function encryptSensitiveEntries(entries: Record<string, any>): Record<string, any> {
  const result = { ...entries };
  for (const key of SENSITIVE_KEYS) {
    if (key in result && typeof result[key] === "string") {
      result[key] = encryptField(result[key]);
    }
  }
  if (result.embedding && typeof result.embedding === "object" && result.embedding.onlineApiKey) {
    result.embedding = { ...result.embedding, onlineApiKey: encryptField(result.embedding.onlineApiKey) };
  }
  // Model tiers API keys
  if (result.modelTiers && typeof result.modelTiers === "object") {
    result.modelTiers = { ...result.modelTiers };
    for (const tier of MODEL_TIER_KEYS) {
      if (result.modelTiers[tier] && typeof result.modelTiers[tier].apiKey === "string" && result.modelTiers[tier].apiKey) {
        result.modelTiers[tier] = { ...result.modelTiers[tier], apiKey: encryptField(result.modelTiers[tier].apiKey) };
      }
    }
  }
  return result;
}

/** Decrypt sensitive top-level fields. Handles nested embedding.onlineApiKey and modelTiers.*.apiKey. */
function decryptSensitiveEntries(entries: Record<string, any>): Record<string, any> {
  const result = { ...entries };
  for (const key of SENSITIVE_KEYS) {
    if (key in result && typeof result[key] === "string") {
      result[key] = decryptField(result[key]);
    }
  }
  if (result.embedding && typeof result.embedding === "object" && result.embedding.onlineApiKey) {
    result.embedding = { ...result.embedding, onlineApiKey: decryptField(result.embedding.onlineApiKey) };
  }
  // Model tiers API keys
  if (result.modelTiers && typeof result.modelTiers === "object") {
    result.modelTiers = { ...result.modelTiers };
    for (const tier of MODEL_TIER_KEYS) {
      if (result.modelTiers[tier] && typeof result.modelTiers[tier].apiKey === "string" && result.modelTiers[tier].apiKey) {
        result.modelTiers[tier] = { ...result.modelTiers[tier], apiKey: decryptField(result.modelTiers[tier].apiKey) };
      }
    }
  }
  return result;
}

// ─── Deep patch (max 2 levels) ──────────────────────────────

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

// ─── Migration from settings.json ──────────────────────────

export async function migrateSettingsToVault(vault: Vault): Promise<void> {
  const allVault = await vault.getAll();
  if (Object.keys(allVault).length > 0) return;

  const userDataDir = app.getPath("userData");
  const settingsPath = join(userDataDir, "settings.json");

  if (existsSync(settingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
      // Decrypt old encrypted values, then re-encrypt through vault flow
      const decrypted = decryptSensitiveEntries(raw);
      const encrypted = encryptSensitiveEntries(decrypted);
      await vault.set(encrypted, "boot:migration-from-json");
      try { unlinkSync(settingsPath); } catch {}
      console.log("[settings] migrated settings.json → vault, old file removed");
    } catch (err) {
      console.error("[settings] failed to migrate settings.json:", err);
    }
  }

  // Migrate sessions
  const sessionsPath = join(userDataDir, "llm-sessions.json");
  if (existsSync(sessionsPath)) {
    try {
      const sessions = JSON.parse(readFileSync(sessionsPath, "utf-8"));
      if (Array.isArray(sessions) && sessions.length > 0) {
        await vault.set({ llmSessions: sessions }, "boot:migration-sessions");
      }
      try { unlinkSync(sessionsPath); } catch {}
      console.log("[settings] migrated llm-sessions.json → vault");
    } catch (err) {
      console.error("[settings] failed to migrate sessions:", err);
    }
  }
}

// ─── Service ────────────────────────────────────────────────

export interface SettingsService {
  getAll(): Settings;
  patch(partial: Partial<Settings>, source?: string): void;
  getSessions(): any[];
  saveSessions(sessions: any[], source?: string): void;
  flushSync(): void;
  // Vault history
  getVaultHistory(limit?: number): Promise<RevisionInfo[]>;
  getVaultSnapshot(revision: number): Promise<Record<string, any>>;
  rollbackVault(revision: number): Promise<number>;
}

export function createSettingsService(vault: Vault): SettingsService {
  let cache: Settings;
  let sessionsCache: any[] = [];

  // Dirty tracking: accumulate changed keys and sources for debounced flush
  const dirtyEntries = new Map<string, any>();
  const dirtySources = new Set<string>();
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;

  let dirtySessions = false;
  let sessionsTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Load from vault (sync wrapper for boot) ──

  function loadSettingsSync(): Settings {
    // At this point vault should already have data (migrated or existing)
    // We use a blocking approach: read vault in constructor, cache result
    return { ...SETTINGS_DEFAULTS };
  }

  // ── Async init ──

  async function initFromVault(): Promise<void> {
    const raw = await vault.getAll();
    const decrypted = decryptSensitiveEntries(raw);
    cache = validateSettings({ ...SETTINGS_DEFAULTS, ...decrypted });

    // Migrate: if modelTiers has no API keys but llmApiKey exists, populate tiers
    if (cache.llmApiKey && !cache.modelTiers.strong.apiKey) {
      const isOAuth = cache.llmApiKey.startsWith("sk-ant-oat");
      const scriptRef = isOAuth
        ? { type: "builtin" as const, builtinId: "anthropic-oauth" }
        : { type: "builtin" as const, builtinId: "anthropic-apikey" };

      for (const tier of MODEL_TIER_KEYS) {
        cache.modelTiers[tier] = {
          ...cache.modelTiers[tier],
          providerScript: scriptRef,
          apiKey: cache.llmApiKey,
        };
      }
      // Persist migration
      dirtyEntries.set("modelTiers", cache.modelTiers);
      dirtySources.add("boot:migrate-tiers");
      console.log(`[settings] migrated llmApiKey → modelTiers (${isOAuth ? "oauth" : "apikey"})`);
    }

    // Load sessions from vault
    const sessions = await vault.get<any[]>("llmSessions");
    sessionsCache = Array.isArray(sessions) ? sessions : [];

    console.log(`[settings] loaded from vault, keys: ${Object.keys(raw).length}`);
  }

  // ── Flush to vault ──

  async function flushSettings(): Promise<void> {
    if (dirtyEntries.size === 0) return;

    const entries: Record<string, any> = {};
    for (const [key, value] of dirtyEntries) {
      entries[key] = value;
    }
    const encrypted = encryptSensitiveEntries(entries);
    const source = dirtySources.size > 0 ? [...dirtySources].join(",") : "renderer:unknown";

    dirtyEntries.clear();
    dirtySources.clear();

    try {
      await vault.set(encrypted, source);
    } catch (err) {
      console.error("[settings] vault flush error:", err);
      // Re-add entries for next flush attempt
      for (const [key, value] of Object.entries(entries)) {
        dirtyEntries.set(key, value);
      }
    }
  }

  async function flushSessions(): Promise<void> {
    if (!dirtySessions) return;
    dirtySessions = false;
    try {
      await vault.set({ llmSessions: sessionsCache }, "sessions:save");
    } catch (err) {
      console.error("[settings] sessions vault flush error:", err);
      dirtySessions = true;
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

  function flushAllSync(): void {
    if (settingsTimer) { clearTimeout(settingsTimer); settingsTimer = null; }
    if (sessionsTimer) { clearTimeout(sessionsTimer); sessionsTimer = null; }
    // Vault uses libsql in file mode — promises resolve synchronously on microtask queue.
    // We fire-and-forget here; the data is already in the in-memory WAL by the time we return.
    if (dirtyEntries.size > 0) flushSettings();
    if (dirtySessions) flushSessions();
  }

  // ── Init ──

  cache = loadSettingsSync();

  // ── Public API ──

  const service: SettingsService = {
    getAll(): Settings {
      return cache;
    },

    patch(partial: Partial<Settings>, source?: string): void {
      cache = validateSettings(deepPatch(cache, partial));

      // Track which top-level keys changed
      for (const key of Object.keys(partial)) {
        dirtyEntries.set(key, (cache as any)[key]);
      }
      if (source) dirtySources.add(source);

      scheduleSettingsFlush();
    },

    getSessions(): any[] {
      return sessionsCache;
    },

    saveSessions(sessions: any[], source?: string): void {
      sessionsCache = sessions;
      dirtySessions = true;
      scheduleSessionsFlush();
    },

    flushSync(): void {
      flushAllSync();
    },

    async getVaultHistory(limit = 50): Promise<RevisionInfo[]> {
      return vault.history(limit);
    },

    async getVaultSnapshot(revision: number): Promise<Record<string, any>> {
      const raw = await vault.snapshot(revision);
      return decryptSensitiveEntries(raw);
    },

    async rollbackVault(revision: number): Promise<number> {
      const rev = await vault.rollback(revision, "user:rollback");
      // Reload cache from vault
      await initFromVault();
      return rev;
    },
  };

  // Kick off async vault load — cache will be populated before first IPC call
  // because initServices awaits before registering IPC handlers
  const initPromise = initFromVault();

  // Expose init promise for boot sequence
  (service as any)._initPromise = initPromise;

  return service;
}
