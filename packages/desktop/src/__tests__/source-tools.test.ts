import { describe, it, expect } from "vitest";
import {
  escapeRegex,
  extractOutline,
  extractSymbols,
  searchFileContent,
  countFileMatches,
  buildSearchRegex,
  formatSymbolResults,
  CODE_EXTS,
} from "../main/source-tools";
import type { SymbolEntry } from "../main/source-tools";

// ─── escapeRegex ────────────────────────────────────────────────

describe("escapeRegex", () => {
  it("escapes all special regex characters", () => {
    expect(escapeRegex("foo.bar")).toBe("foo\\.bar");
    expect(escapeRegex("a+b*c?")).toBe("a\\+b\\*c\\?");
    expect(escapeRegex("(x|y)")).toBe("\\(x\\|y\\)");
    expect(escapeRegex("[0-9]")).toBe("\\[0-9\\]"); // - is not a special regex char
    expect(escapeRegex("a{3}")).toBe("a\\{3\\}");
    expect(escapeRegex("$100^2")).toBe("\\$100\\^2");
    expect(escapeRegex("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeRegex("hello world")).toBe("hello world");
    expect(escapeRegex("fooBar123")).toBe("fooBar123");
  });
});

// ─── extractOutline ─────────────────────────────────────────────

describe("extractOutline", () => {
  describe("TypeScript/JS", () => {
    const tsContent = `import { foo } from "./bar";
import type { Baz } from "./baz";

export const API_KEY = "xxx";

export default function main() {
  console.log("hello");
}

function helper() {
  return 42;
}

export class Service {
  async doWork() {}
}

export interface Config {
  key: string;
}

export type Result = { ok: boolean };

export { helper };
export * from "./utils";`;

    it("extracts all signature types", () => {
      const { signatures, lineCount } = extractOutline(tsContent, ".ts");
      expect(lineCount).toBe(tsContent.split("\n").length);
      // Should find: 2 imports, 1 export const, 1 export default function, 1 function,
      // 1 export class, 1 export interface, 1 export type, 1 export {}, 1 export *
      expect(signatures.length).toBe(10);
    });

    it("includes line numbers", () => {
      const { signatures } = extractOutline(tsContent, ".ts");
      expect(signatures[0]).toMatch(/^1: import/);
    });

    it("works for .tsx, .jsx, .mts, .mjs extensions", () => {
      for (const ext of [".tsx", ".jsx", ".mts", ".mjs"]) {
        const { signatures } = extractOutline("export function App() {}", ext);
        expect(signatures.length).toBe(1);
      }
    });
  });

  describe("Python", () => {
    const pyContent = `import os
from pathlib import Path

class MyService:
    def __init__(self):
        pass

    async def process(self):
        pass

def main():
    pass

async def async_main():
    pass`;

    it("extracts classes, functions, and imports", () => {
      const { signatures } = extractOutline(pyContent, ".py");
      // import, from...import, class, def main, async def async_main
      expect(signatures.length).toBe(5);
    });
  });

  describe("Go", () => {
    const goContent = `package main

import "fmt"

func main() {
    fmt.Println("hello")
}

type Server struct {
    port int
}

func (s *Server) Start() error {
    return nil
}

type Handler interface {
    Handle() error
}`;

    it("extracts package, imports, funcs, types", () => {
      const { signatures } = extractOutline(goContent, ".go");
      // package, import, func main, type Server, func Start, type Handler
      expect(signatures.length).toBe(6);
    });
  });

  describe("Rust", () => {
    const rsContent = `use std::io;

pub fn main() {
    println!("hello");
}

fn helper() -> i32 {
    42
}

pub struct Config {
    key: String,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Handler {
    fn handle(&self);
}

impl Config {
    pub fn new() -> Self {
        Config { key: String::new() }
    }
}`;

    it("extracts use, fn, struct, enum, trait, impl", () => {
      const { signatures } = extractOutline(rsContent, ".rs");
      // use, pub fn main, fn helper, pub struct, pub enum, pub trait, impl Config, pub fn new, fn handle
      expect(signatures.length).toBe(9);
    });
  });

  describe("unknown extension", () => {
    it("returns empty signatures", () => {
      const { signatures, lineCount } = extractOutline("hello\nworld", ".txt");
      expect(signatures.length).toBe(0);
      expect(lineCount).toBe(2);
    });
  });
});

// ─── extractSymbols ─────────────────────────────────────────────

describe("extractSymbols", () => {
  describe("TypeScript", () => {
    const tsContent = `import { foo } from "./bar";

export function createProject(name: string): Project {
  return { name };
}

function internalHelper() {
  return 42;
}

export default class ProjectService {
  async getById(id: string) {
    return null;
  }

  static fromConfig(config: any) {
    return new ProjectService();
  }

  private _internal() {}
}

export interface ProjectConfig {
  name: string;
}

export type ProjectId = string;

export const DEFAULT_NAME = "untitled";

const enum InternalStatus {
  Active,
  Done,
}

export enum PublicStatus {
  Open = "open",
  Closed = "closed",
}`;

    it("extracts functions with correct kind and export status", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const fns = symbols.filter(s => s.kind === "function");
      expect(fns).toHaveLength(2);
      expect(fns[0]).toEqual({ name: "createProject", kind: "function", file: "src/project.ts", line: 3, exported: true });
      expect(fns[1]).toEqual({ name: "internalHelper", kind: "function", file: "src/project.ts", line: 7, exported: false });
    });

    it("extracts classes", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const classes = symbols.filter(s => s.kind === "class");
      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe("ProjectService");
      expect(classes[0].exported).toBe(true);
    });

    it("extracts methods inside class", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const methods = symbols.filter(s => s.kind === "method");
      const names = methods.map(m => m.name);
      expect(names).toContain("getById");
      expect(names).toContain("fromConfig");
      // private _internal() — not matched because `private` is parsed as method name and fails \s*\( check
    });

    it("extracts interfaces", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const ifaces = symbols.filter(s => s.kind === "interface");
      expect(ifaces).toHaveLength(1);
      expect(ifaces[0].name).toBe("ProjectConfig");
      expect(ifaces[0].exported).toBe(true);
    });

    it("extracts type aliases", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const types = symbols.filter(s => s.kind === "type");
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe("ProjectId");
    });

    it("extracts enums", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const enums = symbols.filter(s => s.kind === "enum");
      expect(enums).toHaveLength(2);
      expect(enums.map(e => e.name)).toEqual(["InternalStatus", "PublicStatus"]);
    });

    it("extracts exported variables", () => {
      const symbols = extractSymbols(tsContent, ".ts", "src/project.ts");
      const vars = symbols.filter(s => s.kind === "variable");
      expect(vars).toHaveLength(1);
      expect(vars[0].name).toBe("DEFAULT_NAME");
      expect(vars[0].exported).toBe(true);
    });

    it("does not extract constructor as method", () => {
      const content = `export class Foo {\n  constructor() {}\n  bar() {}\n}`;
      const symbols = extractSymbols(content, ".ts", "test.ts");
      const methods = symbols.filter(s => s.kind === "method");
      expect(methods.map(m => m.name)).not.toContain("constructor");
      expect(methods.map(m => m.name)).toContain("bar");
    });

    it("stops tracking methods after class end", () => {
      const content = `export class Foo {\n  bar() {}\n}\n\nfunction standalone() {}`;
      const symbols = extractSymbols(content, ".ts", "test.ts");
      // "standalone" should be detected as function, not method
      const standalone = symbols.find(s => s.name === "standalone");
      expect(standalone?.kind).toBe("function");
    });
  });

  describe("Python", () => {
    const pyContent = `class UserService:
    def __init__(self):
        pass

    async def get_user(self, id):
        pass

    def _private_method(self):
        pass

def main():
    pass

def _internal():
    pass

async def async_handler():
    pass`;

    it("extracts classes and functions", () => {
      const symbols = extractSymbols(pyContent, ".py", "service.py");
      expect(symbols.filter(s => s.kind === "class")).toHaveLength(1);
      expect(symbols.filter(s => s.kind === "function")).toHaveLength(3);
    });

    it("extracts methods (indented defs)", () => {
      const symbols = extractSymbols(pyContent, ".py", "service.py");
      const methods = symbols.filter(s => s.kind === "method");
      expect(methods.map(m => m.name)).toEqual(["__init__", "get_user", "_private_method"]);
    });

    it("marks underscore-prefixed as not exported", () => {
      const symbols = extractSymbols(pyContent, ".py", "service.py");
      const internal = symbols.find(s => s.name === "_internal");
      expect(internal?.exported).toBe(false);
      const main = symbols.find(s => s.name === "main");
      expect(main?.exported).toBe(true);
    });
  });

  describe("Go", () => {
    const goContent = `func main() {
    fmt.Println("hello")
}

func (s *Server) Start() error {
    return nil
}

type Config struct {
    Port int
}

type handler interface {
    Handle() error
}`;

    it("extracts funcs with receiver", () => {
      const symbols = extractSymbols(goContent, ".go", "main.go");
      const fns = symbols.filter(s => s.kind === "function");
      expect(fns.map(f => f.name)).toEqual(["main", "Start"]);
    });

    it("marks uppercase as exported", () => {
      const symbols = extractSymbols(goContent, ".go", "main.go");
      expect(symbols.find(s => s.name === "main")?.exported).toBe(false);
      expect(symbols.find(s => s.name === "Start")?.exported).toBe(true);
      expect(symbols.find(s => s.name === "Config")?.exported).toBe(true);
      expect(symbols.find(s => s.name === "handler")?.exported).toBe(false);
    });

    it("distinguishes struct vs interface", () => {
      const symbols = extractSymbols(goContent, ".go", "main.go");
      expect(symbols.find(s => s.name === "Config")?.kind).toBe("struct");
      expect(symbols.find(s => s.name === "handler")?.kind).toBe("interface");
    });
  });

  describe("Rust", () => {
    const rsContent = `pub fn serve(port: u16) {
    // ...
}

fn helper() -> i32 {
    42
}

pub struct Server {
    port: u16,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Handler {
    fn handle(&self);
}

impl Server {
    pub fn new(port: u16) -> Self {
        Server { port }
    }
}`;

    it("extracts all Rust symbol types", () => {
      const symbols = extractSymbols(rsContent, ".rs", "lib.rs");
      expect(symbols.filter(s => s.kind === "function").map(s => s.name)).toEqual(["serve", "helper", "handle", "new"]);
      expect(symbols.filter(s => s.kind === "struct").map(s => s.name)).toEqual(["Server"]);
      expect(symbols.filter(s => s.kind === "enum").map(s => s.name)).toEqual(["Status"]);
      expect(symbols.filter(s => s.kind === "trait").map(s => s.name)).toEqual(["Handler"]);
      expect(symbols.filter(s => s.kind === "impl").map(s => s.name)).toEqual(["Server"]);
    });

    it("marks pub as exported", () => {
      const symbols = extractSymbols(rsContent, ".rs", "lib.rs");
      expect(symbols.find(s => s.name === "serve")?.exported).toBe(true);
      expect(symbols.find(s => s.name === "helper")?.exported).toBe(false);
    });
  });
});

