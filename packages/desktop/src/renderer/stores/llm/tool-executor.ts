/**
 * Executes tool calls against the local window.api.
 * Manages mutation tracking and section creation with markdown splitting.
 */

import type { GetState, SetState } from "./types.js";
import { formatCompactTree, resolveIdInTree, paginateText, buildSlugMap, DEFAULT_CONTENT_LIMIT, MAX_CONTENT_LIMIT } from "../../llm-utils.js";
import { truncateToolResult, compressToolResult } from "../../llm-utils.js";
import { splitMarkdownIntoSections } from "./split-markdown.js";
import { buildTools, TOOL_DESCRIPTIONS } from "./tool-definitions.js";

/**
 * Strip comment-only lines and collapse consecutive blank lines from source code.
 * Keeps inline comments (e.g. `const x = 1; // reason`) and preserves strings.
 */
export function stripCodeNoise(code: string): string {
  const lines = code.split("\n");
  const result: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Remove lines that are purely comments
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*/") ||
      (trimmed.startsWith("*") && !trimmed.startsWith("**") && !trimmed.startsWith("* @"))
    ) {
      continue;
    }

    // Collapse 2+ consecutive blank lines into 1
    if (trimmed === "") {
      blankCount++;
      if (blankCount <= 1) result.push(line);
      continue;
    }

    blankCount = 0;
    result.push(line);
  }

  return result.join("\n");
}

/** Mutable state shared between executeTool calls within a single sendLlmMessage invocation. */
export interface ToolExecutionState {
  mutated: boolean;
  lastCreatedId: string | null;
}

/**
 * Normalize LLM tool inputs — Haiku sometimes passes arrays as JSON strings
 * and numbers as string digits. Fix these before execution.
 */
function normalizeInput(input: any): any {
  if (!input || typeof input !== "object") return input;
  const out = { ...input };

  // Fix stringified arrays (e.g. section_ids: "[\"a\",\"b\"]" → ["a","b"], paths: "[...]" → [...])
  for (const key of ["section_ids", "paths", "sections", "tags", "ordered_ids"]) {
    if (typeof out[key] === "string" && out[key].startsWith("[")) {
      try { out[key] = JSON.parse(out[key]); } catch { /* leave as-is */ }
    }
  }

  // Fix stringified numbers (e.g. startLine: "80" → 80)
  for (const key of ["startLine", "endLine", "max_depth", "max_results", "context_lines", "offset", "limit"]) {
    if (typeof out[key] === "string" && /^\d+$/.test(out[key])) {
      out[key] = parseInt(out[key], 10);
    }
  }

  // Fix stringified booleans (Haiku sometimes sends "false"/"true" as strings)
  for (const key of ["include_content", "is_regex", "case_sensitive", "whole_word"]) {
    if (out[key] === "true") out[key] = true;
    else if (out[key] === "false") out[key] = false;
    else if (typeof out[key] === "string") {
      console.warn(`[LLM] Unexpected boolean string "${out[key]}" for param "${key}", removing`);
      delete out[key];
    }
  }

  return out;
}

// ─── Tool result cache ──────────────────────────────────────────
// Two-level cache:
// 1. In-memory Map — shared within one session.
// 2. localStorage — persists across sessions. Loaded on start, saved on each cache write.
// Automatically invalidated when mutating tools (update/create/delete/move) are called.

const PERSISTENT_CACHE_MAX_ENTRIES = 150;
const PERSISTENT_CACHE_KEY_PREFIX = "toolCache:";
/** Max age for persistent cache entries (ms). Entries older than this are discarded on load. */
const PERSISTENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/** Tools whose results should be persisted across sessions. */
const PERSISTABLE_TOOLS = new Set([
  "get_section", "get_file_with_sections", "get_sections_batch",
  "get_tree", "get_file_outlines", "read_project_file", "find_symbols",
]);

type CacheEntry = { v: string; t: number }; // value + timestamp

/** Load persistent cache from localStorage, discarding expired entries. */
function loadPersistentCache(token: string): Map<string, CacheEntry> {
  const cache = new Map<string, CacheEntry>();
  try {
    const raw = localStorage.getItem(PERSISTENT_CACHE_KEY_PREFIX + token);
    if (raw) {
      const entries: [string, CacheEntry][] = JSON.parse(raw);
      const now = Date.now();
      let loaded = 0;
      for (const [k, entry] of entries) {
        if (now - entry.t < PERSISTENT_CACHE_TTL) {
          cache.set(k, entry);
          loaded++;
        }
      }
      console.log(`[ToolCache] Loaded ${loaded} persistent entries (${entries.length - loaded} expired)`);
    }
  } catch { /* corrupted — start fresh */ }
  return cache;
}

/** Save persistent cache to localStorage (debounced, only persistable tools, LRU eviction). */
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function savePersistentCache(token: string, cache: Map<string, CacheEntry>) {
  // Debounce: batch multiple writes into one localStorage call
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const entries: [string, CacheEntry][] = [];
      for (const [k, entry] of cache) {
        const toolName = k.split(":")[0];
        if (PERSISTABLE_TOOLS.has(toolName)) entries.push([k, entry]);
      }
      const trimmed = entries.slice(-PERSISTENT_CACHE_MAX_ENTRIES);
      localStorage.setItem(PERSISTENT_CACHE_KEY_PREFIX + token, JSON.stringify(trimmed));
      console.log(`[ToolCache] Persisted ${trimmed.length} entries`);
    } catch { /* localStorage full or unavailable */ }
  }, 2000);
}

