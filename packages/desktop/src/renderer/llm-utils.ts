/**
 * Pure utility functions for LLM integration — extracted from app.store.ts for testability.
 */

// ─── Constants ──────────────────────────────────────────────────

export const CONTEXT_LIMIT = 200_000;
export const COMPRESS_AT = 0.6;
export const HARD_STOP_AT = 0.85;
export const ABSOLUTE_MAX_ROUNDS = 50;
export const TOOL_RESULT_LIMIT = 6000;
export const DEFAULT_CONTENT_LIMIT = 6000;
export const MAX_CONTENT_LIMIT = 10_000;
export const SUB_AGENT_RESULT_LIMIT = 3000;
export const SUB_AGENT_CONTEXT_LIMIT = 40_000;
export const SUB_AGENT_MAX_ROUNDS_HAIKU = 4;
export const SUB_AGENT_MAX_ROUNDS_DEFAULT = 6;
/** When orchestrator context exceeds this, compress consumed delegate results. */
export const ORCHESTRATOR_COMPRESS_AT = 25_000;
/** Max chars for a consumed (old) delegate result after compression. */
export const CONSUMED_DELEGATE_MAX_LEN = 800;

/** Returns max tool-use rounds for a sub-agent based on the model. */
export function getSubAgentMaxRounds(model: string): number {
  if (model.includes("haiku")) return SUB_AGENT_MAX_ROUNDS_HAIKU;
  return SUB_AGENT_MAX_ROUNDS_DEFAULT;
}
export const PLAN_RESEARCH_MAX_ROUNDS = 2; // After this many rounds, strip read-only tools in planMode to force writing

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const CAPABLE_MODEL = "claude-sonnet-4-6";

export const READ_ONLY_TOOLS = new Set([
  "get_tree", "get_section", "get_file_with_sections", "get_sections_batch",
  "search", "get_history", "list_backups",
  "get_project_tree", "get_file_outlines", "read_project_file", "search_project_files", "find_symbols",
  "web_search",
]);

export const WRITER_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  "create_section", "update_section", "delete_section", "move_section", "update_icon",
]);

export const PLAN_TOOLS = new Set([
  "get_tree", "get_section", "get_file_with_sections", "get_sections_batch", "search",
  "get_project_tree", "get_file_outlines", "read_project_file", "search_project_files", "find_symbols",
  "web_search",
  "create_section",
  "ask_user",
]);

/** Tools the orchestrator may call directly when sub-agents are enabled.
 *  Source code tools are excluded — they must go through delegate_research. */
export const ORCHESTRATOR_TOOLS = new Set([
  "get_tree", "get_section", "get_file_with_sections", "get_sections_batch", "search",
  "create_section", "update_section", "delete_section", "move_section",
  "duplicate_section", "restore_section", "update_icon",
  "commit_version", "get_history", "restore_version",
  "create_backup", "list_backups",
  "web_search",
  "ask_user",
  // delegate_* tools are added separately by buildSubAgentTools()
  "delegate_research", "delegate_writing", "delegate_review", "delegate_planning",
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
    `\n\n[TRUNCATED — result is ${result.length} chars total. Use offset/limit parameters to read remaining content, or delegate_task for bulk operations.]`;
}

// ─── Delegate report compression ────────────────────────────────

/** Max chars for the compressed delegate report delivered to the orchestrator. */
export const DELEGATE_REPORT_LIMIT = 6000;

/**
 * Compress a sub-agent report preserving key information.
 *
 * Strategy:
 * 1. If report has "## Summary" — keep it in full, compress the rest ("Details").
 * 2. In the Details part:
 *    - Keep ## headings
 *    - Bullet points → first sentence only
 *    - Code blocks → replace with "[code: N lines]"
 *    - Prose paragraphs → first sentence
 * 3. If still over DELEGATE_REPORT_LIMIT, hard-truncate Details.
 *
 * This eliminates the "[TRUNCATED]" message that triggers re-delegation.
 */
export function compressDelegateReport(report: string, limit = DELEGATE_REPORT_LIMIT): string {
  if (report.length <= limit) return report;

  // Split into Summary and Details at "## " boundary after Summary
  const summaryMatch = report.match(/^([\s\S]*?## Summary\b[\s\S]*?)(\n## (?!Summary))/i);
  let summary: string;
  let details: string;

  if (summaryMatch) {
    summary = summaryMatch[1];
    details = report.slice(summaryMatch[1].length);
  } else {
    // No ## Summary header — treat entire report as details
    summary = "";
    details = report;
  }

  // Compress the details section
  const compressed = compressDetailsSection(details, limit - summary.length);
  const result = (summary + compressed).trim();

  if (result.length <= limit) return result;

  // Hard fallback — keep summary + truncated details
  const remaining = limit - summary.length - 50;
  if (remaining > 200) {
    return (summary + compressed.slice(0, remaining) + "\n\n[Details compressed]").trim();
  }
  return summary.trim() || report.slice(0, limit);
}

/** Compress a details section: keep headings, shorten bullets and prose, replace code blocks. */
function compressDetailsSection(text: string, budget: number): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let len = 0;
  let inCodeBlock = false;
  let codeLines = 0;

  for (const line of lines) {
    if (len >= budget) break;
    const trimmed = line.trim();

    // Code block handling
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        // End of code block
        result.push(`  [code block: ${codeLines} lines]`);
        len += 30;
        inCodeBlock = false;
        codeLines = 0;
      } else {
        inCodeBlock = true;
        codeLines = 0;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines++;
      continue;
    }

    // Always keep headings
    if (trimmed.startsWith("#")) {
      result.push(line);
      len += line.length + 1;
      continue;
    }

    // Bullet points — first sentence only
    if (/^[-*•]\s/.test(trimmed)) {
      const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0];
      const shortened = firstSentence.length < trimmed.length ? firstSentence : trimmed;
      if (len + shortened.length < budget) {
        result.push(shortened);
        len += shortened.length + 1;
      }
      continue;
    }

    // Empty lines — keep one
    if (trimmed === "") {
      if (result.length > 0 && result[result.length - 1].trim() !== "") {
        result.push("");
        len += 1;
      }
      continue;
    }

    // Prose — first sentence only
    const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0];
    if (len + firstSentence.length < budget) {
      result.push(firstSentence);
      len += firstSentence.length + 1;
    }
  }

  // Handle unclosed code block
  if (inCodeBlock && codeLines > 0) {
    result.push(`  [code block: ${codeLines} lines]`);
  }

  return result.join("\n");
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

