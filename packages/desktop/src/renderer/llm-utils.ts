/**
 * Pure utility functions for LLM integration — extracted from app.store.ts for testability.
 */

// ─── Constants ──────────────────────────────────────────────────

export const CONTEXT_LIMIT = 200_000;
export const COMPRESS_AT = 0.6;
export const HARD_STOP_AT = 0.85;
export const ABSOLUTE_MAX_ROUNDS = 200;
export const ROUNDS_WARNING_AT = 180;
export const TOOL_RESULT_LIMIT = 15_000;
export const DEFAULT_CONTENT_LIMIT = 10_000;
export const MAX_CONTENT_LIMIT = 15_000;
export const PLAN_RESEARCH_MAX_ROUNDS = 2; // After this many rounds, strip read-only tools in planMode to force writing

// Soft budget: warn model when it uses too many read-only rounds
export const CHAT_SOFT_BUDGET = 6;   // Warn after N read-only rounds in regular chat
export const CHAT_HARD_BUDGET = 10;  // Strong warning after N read-only rounds

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const CAPABLE_MODEL = "claude-sonnet-4-6";

export const READ_ONLY_TOOLS = new Set([
  "gt", "read",
  "search", "semantic_search", "get_history", "list_backups",
  "get_project_tree", "get_file_outlines", "read_project_file", "search_project_files", "find_symbols",
  "web_search",
  "read_buffer", "list_buffer",
]);

export const PLAN_TOOLS = new Set([
  "gt", "read", "search", "semantic_search",
  "get_project_tree", "get_file_outlines", "read_project_file", "search_project_files", "find_symbols",
  "web_search",
  "create_section",
  "ask_user",
  "write_buffer", "read_buffer", "list_buffer",
]);

// ─── Token estimation ───────────────────────────────────────────

export function estimateInputTokens(system: string, messages: any[]): number {
  let chars = system.length;
  for (const m of messages) {
    chars += 20; // role/structure overhead per message
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === "text") chars += (b.text?.length || 0);
        else if (b.type === "tool_result" && typeof b.content === "string") chars += b.content.length;
        else if (b.type === "tool_use") chars += (b.name?.length || 0) + JSON.stringify(b.input || {}).length + 20;
      }
    }
  }
  // ~2.7 chars per token for mixed content with JSON structure overhead
  // (validated against actual API usage across multiple sessions)
  return Math.round(chars / 2.7);
}

/**
 * Estimate total character length of messages WITHOUT JSON.stringify.
 * Walks the message tree and sums up content lengths directly.
 * For base64 image data, uses .length (O(1)) instead of serializing.
 */
export function estimateMessagesChars(messages: any[]): number {
  let chars = 2; // []
  for (const m of messages) {
    chars += 30; // {"role":"...","content":...},
    if (typeof m.content === "string") {
      chars += m.content.length + 2;
    } else if (Array.isArray(m.content)) {
      chars += 2; // []
      for (const b of m.content) {
        chars += 20; // {"type":"..."},
        if (b.type === "text") {
          chars += (b.text?.length || 0);
        } else if (b.type === "image" && b.source?.data) {
          chars += b.source.data.length + 80;
        } else if (b.type === "tool_result") {
          chars += typeof b.content === "string" ? b.content.length : 0;
        } else if (b.type === "tool_use") {
          chars += (b.name?.length || 0) + JSON.stringify(b.input || {}).length + 20;
        } else if (b.type === "thinking") {
          chars += (b.thinking?.length || 0);
        }
      }
    }
  }
  return chars;
}

// ─── Tool result processing ────────────────────────────────────

/**
 * Compress a tool result immediately after execution, before adding to context.
 * Applies content-aware compression based on what the result looks like:
 * - Source code: strip comments, imports, blank lines (~20% savings)
 * - JSON metadata: compact whitespace
 * - Documentation: collapse blank lines
 */
export function compressToolResult(result: string): string {
  if (result.length < 200) return result; // skip tiny results

  // JSON first (more specific check) — must come before looksLikeCode,
  // because JSON values may contain code keywords like "function", "class"
  // that would falsely trigger looksLikeCode.
  if (result.trimStart().startsWith("{") || result.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(result);
      return JSON.stringify(parsed); // remove pretty-print whitespace
    } catch {
      // Not valid JSON — continue to other checks
    }
  }

  // Source code: strip comments, imports, blank lines
  if (looksLikeCode(result)) {
    return compressSourceCode(result);
  }

  // Documentation / other text — collapse excessive blank lines
  return result.replace(/\n{3,}/g, "\n\n");
}

