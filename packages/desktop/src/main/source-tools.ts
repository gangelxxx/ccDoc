/**
 * Pure functions for source code analysis — extracting outlines, symbols, and search helpers.
 * Extracted from index.ts for testability.
 */

export const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".go", ".rs"]);

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractOutline(content: string, ext: string): { lineCount: number; signatures: string[] } {
  const lines = content.split("\n");
  const result: string[] = [];
  if ([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"].includes(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(export\s+)?(default\s+)?(async\s+)?function\s/.test(line) ||
          /^\s*(export\s+)?(default\s+)?class\s/.test(line) ||
          /^\s*(export\s+)?(type|interface)\s/.test(line) ||
          /^\s*export\s+(default\s+)?(const|let|var)\s/.test(line) ||
          /^\s*export\s+\{/.test(line) ||
          /^\s*export\s+\*/.test(line) ||
          /^\s*import\s/.test(line)) {
        result.push(`${i + 1}: ${line}`);
      }
    }
  } else if (ext === ".py") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(class|def|async\s+def)\s/.test(line) || /^(from|import)\s/.test(line)) {
        result.push(`${i + 1}: ${line}`);
      }
    }
  } else if (ext === ".go") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(func|type|package|import)\s/.test(line)) {
        result.push(`${i + 1}: ${line}`);
      }
    }
  } else if (ext === ".rs") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(pub\s+)?(fn|struct|enum|trait|impl|mod|use)\s/.test(line)) {
        result.push(`${i + 1}: ${line}`);
      }
    }
  }
  return { lineCount: lines.length, signatures: result };
}

export type SymbolKind = "function" | "class" | "interface" | "type" | "variable" | "method" | "enum" | "struct" | "trait" | "impl" | "module";
export interface SymbolEntry { name: string; kind: SymbolKind; file: string; line: number; exported: boolean; }

export function extractSymbols(content: string, ext: string, filePath: string): SymbolEntry[] {
  const lines = content.split("\n");
  const symbols: SymbolEntry[] = [];
  let inClass = false;

  if ([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"].includes(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpMatchArray | null;
      // function
      if ((m = line.match(/^\s*(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)/))) {
        symbols.push({ name: m[4], kind: "function", file: filePath, line: i + 1, exported: !!m[1] });
        continue;
      }
      // class
      if ((m = line.match(/^\s*(export\s+)?(default\s+)?class\s+(\w+)/))) {
        symbols.push({ name: m[3], kind: "class", file: filePath, line: i + 1, exported: !!m[1] });
        inClass = true;
        continue;
      }
      // interface
      if ((m = line.match(/^\s*(export\s+)?interface\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "interface", file: filePath, line: i + 1, exported: !!m[1] });
        continue;
      }
      // type alias
      if ((m = line.match(/^\s*(export\s+)?type\s+(\w+)\s*[=<{]/))) {
        symbols.push({ name: m[2], kind: "type", file: filePath, line: i + 1, exported: !!m[1] });
        continue;
      }
      // enum
      if ((m = line.match(/^\s*(export\s+)?(const\s+)?enum\s+(\w+)/))) {
        symbols.push({ name: m[3], kind: "enum", file: filePath, line: i + 1, exported: !!m[1] });
        continue;
      }
      // exported variable
      if ((m = line.match(/^\s*export\s+(default\s+)?(const|let|var)\s+(\w+)/))) {
        symbols.push({ name: m[3], kind: "variable", file: filePath, line: i + 1, exported: true });
        continue;
      }
      // method (indented, inside class)
      if (inClass && (m = line.match(/^\s{2,}(static\s+)?(async\s+)?(get\s+|set\s+)?(\w+)\s*\(/))) {
        const name = m[4];
        if (name !== "constructor" && name !== "if" && name !== "for" && name !== "while" && name !== "switch") {
          symbols.push({ name, kind: "method", file: filePath, line: i + 1, exported: false });
        }
      }
      // Track class end (heuristic: line starting with })
      if (inClass && /^\}/.test(line)) inClass = false;
    }
  } else if (ext === ".py") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^class\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: "class", file: filePath, line: i + 1, exported: !m[1].startsWith("_") });
      } else if ((m = line.match(/^(async\s+)?def\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "function", file: filePath, line: i + 1, exported: !m[2].startsWith("_") });
      } else if ((m = line.match(/^\s+(async\s+)?def\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "method", file: filePath, line: i + 1, exported: !m[2].startsWith("_") });
      }
    }
  } else if (ext === ".go") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^func\s+(?:\(.*?\)\s+)?(\w+)/))) {
        symbols.push({ name: m[1], kind: "function", file: filePath, line: i + 1, exported: /^[A-Z]/.test(m[1]) });
      } else if ((m = line.match(/^type\s+(\w+)\s+(struct|interface)/))) {
        symbols.push({ name: m[1], kind: m[2] as SymbolKind, file: filePath, line: i + 1, exported: /^[A-Z]/.test(m[1]) });
      }
    }
  } else if (ext === ".rs") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^\s*(pub\s+)?fn\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "function", file: filePath, line: i + 1, exported: !!m[1] });
      } else if ((m = line.match(/^\s*(pub\s+)?struct\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "struct", file: filePath, line: i + 1, exported: !!m[1] });
      } else if ((m = line.match(/^\s*(pub\s+)?enum\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "enum", file: filePath, line: i + 1, exported: !!m[1] });
      } else if ((m = line.match(/^\s*(pub\s+)?trait\s+(\w+)/))) {
        symbols.push({ name: m[2], kind: "trait", file: filePath, line: i + 1, exported: !!m[1] });
      } else if ((m = line.match(/^\s*impl\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: "impl", file: filePath, line: i + 1, exported: false });
      }
    }
  }
  return symbols;
}