// ─── Consumed delegate compression ──────────────────────────────

/**
 * Compress old delegate results that the orchestrator has already acted on.
 * Keeps ## Summary intact, strips ## Details.
 *
 * "Consumed" = there are at least `minAge` assistant messages after the delegate result.
 * This means the orchestrator has read the result and moved on.
 */
export function shrinkConsumedDelegates(msgs: any[], minAge = 2): any[] {
  // Step 1: build tool_use_id → tool_name map
  const toolNameMap = new Map<string, string>();
  for (const m of msgs) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use" && b.id) toolNameMap.set(b.id, b.name);
    }
  }

  // Step 2: compute age for each user message (how many assistant messages come AFTER it)
  // Message pattern: [user, assistant, user(tool_result), assistant, user(tool_result), ...]
  // Age of a user message at index i = number of assistant messages in msgs[i+1..]
  const assistantAfter: number[] = new Array(msgs.length).fill(0);
  let countFromEnd = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    assistantAfter[i] = countFromEnd;
    if (msgs[i].role === "assistant") countFromEnd++;
  }

  return msgs.map((m, i) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;

    const age = assistantAfter[i];
    if (age < minAge) return m; // Too recent — keep full

    let changed = false;
    const newContent = m.content.map((block: any) => {
      if (block.type !== "tool_result" || typeof block.content !== "string") return block;

      const toolName = toolNameMap.get(block.tool_use_id) || "";
      if (!toolName.startsWith("delegate_")) return block;

      // Already compressed — skip
      if (block.content.length <= CONSUMED_DELEGATE_MAX_LEN) return block;

      changed = true;

      // Extract ## Summary if present, strip the rest
      const summaryMatch = block.content.match(/## Summary[\s\S]*?(?=\n## (?!Summary)|$)/i);
      const summary = summaryMatch ? summaryMatch[0].trim() : "";

      if (summary) {
        const compressed = summary.slice(0, CONSUMED_DELEGATE_MAX_LEN - 30) + "\n\n[Details removed — already processed]";
        return { ...block, content: compressed };
      }

      // No Summary — hard truncate
      return { ...block, content: block.content.slice(0, CONSUMED_DELEGATE_MAX_LEN) + "...[compressed]" };
    });

    return changed ? { ...m, content: newContent } : m;
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

// ─── Tree formatting ────────────────────────────────────────────

export interface TreeNode {
  id: string;
  title: string;
  type: string;
  icon?: string | null;
  children: TreeNode[];
}

export function formatCompactTree(nodes: TreeNode[], depth = 0, includeIds = true, maxDepth?: number): string {
  const indent = "  ".repeat(depth);
  const typeIcons: Record<string, string> = { folder: "📁", file: "📄", section: "§", idea: "💡", todo: "✅", kanban: "📋", drawing: "🎨" };
  return nodes.map(n => {
    const icon = n.icon || typeIcons[n.type] || "•";
    const idSuffix = includeIds ? ` [${n.id.slice(0, 8)}]` : "";
    const childCount = n.children?.length || 0;

    if (maxDepth !== undefined && depth >= maxDepth) {
      const suffix = childCount > 0 ? ` (${childCount} ${childCount === 1 ? "child" : "children"})` : "";
      return `${indent}${icon} ${n.title}${idSuffix}${suffix}`;
    }

    const line = `${indent}${icon} ${n.title}${idSuffix}`;
    const children = childCount ? "\n" + formatCompactTree(n.children, depth + 1, includeIds, maxDepth) : "";
    return line + children;
  }).join("\n");
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

export function resolveIdInTree(prefix: string, tree: TreeNode[]): string {
  if (!prefix || prefix.length > 20) return prefix;
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

export function isWriterTool(name: string): boolean {
  return WRITER_TOOLS.has(name);
}

export function isMutatingTool(name: string): boolean {
  return WRITER_TOOLS.has(name) && !READ_ONLY_TOOLS.has(name);
}

export function isPlanModeTool(name: string): boolean {
  return PLAN_TOOLS.has(name);
}
