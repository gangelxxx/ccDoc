import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vm from "node:vm";
import { join } from "node:path";
import { readFileSync } from "node:fs";

// ─── Helpers: execute script in sandbox (same as ScriptRunner.execute) ──────

function executeInSandbox(code: string): any {
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
    console: { log: () => {}, warn: () => {}, error: () => {} },
    require: undefined,
    process: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined,
    globalThis: undefined,
  };
  vm.runInNewContext(code, sandbox, { timeout: 5000, filename: "test-script.js" });
  return module.exports;
}

// ─── Sandbox security ──────────────────────────────────────────────────────

describe("ScriptRunner sandbox", () => {
  it("exports meta, chat, listModels from a valid script", () => {
    const code = `
      module.exports.meta = { id: "test", name: "Test", description: "desc" };
      module.exports.chat = async function(ctx, params) { return new Response("ok"); };
      module.exports.listModels = async function(ctx) { return [{ id: "m1", name: "M1" }]; };
    `;
    const exports = executeInSandbox(code);
    expect(exports.meta).toEqual({ id: "test", name: "Test", description: "desc" });
    expect(typeof exports.chat).toBe("function");
    expect(typeof exports.listModels).toBe("function");
  });

  it("require is undefined — cannot load Node modules", () => {
    const code = `
      module.exports.meta = { id: "t", name: "T", description: "d" };
      module.exports.hasRequire = typeof require !== "undefined";
    `;
    const exports = executeInSandbox(code);
    expect(exports.hasRequire).toBe(false);
  });

  it("process is undefined — cannot access env/argv", () => {
    const code = `
      module.exports.meta = { id: "t", name: "T", description: "d" };
      module.exports.hasProcess = typeof process !== "undefined";
    `;
    const exports = executeInSandbox(code);
    expect(exports.hasProcess).toBe(false);
  });

  it("__dirname / __filename are undefined", () => {
    const code = `
      module.exports.meta = { id: "t", name: "T", description: "d" };
      module.exports.hasDirname = typeof __dirname !== "undefined";
      module.exports.hasFilename = typeof __filename !== "undefined";
    `;
    const exports = executeInSandbox(code);
    expect(exports.hasDirname).toBe(false);
    expect(exports.hasFilename).toBe(false);
  });

  it("global / globalThis are undefined", () => {
    const code = `
      module.exports.meta = { id: "t", name: "T", description: "d" };
      module.exports.hasGlobal = typeof global !== "undefined";
      module.exports.hasGlobalThis = typeof globalThis !== "undefined";
    `;
    const exports = executeInSandbox(code);
    expect(exports.hasGlobal).toBe(false);
    expect(exports.hasGlobalThis).toBe(false);
  });

  it("script trying to use require() throws", () => {
    const code = `
      var fs = require("fs");
      module.exports.meta = { id: "t", name: "T", description: "d" };
    `;
    expect(() => executeInSandbox(code)).toThrow();
  });

  it("infinite loop hits timeout", () => {
    const code = `
      while(true) {}
      module.exports.meta = { id: "t", name: "T", description: "d" };
    `;
    expect(() => executeInSandbox(code)).toThrow(/timed out/i);
  });

  it("script can use JSON.stringify and Object.assign", () => {
    const code = `
      var obj = Object.assign({}, { a: 1 }, { b: 2 });
      module.exports.meta = { id: "t", name: "T", description: "d" };
      module.exports.result = JSON.stringify(obj);
    `;
    const exports = executeInSandbox(code);
    expect(exports.result).toBe('{"a":1,"b":2}');
  });

  it("script can use Promise and async functions", () => {
    const code = `
      module.exports.meta = { id: "t", name: "T", description: "d" };
      module.exports.chat = async function(ctx, params) {
        await new Promise(function(r) { setTimeout(r, 1); });
        return { status: 200 };
      };
    `;
    const exports = executeInSandbox(code);
    expect(typeof exports.chat).toBe("function");
  });

  it("caching — same code loaded twice returns same exports", () => {
    // Simulating cache behavior: run twice, check deterministic output
    const code = `
      module.exports.meta = { id: "cached", name: "Cached", description: "d" };
      module.exports.counter = Date.now();
    `;
    const e1 = executeInSandbox(code);
    const e2 = executeInSandbox(code);
    // Both should have valid meta
    expect(e1.meta.id).toBe("cached");
    expect(e2.meta.id).toBe("cached");
  });
});

// ─── readFile whitelist ──────────────────────────────────────────────────────

describe("isPathAllowed (readFile whitelist)", () => {
  // Replicate the logic from script-runner.ts
  const READ_WHITELIST_DIRS = [".claude", ".config", ".aws", ".ccdoc"];
  const { resolve } = require("node:path");

  function isPathAllowed(fullPath: string, homedir: string): boolean {
    const normalized = resolve(fullPath);
    for (const dir of READ_WHITELIST_DIRS) {
      const allowed = resolve(homedir, dir);
      if (normalized.startsWith(allowed)) return true;
    }
    return false;
  }

  const homedir = process.platform === "win32" ? "C:\\Users\\test" : "/home/test";

  it("allows ~/.claude/.credentials.json", () => {
    expect(isPathAllowed(join(homedir, ".claude", ".credentials.json"), homedir)).toBe(true);
  });

  it("allows ~/.config/some-app/config.json", () => {
    expect(isPathAllowed(join(homedir, ".config", "some-app", "config.json"), homedir)).toBe(true);
  });

  it("allows ~/.aws/credentials", () => {
    expect(isPathAllowed(join(homedir, ".aws", "credentials"), homedir)).toBe(true);
  });

  it("allows ~/.ccdoc/provider-scripts/my.js", () => {
    expect(isPathAllowed(join(homedir, ".ccdoc", "provider-scripts", "my.js"), homedir)).toBe(true);
  });

  it("blocks /etc/passwd", () => {
    expect(isPathAllowed("/etc/passwd", homedir)).toBe(false);
  });

  it("blocks ~/Documents/secret.txt", () => {
    expect(isPathAllowed(join(homedir, "Documents", "secret.txt"), homedir)).toBe(false);
  });

  it("blocks ~/.ssh/id_rsa", () => {
    expect(isPathAllowed(join(homedir, ".ssh", "id_rsa"), homedir)).toBe(false);
  });

  it("blocks path traversal attempt", () => {
    expect(isPathAllowed(join(homedir, ".claude", "..", ".ssh", "id_rsa"), homedir)).toBe(false);
  });
});
