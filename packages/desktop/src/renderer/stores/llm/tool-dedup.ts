/**
 * Tracks tool call history within an LLM session to detect and block
 * redundant searches, overlapping file reads, and duplicate patterns.
 *
 * Dedup policy:
 * - Exact duplicate search: BLOCK
 * - Pattern searched with broader glob: BLOCK
 * - Same pattern searched 2+ times with any glob: BLOCK
 * - Cross-tool redundancy (search after find_symbols): WARN then BLOCK
 * - Overlapping glob for same pattern: WARN then BLOCK
 * - Overlapping/adjacent file reads: WARN with merged range
 */

// -- Types ------------------------------------------------------------------

interface SearchRecord {
  tool: string; // search_project_files | find_symbols | search | semantic_search
  pattern: string; // normalized (trimmed, lowercased)
  glob: string | null;
  round: number;
}

interface ReadRecord {
  path: string;
  startLine: number;
  endLine: number;
  round: number;
}

type DedupAction = "allow" | "warn" | "block";

export interface DedupResult {
  action: DedupAction;
  message?: string;
  mergedInput?: { startLine: number; endLine: number };
}

// -- Tracker ----------------------------------------------------------------

export class ToolDedupTracker {
  private searchHistory: SearchRecord[] = [];
  private readHistory: ReadRecord[] = [];
  private warnKeys = new Set<string>();
  private _readOnlyRounds = 0;

  // --- Search dedup --------------------------------------------------------

  checkSearch(tool: string, input: Record<string, any>, round: number): DedupResult {
    const pattern = normalizePattern(tool, input);
    if (!pattern) return { action: "allow" };

    const glob: string | null = input.include || input.file_glob || null;

    // 1. Exact duplicate (same pattern + same glob)
    const exactDup = this.searchHistory.find(
      (r) => r.pattern === pattern && r.glob === glob,
    );
    if (exactDup) {
      return {
        action: "block",
        message: `BLOCKED: Exact duplicate search "${pattern}" with glob "${glob || "*"}". Results already in context from round ${exactDup.round}.`,
      };
    }

    // 2. Pattern already searched with a broader glob
    const broaderMatch = this.searchHistory.find(
      (r) => r.pattern === pattern && globCovers(r.glob, glob),
    );
    if (broaderMatch) {
      return {
        action: "block",
        message:
          `BLOCKED: Pattern "${pattern}" already searched with broader glob ` +
          `"${broaderMatch.glob || "*"}" in round ${broaderMatch.round}. ` +
          `Current glob "${glob || "*"}" is a subset — results are already in context.`,
      };
    }

    // 3. Pattern searched >= 2 times with any glob
    const samePatternCount = this.searchHistory.filter(
      (r) => r.pattern === pattern,
    ).length;
    if (samePatternCount >= 2) {
      return {
        action: "block",
        message: `BLOCKED: Pattern "${pattern}" already searched ${samePatternCount} times. Move on with the information you have.`,
      };
    }

    // 4. Cross-tool: search_project_files after find_symbols with same pattern
    if (tool === "search_project_files") {
      const prevFind = this.searchHistory.find(
        (r) => r.tool === "find_symbols" && r.pattern === pattern,
      );
      if (prevFind) {
        const warnKey = `cross:${pattern}`;
        if (this.warnKeys.has(warnKey)) {
          return {
            action: "block",
            message:
              `BLOCKED: find_symbols already found "${pattern}" in round ${prevFind.round}. ` +
              `Use read_project_file to read the specific file instead of searching again.`,
          };
        }
        this.warnKeys.add(warnKey);
        return {
          action: "warn",
          message:
            `WARNING: find_symbols already located "${pattern}" in round ${prevFind.round}. ` +
            `Consider using read_project_file directly instead of re-searching.\n\n`,
        };
      }
    }

    // 5. Overlapping glob (same pattern, different but overlapping globs)
    const overlapMatch = this.searchHistory.find(
      (r) => r.pattern === pattern && r.glob !== glob,
    );
    if (overlapMatch) {
      const warnKey = `overlap:${pattern}`;
      if (this.warnKeys.has(warnKey)) {
        return {
          action: "block",
          message:
            `BLOCKED: Pattern "${pattern}" searched with overlapping globs ` +
            `"${overlapMatch.glob || "*"}" and "${glob || "*"}". ` +
            `Use a single broad glob next time.`,
        };
      }
      this.warnKeys.add(warnKey);
      return {
        action: "warn",
        message:
          `WARNING: Pattern "${pattern}" was already searched with glob ` +
          `"${overlapMatch.glob || "*"}" in round ${overlapMatch.round}. ` +
          `Current glob "${glob || "*"}" may overlap.\n\n`,
      };
    }

    return { action: "allow" };
  }