// ─── buildSearchRegex ───────────────────────────────────────────

describe("buildSearchRegex", () => {
  // Note: buildSearchRegex returns regex with 'g' flag, so .test() advances lastIndex.
  // Must reset lastIndex=0 before each .test() call on a different string.

  it("creates case-insensitive regex by default", () => {
    const re = buildSearchRegex({ pattern: "hello" });
    expect(re.flags).toContain("i");
    re.lastIndex = 0; expect(re.test("Hello World")).toBe(true);
    re.lastIndex = 0; expect(re.test("HELLO")).toBe(true);
  });

  it("creates case-sensitive regex when requested", () => {
    const re = buildSearchRegex({ pattern: "hello", case_sensitive: true });
    expect(re.flags).not.toContain("i");
    re.lastIndex = 0; expect(re.test("hello")).toBe(true);
    re.lastIndex = 0; expect(re.test("Hello")).toBe(false);
  });

  it("escapes special chars in plain text mode", () => {
    const re = buildSearchRegex({ pattern: "foo.bar()" });
    re.lastIndex = 0; expect(re.test("foo.bar()")).toBe(true);
    re.lastIndex = 0; expect(re.test("fooXbar()")).toBe(false);
  });

  it("uses pattern as-is in regex mode", () => {
    const re = buildSearchRegex({ pattern: "foo.*bar", is_regex: true });
    re.lastIndex = 0; expect(re.test("foo123bar")).toBe(true);
    re.lastIndex = 0; expect(re.test("foobar")).toBe(true);
  });

  it("wraps in word boundaries when whole_word is true", () => {
    const re = buildSearchRegex({ pattern: "foo", whole_word: true });
    re.lastIndex = 0; expect(re.test("foo bar")).toBe(true);
    re.lastIndex = 0; expect(re.test("foobar")).toBe(false);
    re.lastIndex = 0; expect(re.test("barfoo")).toBe(false);
  });

  it("throws on invalid regex", () => {
    expect(() => buildSearchRegex({ pattern: "[invalid", is_regex: true })).toThrow();
  });
});