/** Build a cache key for cacheable tools. Returns null for non-cacheable tools. */
function buildCacheKey(name: string, input: any): string | null {
  switch (name) {
    case "get_section":
      return `get_section:${input.section_id}:${input.offset ?? 0}:${input.limit ?? 0}:${input.format ?? "md"}`;
    case "get_file_with_sections":
      return `get_file_with_sections:${input.file_id}:${input.max_depth ?? ""}:${input.include_content ?? true}:${input.format ?? "md"}`;
    case "get_sections_batch":
      return `get_sections_batch:${(input.section_ids || []).sort().join(",")}:${input.format ?? "md"}`;
    case "get_tree":
      return `get_tree:${input.parent_id ?? "root"}:${input.max_depth ?? "all"}`;
    case "get_project_tree":
      return `get_project_tree:${input.glob ?? ""}:${input.max_depth ?? ""}`;
    case "get_file_outlines":
      return `get_file_outlines:${(input.paths || []).sort().join(",")}`;
    case "read_project_file":
      return `read_project_file:${input.path}:${input.startLine ?? 0}:${input.endLine ?? 0}`;
    case "find_symbols":
      return `find_symbols:${input.name_pattern ?? ""}:${input.kind ?? ""}:${input.file_glob ?? ""}:${input.max_results ?? 50}`;
    // search, get_history, list_backups are NOT cached — they depend on mutations
    // and caching them causes stale results after update/create/commit operations.
    default:
      return null; // Not cacheable (mutating tools, delegate_*, web_search, etc.)
  }
}

/** Invalidate cache entries affected by a mutation on the given section ID. */
function invalidateCache(cache: Map<string, any>, sectionId?: string) {
  if (!sectionId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    // Always clear tree and batch caches (they aggregate multiple sections)
    if (
      key.startsWith("get_tree:") ||
      key.startsWith("get_sections_batch:") ||
      key.startsWith("get_file_with_sections:")
    ) {
      cache.delete(key);
      continue;
    }
    // For section-specific tools: match the ID as a distinct segment after the tool name
    // Key format: "tool_name:id:param1:param2" — split by ":" and check segments
    const segments = key.split(":");
    // segments[0] = tool name, segments[1] = primary ID (section_id, file_id, path, etc.)
    if (segments.length > 1 && segments[1] === sectionId) {
      cache.delete(key);
    }
  }
}

/**
 * Runs a custom agent in an isolated conversation context.
 * The agent has its own system prompt, tool set, and round loop.
 */
const AGENT_MAX_ROUNDS = 100;
const AGENT_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