  // --- Read dedup (merge adjacent / overlapping reads) ---------------------

  checkRead(input: Record<string, any>, round: number): DedupResult {
    const path = normalizePath(input.path);
    const startLine = input.startLine || 1;
    const endLine = input.endLine || startLine + 200;

    const prev = this.readHistory.find((r) => r.path === path);
    if (!prev) return { action: "allow" };

    // Check for overlap or adjacency (within 10-line gap)
    const overlaps =
      startLine <= prev.endLine + 10 && endLine >= prev.startLine - 10;
    if (!overlaps) return { action: "allow" };

    const mergedStart = Math.min(prev.startLine, startLine);
    const mergedEnd = Math.max(prev.endLine, endLine);

    // Don't merge if result would be too large (> 500 lines)
    if (mergedEnd - mergedStart > 500) return { action: "allow" };

    // If requested range is fully covered by previous read — block (content already in context)
    if (startLine >= prev.startLine && endLine <= prev.endLine) {
      return {
        action: "block",
        message: `BLOCKED: File ${path} lines ${startLine}-${endLine} already read in round ${prev.round} (lines ${prev.startLine}-${prev.endLine}). Content is already in context — use it directly.`,
      };
    }

    return {
      action: "warn",
      message:
        `NOTE: Merged with previous read of ${path} ` +
        `(lines ${prev.startLine}-${prev.endLine}). ` +
        `Now reading lines ${mergedStart}-${mergedEnd}.\n\n`,
      mergedInput: { startLine: mergedStart, endLine: mergedEnd },
    };
  }

  // --- Recording -----------------------------------------------------------

  recordSearch(tool: string, input: Record<string, any>, round: number): void {
    const pattern = normalizePattern(tool, input);
    if (!pattern) return;
    const glob: string | null = input.include || input.file_glob || null;
    this.searchHistory.push({ tool, pattern, glob, round });
  }

  recordRead(input: Record<string, any>, round: number): void {
    const path = normalizePath(input.path);
    const startLine = input.startLine || 1;
    const endLine = input.endLine || startLine + 200;

    // Update existing record if same path (extend range)
    const existing = this.readHistory.find((r) => r.path === path);
    if (existing) {
      existing.startLine = Math.min(existing.startLine, startLine);
      existing.endLine = Math.max(existing.endLine, endLine);
      existing.round = round;
    } else {
      this.readHistory.push({ path, startLine, endLine, round });
    }
  }

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Call after a mutating tool (create/update/delete).
   * Clears search history because results may differ; keeps read history
   * since file reads remain valid after doc mutations.
   */
  onMutation(): void {
    this.searchHistory = [];
    this._readOnlyRounds = 0;
  }

  incrementReadOnlyRound(): void {
    this._readOnlyRounds++;
  }
  getReadOnlyRoundCount(): number {
    return this._readOnlyRounds;
  }
}

// -- Helpers ----------------------------------------------------------------

const SEARCH_TOOLS = new Set([
  "search_project_files",
  "find_symbols",
  "search",
  "semantic_search",
]);


function normalizePattern(tool: string, input: Record<string, any>): string | null {
  if (!SEARCH_TOOLS.has(tool)) return null;

  let raw: string;
  if (tool === "find_symbols") {
    raw = input.name_pattern || input.name || "";
  } else if (tool === "semantic_search") {
    raw = input.query || "";
  } else {
    raw = input.pattern || input.query || "";
  }

  // Strip regex delimiters
  let pattern = raw.trim();
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    pattern = pattern.slice(1, -1);
  }

  return pattern.toLowerCase() || null;
}

function normalizePath(path: string): string {
  return (path || "").replace(/\\/g, "/").toLowerCase().trim();
}

/**
 * Check if `broader` glob covers `narrower` glob.
 * Simple heuristic — not a full glob engine.
 */
function globCovers(broader: string | null, narrower: string | null): boolean {
  if (broader === narrower) return true;
  if (!broader) return true; // null = all files, covers everything
  if (!narrower) return false; // narrower is all files, broader isn't

  const b = broader.replace(/^\*\*\//, "");
  const n = narrower.replace(/^\*\*\//, "");

  // *.ts* covers *.ts, *.tsx, *.ts*
  if (
    b === "*.ts*" &&
    (n === "*.ts" || n === "*.tsx" || n === "*.ts*")
  ) {
    return true;
  }
  if (b === "*.ts" && n === "*.ts") return true;

  // Broader path prefix: "packages/**/*.ts" covers "packages/desktop/src/**/*.ts"
  if (b.includes("*") && n.includes(b.replace("**/*", ""))) return true;

  return false;
}