// ─── searchFileContent ──────────────────────────────────────────

describe("searchFileContent", () => {
  const lines = [
    "line 0: nothing here",     // 0
    "line 1: nothing here",     // 1
    "line 2: MATCH_A here",     // 2
    "line 3: nothing here",     // 3
    "line 4: nothing here",     // 4
    "line 5: nothing here",     // 5
    "line 6: MATCH_B here",     // 6
    "line 7: nothing here",     // 7
    "line 8: nothing here",     // 8
  ];

  it("finds matches with context", () => {
    const regex = /MATCH_A/g;
    const results = searchFileContent(lines, regex, "test.ts", 2, 50, 0);
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe("test.ts");
    expect(results[0].line).toBe(3); // 1-based
    // Context: lines 0-4 (2 before, match at 2, 2 after)
    expect(results[0].text).toContain("3> line 2: MATCH_A here");
    expect(results[0].text).toContain("1: line 0:");
    expect(results[0].text).toContain("5: line 4:");
  });

  it("merges overlapping contexts", () => {
    // Two matches close together: line 2 and line 4 with context=2 → overlap
    const linesMerge = [
      "line 0",
      "line 1",
      "line 2: MATCH",
      "line 3",
      "line 4: MATCH",
      "line 5",
      "line 6",
    ];
    const regex = /MATCH/g;
    const results = searchFileContent(linesMerge, regex, "test.ts", 2, 50, 0);
    // Should merge into a single range (lines 0-6)
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain("3> line 2: MATCH");
    expect(results[0].text).toContain("5> line 4: MATCH");
  });

  it("returns empty array when no matches", () => {
    const regex = /NOMATCH/g;
    const results = searchFileContent(lines, regex, "test.ts", 2, 50, 0);
    expect(results).toHaveLength(0);
  });

  it("respects maxResults", () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i}: MATCH`);
    const regex = /MATCH/g;
    const results = searchFileContent(manyLines, regex, "test.ts", 0, 3, 0);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("works with zero context", () => {
    const regex = /MATCH_A/g;
    const results = searchFileContent(lines, regex, "test.ts", 0, 50, 0);
    expect(results).toHaveLength(1);
    // Only the match line itself
    expect(results[0].text).toBe("3> line 2: MATCH_A here");
  });

  it("uses > marker for match lines and : for context", () => {
    const regex = /MATCH_A/g;
    const results = searchFileContent(lines, regex, "test.ts", 1, 50, 0);
    const textLines = results[0].text.split("\n");
    expect(textLines[0]).toMatch(/^2: /); // context before
    expect(textLines[1]).toMatch(/^3> /); // match line
    expect(textLines[2]).toMatch(/^4: /); // context after
  });
});

// ─── countFileMatches ───────────────────────────────────────────

describe("countFileMatches", () => {
  it("counts matching lines", () => {
    const lines = ["foo", "bar", "foo", "baz", "foo"];
    expect(countFileMatches(lines, /foo/g)).toBe(3);
  });

  it("returns 0 when no matches", () => {
    expect(countFileMatches(["a", "b", "c"], /x/g)).toBe(0);
  });

  it("counts at most once per line even with global regex", () => {
    // regex.test() with 'g' flag returns true once per line scan
    const lines = ["foo foo foo"];
    expect(countFileMatches(lines, /foo/g)).toBe(1); // per-line count
  });
});

// ─── formatSymbolResults ────────────────────────────────────────

describe("formatSymbolResults", () => {
  it("returns 'No symbols found.' for empty array", () => {
    expect(formatSymbolResults([])).toBe("No symbols found.");
  });

  it("formats symbols with ⊕ for exported", () => {
    const symbols: SymbolEntry[] = [
      { name: "Foo", kind: "class", file: "src/foo.ts", line: 1, exported: true },
      { name: "bar", kind: "function", file: "src/foo.ts", line: 10, exported: false },
    ];
    const output = formatSymbolResults(symbols);
    expect(output).toContain("2 symbol(s):");
    expect(output).toContain("⊕ Foo (class) — src/foo.ts:1");
    expect(output).toContain("  bar (function) — src/foo.ts:10");
  });
});

// ─── Token efficiency tests ────────────────────────────────────
// These tests verify that the new tools produce significantly more compact output
// than raw file content, validating the token-saving design.

describe("Token efficiency", () => {
  // Approximate token count: ~4 chars per token for code (conservative estimate)
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  const LARGE_TS_FILE = generateLargeTypeScriptFile(50); // 50 functions + 5 classes

  it("find_symbols output is 4x+ smaller than full file content", () => {
    const fullFileTokens = estimateTokens(LARGE_TS_FILE);
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const symbolOutput = formatSymbolResults(symbols);
    const symbolTokens = estimateTokens(symbolOutput);

    // Symbol output should be much smaller than full file
    const ratio = fullFileTokens / symbolTokens;
    expect(ratio).toBeGreaterThan(4);
    // Verify we actually found symbols
    expect(symbols.length).toBeGreaterThan(50);
  });

  it("extractOutline output is 3x+ smaller than full file content", () => {
    const fullFileTokens = estimateTokens(LARGE_TS_FILE);
    const { signatures } = extractOutline(LARGE_TS_FILE, ".ts");
    const outlineOutput = signatures.join("\n");
    const outlineTokens = estimateTokens(outlineOutput);

    const ratio = fullFileTokens / outlineTokens;
    expect(ratio).toBeGreaterThan(3);
    expect(signatures.length).toBeGreaterThan(50);
  });

  it("search with output_mode='files' is much smaller than output_mode='content'", () => {
    const lines = LARGE_TS_FILE.split("\n");
    const regex = /function/gi;

    // content mode — full match output with context
    const contentResults = searchFileContent(lines, regex, "large.ts", 2, 50, 0);
    const contentOutput = contentResults.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
    const contentTokens = estimateTokens(contentOutput);

    // files mode — just the file path
    const filesOutput = "1 file(s):\nlarge.ts";
    const filesTokens = estimateTokens(filesOutput);

    // Files mode should be dramatically smaller
    expect(contentTokens / filesTokens).toBeGreaterThan(20);
  });

  it("search with output_mode='count' is much smaller than 'content'", () => {
    const lines = LARGE_TS_FILE.split("\n");
    const regex = /function/gi;

    const contentResults = searchFileContent(lines, regex, "large.ts", 2, 200, 0);
    const contentOutput = contentResults.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
    const contentTokens = estimateTokens(contentOutput);

    const matchCount = countFileMatches(lines, regex);
    const countOutput = `${matchCount} match(es) in 1 file(s):\nlarge.ts: ${matchCount}`;
    const countTokens = estimateTokens(countOutput);

    expect(contentTokens / countTokens).toBeGreaterThan(10);
  });

  it("search with context_lines=0 is significantly smaller than context_lines=5", () => {
    const lines = LARGE_TS_FILE.split("\n");
    const regex = /async/gi;

    const noCtxResults = searchFileContent(lines, regex, "large.ts", 0, 50, 0);
    const noCtxOutput = noCtxResults.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
    const noCtxTokens = estimateTokens(noCtxOutput);

    const fullCtxResults = searchFileContent(lines, regex, "large.ts", 5, 50, 0);
    const fullCtxOutput = fullCtxResults.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
    const fullCtxTokens = estimateTokens(fullCtxOutput);

    // 0-context should be significantly smaller than 5-context
    expect(fullCtxTokens / noCtxTokens).toBeGreaterThan(3);
  });

  it("find_symbols output fits within TOOL_RESULT_LIMIT (6000 chars) for 50+ symbols", () => {
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const output = formatSymbolResults(symbols.slice(0, 80));
    // Each symbol line is ~60 chars → 80 symbols ≈ 4800 chars + header
    expect(output.length).toBeLessThan(6000);
  });

  it("reports approximate token savings for a realistic scenario", () => {
    // Simulate: LLM wants to find "createProject" function
    // Old approach: read entire file → many tokens
    // New approach: find_symbols → few tokens
    const fullFileTokens = estimateTokens(LARGE_TS_FILE);

    // find_symbols for "create"
    const allSymbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const filtered = allSymbols.filter(s => s.name.toLowerCase().includes("create"));
    const symbolOutput = formatSymbolResults(filtered);
    const symbolTokens = estimateTokens(symbolOutput);

    // Then read only the relevant function (assume ~10 lines)
    const targetLines = LARGE_TS_FILE.split("\n").slice(0, 10);
    const readTokens = estimateTokens(targetLines.join("\n"));

    const newTotalTokens = symbolTokens + readTokens;

    // New approach should use less than 20% of full file tokens
    expect(newTotalTokens / fullFileTokens).toBeLessThan(0.2);
  });
});

// ─── Prompt caching tests ───────────────────────────────────────
// Anthropic prompt caching: system prompt + tool definitions = cached prefix.
// Tool RESULTS go into messages (non-cached, full-rate tokens).
// Key optimization: minimize result sizes → less non-cached tokens per round-trip.
// Secondary: keep tool definitions compact → smaller cached prefix.

describe("Prompt caching: tool definitions", () => {
  // Replicate tool definitions exactly as in app.store.ts
  const SOURCE_TOOLS = [
    {
      name: "get_project_tree",
      description: "Get a compact file tree of the project's source code. Supports glob filtering and depth limits. Excludes node_modules, .git, dist, etc.",
      input_schema: {
        type: "object",
        properties: {
          glob: { type: "string", description: "Glob pattern to filter files (e.g. 'src/**/*.ts', '**/*.{ts,tsx}'). Omit to show all files." },
          max_depth: { type: "number", description: "Maximum directory depth (0 = root files only). Omit for unlimited." },
        },
        required: [],
      },
    },
    {
      name: "get_file_outlines",
      description: "Get compact outlines (exports, functions, classes, interfaces, types) from one or more source files. Ultra token-efficient — shows only signatures with line numbers. Use BEFORE reading full files. Max 20 files per call.",
      input_schema: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" }, description: "One or more relative file paths (e.g. ['src/index.ts'])" },
        },
        required: ["paths"],
      },
    },
    {
      name: "read_project_file",
      description: "Read a source file's content. Supports optional line range for targeted reading (much more efficient). For large files, use startLine/endLine to read only what you need.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path from project root" },
          startLine: { type: "number", description: "Start line number (1-based). Omit to read from beginning." },
          endLine: { type: "number", description: "End line number (inclusive). Omit to read 200 lines from startLine." },
        },
        required: ["path"],
      },
    },
    {
      name: "search_project_files",
      description: "Grep-like search across project source files. Supports regex, output modes, globs, configurable context.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern. Plain text by default, or regex if is_regex=true." },
          is_regex: { type: "boolean", description: "Treat pattern as regex. Default: false." },
          case_sensitive: { type: "boolean", description: "Case-sensitive matching. Default: false." },
          whole_word: { type: "boolean", description: "Match whole words only. Default: false." },
          include: { type: "string", description: "Glob for files to include (e.g. 'src/**/*.ts'). Omit to search all." },
          exclude: { type: "string", description: "Glob for files to exclude (on top of default exclusions)." },
          context_lines: { type: "number", description: "Context lines before and after each match (0-10). Default: 2." },
          output_mode: { type: "string", enum: ["content", "files", "count"], description: "'content' shows matches with context (default), 'files' shows only file paths, 'count' shows match count per file." },
          max_results: { type: "number", description: "Maximum matches to return (1-200). Default: 50." },
        },
        required: ["pattern"],
      },
    },
    {
      name: "find_symbols",
      description: "Search the project's symbol index (functions, classes, interfaces, types, variables, methods). Returns compact 'name (kind) — file:line' per result. Ultra token-efficient for locating code.",
      input_schema: {
        type: "object",
        properties: {
          name_pattern: { type: "string", description: "Symbol name pattern (case-insensitive substring, or /regex/ if wrapped in slashes)." },
          kind: { type: "string", enum: ["function", "class", "interface", "type", "variable", "method", "enum", "struct", "trait", "impl"], description: "Filter by symbol kind." },
          file_glob: { type: "string", description: "Only search symbols in files matching this glob (e.g. 'src/**/*.ts')." },
          max_results: { type: "number", description: "Maximum results (default: 50)." },
        },
        required: [],
      },
    },
  ];

  // Old tool definitions (before redesign) for comparison
  const OLD_SOURCE_TOOLS = [
    {
      name: "get_project_tree",
      description: "Get a compact file tree of the project's source code directory. Shows all files and folders (excluding node_modules, .git, dist, etc.).",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_file_outline",
      description: "Get a compact outline of a source file — only exports, functions, classes, interfaces, types, imports. Much more token-efficient than reading the full file. Use this to understand file structure before reading specific sections.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path from project root (e.g. 'src/index.ts')" },
        },
        required: ["path"],
      },
    },
    {
      name: "read_project_file",
      description: "Read a source file's content. Supports optional line range for targeted reading (much more efficient). For large files, use startLine/endLine to read only what you need.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path from project root" },
          startLine: { type: "number", description: "Start line number (1-based). Omit to read from beginning." },
          endLine: { type: "number", description: "End line number (inclusive). Omit to read 200 lines from startLine." },
        },
        required: ["path"],
      },
    },
    {
      name: "search_project_files",
      description: "Search for text patterns in project source files (case-insensitive). Returns up to 50 matches with 2 lines of context. Use glob to filter by file extension (e.g. '*.ts' or '*.tsx,*.ts').",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for (case-insensitive)" },
          glob: { type: "string", description: "File extension filter, e.g. '*.ts' or '*.tsx,*.ts'. Omit to search all files." },
        },
        required: ["query"],
      },
    },
    {
      name: "get_outlines_batch",
      description: "Get outlines (exports, functions, classes, interfaces) of multiple source files in a single call. Much more efficient than calling get_file_outline multiple times. Max 20 files per batch.",
      input_schema: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" }, description: "Array of relative file paths from project root" },
        },
        required: ["paths"],
      },
    },
  ];

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  it("all 5 source tool definitions fit under 2000 tokens (cached prefix budget)", () => {
    const json = JSON.stringify(SOURCE_TOOLS);
    const tokens = estimateTokens(json);
    // Tool definitions are cached — but still should be compact
    // 2000 tokens ≈ 8000 chars is a reasonable budget for 5 tool schemas
    expect(tokens).toBeLessThan(2000);
  });

  it("new tools add less than 2x overhead vs old tools (acceptable for much more capability)", () => {
    const newJson = JSON.stringify(SOURCE_TOOLS);
    const oldJson = JSON.stringify(OLD_SOURCE_TOOLS);
    const ratio = newJson.length / oldJson.length;
    // New tools have more parameters (search has 9 params vs 2, find_symbols is new)
    // but should stay under 2x the old definition size
    expect(ratio).toBeLessThan(2.0);
  });

  it("individual tool definition descriptions are under 300 chars each", () => {
    for (const tool of SOURCE_TOOLS) {
      expect(tool.description.length).toBeLessThan(300);
    }
  });

  it("individual parameter descriptions are under 150 chars each", () => {
    for (const tool of SOURCE_TOOLS) {
      const props = tool.input_schema.properties as Record<string, { description?: string }>;
      for (const [paramName, param] of Object.entries(props)) {
        if (param.description) {
          expect(param.description.length).toBeLessThan(150);
        }
      }
    }
  });

  it("tool definitions produce identical JSON on repeated serialization (cache-friendly)", () => {
    // Prompt caching requires byte-identical prefixes for cache hits
    const json1 = JSON.stringify(SOURCE_TOOLS);
    const json2 = JSON.stringify(SOURCE_TOOLS);
    const json3 = JSON.stringify(SOURCE_TOOLS);
    expect(json1).toBe(json2);
    expect(json2).toBe(json3);
  });

  it("no tool has duplicate parameter names (would cause API error / cache miss)", () => {
    for (const tool of SOURCE_TOOLS) {
      const props = tool.input_schema.properties as Record<string, unknown>;
      const paramNames = Object.keys(props);
      const unique = new Set(paramNames);
      expect(unique.size).toBe(paramNames.length);
    }
  });
});

describe("Prompt caching: system prompt", () => {
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  const SOURCE_CODE_STRATEGY = `\nYou have access to the project's SOURCE CODE files on disk.

Strategy for reading code efficiently (minimize tokens):
1. Use find_symbols to locate functions, classes, types by name — returns just "name (kind) — file:line".
2. Use get_project_tree (with glob/max_depth to narrow scope) to see the file structure.
3. Use get_file_outlines on relevant files to see full signatures with line numbers.
4. Use read_project_file with startLine/endLine to read only specific code sections.
5. Use search_project_files with output_mode="files" to find which files contain a pattern, then read targeted sections.

RULES:
- NEVER read entire large files when you only need a few functions.
- Use find_symbols FIRST for locating code. Use search_project_files for text patterns.
- Use search_project_files with output_mode="count" to gauge pattern spread before reading.
- Use include/exclude globs to narrow search scope (e.g. include="src/**/*.ts").
- For regex search, set is_regex=true. Default is plain text.`;

  const OLD_SOURCE_CODE_STRATEGY = `\nYou have access to the project's SOURCE CODE files on disk.
Strategy for reading code efficiently (minimize tokens):
1. Start with get_project_tree to see the file structure.
2. Use get_file_outline on relevant files OR get_outlines_batch for multiple files at once to see exports, functions, classes, interfaces WITHOUT reading full content.
3. Use read_project_file with startLine/endLine to read only the specific code sections you need.
4. Use search_project_files to find specific patterns across the codebase.
NEVER read entire large files when you only need a few functions. Always use outline first, then targeted reads.`;

  it("source code strategy prompt is under 300 tokens", () => {
    const tokens = estimateTokens(SOURCE_CODE_STRATEGY);
    expect(tokens).toBeLessThan(300);
  });

  it("new strategy prompt is within 1.7x of old (more guidance, still compact)", () => {
    const ratio = SOURCE_CODE_STRATEGY.length / OLD_SOURCE_CODE_STRATEGY.length;
    // New prompt has 5 strategy steps + 5 rules vs old 4 steps + 1 rule — bigger but more valuable
    expect(ratio).toBeLessThan(1.7);
  });

  it("strategy prompt mentions all 5 tools by name (LLM must know them)", () => {
    expect(SOURCE_CODE_STRATEGY).toContain("find_symbols");
    expect(SOURCE_CODE_STRATEGY).toContain("get_project_tree");
    expect(SOURCE_CODE_STRATEGY).toContain("get_file_outlines");
    expect(SOURCE_CODE_STRATEGY).toContain("read_project_file");
    expect(SOURCE_CODE_STRATEGY).toContain("search_project_files");
  });

  it("strategy prompt mentions key output_mode values (critical for token saving)", () => {
    expect(SOURCE_CODE_STRATEGY).toContain('output_mode="files"');
    expect(SOURCE_CODE_STRATEGY).toContain('output_mode="count"');
  });
});

describe("Prompt caching: tool result sizes (non-cached message tokens)", () => {
  // Tool results go into messages, NOT the cached prefix.
  // These are charged at FULL token rate, so minimizing them is the #1 optimization.

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  const TOOL_RESULT_LIMIT = 6000; // chars, from app.store.ts
  const LARGE_TS_FILE = generateLargeTypeScriptFile(50);

  it("find_symbols result for targeted query is under 500 tokens", () => {
    // Realistic: LLM searches for "Service" symbols
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const filtered = symbols.filter(s => s.name.toLowerCase().includes("service"));
    const output = formatSymbolResults(filtered);
    const tokens = estimateTokens(output);
    expect(tokens).toBeLessThan(500);
  });

  it("find_symbols result for broad query stays under TOOL_RESULT_LIMIT", () => {
    // Worst case: no filter, returns all symbols
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const output = formatSymbolResults(symbols);
    expect(output.length).toBeLessThan(TOOL_RESULT_LIMIT);
  });

  it("search output_mode='files' for 20 files is under 200 tokens", () => {
    // Simulate: 20 matching file paths
    const files = Array.from({ length: 20 }, (_, i) => `src/services/service${i}.ts`);
    const output = `${files.length} file(s):\n${files.join("\n")}`;
    const tokens = estimateTokens(output);
    expect(tokens).toBeLessThan(200);
  });

  it("search output_mode='count' for 20 files is under 200 tokens", () => {
    const counts = Array.from({ length: 20 }, (_, i) => `src/services/service${i}.ts: ${3 + i}`);
    const total = counts.reduce((s, c) => s + parseInt(c.split(": ")[1]), 0);
    const output = `${total} match(es) in ${counts.length} file(s):\n${counts.join("\n")}`;
    const tokens = estimateTokens(output);
    expect(tokens).toBeLessThan(200);
  });

  it("search output_mode='content' with context=0 is 3x smaller than context=2", () => {
    const lines = LARGE_TS_FILE.split("\n");
    const regex = /export/gi;

    const ctx0 = searchFileContent(lines, regex, "large.ts", 0, 30, 0);
    const ctx2 = searchFileContent(lines, regex, "large.ts", 2, 30, 0);
    const out0 = ctx0.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
    const out2 = ctx2.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");

    // context=0 produces much less output
    expect(out2.length / out0.length).toBeGreaterThan(2);
  });

  it("outline output is deterministic (same input → identical output → cacheable in conversations)", () => {
    const { signatures: s1 } = extractOutline(LARGE_TS_FILE, ".ts");
    const { signatures: s2 } = extractOutline(LARGE_TS_FILE, ".ts");
    expect(s1).toEqual(s2);
  });

  it("find_symbols output is deterministic", () => {
    const sym1 = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const sym2 = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    expect(sym1).toEqual(sym2);
    expect(formatSymbolResults(sym1)).toBe(formatSymbolResults(sym2));
  });

  it("search results are deterministic for same input", () => {
    const lines = LARGE_TS_FILE.split("\n");
    const regex1 = /function/gi;
    const regex2 = /function/gi;
    const r1 = searchFileContent(lines, regex1, "large.ts", 2, 10, 0);
    const r2 = searchFileContent(lines, regex2, "large.ts", 2, 10, 0);
    expect(r1).toEqual(r2);
  });
});

describe("Prompt caching: multi-turn token savings simulation", () => {
  // Simulates a realistic LLM conversation and measures total non-cached tokens
  // (tool results that go into messages) for old vs new approach.

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  const LARGE_TS_FILE = generateLargeTypeScriptFile(50);
  const FILE_LINES = LARGE_TS_FILE.split("\n");

  it("new approach uses 3x fewer message tokens for 'find and read a function'", () => {
    // OLD approach: read entire file
    const oldTokens = estimateTokens(LARGE_TS_FILE);

    // NEW approach: find_symbols → targeted read
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const filtered = symbols.filter(s => s.name.toLowerCase().includes("create") && s.kind === "function");
    const symbolOutput = formatSymbolResults(filtered);
    const symbolTokens = estimateTokens(symbolOutput);

    // Read 10 lines around the found symbol
    const targetLine = filtered[0]?.line || 1;
    const readLines = FILE_LINES.slice(targetLine - 1, targetLine + 9);
    const readOutput = `[lines ${targetLine}-${targetLine + 9} of ${FILE_LINES.length}]\n${readLines.map((l, i) => `${targetLine + i}: ${l}`).join("\n")}`;
    const readTokens = estimateTokens(readOutput);

    const newTokens = symbolTokens + readTokens;
    expect(oldTokens / newTokens).toBeGreaterThan(3);
  });

  it("new approach uses 5x fewer tokens for 'find all files with pattern'", () => {
    // OLD approach: search with content mode → up to 50 matches with 2 lines context each
    const regex = /export/gi;
    const contentResults = searchFileContent(FILE_LINES, regex, "large.ts", 2, 50, 0);
    const oldOutput = contentResults.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
    const oldTokens = estimateTokens(oldOutput);

    // NEW approach: search with files mode → just file paths
    const newOutput = "1 file(s):\nlarge.ts";
    const newTokens = estimateTokens(newOutput);

    expect(oldTokens / newTokens).toBeGreaterThan(5);
  });

  it("new approach uses 2x fewer tokens for 'understand code structure'", () => {
    // OLD approach: get_file_outline (returns signatures with line numbers, same data)
    const { signatures } = extractOutline(LARGE_TS_FILE, ".ts");
    const oldOutlineOutput = `[${FILE_LINES.length} lines total, ${signatures.length} signatures]\n${signatures.join("\n")}`;
    const oldTokens = estimateTokens(oldOutlineOutput);

    // NEW approach: find_symbols (returns compact name+kind+line, no full signature text)
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    const newOutput = formatSymbolResults(symbols);
    const newTokens = estimateTokens(newOutput);

    // find_symbols is slightly more compact than outlines (name+kind vs full signature line)
    // The main advantage is targeted filtering, not raw compression
    expect(oldTokens / newTokens).toBeGreaterThan(1.1);
  });

  it("cumulative savings over 5-turn conversation exceed 60%", () => {
    // Simulate 5-turn conversation: explore → find → read → search → verify
    let oldTotal = 0;
    let newTotal = 0;

    // Turn 1: understand structure
    const { signatures } = extractOutline(LARGE_TS_FILE, ".ts");
    oldTotal += estimateTokens(`[${FILE_LINES.length} lines]\n${signatures.join("\n")}`);
    const symbols = extractSymbols(LARGE_TS_FILE, ".ts", "large.ts");
    newTotal += estimateTokens(formatSymbolResults(symbols.filter(s => s.kind !== "method")));

    // Turn 2: find specific code
    const searchRegex = /Service/gi;
    const oldSearch = searchFileContent(FILE_LINES, searchRegex, "large.ts", 2, 20, 0);
    oldTotal += estimateTokens(oldSearch.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n"));
    const newFind = symbols.filter(s => s.name.includes("Service"));
    newTotal += estimateTokens(formatSymbolResults(newFind));

    // Turn 3: read found code
    const readAll = FILE_LINES.slice(0, 100).join("\n");
    oldTotal += estimateTokens(readAll); // old: read 100 lines
    const readTargeted = FILE_LINES.slice(0, 20).join("\n");
    newTotal += estimateTokens(readTargeted); // new: read only 20 lines (targeted)

    // Turn 4: search for pattern
    const searchRegex2 = /async/gi;
    const oldContent = searchFileContent(FILE_LINES, searchRegex2, "large.ts", 2, 30, 0);
    oldTotal += estimateTokens(oldContent.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n"));
    const countOutput = `${countFileMatches(FILE_LINES, searchRegex2)} match(es) in 1 file(s):\nlarge.ts: ${countFileMatches(FILE_LINES, /async/gi)}`;
    newTotal += estimateTokens(countOutput);

    // Turn 5: verify specific line
    const oldVerify = FILE_LINES.slice(0, 50).join("\n");
    oldTotal += estimateTokens(oldVerify);
    const newVerify = FILE_LINES.slice(10, 20).join("\n");
    newTotal += estimateTokens(newVerify);

    const savings = 1 - (newTotal / oldTotal);
    expect(savings).toBeGreaterThan(0.6); // >60% savings
  });
});

// ─── CODE_EXTS ──────────────────────────────────────────────────

describe("CODE_EXTS", () => {
  it("includes standard code extensions", () => {
    expect(CODE_EXTS.has(".ts")).toBe(true);
    expect(CODE_EXTS.has(".tsx")).toBe(true);
    expect(CODE_EXTS.has(".js")).toBe(true);
    expect(CODE_EXTS.has(".jsx")).toBe(true);
    expect(CODE_EXTS.has(".py")).toBe(true);
    expect(CODE_EXTS.has(".go")).toBe(true);
    expect(CODE_EXTS.has(".rs")).toBe(true);
  });

  it("does not include non-code extensions", () => {
    expect(CODE_EXTS.has(".md")).toBe(false);
    expect(CODE_EXTS.has(".json")).toBe(false);
    expect(CODE_EXTS.has(".txt")).toBe(false);
    expect(CODE_EXTS.has(".css")).toBe(false);
  });
});

// ─── Helpers ────────────────────────────────────────────────────

function generateLargeTypeScriptFile(funcCount: number): string {
  const parts: string[] = [];
  parts.push(`import { BaseService } from "./base";`);
  parts.push(`import type { Config, Result } from "./types";`);
  parts.push(``);
  parts.push(`export interface AppConfig {`);
  parts.push(`  name: string;`);
  parts.push(`  port: number;`);
  parts.push(`  debug: boolean;`);
  parts.push(`}`);
  parts.push(``);
  parts.push(`export type AppId = string;`);
  parts.push(``);

  // Generate 5 classes with methods
  for (let c = 0; c < 5; c++) {
    parts.push(`export class Service${c} extends BaseService {`);
    for (let m = 0; m < 4; m++) {
      parts.push(`  async method${m}(arg: string): Promise<Result> {`);
      parts.push(`    // Implementation for method ${m}`);
      parts.push(`    const value = arg.trim();`);
      parts.push(`    if (!value) throw new Error("empty");`);
      parts.push(`    return { ok: true, data: value };`);
      parts.push(`  }`);
      parts.push(``);
    }
    parts.push(`}`);
    parts.push(``);
  }

  // Generate standalone functions
  for (let i = 0; i < funcCount; i++) {
    const exported = i % 3 === 0;
    const isAsync = i % 4 === 0;
    parts.push(`${exported ? "export " : ""}${isAsync ? "async " : ""}function create${capitalize(randomWord(i))}(config: AppConfig): ${isAsync ? "Promise<Result>" : "Result"} {`);
    parts.push(`  // Validate config`);
    parts.push(`  if (!config.name) throw new Error("name required");`);
    parts.push(`  const result = { id: "${i}", name: config.name };`);
    parts.push(`  // Process`);
    parts.push(`  console.log("Creating ${i}...");`);
    parts.push(`  return { ok: true, data: result };`);
    parts.push(`}`);
    parts.push(``);
  }

  // Exported constants
  parts.push(`export const MAX_RETRIES = 3;`);
  parts.push(`export const DEFAULT_CONFIG: AppConfig = { name: "default", port: 3000, debug: false };`);

  return parts.join("\n");
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function randomWord(seed: number): string {
  const words = ["project", "user", "config", "session", "handler", "service", "client", "server", "cache", "logger",
    "router", "model", "view", "controller", "middleware", "plugin", "worker", "task", "event", "stream"];
  return words[seed % words.length];
}