async function executeAgentTool(
  input: any,
  token: string,
  get: GetState,
  set: SetState,
  state: ToolExecutionState,
): Promise<string> {
  const agents = get().customAgents || [];
  const agent = agents.find(a => a.id === input.agent_id);
  if (!agent) return `Error: agent "${input.agent_id}" not found`;

  // Build agent tools from the full tool list (without run_agent to prevent recursion)
  const allToolDefs = buildTools({
    includeSourceCode: true,
    planMode: false,
    webSearchEnabled: get().webSearchProvider !== "none" && !!get().webSearchApiKey,
    customAgents: [], // no nested agents
  });
  const BUFFER_TOOLS = new Set(["write_buffer", "read_buffer", "list_buffer"]);
  const agentToolDefs = allToolDefs.filter(t =>
    (agent.tools.includes(t.name) || BUFFER_TOOLS.has(t.name)) && t.name !== "run_agent"
  );

  const agentSystem = agent.systemPrompt +
    `\n\nProject token: ${token}` +
    `\n\nSession Buffer: You have write_buffer, read_buffer, list_buffer tools for sharing data with the main assistant and other agents. Use list_buffer to see what's available. Write findings to the buffer with write_buffer instead of returning everything as text — the assistant will read them from the buffer.` +
    `\n\nIMPORTANT: If a tool returns an error, do NOT retry the same call. Try a different approach or report what you found so far and finish.`;
  const taskContent = agent.prompt ? `${agent.prompt}\n\nTask: ${input.task}` : input.task;

  let agentMessages: any[] = [{ role: "user", content: taskContent }];
  let round = 0;
  let lastActivityTime = Date.now();
  const startedAt = Date.now();
  const recentSignatures: string[] = [];

  // Create a separate tool executor for the agent (shares the same token/state)
  const agentExecuteTool = createToolExecutor(token, get, set, state, agent.name);

  const effortMaxTokens = agent.effort === "low" ? 2048 : agent.effort === "high" ? 16384 : 8192;

  // --- Agent card in chat ---
  const cardMsgIdx = get().llmMessages.length;
  const card: any = {
    agentId: agent.id, agentName: agent.name, task: input.task,
    actions: [], startedAt, status: "running",
  };
  set((s: any) => ({
    llmMessages: [...s.llmMessages, { role: "assistant" as const, content: "", agentCard: { ...card } }],
  }));

  const updateCard = (patch: any) => {
    Object.assign(card, patch);
    set((s: any) => ({
      llmMessages: s.llmMessages.map((m: any, idx: number) =>
        idx === cardMsgIdx && m.agentCard ? { ...m, agentCard: { ...card, actions: [...card.actions] } } : m
      ),
    }));
  };

  const addAction = (tool: string, description: string, status: "running" | "done" | "error" = "running") => {
    card.actions.push({ tool, description, timestamp: Date.now(), status });
    updateCard({});
  };

  const finishLastAction = (status: "done" | "error" = "done") => {
    if (card.actions.length > 0) card.actions[card.actions.length - 1].status = status;
    updateCard({});
  };

  const buildStopSummary = (reason: string) => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const agentBufferEntries = get().listBuffer().filter((e: any) => e.author === agent.name);
    const bufferInfo = agentBufferEntries.length > 0
      ? `\nBuffer entries written: ${agentBufferEntries.map((e: any) => `"${e.key}"`).join(", ")}. Use read_buffer to access them.`
      : "";
    const lastAction = card.actions.length > 0 ? card.actions[card.actions.length - 1].description : "none";
    return `[Agent "${agent.name}" ${reason} after ${elapsed}s, ${round} rounds, ${card.actions.length} tool calls.\nLast action: ${lastAction}.${bufferInfo}]`;
  };

  try {
    while (round < AGENT_MAX_ROUNDS) {
      // Check abort (user pressed global stop OR agent-specific stop)
      if (get().llmAborted) {
        updateCard({ status: "stopped" });
        return buildStopSummary("stopped by user");
      }

      // Check idle timeout
      if (Date.now() - lastActivityTime > AGENT_IDLE_TIMEOUT) {
        updateCard({ status: "error" });
        return buildStopSummary("timed out (10 min idle)");
      }

      round++;

      const data = await window.api.llmChat({
        apiKey: get().llmApiKey,
        system: agentSystem,
        messages: agentMessages,
        model: agent.model,
        maxTokens: agent.thinking ? effortMaxTokens + 16000 : effortMaxTokens,
        tools: agentToolDefs.length ? agentToolDefs : undefined,
        ...(agent.thinking ? { thinking: { type: "enabled", budget_tokens: 16000 } } : {}),
        ...(!agent.thinking ? { temperature: 0.5 } : {}),
      });

      lastActivityTime = Date.now();

      // Track tokens
      if (data.usage) {
        set((s: any) => ({
          llmTokensUsed: {
            input: s.llmTokensUsed.input + (data.usage.input_tokens || 0),
            output: s.llmTokensUsed.output + (data.usage.output_tokens || 0),
            cacheRead: s.llmTokensUsed.cacheRead + (data.usage.cache_read_input_tokens || 0),
            cacheCreation: s.llmTokensUsed.cacheCreation + (data.usage.cache_creation_input_tokens || 0),
          },
        }));
      }

      if (data.stop_reason === "tool_use") {
        const blocks = (data.content || []).filter((b: any) => b.type === "tool_use");

        // Loop detection
        const sig = blocks.map((b: any) => `${b.name}:${JSON.stringify(b.input)}`).sort().join("|");
        recentSignatures.push(sig);
        if (recentSignatures.length >= 3 && recentSignatures.slice(-3).every(s => s === sig)) {
          console.warn(`[Agent:${agent.name}] LOOP DETECTED at round ${round}`);
          updateCard({ status: "error" });
          return buildStopSummary("stuck in a loop");
        }

        agentMessages = [...agentMessages, { role: "assistant", content: data.content }];
        const results: any[] = [];
        for (const block of blocks) {
          if (!agent.tools.includes(block.name) && !BUFFER_TOOLS.has(block.name)) {
            results.push({ type: "tool_result", tool_use_id: block.id, content: `Error: tool '${block.name}' not allowed for agent "${agent.name}"` });
            continue;
          }
          const desc = TOOL_DESCRIPTIONS[block.name] || block.name;
          addAction(block.name, desc, "running");
          const raw = await agentExecuteTool(block.name, block.input);
          lastActivityTime = Date.now();
          const isError = raw.startsWith("Error:");
          finishLastAction(isError ? "error" : "done");
          results.push({ type: "tool_result", tool_use_id: block.id, content: truncateToolResult(compressToolResult(raw)) });
        }
        agentMessages = [...agentMessages, { role: "user", content: results }];
      } else {
        // Agent finished — extract text
        const agentText = (data.content || [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n") || "[Agent returned no text]";
        // Auto-save agent output to buffer
        const bufferKey = `agent-${agent.id}-output`;
        get().writeBuffer(
          bufferKey,
          agentText,
          `Output from agent "${agent.name}"`,
          agent.name,
          ["agent-output"],
        );
        const agentBufferEntries = get().listBuffer().filter((e: any) => e.author === agent.name);
        const bufferNote = agentBufferEntries.length > 0
          ? `\n\n[Agent wrote ${agentBufferEntries.length} buffer entries: ${agentBufferEntries.map((e: any) => `"${e.key}"`).join(", ")}. Use read_buffer to access them.]`
          : "";
        updateCard({ status: "done" });
        return agentText + bufferNote;
      }
    }
    updateCard({ status: "error" });
    return buildStopSummary(`hit safety limit (${AGENT_MAX_ROUNDS} rounds)`);
  } catch (e: any) {
    updateCard({ status: "error" });
    return buildStopSummary(`error: ${e.message || e}`);
  }
}

/**
 * Creates a tool executor bound to the current project token and state.
 */
export function createToolExecutor(
  token: string,
  get: GetState,
  set: SetState,
  state: ToolExecutionState,
  authorName: string = "assistant",
) {
  // Slug map: human-readable names → UUIDs, rebuilt on tree changes
  let slugMap = buildSlugMap(get().tree);
  let lastTreeRef = get().tree;

  const resolveId = (prefix: string): string => {
    // Rebuild slug map if tree reference changed (after mutations)
    const currentTree = get().tree;
    if (currentTree !== lastTreeRef) {
      slugMap = buildSlugMap(currentTree);
      lastTreeRef = currentTree;
    }
    return resolveIdInTree(prefix, currentTree, slugMap);
  };

  // Two-level cache: in-memory (session) + localStorage (persistent).
  // Loaded from localStorage on start (with TTL filtering), saved on each write.
  const persistentCache = loadPersistentCache(token);
  // Session cache: simple key→value for fast lookups (populated from persistent + fresh results)
  const cache = new Map<string, string>();
  for (const [k, entry] of persistentCache) cache.set(k, entry.v);

  // Tool error tracking (Feature 3: Tool Diagnostics)
  const toolErrorCounts = new Map<string, { count: number; errors: string[] }>();

  async function executeToolInner(name: string, rawInput: any): Promise<string> {
    if (!token) return "Error: no project selected";
    const input = normalizeInput(rawInput);
    try {
      switch (name) {
        case "get_tree": {
          const fullTree = await window.api.getTree(token);
          // Rebuild slug map from latest tree (don't update lastTreeRef —
          // let resolveId rebuild again when store catches up via silentRefreshUI)
          slugMap = buildSlugMap(fullTree);

          let treeData = fullTree;
          if (input.parent_id) {
            const parentId = resolveId(input.parent_id);
            const findSubtree = (nodes: any[]): any[] | null => {
              for (const n of nodes) {
                if (n.id === parentId) return n.children || [];
                const found = findSubtree(n.children || []);
                if (found) return found;
              }
              return null;
            };
            const subtree = findSubtree(fullTree);
            if (!subtree) return `Error: section "${input.parent_id}" not found in tree.`;
            treeData = subtree;
          }

          return formatCompactTree(treeData, 0, true, input.max_depth, slugMap);
        }
        case "get_section": {
          const format = (input.format === "plain") ? "plain" : "markdown";
          const sectionId = resolveId(input.section_id);
          const sectionMeta = await window.api.getSection(token, sectionId);
          let raw = await window.api.getSectionContent(token, sectionId, format);
          let text = (typeof raw === "string" && raw) ? raw : "";

          // File-type sections store content in children — auto-collect
          if (sectionMeta?.type === "file" && !text.trim()) {
            try {
              const fileData = await window.api.getFileWithSections(token, sectionId);
              const parts: string[] = [];
              const collectContent = async (nodes: any[]) => {
                for (const node of nodes) {
                  const nodeContent = await window.api.getSectionContent(token, node.id, format);
                  if (nodeContent && typeof nodeContent === "string" && nodeContent.trim()) {
                    parts.push(`## ${node.title}\n${nodeContent}`);
                  }
                  if (node.children?.length) await collectContent(node.children);
                }
              };
              await collectContent(fileData.sections || []);
              text = parts.join("\n\n");
            } catch { /* fallback to empty */ }
          }

          if (!text) return "(empty section)";

          const offset = input.offset ?? 0;
          const limit = Math.min(input.limit ?? DEFAULT_CONTENT_LIMIT, MAX_CONTENT_LIMIT);

          if (offset >= text.length) {
            return `No more content. Section is ${text.length} chars total, requested offset: ${offset}.`;
          }

          const p = paginateText(text, offset, limit);

          if (p.offset > 0 || p.hasMore) {
            const meta = `[chars ${p.offset}–${p.end} of ${p.totalLen}]`;
            const formatHint = format !== "markdown" ? `, format: "${format}"` : "";
            const hint = p.hasMore
              ? `\n\n[Use offset: ${p.end}${formatHint} to read next ${Math.min(limit, p.totalLen - p.end)} chars]`
              : "";
            return `${meta}\n${p.slice}${hint}`;
          }

          return p.slice;
        }
        case "search": {
          const results = await window.api.search(token, input.query);
          const limit = Math.min(Math.max(1, input.limit ?? 20), 50);
          const sliced = results.slice(0, limit);
          return JSON.stringify(sliced.map((r: any) => {
            let snippet = "";
            if (r.content) {
              if (r.content.length <= 200) {
                snippet = r.content;
              } else {
                const trimmed = r.content.slice(0, 200).replace(/\S+$/, "").trimEnd();
                snippet = (trimmed.length >= 50 ? trimmed : r.content.slice(0, 200)) + "…";
              }
            }
            return { id: r.id, title: r.title, type: r.type, score: r.score, ...(snippet ? { snippet } : {}) };
          }));
        }
        case "create_section": {
          const parentId = (input.parent_id && input.parent_id !== "null") ? resolveId(input.parent_id) : null;
          const content = input.content;

          // Validate: content is required for types that need text
          if (["file", "section", "idea", "todo"].includes(input.type) && !content?.trim()) {
            return `Error: 'content' parameter is REQUIRED for type '${input.type}'. Pass full markdown text in 'content'. Never leave it empty.`;
          }

          // For 'file' with content: create file, then split markdown into nested child sections
          if (input.type === "file" && content) {
            const file = await window.api.createSection(token, parentId, input.title, "file", input.icon || null);
            const parts = splitMarkdownIntoSections(content);
            let totalCreated = 0;
            for (const part of parts) {
              const sec = await window.api.createSection(token, file.id, part.title, "section", null, part.content || undefined);
              totalCreated++;
              for (const child of part.children) {
                await window.api.createSection(token, sec.id, child.title, "section", null, child.content);
                totalCreated++;
              }
            }
            // Position after specified sibling
            if (input.after_id) {
              const afterId = resolveId(input.after_id);
              await window.api.moveSection(token, file.id, parentId, afterId);
            }
            state.mutated = true;
            state.lastCreatedId = file.id;
            return JSON.stringify({ id: file.id, title: file.title, type: file.type, sections_created: totalCreated, link: `[${file.title}](ccdoc:${file.id})` });
          }

          const section = await window.api.createSection(token, parentId, input.title, input.type, input.icon || null, content);
          if (input.after_id) {
            const afterId = resolveId(input.after_id);
            await window.api.moveSection(token, section.id, parentId, afterId);
          }
          state.mutated = true;
          state.lastCreatedId = section.id;
          return JSON.stringify({ id: section.id, title: section.title, type: section.type, link: `[${section.title}](ccdoc:${section.id})` });
        }
        case "bulk_create_sections": {
          const createdIds: string[] = [];
          const results: any[] = [];
          for (let i = 0; i < input.sections.length; i++) {
            const s = input.sections[i];
            let parentId = (s.parent_id && s.parent_id !== "null") ? resolveId(s.parent_id) : null;
            // Resolve $N references
            if (parentId && parentId.startsWith("$")) {
              const refIdx = parseInt(parentId.slice(1), 10);
              if (refIdx >= 0 && refIdx < createdIds.length) {
                parentId = createdIds[refIdx];
              } else {
                results.push({ index: i, error: `Invalid reference ${parentId}` });
                createdIds.push("");
                continue;
              }
            }
            try {
              if (s.type === "file" && s.content) {
                const file = await window.api.createSection(token, parentId, s.title, "file", s.icon || null);
                const parts = splitMarkdownIntoSections(s.content);
                let totalCreated = 0;
                for (const part of parts) {
                  const sec = await window.api.createSection(token, file.id, part.title, "section", null, part.content || undefined);
                  totalCreated++;
                  for (const child of part.children) {
                    await window.api.createSection(token, sec.id, child.title, "section", null, child.content);
                    totalCreated++;
                  }
                }
                createdIds.push(file.id);
                state.lastCreatedId = file.id;
                results.push({ index: i, id: file.id, title: s.title, type: s.type, sections_created: totalCreated, link: `[${s.title}](ccdoc:${file.id})` });
              } else {
                const section = await window.api.createSection(token, parentId, s.title, s.type, s.icon || null, s.content);
                createdIds.push(section.id);
                state.lastCreatedId = section.id;
                results.push({ index: i, id: section.id, title: section.title, type: section.type, link: `[${section.title}](ccdoc:${section.id})` });
              }
            } catch (e: any) {
              createdIds.push("");
              results.push({ index: i, error: e.message });
            }
          }
          state.mutated = true;
          return JSON.stringify({ created: results });
        }
        case "update_section": {
          const sid = resolveId(input.section_id);
          const title = input.title;
          const content = input.content;
          // Use explicit undefined/null check — empty string "" is a valid content (clears section)
          const current = await window.api.getSection(token, sid);
          const finalTitle = title ?? current.title;
          const finalContent = content ?? await (async () => {
            const c = await window.api.getSectionContent(token, sid, "markdown");
            return typeof c === "string" ? c : "";
          })();

          await window.api.updateSectionMarkdown(token, sid, finalTitle, finalContent);
          state.mutated = true;
          return `Section "${finalTitle}" updated (${finalContent.length} chars sent, ${finalContent.length} chars written).`;
        }
        case "bulk_update_sections": {
          if (!Array.isArray(input.sections)) return "Error: 'sections' must be an array.";
          const results: any[] = [];
          for (const s of input.sections) {
            const sid = resolveId(s.section_id);
            try {
              const current = await window.api.getSection(token, sid);
              const finalTitle = s.title ?? current.title;
              const finalContent = s.content ?? await (async () => {
                const c = await window.api.getSectionContent(token, sid, "markdown");
                return typeof c === "string" ? c : "";
              })();
              await window.api.updateSectionMarkdown(token, sid, finalTitle, finalContent);
              results.push({ id: sid, title: finalTitle, chars: finalContent.length });
            } catch (e: any) {
              results.push({ id: sid, error: e.message });
            }
          }
          state.mutated = true;
          return JSON.stringify({ updated: results });
        }
        case "move_section": {
          const newParentId = (input.new_parent_id && input.new_parent_id !== "null") ? resolveId(input.new_parent_id) : null;
          const afterId = (input.after_id && input.after_id !== "null") ? resolveId(input.after_id) : null;
          await window.api.moveSection(token, resolveId(input.section_id), newParentId, afterId);
          state.mutated = true;
          return "Section moved successfully.";
        }
        case "reorder_children": {
          if (!Array.isArray(input.ordered_ids)) return "Error: 'ordered_ids' must be an array of section IDs.";
          const parentId = (input.parent_id && input.parent_id !== "null") ? resolveId(input.parent_id) : null;
          const orderedIds = (input.ordered_ids as string[]).map((id: string) => resolveId(id));
          // Reorder by moving each section after the previous one
          for (let i = 0; i < orderedIds.length; i++) {
            const afterId = i === 0 ? null : orderedIds[i - 1];
            await window.api.moveSection(token, orderedIds[i], parentId, afterId);
          }
          state.mutated = true;
          return `Reordered ${orderedIds.length} children successfully.`;
        }
        case "delete_section": {
          await window.api.deleteSection(token, resolveId(input.section_id));
          state.mutated = true;
          return "Section deleted.";
        }
        case "duplicate_section": {
          const result = await window.api.duplicateSection(token, resolveId(input.section_id));
          state.mutated = true;
          state.lastCreatedId = result.id;
          return JSON.stringify({ id: result.id, title: result.title, type: result.type });
        }
        case "restore_section": {
          await window.api.restoreSection(token, resolveId(input.section_id));
          state.mutated = true;
          return "Section restored successfully.";
        }
        case "update_icon": {
          const icon = (input.icon && input.icon !== "null") ? input.icon : null;
          await window.api.updateIcon(token, resolveId(input.section_id), icon);
          state.mutated = true;
          return "Icon updated successfully.";
        }
        case "get_file_with_sections": {
          const result = await window.api.getFileWithSections(token, resolveId(input.file_id));
          const includeContent = input.include_content !== false;
          const maxDepth = input.max_depth;
          const format = (input.format === "plain") ? "plain" : "markdown";

          const MAX_NODES = 100;
          let nodeCount = 0;
          let truncatedByLimit = false;

          // depth starts at 1: direct children of file = level 1.
          // max_depth: 1 → depth < 1 = false → only direct children without recursion.
          const formatNode = async (node: any, depth: number): Promise<any> => {
            nodeCount++;
            if (nodeCount > MAX_NODES) {
              truncatedByLimit = true;
              return { id: node.id, title: node.title, type: node.type, skipped: true };
            }

            const base: any = { id: node.id, title: node.title, type: node.type };

            if (includeContent) {
              const raw = await window.api.getSectionContent(token, node.id, format);
              const full = (typeof raw === "string" && raw) ? raw : "";
              if (full.length > DEFAULT_CONTENT_LIMIT) {
                base.content = full.slice(0, DEFAULT_CONTENT_LIMIT);
                base.truncated = true;
                base.totalLen = full.length;
              } else {
                base.content = full;
              }
            }

            const children = node.children || [];
            if (maxDepth === undefined || depth < maxDepth) {
              const formatted = [];
              for (const c of children) {
                formatted.push(await formatNode(c, depth + 1));
              }
              base.children = formatted;
            } else if (children.length > 0) {
              base.children_count = children.length;
            }

            return base;
          };

          const fileBase: any = { id: result.file.id, title: result.file.title, type: result.file.type };
          if (includeContent) {
            const raw = await window.api.getSectionContent(token, result.file.id, format);
            const full = (typeof raw === "string" && raw) ? raw : "";
            if (full.length > DEFAULT_CONTENT_LIMIT) {
              fileBase.content = full.slice(0, DEFAULT_CONTENT_LIMIT);
              fileBase.truncated = true;
              fileBase.totalLen = full.length;
            } else {
              fileBase.content = full;
            }
          }

          const sections = [];
          for (const s of result.sections) {
            sections.push(await formatNode(s, 1));
          }

          const out: any = { file: fileBase, sections };
          if (truncatedByLimit) {
            out.warning = `Stopped after ${MAX_NODES} nodes. Use max_depth or get_section for remaining content.`;
          }

          return JSON.stringify(out);
        }
        case "get_sections_batch": {
          const MAX_BATCH = 20;
          const ids = input.section_ids.slice(0, MAX_BATCH);
          const format = (input.format === "plain") ? "plain" : "markdown";
          const results = [];

          for (const rawId of ids) {
            const id = resolveId(rawId);
            try {
              const section = await window.api.getSection(token, id);
              let raw = await window.api.getSectionContent(token, id, format);
              let content = (typeof raw === "string" && raw) ? raw : "";

              // File-type sections store content in children, not in the file node itself.
              // Auto-collect children content so the model doesn't waste a round discovering this.
              if (section?.type === "file" && !content.trim()) {
                try {
                  const fileData = await window.api.getFileWithSections(token, id);
                  const parts: string[] = [];
                  const collectContent = async (nodes: any[]) => {
                    for (const node of nodes) {
                      const nodeContent = await window.api.getSectionContent(token, node.id, format);
                      if (nodeContent && typeof nodeContent === "string" && nodeContent.trim()) {
                        parts.push(`## ${node.title}\n${nodeContent}`);
                      }
                      if (node.children?.length) await collectContent(node.children);
                    }
                  };
                  await collectContent(fileData.sections || []);
                  content = parts.join("\n\n");
                } catch { /* fallback to empty */ }
              }

              if (content.length > DEFAULT_CONTENT_LIMIT) {
                results.push({
                  id, title: section?.title, type: section?.type,
                  content: content.slice(0, DEFAULT_CONTENT_LIMIT),
                  truncated: true, totalLen: content.length,
                });
              } else {
                results.push({ id, title: section?.title, type: section?.type, content });
              }
            } catch (e: any) {
              results.push({ id, error: e.message });
            }
          }

          const out: any = { sections: results };
          if (input.section_ids.length > MAX_BATCH) {
            out.warning = `Showing first ${MAX_BATCH} of ${input.section_ids.length}. Call again with remaining IDs.`;
          }
          return JSON.stringify(out);
        }
        case "commit_version": {
          const oid = await window.api.commitVersion(token, input.message);
          return oid ? "Version committed successfully." : "Nothing to commit — project is empty.";
        }
        case "get_history": {
          const history = await window.api.getHistory(token);
          return JSON.stringify(history);
        }
        case "restore_version": {
          const autoSaveOid = await window.api.commitVersion(token, `Auto-save before restore to ${input.commit_id}`);
          await window.api.restoreVersion(token, input.commit_id);
          state.mutated = true;
          return autoSaveOid
            ? "Version restored successfully. Current state was auto-committed before restore."
            : "Version restored successfully.";
        }
        case "create_backup": {
          const path = await window.api.createBackup(token);
          return `Backup created: ${path}`;
        }
        case "list_backups": {
          const backups = await window.api.listBackups(token);
          if (backups.length === 0) return "No backups found.";
          return JSON.stringify(backups);
        }
        case "get_project_tree": {
          return await window.api.sourceTree(token, input.glob, input.max_depth);
        }
        case "get_file_outlines": {
          const results = await window.api.sourceOutlines(token, input.paths);
          if (input.paths.length === 1) return results[input.paths[0]] || "File not found";
          return Object.entries(results).map(([p, o]) => `--- ${p} ---\n${o}`).join("\n\n");
        }
        case "read_project_file": {
          if (!input.path || input.path.endsWith("/")) {
            return `Error: "${input.path}" is not a valid file path. Use get_project_tree to list directory contents.`;
          }
          try {
            const raw = await window.api.sourceRead(token, input.path, input.startLine, input.endLine);
            return stripCodeNoise(raw);
          } catch (e: any) {
            if (e.code === "EISDIR" || e.message?.includes("EISDIR")) {
              return `Error: "${input.path}" is a directory, not a file. Use get_project_tree to list its contents.`;
            }
            throw e;
          }
        }
        case "search_project_files": {
          return await window.api.sourceSearch(token, {
            pattern: input.pattern,
            is_regex: input.is_regex,
            case_sensitive: input.case_sensitive,
            whole_word: input.whole_word,
            include: input.include,
            exclude: input.exclude,
            context_lines: input.context_lines,
            output_mode: input.output_mode,
            max_results: input.max_results,
          });
        }
        case "find_symbols": {
          return await window.api.sourceFindSymbols(token, {
            name_pattern: input.name_pattern,
            kind: input.kind,
            file_glob: input.file_glob,
            max_results: input.max_results,
          });
        }
        case "web_search": {
          const { webSearchProvider, webSearchApiKey } = get();
          if (!webSearchApiKey || webSearchProvider === "none") {
            return "Error: Web search is not configured. Ask the user to set up an API key in Settings → Model.";
          }
          const response = await window.api.webSearch({
            provider: webSearchProvider,
            apiKey: webSearchApiKey,
            query: input.query,
            options: {
              maxResults: Math.min(input.max_results ?? 5, 10),
              includeContent: true,
            },
          });
          const formatted = response.results
            .map((r: any, i: number) =>
              `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content || r.snippet}`,
            )
            .join("\n\n");
          return `Found ${response.results.length} results for "${response.query}" (${response.duration}ms):\n\n${formatted}`;
        }
        case "create_plan": {
          const steps = (input.steps || []).map((s: string) => ({
            text: String(s),
            status: "pending" as const,
          }));
          if (steps.length === 0) return "Error: plan must have at least one step";
          steps[0].status = "in_progress";
          const plan = { steps };
          set((s: any) => ({
            llmCurrentPlan: plan,
            llmMessages: [...s.llmMessages, { role: "assistant" as const, content: "", plan: { ...plan, steps: [...plan.steps] } }],
          }));
          return `Plan created with ${steps.length} steps. Now working on step 1: "${steps[0].text}"`;
        }
        case "update_plan": {
          const plan = get().llmCurrentPlan;
          if (!plan) return "Error: no active plan. Create one with create_plan first.";
          const idx = Number(input.step_index);
          if (isNaN(idx) || idx < 0 || idx >= plan.steps.length) return `Error: invalid step index ${input.step_index}. Plan has ${plan.steps.length} steps (0-${plan.steps.length - 1}).`;

          const newSteps = plan.steps.map((s) => ({ ...s }));
          newSteps[idx].status = input.status as "in_progress" | "done";

          // Auto-advance: if marking done and next step exists, set it to in_progress
          if (input.status === "done" && idx + 1 < newSteps.length && newSteps[idx + 1].status === "pending") {
            newSteps[idx + 1].status = "in_progress";
          }

          const updatedPlan = { steps: newSteps };
          const planSnapshot = { steps: newSteps.map((st: any) => ({ ...st })) };
          set((s: any) => ({
            llmCurrentPlan: updatedPlan,
            // Update old plan messages in-place AND append fresh copy at the bottom
            llmMessages: [
              ...s.llmMessages.map((m: any) =>
                m.plan ? { ...m, plan: planSnapshot } : m
              ),
              { role: "assistant" as const, content: "", plan: { ...planSnapshot, steps: [...planSnapshot.steps] } },
            ],
          }));

          const allDone = newSteps.every((s) => s.status === "done");
          if (allDone) {
            set({ llmCurrentPlan: null });
            return "All plan steps completed!";
          }
          const nextStep = newSteps.find((s) => s.status === "in_progress");
          const nextIdx = nextStep ? newSteps.indexOf(nextStep) : -1;
          return `Step ${idx + 1} "${newSteps[idx].text}" done.${nextStep ? ` Now working on step ${nextIdx + 1}: "${nextStep.text}"` : ""}`;
        }
        case "ask_user":
          return "Error: ask_user should be handled by the engine, not the executor.";
        case "rate_agent": {
          const agents = get().customAgents || [];
          const agent = agents.find((a: any) => a.id === input.agent_id);
          if (!agent) return `Error: agent "${input.agent_id}" not found`;
          const score = Math.max(0, Math.min(10, Number(input.score) || 10));
          const issues = input.issues ? String(input.issues) : undefined;
          const newLog = issues ? [issues, ...(agent.ratingLog || []).slice(0, 9)] : (agent.ratingLog || []);
          // Running average: blend old rating with new score (biased toward history)
          const newRating = Math.round(((agent.rating ?? 10) * 0.6 + score * 0.4) * 10) / 10;
          get().updateCustomAgent(agent.id, { rating: newRating, ratingLog: newLog });
          return `Agent "${agent.name}" rated: ${score}/10 → rating now ${newRating}/10${issues ? `. Issues noted: ${issues}` : ""}`;
        }
        case "run_agent": {
          const mutatedBefore = state.mutated;
          const agentResult = await executeAgentTool(input, token, get, set, state);
          // If agent was stopped by user, reset abort so the assistant can continue
          if (get().llmAborted) {
            set({ llmAborted: false });
          }
          // If agent mutated data, invalidate our cache so main assistant gets fresh data
          if (state.mutated && !mutatedBefore) {
            invalidateCache(cache);
            invalidateCache(persistentCache);
          }
          return agentResult + `\n\n[IMPORTANT: Call rate_agent(agent_id="${input.agent_id}", score=...) to rate this agent's performance]`;
        }
        // ─── Session buffer tools ──────────────────────────────
        case "write_buffer": {
          return get().writeBuffer(
            String(input.key || ""),
            String(input.content || ""),
            String(input.summary || ""),
            authorName,
            Array.isArray(input.tags) ? input.tags : undefined,
          );
        }
        case "read_buffer": {
          const entry = get().readBuffer(String(input.key || ""));
          if (!entry) return `Buffer entry "${input.key}" not found. Use list_buffer to see available entries.`;
          const limit = Math.min(Math.max(input.limit || DEFAULT_CONTENT_LIMIT, 1), MAX_CONTENT_LIMIT);
          const offset = Math.max(input.offset || 0, 0);
          const page = paginateText(entry.content, offset, limit);
          const meta: any = { key: entry.key, author: entry.author, tags: entry.tags, charCount: entry.charCount, content: page.slice };
          if (page.hasMore) {
            meta.hasMore = true;
            meta.nextOffset = page.end;
            meta.hint = `Use read_buffer(key="${entry.key}", offset=${page.end}) to continue reading.`;
          }
          return JSON.stringify(meta);
        }
        case "list_buffer": {
          const entries = get().listBuffer(input.tag ? String(input.tag) : undefined);
          if (entries.length === 0) return "Session buffer is empty.";
          return JSON.stringify({ entries, totalEntries: entries.length });
        }

        default:
          return `Unknown tool: ${name}`;
      }
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  /** Resolve section/file IDs in input to full UUIDs for consistent cache keys. */
  function resolveInputIds(input: any): any {
    const out = { ...input };
    if (out.section_id) try { out.section_id = resolveId(out.section_id); } catch { /* keep original */ }
    if (out.file_id) try { out.file_id = resolveId(out.file_id); } catch { /* keep original */ }
    if (out.parent_id && out.parent_id !== "null") try { out.parent_id = resolveId(out.parent_id); } catch { /* keep original */ }
    if (Array.isArray(out.section_ids)) {
      out.section_ids = out.section_ids.map((id: string) => { try { return resolveId(id); } catch { return id; } });
    }
    return out;
  }

  /** Find "Быстрые идеи" / "Quick Ideas" folder in tree. */
  function findQuickIdeasFolder(tree: any[]): string | null {
    for (const node of tree) {
      if (node.title === "Быстрые идеи" || node.title === "Quick Ideas") return node.id;
      if (node.children?.length) {
        const found = findQuickIdeasFolder(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Wrapper that adds caching and invalidation
  return async function executeToolCached(name: string, rawInput: any): Promise<string> {
    const input = resolveInputIds(normalizeInput(rawInput));
    const cacheKey = buildCacheKey(name, input);

    // Check cache for read-only tools
    if (cacheKey && cache.has(cacheKey)) {
      console.log(`[ToolCache] HIT ${name} (${cacheKey.slice(0, 80)})`);
      return cache.get(cacheKey)!;
    }

    const result = await executeToolInner(name, rawInput);

    // Tool error tracking (Feature 3: Tool Diagnostics)
    if (result.startsWith("Error:")) {
      const entry = toolErrorCounts.get(name) || { count: 0, errors: [] };
      entry.count++;
      entry.errors.push(result.slice(0, 200));
      toolErrorCounts.set(name, entry);

      // If devTrackToolIssues is on and tool errored 3+ times, create an idea in Quick Ideas
      if (entry.count === 3 && get().devTrackToolIssues) {
        const quickIdeasId = findQuickIdeasFolder(get().tree);
        if (quickIdeasId) {
          window.api.createSection(
            token, quickIdeasId,
            `Tool issue: ${name}`, "idea", null,
            `Tool "${name}" failed ${entry.count} times.\nErrors:\n${entry.errors.join("\n")}`,
          ).catch(() => {});
        }
      }
    }

    // Invalidate cache on mutating operations
    const isMutating = ["create_section", "bulk_create_sections", "update_section", "bulk_update_sections",
      "delete_section", "move_section", "reorder_children", "duplicate_section", "restore_section",
      "update_icon", "restore_version"].includes(name);
    if (isMutating) {
      const broadMutation = name === "restore_version" || name === "bulk_create_sections" || name === "bulk_update_sections" || name === "reorder_children";
      const sid = broadMutation ? undefined : (input.section_id || input.file_id || state.lastCreatedId);
      invalidateCache(cache, sid);
      invalidateCache(persistentCache, sid);
      // Force immediate save on mutation (no debounce)
      if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
      try {
        const entries: [string, CacheEntry][] = [];
        for (const [k, entry] of persistentCache) {
          const tn = k.split(":")[0];
          if (PERSISTABLE_TOOLS.has(tn)) entries.push([k, entry]);
        }
        localStorage.setItem(PERSISTENT_CACHE_KEY_PREFIX + token, JSON.stringify(entries.slice(-PERSISTENT_CACHE_MAX_ENTRIES)));
      } catch { /* ignore */ }
    }

    // Save to cache for read-only tools
    if (cacheKey && !result.startsWith("Error:")) {
      cache.set(cacheKey, result);
      // Persist to localStorage for cross-session caching
      const toolName = cacheKey.split(":")[0];
      if (PERSISTABLE_TOOLS.has(toolName)) {
        persistentCache.set(cacheKey, { v: result, t: Date.now() });
        savePersistentCache(token, persistentCache);
      }
    }

    return result;
  };
}