export function truncateToolResult(result: string, limit = TOOL_RESULT_LIMIT): string {
  if (result.length <= limit) return result;
  // Don't cut in the middle of a surrogate pair
  if ((result.charCodeAt(limit - 1) & 0xFC00) === 0xD800) limit--;
  return result.slice(0, limit) +
    `\n\n[TRUNCATED — result is ${result.length} chars total. Use offset/limit parameters to read remaining content.]`;
}

export function shrinkToolResults(msgs: any[], maxLen: number): any[] {
  return msgs.map(m => {
    if (!Array.isArray(m.content)) return m;

    if (m.role === "user") {
      return {
        ...m,
        content: m.content.map((block: any) => {
          if (block.type !== "tool_result") return block;
          const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          if (text.length <= maxLen) return block;
          let cut = maxLen;
          if ((text.charCodeAt(cut - 1) & 0xFC00) === 0xD800) cut--;
          return { ...block, content: text.slice(0, cut) + "...[compressed]" };
        }),
      };
    }

    if (m.role === "assistant") {
      return {
        ...m,
        content: m.content.map((block: any) => {
          if (block.type !== "tool_use" || !block.input) return block;
          // Shrink large string inputs (e.g. delegate task descriptions)
          const inputStr = JSON.stringify(block.input);
          if (inputStr.length <= maxLen * 2) return block;
          // Truncate the largest string field in the input
          const shrunk = { ...block.input };
          for (const key of Object.keys(shrunk)) {
            if (typeof shrunk[key] === "string" && shrunk[key].length > maxLen) {
              let cut = maxLen;
              if ((shrunk[key].charCodeAt(cut - 1) & 0xFC00) === 0xD800) cut--;
              shrunk[key] = shrunk[key].slice(0, cut) + "...[compressed]";
            }
          }
          return { ...block, input: shrunk };
        }),
      };
    }

    return m;
  });
}

// ─── Between-round optimization ─────────────────────────────────

/**
 * Compress source code content: strip comments, imports, collapse blank lines.
 * ~20% savings on typical TypeScript/JavaScript files.
 *
 * Careful with // comments: only strip lines where // is at the start (after whitespace),
 * to avoid breaking URLs (https://...) and string literals containing //.
 */
function compressSourceCode(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")        // block comments
    .replace(/^\s*\/\/.*$/gm, "")            // line-starting // comments only (safe for URLs in code)
    .replace(/^\s*import\s+.*$/gm, "")       // import statements
    .replace(/^\s*\n/gm, "")                 // blank lines
    .replace(/\n{3,}/g, "\n\n");             // collapse remaining
}

/** Looks like source code (has function/class/import/export keywords) */
function looksLikeCode(text: string): boolean {
  const codeSignals = /\b(function|class|interface|import|export|const|let|var|return|async|await)\b/;
  return codeSignals.test(text.slice(0, 500));
}

/**
 * Deduplicate and compress tool_results between rounds.
 *
 * Strategy:
 * 1. Build a set of "seen lines" from ALL tool_results (latest wins)
 * 2. For older tool_results, remove lines already seen in newer results
 * 3. Compress source code (strip comments, imports, blank lines)
 * 4. If a tool_result loses >70% of its lines, replace with a short summary
 *
 * Returns new messages array with compressed tool_results.
 */
