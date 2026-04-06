import type { ProviderContext, ProviderScriptExports, ProviderScriptMeta, ChatParams } from "./types.js";
import type { ModelTierConfig, ProviderScriptRef } from "../settings.types.js";
import * as vm from "node:vm";
import { join, resolve } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { app } from "electron";

// Builtin scripts directory — resolved at runtime.
// electron-vite compiles to dist/main/index.js, and our Vite plugin copies
// builtin scripts to dist/main/provider-scripts/builtin/.
function getBuiltinDir(): string {
  // 1. Copied by build plugin (dist/main/provider-scripts/builtin/)
  const distPath = join(__dirname, "provider-scripts", "builtin");
  if (existsSync(distPath)) return distPath;
  // 2. Source path (dev mode with unset ELECTRON_RUN_AS_NODE)
  const srcPath = join(__dirname, "..", "services", "provider-scripts", "builtin");
  if (existsSync(srcPath)) return srcPath;
  // 3. Relative to app path
  const appPath = join(app.getAppPath(), "src", "main", "services", "provider-scripts", "builtin");
  if (existsSync(appPath)) return appPath;
  // Fallback
  return distPath;
}

// Cache of loaded scripts
const scriptCache = new Map<string, ProviderScriptExports>();

// Whitelisted directories for readFile
const READ_WHITELIST_DIRS = [".claude", ".config", ".aws", ".ccdoc"];

function isPathAllowed(fullPath: string, homedir: string): boolean {
  const normalized = resolve(fullPath);
  for (const dir of READ_WHITELIST_DIRS) {
    const allowed = resolve(homedir, dir);
    if (normalized.startsWith(allowed)) return true;
  }
  return false;
}

export class ScriptRunner {
  private builtinDir: string;

  constructor() {
    this.builtinDir = getBuiltinDir();
  }

  /** Load script by ProviderScriptRef */
  load(ref: ProviderScriptRef): ProviderScriptExports {
    const cacheKey = ref.type === "builtin"
      ? `builtin:${ref.builtinId}`
      : `custom:${ref.customPath || "inline"}`;

    if (scriptCache.has(cacheKey)) return scriptCache.get(cacheKey)!;

    let code: string;
    if (ref.type === "builtin") {
      const filePath = join(this.builtinDir, `${ref.builtinId}.js`);
      if (!existsSync(filePath)) {
        throw new Error(`Built-in provider script not found: ${ref.builtinId} (looked in ${filePath})`);
      }
      code = readFileSync(filePath, "utf-8");
    } else if (ref.customCode) {
      code = ref.customCode;
    } else if (ref.customPath) {
      if (!existsSync(ref.customPath)) {
        throw new Error(`Custom provider script not found: ${ref.customPath}`);
      }
      code = readFileSync(ref.customPath, "utf-8");
    } else {
      throw new Error("No script source specified in ProviderScriptRef");
    }

    const exports = this.execute(code);
    scriptCache.set(cacheKey, exports);
    return exports;
  }

  /** Execute script code in sandbox */
  private execute(code: string): ProviderScriptExports {
    const exports: any = {};
    const module = { exports };
    const sandbox = {
      module,
      exports,
      Object,
      Array,
      JSON,
      Promise,
      Date,
      Math,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      setTimeout,
      clearTimeout,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
      // Forbidden:
      require: undefined,
      process: undefined,
      __dirname: undefined,
      __filename: undefined,
      global: undefined,
      globalThis: undefined,
    };

    vm.runInNewContext(code, sandbox, {
      timeout: 5000,
      filename: "provider-script.js",
    });

    return module.exports as ProviderScriptExports;
  }

  /** Create ProviderContext for a script */
  buildContext(config: ModelTierConfig): ProviderContext {
    const homedir = app.getPath("home");
    return {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.modelId,
      homedir,
      fetch: globalThis.fetch.bind(globalThis),
      readFile: (...parts: string[]) => {
        const fullPath = join(...parts);
        if (!isPathAllowed(fullPath, homedir)) {
          console.warn(`[provider-script] readFile blocked: ${fullPath}`);
          return null;
        }
        try {
          return readFileSync(fullPath, "utf-8");
        } catch {
          return null;
        }
      },
      log: (level: string, msg: string) => {
        console.log(`[provider-script][${level}]`, msg);
      },
    };
  }

  /** Execute chat() on the provider script */
  async chat(config: ModelTierConfig, params: ChatParams): Promise<Response> {
    const script = this.load(config.providerScript);
    const ctx = this.buildContext(config);
    return script.chat(ctx, params);
  }

  /** Get available models from provider */
  async listModels(config: ModelTierConfig): Promise<Array<{ id: string; name: string }>> {
    const script = this.load(config.providerScript);
    const ctx = this.buildContext(config);
    return script.listModels?.(ctx) ?? [];
  }

  /** Get script metadata */
  getMeta(ref: ProviderScriptRef): ProviderScriptMeta {
    return this.load(ref).meta;
  }

  /** Get code of a script (for viewer) */
  getCode(ref: ProviderScriptRef): string {
    if (ref.type === "builtin") {
      const filePath = join(this.builtinDir, `${ref.builtinId}.js`);
      if (!existsSync(filePath)) return "";
      return readFileSync(filePath, "utf-8");
    }
    if (ref.customCode) return ref.customCode;
    if (ref.customPath && existsSync(ref.customPath)) {
      return readFileSync(ref.customPath, "utf-8");
    }
    return "";
  }

  /** List all builtin scripts */
  listBuiltinScripts(): ProviderScriptMeta[] {
    const result: ProviderScriptMeta[] = [];
    try {
      const dir = this.builtinDir;
      if (!existsSync(dir)) return result;
      const files = readdirSync(dir).filter(f => f.endsWith(".js"));
      for (const file of files) {
        try {
          const ref: ProviderScriptRef = { type: "builtin", builtinId: file.replace(".js", "") };
          result.push(this.getMeta(ref));
        } catch (e) {
          console.warn(`[ScriptRunner] Failed to load builtin ${file}:`, e);
        }
      }
    } catch {
      // dir not found — ok
    }
    return result;
  }

  /** Invalidate cache (when script is updated) */
  invalidate(ref: ProviderScriptRef): void {
    const key = ref.type === "builtin"
      ? `builtin:${ref.builtinId}`
      : `custom:${ref.customPath || "inline"}`;
    scriptCache.delete(key);
  }

  /** Clear entire cache */
  clearCache(): void {
    scriptCache.clear();
  }
}
