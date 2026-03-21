import { ipcMain } from "electron";
import { join, basename, extname, resolve } from "path";
import { readFileSync, existsSync, statSync } from "fs";
import { readdir } from "fs/promises";
import picomatch from "picomatch";
import { escapeRegex, extractOutline, extractSymbols, CODE_EXTS } from "../source-tools";
import type { SymbolEntry } from "../source-tools";
import { getProjectsService } from "../services";

// ── Constants ──────────────────────────────────────────────────────

const SOURCE_EXCLUDED = new Set(["node_modules", ".git", ".ccdoc", "dist", "build", ".next", "vendor", "__pycache__", ".vscode", ".idea", ".svn", "coverage", ".nyc_output", ".cache", ".turbo", "release", "out", ".output", "logs"]);
const SOURCE_SENSITIVE = new Set([".env", ".env.local", ".env.production"]);
const SOURCE_SENSITIVE_EXT = new Set([".key", ".pem", ".p12", ".pfx", ".jks"]);
const SOURCE_BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg", ".mp3", ".mp4", ".wav", ".avi", ".mov", ".zip", ".tar", ".gz", ".rar", ".7z", ".pdf", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".pyc", ".class", ".sqlite", ".db", ".pak", ".asar", ".node", ".map"]);
const MAX_FILE_SIZE = 500 * 1024; // 500KB
const SOURCE_CACHE_TTL = 30_000; // 30 seconds
const SYMBOLS_CACHE_TTL = 60_000; // 60 seconds for symbol index

// ── Helpers ────────────────────────────────────────────────────────

function isInsideProject(projectPath: string, filePath: string): boolean {
  const resolved = resolve(projectPath, filePath);
  return resolved.startsWith(projectPath + "\\") || resolved.startsWith(projectPath + "/") || resolved === projectPath;
}

function isSensitiveFile(name: string): boolean {
  if (SOURCE_SENSITIVE.has(name.toLowerCase())) return true;
  const ext = extname(name).toLowerCase();
  if (SOURCE_SENSITIVE_EXT.has(ext)) return true;
  if (name.toLowerCase().startsWith("credentials")) return true;
  return false;
}

function isBinaryFile(name: string): boolean {
  return SOURCE_BINARY_EXT.has(extname(name).toLowerCase());
}

// Shared file walker -- collects relative paths of eligible source files
async function walkSourceFiles(
  rootDir: string,
  opts?: { includeMatcher?: (path: string) => boolean; excludeMatcher?: (path: string) => boolean; maxDepth?: number },
): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, relBase: string, depth: number) {
    if (opts?.maxDepth !== undefined && depth > opts.maxDepth) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    const dirs: string[] = [];
    const fileNames: string[] = [];
    for (const e of entries) {
      if (e.isDirectory() && !SOURCE_EXCLUDED.has(e.name)) dirs.push(e.name);
      else if (e.isFile()) fileNames.push(e.name);
    }
    dirs.sort();
    fileNames.sort();
    for (const d of dirs) {
      await walk(join(dir, d), relBase ? `${relBase}/${d}` : d, depth + 1);
    }
    for (const f of fileNames) {
      if (isBinaryFile(f)) continue;
      if (isSensitiveFile(f)) continue;
      const rel = relBase ? `${relBase}/${f}` : f;
      if (opts?.includeMatcher && !opts.includeMatcher(rel)) continue;
      if (opts?.excludeMatcher && opts.excludeMatcher(rel)) continue;
      files.push(rel);
    }
  }
  await walk(rootDir, "", 0);
  return files;
}

// ── Source cache ────────────────────────────────────────────────────

const sourceCache = new Map<string, {
  trees: Map<string, { data: string; ts: number }>;
  outlines: Map<string, { data: string; ts: number }>;
  symbols?: { entries: SymbolEntry[]; ts: number };
}>();

function getProjectCache(projectPath: string) {
  if (!sourceCache.has(projectPath)) sourceCache.set(projectPath, { trees: new Map(), outlines: new Map() });
  return sourceCache.get(projectPath)!;
}

// ── IPC registration ───────────────────────────────────────────────