export function optimizeBetweenRounds(msgs: any[]): any[] {
  // Collect all tool_result positions (newest first for dedup priority)
  const positions: { msgIdx: number; blockIdx: number; content: string }[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (b.type === "tool_result" && typeof b.content === "string" && b.content.length > 200) {
        positions.push({ msgIdx: i, blockIdx: j, content: b.content });
      }
    }
  }

  if (positions.length < 2) return msgs;

  // Build "seen lines" set — newer results take priority
  const seenLines = new Set<string>();
  const resultLines: Map<string, Set<string>> = new Map();

  for (const pos of positions) {
    const key = `${pos.msgIdx}:${pos.blockIdx}`;
    const lines = new Set<string>();
    for (const line of pos.content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length >= 15) lines.add(trimmed);
    }
    resultLines.set(key, lines);
  }

  // Process from newest to oldest: newest builds the "seen" set,
  // older results get deduplicated
  const toCompress = new Map<string, string>();

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const key = `${pos.msgIdx}:${pos.blockIdx}`;
    const lines = resultLines.get(key)!;

    if (i === 0) {
      // Newest result — keep full, add all lines to "seen"
      // (source code compression already applied by compressToolResult on input)
      for (const line of lines) seenLines.add(line);
      continue;
    }

    // Check how many lines are duplicated
    let dupCount = 0;
    for (const line of lines) {
      if (seenLines.has(line)) dupCount++;
    }
    const dupRatio = lines.size > 0 ? dupCount / lines.size : 0;

    if (dupRatio > 0.7) {
      // >70% duplicated — replace with summary
      const uniqueLines: string[] = [];
      for (const line of pos.content.split("\n")) {
        if (line.trim().length >= 15 && !seenLines.has(line.trim())) {
          uniqueLines.push(line);
        }
      }
      const summary = uniqueLines.length > 0
        ? uniqueLines.slice(0, 10).join("\n") + "\n[...rest duplicates later results]"
        : "[Content duplicates later results — see below]";
      toCompress.set(key, summary);
    } else if (dupRatio > 0.3) {
      // 30-70% — remove duplicate lines, collapse resulting blank lines
      const filtered = pos.content.split("\n")
        .filter(line => line.trim().length < 15 || !seenLines.has(line.trim()))
        .join("\n")
        .replace(/^\s*\n/gm, "")     // remove blank lines left by filtering
        .replace(/\n{3,}/g, "\n\n"); // collapse remaining
      toCompress.set(key, filtered);
    } else {
      // <30% duplication — already compressed by compressToolResult on input, skip
    }

    // Add this result's lines to "seen" for even older results
    for (const line of lines) seenLines.add(line);
  }

  if (toCompress.size === 0) return msgs;

  // Apply compressions
  return msgs.map((m, mi) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;
    let changed = false;
    const newContent = m.content.map((b: any, bi: number) => {
      const key = `${mi}:${bi}`;
      if (toCompress.has(key)) {
        changed = true;
        return { ...b, content: toCompress.get(key) };
      }
      return b;
    });
    return changed ? { ...m, content: newContent } : m;
  });
}

// ─── Slug generation ────────────────────────────────────────────

const CYRILLIC_MAP: Record<string, string> = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"j",к:"k",
  л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",
  ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};

export function generateSlug(title: string): string {
  const transliterated = title.toLowerCase().split("").map(ch => CYRILLIC_MAP[ch] ?? ch).join("");
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")  // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "")       // trim hyphens
    .slice(0, 40);                  // max length
  return slug || "item";
}

/**
 * Build a bidirectional slug↔UUID map from a tree.
 * Slugs are globally unique (duplicates get -2, -3 suffixes).
 */
export function buildSlugMap(tree: TreeNode[]): Map<string, string> {
  const slugToId = new Map<string, string>();
  const baseCounts = new Map<string, number>();

  function walk(nodes: TreeNode[]) {
    for (const n of nodes) {
      const base = generateSlug(n.title);
      const count = baseCounts.get(base) || 0;
      baseCounts.set(base, count + 1);
      const slug = count === 0 ? base : `${base}-${count + 1}`;
      slugToId.set(slug, n.id);
      walk(n.children);
    }
  }
  walk(tree);
  return slugToId;
}

// ─── Tree formatting ────────────────────────────────────────────

export interface TreeNode {
  id: string;
  title: string;
  type: string;
  icon?: string | null;
  children: TreeNode[];
}

/**
 * Format tree for LLM display.
 * If slugMap is provided, shows slugs instead of UUID prefixes.
 */