/**
 * Build grep-like search output.
 * Pure function — given file lines and a regex, produces match results.
 */
export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export function searchFileContent(
  fileLines: string[],
  regex: RegExp,
  filePath: string,
  ctxLines: number,
  maxResults: number,
  currentCount: number,
): SearchMatch[] {
  const matchIndices: number[] = [];
  for (let i = 0; i < fileLines.length; i++) {
    regex.lastIndex = 0;
    if (regex.test(fileLines[i])) matchIndices.push(i);
  }
  if (matchIndices.length === 0) return [];

  // Merge overlapping context ranges
  const ranges: { start: number; end: number; matchLines: Set<number> }[] = [];
  for (const idx of matchIndices) {
    const rStart = Math.max(0, idx - ctxLines);
    const rEnd = Math.min(fileLines.length, idx + ctxLines + 1);
    const last = ranges[ranges.length - 1];
    if (last && rStart <= last.end) {
      last.end = Math.max(last.end, rEnd);
      last.matchLines.add(idx);
    } else {
      ranges.push({ start: rStart, end: rEnd, matchLines: new Set([idx]) });
    }
  }

  const matches: SearchMatch[] = [];
  for (const range of ranges) {
    if (currentCount + matches.length >= maxResults) break;
    const snippet = fileLines.slice(range.start, range.end)
      .map((l, j) => `${range.start + j + 1}${range.matchLines.has(range.start + j) ? ">" : ":"} ${l}`)
      .join("\n");
    const firstMatch = Math.min(...range.matchLines) + 1;
    matches.push({ file: filePath, line: firstMatch, text: snippet });
  }
  return matches;
}

/**
 * Count matches per file (for output_mode="count").
 */
export function countFileMatches(fileLines: string[], regex: RegExp): number {
  let count = 0;
  for (const line of fileLines) {
    regex.lastIndex = 0;
    if (regex.test(line)) count++;
  }
  return count;
}

/**
 * Build a compiled search regex from user options.
 */
export function buildSearchRegex(opts: {
  pattern: string;
  is_regex?: boolean;
  case_sensitive?: boolean;
  whole_word?: boolean;
}): RegExp {
  let patternStr = opts.is_regex ? opts.pattern : escapeRegex(opts.pattern);
  if (opts.whole_word) patternStr = `\\b${patternStr}\\b`;
  const flags = opts.case_sensitive ? "g" : "gi";
  return new RegExp(patternStr, flags);
}

/**
 * Format find_symbols output — compact "name (kind) — file:line" format.
 */
export function formatSymbolResults(symbols: SymbolEntry[]): string {
  if (symbols.length === 0) return "No symbols found.";
  return `${symbols.length} symbol(s):\n` + symbols.map(s =>
    `${s.exported ? "⊕ " : "  "}${s.name} (${s.kind}) — ${s.file}:${s.line}`
  ).join("\n");
}