export function registerSourceCodeIpc(): void {
  // source:tree -- compact file tree (with caching, glob filtering, depth limit)
  ipcMain.handle("source:tree", async (_e, token: string, glob?: string, maxDepth?: number) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");

    // Check cache (keyed by glob|maxDepth)
    const cache = getProjectCache(project.path);
    const now = Date.now();
    const cacheKey = `${glob || "*"}|${maxDepth ?? "inf"}`;
    const cached = cache.trees.get(cacheKey);
    if (cached && (now - cached.ts) < SOURCE_CACHE_TTL) return cached.data;

    const matcher = glob ? picomatch(glob) : null;

    // Build tree as intermediate structure, then render (to support pruning empty dirs)
    interface TreeNode { name: string; isDir: boolean; children: TreeNode[] }

    async function walk(dir: string, relBase: string, depth: number): Promise<TreeNode[]> {
      if (maxDepth !== undefined && depth > maxDepth) return [];
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
      const nodes: TreeNode[] = [];
      const dirNames: string[] = [];
      const fileNames: string[] = [];
      for (const e of entries) {
        if (e.isDirectory() && !SOURCE_EXCLUDED.has(e.name)) dirNames.push(e.name);
        else if (e.isFile()) fileNames.push(e.name);
      }
      dirNames.sort();
      fileNames.sort();
      for (const d of dirNames) {
        const children = await walk(join(dir, d), relBase ? `${relBase}/${d}` : d, depth + 1);
        // If glob is active, prune empty directories (no matching descendants)
        if (matcher && children.length === 0) continue;
        nodes.push({ name: d, isDir: true, children });
      }
      for (const f of fileNames) {
        const rel = relBase ? `${relBase}/${f}` : f;
        if (matcher && !matcher(rel)) continue;
        nodes.push({ name: f, isDir: false, children: [] });
      }
      return nodes;
    }

    function render(nodes: TreeNode[], prefix: string): string[] {
      const lines: string[] = [];
      for (const n of nodes) {
        if (n.isDir) {
          lines.push(`${prefix}${n.name}/`);
          lines.push(...render(n.children, prefix + "  "));
        } else {
          lines.push(`${prefix}${n.name}`);
        }
      }
      return lines;
    }

    const tree = await walk(project.path, "", 0);
    const result = render(tree, "").join("\n");
    cache.trees.set(cacheKey, { data: result, ts: now });
    return result;
  });

  // source:outlines -- get outlines for one or more files (merged outline + outlines-batch)
  ipcMain.handle("source:outlines", async (_e, token: string, paths: string[]) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");
    const cache = getProjectCache(project.path);
    const now = Date.now();

    const results: Record<string, string> = {};
    for (const relativePath of paths.slice(0, 20)) {
      // Check cache first
      const cached = cache.outlines.get(relativePath);
      if (cached && (now - cached.ts) < SOURCE_CACHE_TTL) {
        results[relativePath] = cached.data;
        continue;
      }
      if (!isInsideProject(project.path, relativePath)) { results[relativePath] = "[access denied]"; continue; }
      const abs = resolve(project.path, relativePath);
      if (!existsSync(abs)) { results[relativePath] = "[not found]"; continue; }
      if (isBinaryFile(relativePath)) { results[relativePath] = "[binary]"; continue; }
      const st = statSync(abs);
      if (st.size > MAX_FILE_SIZE * 5) { results[relativePath] = `[too large: ${(st.size / 1024).toFixed(0)}KB]`; continue; }

      const content = readFileSync(abs, "utf-8");
      const ext = extname(relativePath).toLowerCase();

      if (CODE_EXTS.has(ext)) {
        const { lineCount, signatures } = extractOutline(content, ext);
        const outline = signatures.length > 0
          ? `[${lineCount} lines, ${signatures.length} signatures]\n${signatures.join("\n")}`
          : `[${lineCount} lines, no signatures]`;
        cache.outlines.set(relativePath, { data: outline, ts: now });
        results[relativePath] = outline;
      } else {
        // Unknown file type -- preview first 30 lines
        const lines = content.split("\n");
        results[relativePath] = `[preview, ${lines.length} lines total]\n${lines.slice(0, 30).join("\n")}`;
      }
    }
    return results;
  });

  // source:read -- read file with optional line range
  ipcMain.handle("source:read", async (_e, token: string, relativePath: string, startLine?: number, endLine?: number) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");
    if (!isInsideProject(project.path, relativePath)) throw new Error("Access denied");

    const abs = resolve(project.path, relativePath);
    if (!existsSync(abs)) throw new Error("File not found");
    if (isBinaryFile(relativePath)) return "[binary file]";
    if (isSensitiveFile(basename(relativePath))) return "[sensitive file -- access denied]";

    const st = statSync(abs);
    if (st.size > MAX_FILE_SIZE && !startLine) return `[file too large: ${(st.size / 1024).toFixed(0)}KB -- use startLine/endLine to read a range]`;

    const content = readFileSync(abs, "utf-8");
    const lines = content.split("\n");

    if (startLine !== undefined) {
      const start = Math.max(0, (startLine || 1) - 1);
      const end = endLine ? Math.min(lines.length, endLine) : Math.min(lines.length, start + 200);
      const slice = lines.slice(start, end);
      return `[lines ${start + 1}-${end} of ${lines.length}]\n${slice.map((l, i) => `${start + i + 1}: ${l}`).join("\n")}`;
    }

    return `[${lines.length} lines]\n${content}`;
  });

  // source:search -- grep-like search in project files
  ipcMain.handle("source:search", async (_e, token: string, opts: {
    pattern: string;
    is_regex?: boolean;
    case_sensitive?: boolean;
    whole_word?: boolean;
    include?: string;
    exclude?: string;
    context_lines?: number;
    output_mode?: "content" | "files" | "count";
    max_results?: number;
  }) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");

    // Build regex
    let patternStr = opts.is_regex ? opts.pattern : escapeRegex(opts.pattern);
    if (opts.whole_word) patternStr = `\\b${patternStr}\\b`;
    const flags = opts.case_sensitive ? "g" : "gi";
    let regex: RegExp;
    try { regex = new RegExp(patternStr, flags); } catch (e: any) {
      return `Invalid regex: ${e.message}`;
    }

    // Build file matchers
    const includeMatcher = opts.include ? picomatch(opts.include) : undefined;
    const excludeMatcher = opts.exclude ? picomatch(opts.exclude) : undefined;

    const outputMode = opts.output_mode || "content";
    const maxResults = Math.min(Math.max(opts.max_results || 50, 1), 200);
    const ctxLines = Math.min(Math.max(opts.context_lines ?? 2, 0), 10);

    // Collect files
    const files = await walkSourceFiles(project.path, { includeMatcher, excludeMatcher });

    if (outputMode === "files") {
      // Return only file paths containing matches
      const matchingFiles: string[] = [];
      for (const rel of files) {
        if (matchingFiles.length >= maxResults) break;
        const abs = join(project.path, rel);
        try {
          const st = statSync(abs);
          if (st.size > MAX_FILE_SIZE) continue;
          const content = readFileSync(abs, "utf-8");
          regex.lastIndex = 0;
          if (regex.test(content)) matchingFiles.push(rel);
        } catch { /* skip */ }
      }
      if (matchingFiles.length === 0) return "No matches found.";
      return `${matchingFiles.length} file(s):\n${matchingFiles.join("\n")}`;
    }

    if (outputMode === "count") {
      // Return match counts per file
      const counts: { file: string; count: number }[] = [];
      let total = 0;
      for (const rel of files) {
        const abs = join(project.path, rel);
        try {
          const st = statSync(abs);
          if (st.size > MAX_FILE_SIZE) continue;
          const content = readFileSync(abs, "utf-8");
          const fileLines = content.split("\n");
          let count = 0;
          for (const line of fileLines) {
            regex.lastIndex = 0;
            if (regex.test(line)) count++;
          }
          if (count > 0) {
            counts.push({ file: rel, count });
            total += count;
          }
        } catch { /* skip */ }
      }
      if (counts.length === 0) return "No matches found.";
      counts.sort((a, b) => b.count - a.count);
      const limited = counts.slice(0, maxResults);
      return `${total} match(es) in ${counts.length} file(s):\n${limited.map(c => `${c.file}: ${c.count}`).join("\n")}`;
    }

    // outputMode === "content" -- matches with context
    const matches: { file: string; line: number; text: string }[] = [];
    for (const rel of files) {
      if (matches.length >= maxResults) break;
      const abs = join(project.path, rel);
      try {
        const st = statSync(abs);
        if (st.size > MAX_FILE_SIZE) continue;
        const content = readFileSync(abs, "utf-8");
        const fileLines = content.split("\n");
        // Find all matching line indices
        const matchIndices: number[] = [];
        for (let i = 0; i < fileLines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(fileLines[i])) matchIndices.push(i);
        }
        if (matchIndices.length === 0) continue;
        // Merge overlapping context ranges
        const ranges: { start: number; end: number; matchLines: Set<number> }[] = [];
        for (const idx of matchIndices) {
          const rStart = Math.max(0, idx - ctxLines);
          const rEnd = Math.min(fileLines.length, idx + ctxLines + 1);
          const last = ranges[ranges.length - 1];
          if (last && rStart <= last.end) {
            // Merge with previous range
            last.end = Math.max(last.end, rEnd);
            last.matchLines.add(idx);
          } else {
            ranges.push({ start: rStart, end: rEnd, matchLines: new Set([idx]) });
          }
        }
        // Emit merged ranges
        for (const range of ranges) {
          if (matches.length >= maxResults) break;
          const snippet = fileLines.slice(range.start, range.end)
            .map((l, j) => `${range.start + j + 1}${range.matchLines.has(range.start + j) ? ">" : ":"} ${l}`)
            .join("\n");
          const firstMatch = Math.min(...range.matchLines) + 1;
          matches.push({ file: rel, line: firstMatch, text: snippet });
        }
      } catch { /* skip */ }
    }
    if (matches.length === 0) return "No matches found.";
    return matches.map(m => `--- ${m.file}:${m.line} ---\n${m.text}`).join("\n\n");
  });

  // source:find-symbols -- search project symbol index
  ipcMain.handle("source:find-symbols", async (_e, token: string, opts: {
    name_pattern?: string;
    kind?: string;
    file_glob?: string;
    max_results?: number;
  }) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");

    // Build or use cached symbol index
    const cache = getProjectCache(project.path);
    const now = Date.now();
    if (!cache.symbols || (now - cache.symbols.ts) >= SYMBOLS_CACHE_TTL) {
      const allSymbols: SymbolEntry[] = [];
      const files = await walkSourceFiles(project.path);
      for (const rel of files) {
        const ext = extname(rel).toLowerCase();
        if (!CODE_EXTS.has(ext)) continue;
        const abs = join(project.path, rel);
        try {
          const st = statSync(abs);
          if (st.size > MAX_FILE_SIZE * 5) continue;
          const content = readFileSync(abs, "utf-8");
          allSymbols.push(...extractSymbols(content, ext, rel));
        } catch { /* skip */ }
      }
      cache.symbols = { entries: allSymbols, ts: now };
    }

    let results = cache.symbols.entries;

    // Filter by kind
    if (opts.kind) {
      results = results.filter(s => s.kind === opts.kind);
    }

    // Filter by file glob
    if (opts.file_glob) {
      const matcher = picomatch(opts.file_glob);
      results = results.filter(s => matcher(s.file));
    }

    // Filter by name pattern
    if (opts.name_pattern) {
      if (opts.name_pattern.startsWith("/") && opts.name_pattern.endsWith("/")) {
        // Regex mode
        try {
          const regex = new RegExp(opts.name_pattern.slice(1, -1), "i");
          results = results.filter(s => regex.test(s.name));
        } catch { return "Invalid regex pattern."; }
      } else {
        // Substring match (case-insensitive)
        const lower = opts.name_pattern.toLowerCase();
        results = results.filter(s => s.name.toLowerCase().includes(lower));
      }
    }

    const max = Math.min(opts.max_results || 50, 200);
    results = results.slice(0, max);

    if (results.length === 0) return "No symbols found.";
    return `${results.length} symbol(s):\n` + results.map(s =>
      `${s.exported ? "\u2295 " : "  "}${s.name} (${s.kind}) \u2014 ${s.file}:${s.line}`
    ).join("\n");
  });
}