export function formatCompactTree(nodes: TreeNode[], depth = 0, includeIds = true, maxDepth?: number, slugMap?: Map<string, string>): string {
  // Build reverse map (uuid → slug) for display
  const idToSlug = new Map<string, string>();
  if (slugMap) {
    for (const [slug, uuid] of slugMap) idToSlug.set(uuid, slug);
  }

  function format(nodes: TreeNode[], depth: number): string {
    const indent = "  ".repeat(depth);
    const typeIcons: Record<string, string> = { folder: "📁", file: "📄", section: "§", idea: "💡", todo: "✅", kanban: "📋", drawing: "🎨" };
    return nodes.map(n => {
      const icon = n.icon || typeIcons[n.type] || "•";
      const label = includeIds
        ? (idToSlug.has(n.id) ? ` [${idToSlug.get(n.id)}]` : ` [${n.id.slice(0, 8)}]`)
        : "";
      const childCount = n.children?.length || 0;

      if (maxDepth !== undefined && depth >= maxDepth) {
        const suffix = childCount > 0 ? ` (${childCount} ${childCount === 1 ? "child" : "children"})` : "";
        return `${indent}${icon} ${n.title}${label}${suffix}`;
      }

      const line = `${indent}${icon} ${n.title}${label}`;
      const children = childCount ? "\n" + format(n.children, depth + 1) : "";
      return line + children;
    }).join("\n");
  }

  return format(nodes, depth);
}

// ─── Content pagination ─────────────────────────────────────────

export interface PaginateResult {
  slice: string;
  offset: number;
  end: number;
  totalLen: number;
  hasMore: boolean;
}

/**
 * Paginate text content with paragraph-boundary alignment.
 * offset is exact (not shifted back), end is aligned forward to nearest \n\n or \n.
 */
export function paginateText(text: string, offset = 0, limit = DEFAULT_CONTENT_LIMIT): PaginateResult {
  const totalLen = text.length;

  if (offset >= totalLen) {
    return { slice: "", offset, end: totalLen, totalLen, hasMore: false };
  }

  const safeOffset = Math.max(0, offset);
  let end = Math.min(safeOffset + Math.max(1, limit), totalLen);

  // Align end forward to nearest paragraph break
  if (end < totalLen) {
    const dblBreak = text.indexOf("\n\n", end);
    if (dblBreak >= 0 && dblBreak - end < 200) {
      end = dblBreak + 2; // include \n\n in current slice
    } else {
      const singleBreak = text.indexOf("\n", end);
      if (singleBreak >= 0 && singleBreak - end < 100) {
        end = singleBreak + 1; // include \n in current slice
      }
    }
  }

  return {
    slice: text.slice(safeOffset, end),
    offset: safeOffset,
    end,
    totalLen,
    hasMore: end < totalLen,
  };
}

// ─── ID resolution ──────────────────────────────────────────────

export function resolveIdInTree(prefix: string, tree: TreeNode[], slugMap?: Map<string, string>): string {
  if (!prefix) return prefix;

  // 1. Try slug map first (exact match)
  if (slugMap) {
    const fromSlug = slugMap.get(prefix);
    if (fromSlug) return fromSlug;
    // Try lowercase slug match (model may capitalize)
    const fromSlugLower = slugMap.get(prefix.toLowerCase());
    if (fromSlugLower) return fromSlugLower;
  }

  // 2. Fall back to UUID prefix matching
  if (prefix.length > 36) return prefix; // already a full UUID or garbage
  const find = (nodes: TreeNode[]): string | null => {
    for (const n of nodes) {
      if (n.id.startsWith(prefix)) return n.id;
      const found = find(n.children);
      if (found) return found;
    }
    return null;
  };
  return find(tree) || prefix;
}

// ─── Context management ────────────────────────────────────────

export function computeContextThresholds() {
  return {
    compressThreshold: Math.floor(CONTEXT_LIMIT * COMPRESS_AT),
    hardLimit: Math.floor(CONTEXT_LIMIT * HARD_STOP_AT),
  };
}

export function shouldCompress(estimatedTokens: number): boolean {
  const { compressThreshold } = computeContextThresholds();
  return estimatedTokens > compressThreshold;
}

export function shouldHardStop(estimatedTokens: number): boolean {
  const { hardLimit } = computeContextThresholds();
  return estimatedTokens > hardLimit;
}

// ─── Tool classification ───────────────────────────────────────

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function isPlanModeTool(name: string): boolean {
  return PLAN_TOOLS.has(name);
}
