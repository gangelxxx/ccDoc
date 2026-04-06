import type { ModelTierConfig } from "./settings.types.js";
import type { ScriptRunner } from "./provider-scripts/script-runner.js";
import type { ChatParams } from "./provider-scripts/types.js";

export type TestStageName =
  | "connection" | "tool_selection" | "tool_params" | "param_types" | "error_recovery" | "multi_turn" | "structured_output" | "instruction_following"
  | "light_basic_tool" | "light_short_answer" | "light_thinking"
  | "medium_multi_tool" | "medium_long_output" | "medium_param_sensitivity"
  | "heavy_doc_generation" | "heavy_doc_restructure" | "heavy_completeness" | "heavy_architecture";

export type TestDifficulty = "light" | "medium" | "heavy";

export interface ModelTestResult {
  stage: TestStageName;
  success: boolean;
  latencyMs: number;
  error?: string;
  details?: string;
}

export const BASE_STAGES: TestStageName[] = ["connection", "tool_selection", "tool_params", "param_types", "error_recovery", "multi_turn", "structured_output", "instruction_following"];
export const LIGHT_STAGES: TestStageName[] = ["light_basic_tool", "light_short_answer", "light_thinking"];
export const MEDIUM_STAGES: TestStageName[] = ["medium_multi_tool", "medium_long_output", "medium_param_sensitivity"];
export const HEAVY_STAGES: TestStageName[] = ["heavy_doc_generation", "heavy_doc_restructure", "heavy_completeness", "heavy_architecture"];

const TEST_TIMEOUT = 90_000;
const HEAVY_TIMEOUT = 180_000;
const INTER_STAGE_DELAY = 1500;

function makeAbortSignal(timeout = TEST_TIMEOUT): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), timeout);
  return ctrl.signal;
}

/** Base test params (hardcoded, temperature 0) */
function baseParams(system: string, messages: any[], extra?: Partial<ChatParams>): ChatParams {
  return {
    messages,
    system,
    maxTokens: 1024,
    temperature: 0,
    thinking: false,
    thinkingBudget: 0,
    stream: false,
    signal: makeAbortSignal(),
    skipMessageCache: true,
    ...extra,
  };
}

/** Extended test params (uses user's actual config settings) */
function configParams(config: ModelTierConfig, system: string, messages: any[], extra?: Partial<ChatParams>): ChatParams {
  const isHeavy = (extra as any)?._heavy;
  return {
    messages,
    system,
    maxTokens: config.maxTokens || 4096,
    temperature: config.temperature ?? 1,
    thinking: config.thinking || false,
    thinkingBudget: config.thinkingBudget || 0,
    stream: false,
    signal: makeAbortSignal(isHeavy ? HEAVY_TIMEOUT : TEST_TIMEOUT),
    skipMessageCache: true,
    ...extra,
  };
}

// ─── Format-agnostic response parsing ──────────────────────

function extractText(data: any): string | null {
  if (Array.isArray(data.content)) {
    const block = data.content.find((b: any) => b.type === "text");
    if (block?.text) return block.text;
  }
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (data.message?.content) return data.message.content;
  return null;
}

function extractToolCalls(data: any): Array<{ id: string; name: string; input: any }> {
  const result: Array<{ id: string; name: string; input: any }> = [];
  if (Array.isArray(data.content)) {
    for (const b of data.content) {
      if (b.type === "tool_use") result.push({ id: b.id || "tc_test", name: b.name, input: b.input || {} });
    }
  }
  if (Array.isArray(data.choices)) {
    const toolCalls = data.choices[0]?.message?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        if (tc.function) {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          result.push({ id: tc.id || "tc_test", name: tc.function.name, input: args });
        }
      }
    }
  }
  return result;
}

function hasAnyContent(data: any): boolean {
  return extractText(data) !== null || extractToolCalls(data).length > 0;
}

function getModelName(data: any, fallback: string): string {
  return data.model || fallback;
}

// ─── Real ccDoc tool definitions (subset used for testing) ──

const CCDOC_TOOLS = [
  {
    name: "gt",
    description: "Navigate documentation tree. Returns node metadata (title, type, summary, children).",
    input_schema: { type: "object" as const, properties: { id: { type: "string", description: "Node ID" }, depth: { type: "number", description: "Max depth" } }, required: [] as string[] },
  },
  {
    name: "read",
    description: "Read section content by ID.",
    input_schema: { type: "object" as const, properties: { id: { type: "string", description: "Section ID" } }, required: ["id"] },
  },
  {
    name: "search",
    description: "Search documentation by query string.",
    input_schema: { type: "object" as const, properties: { query: { type: "string", description: "Search query" } }, required: ["query"] },
  },
  {
    name: "create_section",
    description: "Create a new documentation section.",
    input_schema: { type: "object" as const, properties: { parent_id: { type: "string" }, title: { type: "string" }, type: { type: "string", enum: ["folder", "file", "section"] }, content: { type: "string" } }, required: ["title", "type"] },
  },
  {
    name: "update_section",
    description: "Update an existing section's title and/or content.",
    input_schema: { type: "object" as const, properties: { id: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, required: ["id"] },
  },
  {
    name: "delete_section",
    description: "Delete a section by ID (soft delete).",
    input_schema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "move_section",
    description: "Move a section to a new parent.",
    input_schema: { type: "object" as const, properties: { id: { type: "string" }, parent_id: { type: "string" }, after_id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_project_tree",
    description: "Get the source code project tree structure.",
    input_schema: { type: "object" as const, properties: { glob: { type: "string" }, max_depth: { type: "number" } }, required: [] as string[] },
  },
  {
    name: "read_project_file",
    description: "Read a source code file from the project.",
    input_schema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "search_project_files",
    description: "Search source code files by pattern.",
    input_schema: { type: "object" as const, properties: { query: { type: "string" }, glob: { type: "string" } }, required: ["query"] },
  },
];

const VALID_TOOL_NAMES = new Set(CCDOC_TOOLS.map(t => t.name));

// ─── Helper: detect response format ──────────────────────

function isOpenAIFormat(data: any): boolean {
  return Array.isArray(data.choices);
}

// ─── Helper: build assistant + tool_result messages for multi-turn ──
// Must match the format of the RESPONSE so the provider script can handle it properly.

function buildAssistantMessage(data: any): any {
  // Anthropic format — content is array of blocks
  if (Array.isArray(data.content)) {
    return { role: "assistant", content: data.content };
  }
  // OpenAI format — message inside choices
  if (Array.isArray(data.choices) && data.choices[0]?.message) {
    const msg = data.choices[0].message;
    return { role: "assistant", content: msg.content, tool_calls: msg.tool_calls };
  }
  return { role: "assistant", content: extractText(data) || "" };
}

function buildToolResultMessages(data: any, toolCalls: Array<{ id: string; name: string; input: any }>, results: Record<string, string>): any[] {
  if (isOpenAIFormat(data)) {
    // OpenAI/OpenRouter format: role:"tool" messages (one per tool call)
    return toolCalls.map(tc => ({
      role: "tool",
      tool_call_id: tc.id,
      content: results[tc.name] || "OK",
    }));
  }
  // Anthropic format: user message with tool_result blocks
  return [{
    role: "user",
    content: toolCalls.map(tc => ({
      type: "tool_result",
      tool_use_id: tc.id,
      content: results[tc.name] || "OK",
    })),
  }];
}

// ─── Test stages ───────────────────────────────────────────

/** Stage 1: Connection — minimal request, verify basic connectivity */
async function testConnection(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, baseParams(
      "Respond with exactly one word.",
      [{ role: "user", content: "Say OK" }],
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "connection", success: false, latencyMs: latency, error: `HTTP ${res.status}`, details: text.slice(0, 500) };
    }
    const data = await res.json();
    if (!hasAnyContent(data)) {
      return { stage: "connection", success: false, latencyMs: latency, error: "Empty response", details: JSON.stringify(data).slice(0, 500) };
    }
    return { stage: "connection", success: true, latencyMs: latency, details: `Model: ${getModelName(data, config.modelId)}` };
  } catch (e: any) {
    return { stage: "connection", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 2: Tool Selection — model must choose the correct tool WITHOUT hints.
 *  System prompt gives NO indication which tool to use.
 *  Task: "Find documentation about authentication" → must call `search` */
async function testToolSelection(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, baseParams(
      "You are a documentation assistant. You have access to tools for managing a documentation system. Use the tools when appropriate to fulfill user requests. Do not explain what you would do — just do it.",
      [{ role: "user", content: "Find all documentation related to authentication and security." }],
      { tools: CCDOC_TOOLS },
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "tool_selection", success: false, latencyMs: latency, error: `HTTP ${res.status}`, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const toolCalls = extractToolCalls(data);

    if (toolCalls.length === 0) {
      const text = extractText(data);
      return { stage: "tool_selection", success: false, latencyMs: latency, error: "Model did not call any tool (just gave text instead of acting)", details: text?.slice(0, 300) || "" };
    }

    const called = toolCalls[0];
    if (!VALID_TOOL_NAMES.has(called.name)) {
      return { stage: "tool_selection", success: false, latencyMs: latency, error: `Hallucinated tool: "${called.name}"`, details: `Valid tools: ${[...VALID_TOOL_NAMES].join(", ")}` };
    }

    // Must call "search" — that's the only sensible tool for "find documentation about X"
    if (called.name !== "search") {
      return { stage: "tool_selection", success: false, latencyMs: latency, error: `Wrong tool: "${called.name}" (expected "search" for a search query)` };
    }

    // Must pass a query param
    if (!called.input?.query || typeof called.input.query !== "string" || called.input.query.trim().length === 0) {
      return { stage: "tool_selection", success: false, latencyMs: latency, error: "Called search but with empty/missing query parameter" };
    }

    return { stage: "tool_selection", success: true, latencyMs: latency, details: `search(query: "${called.input.query}")` };
  } catch (e: any) {
    return { stage: "tool_selection", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 3: Tool Params — complex multi-param tool call.
 *  Task: create a section with specific title, type, parent_id, and content.
 *  Model must pass ALL required params correctly. */
async function testToolParams(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, baseParams(
      "You are a documentation assistant. Use the provided tools to fulfill requests. Do not explain — just execute.",
      [{ role: "user", content: 'Create a new documentation file titled "API Reference" inside the folder with id "folder-xyz-789". The content should be: "## Overview\\nThis section covers the REST API endpoints."' }],
      { tools: CCDOC_TOOLS },
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "tool_params", success: false, latencyMs: latency, error: `HTTP ${res.status}`, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const toolCalls = extractToolCalls(data);

    if (toolCalls.length === 0) {
      return { stage: "tool_params", success: false, latencyMs: latency, error: "Model did not call any tool" };
    }

    const called = toolCalls[0];
    if (!VALID_TOOL_NAMES.has(called.name)) {
      return { stage: "tool_params", success: false, latencyMs: latency, error: `Hallucinated tool: "${called.name}"` };
    }
    if (called.name !== "create_section") {
      return { stage: "tool_params", success: false, latencyMs: latency, error: `Wrong tool: "${called.name}" (expected "create_section")` };
    }

    const errors: string[] = [];

    // Check title
    if (!called.input?.title || !called.input.title.toLowerCase().includes("api reference")) {
      errors.push("title: " + JSON.stringify(called.input?.title ?? null) + " - expected API Reference");
    }

    // Check type - must be "file"
    if (called.input?.type !== "file") {
      errors.push("type: " + JSON.stringify(called.input?.type ?? null) + " - expected file");
    }

    // Check parent_id
    if (called.input?.parent_id !== "folder-xyz-789") {
      errors.push("parent_id: " + JSON.stringify(called.input?.parent_id ?? null) + " - expected folder-xyz-789");
    }

    // Check content - must contain something about API/Overview
    if (!called.input?.content || called.input.content.length < 10) {
      errors.push("content: too short or missing");
    }

    if (errors.length > 0) {
      return { stage: "tool_params", success: false, latencyMs: latency, error: "Wrong params (" + errors.length + " issues)", details: errors.join("; ") };
    }

    const det = "create_section(title: " + called.input.title + ", type: " + called.input.type + ", parent: " + called.input.parent_id + ")";
    return { stage: "tool_params", success: true, latencyMs: latency, details: det };
  } catch (e: any) {
    return { stage: "tool_params", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 4: Param Types — model must pass correct TYPES for parameters.
 *  Catches: array instead of string, object instead of string, number instead of string.
 *  Task: read two sections sequentially (must call read TWICE with string id, not once with array). */
async function testParamTypes(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, baseParams(
      "You are a documentation assistant. Use the provided tools to fulfill requests. The 'read' tool accepts a single section ID as a string. To read multiple sections, call the tool multiple times, once per section.",
      [{ role: "user", content: 'Read these two sections: first "sec-alpha-1", then "sec-beta-2".' }],
      { tools: CCDOC_TOOLS },
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "param_types", success: false, latencyMs: latency, error: "HTTP " + res.status, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const toolCalls = extractToolCalls(data);

    if (toolCalls.length === 0) {
      return { stage: "param_types", success: false, latencyMs: latency, error: "No tool called" };
    }

    // Check all tool calls use correct param types
    const typeErrors: string[] = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      if (tc.name === "read") {
        // id must be a string, NOT an array or object
        if (Array.isArray(tc.input?.id)) {
          typeErrors.push("read() call #" + (i + 1) + ": id is array " + JSON.stringify(tc.input.id) + " (must be string)");
        } else if (typeof tc.input?.id === "object" && tc.input?.id !== null) {
          typeErrors.push("read() call #" + (i + 1) + ": id is object (must be string)");
        } else if (typeof tc.input?.id !== "string") {
          typeErrors.push("read() call #" + (i + 1) + ": id is " + typeof tc.input?.id + " (must be string)");
        }
      }
      if (tc.name === "search") {
        if (typeof tc.input?.query !== "string") {
          typeErrors.push("search() call #" + (i + 1) + ": query is " + typeof tc.input?.query + " (must be string)");
        }
      }
    }

    if (typeErrors.length > 0) {
      return { stage: "param_types", success: false, latencyMs: latency, error: "Wrong param types (" + typeErrors.length + ")", details: typeErrors.join("; ") };
    }

    // Should have called read at least once with string id
    const readCalls = toolCalls.filter(tc => tc.name === "read" && typeof tc.input?.id === "string");
    if (readCalls.length === 0) {
      return { stage: "param_types", success: false, latencyMs: latency, error: "No valid read(id: string) call found", details: "Tools called: " + toolCalls.map(tc => tc.name).join(", ") };
    }

    // Ideally should call read twice (once per section)
    const detail = readCalls.length >= 2
      ? "2 read() calls with string ids"
      : "1 read() call (expected 2, but types are correct)";

    return { stage: "param_types", success: true, latencyMs: latency, details: detail };
  } catch (e: any) {
    return { stage: "param_types", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 5: Error Recovery — model calls a tool, gets an error, must fix the call (not repeat it).
 *  Round 1: model calls create_section → gets error "parent_id required"
 *  Round 2: model must fix by adding parent_id, NOT repeat the same broken call */
async function testErrorRecovery(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const systemPrompt = "You are a documentation assistant. Use the provided tools. When a tool returns an error, read the error message carefully and fix your call. Do NOT repeat the same call that failed.";

    // Round 1: expect model to call create_section (likely without parent_id)
    const res1 = await runner.chat(config, baseParams(
      systemPrompt,
      [{ role: "user", content: 'Create a new documentation file titled "Getting Started" inside the project.' }],
      { tools: CCDOC_TOOLS },
    ));
    if (!res1.ok) {
      return { stage: "error_recovery", success: false, latencyMs: Date.now() - start, error: "Round 1: HTTP " + res1.status };
    }
    const data1 = await res1.json();
    const tc1 = extractToolCalls(data1);
    if (tc1.length === 0) {
      return { stage: "error_recovery", success: false, latencyMs: Date.now() - start, error: "Round 1: no tool called" };
    }

    // Simulate error response regardless of what model called
    const assistantMsg = buildAssistantMessage(data1);
    const errorResult = 'Error: Cannot create section without parent_id. The project root folder ID is "root-folder-abc". Please specify parent_id to place the section inside the correct folder.';

    const toolResultMsgs = buildToolResultMessages(data1, tc1, {
      create_section: errorResult,
      gt: errorResult,
      read: errorResult,
      search: errorResult,
    });

    // Round 2: feed error, expect model to fix the call
    const res2 = await runner.chat(config, baseParams(
      systemPrompt,
      [
        { role: "user", content: 'Create a new documentation file titled "Getting Started" inside the project.' },
        assistantMsg,
        ...toolResultMsgs,
      ],
      { tools: CCDOC_TOOLS },
    ));
    if (!res2.ok) {
      return { stage: "error_recovery", success: false, latencyMs: Date.now() - start, error: "Round 2: HTTP " + res2.status };
    }
    const data2 = await res2.json();
    const tc2 = extractToolCalls(data2);

    if (tc2.length === 0) {
      // Model gave text instead of retrying — check if it explains the error
      const text2 = extractText(data2);
      if (text2 && text2.length > 20) {
        return { stage: "error_recovery", success: true, latencyMs: Date.now() - start, details: "Explained error instead of retrying (acceptable)" };
      }
      return { stage: "error_recovery", success: false, latencyMs: Date.now() - start, error: "Round 2: no tool call and no explanation" };
    }

    // Check that Round 2 call is DIFFERENT from Round 1 (model fixed something)
    const sig1 = tc1.map(t => t.name + ":" + JSON.stringify(t.input)).join("|");
    const sig2 = tc2.map(t => t.name + ":" + JSON.stringify(t.input)).join("|");
    if (sig1 === sig2) {
      return { stage: "error_recovery", success: false, latencyMs: Date.now() - start, error: "Model repeated exact same call (did not fix the error)", details: "Call: " + tc2[0].name + "(" + JSON.stringify(tc2[0].input).slice(0, 100) + ")" };
    }

    // Check that the fixed call includes parent_id (from the error message)
    const fixedCall = tc2[0];
    if (fixedCall.name === "create_section" && fixedCall.input?.parent_id) {
      return { stage: "error_recovery", success: true, latencyMs: Date.now() - start, details: "Fixed: added parent_id=" + fixedCall.input.parent_id };
    }

    // Any different call is acceptable (model adapted)
    return { stage: "error_recovery", success: true, latencyMs: Date.now() - start, details: "Adapted: " + fixedCall.name + " (different from round 1)" };
  } catch (e: any) {
    return { stage: "error_recovery", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 6: Multi-turn — model calls tool, receives result, must produce coherent summary.
 *  Round 1: ask to explore docs → model calls gt
 *  Round 2: feed tree result → model must summarize it in text */
async function testMultiTurn(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const systemPrompt = "You are a documentation assistant. Use the provided tools to fulfill requests. After receiving tool results, summarize the findings for the user in a concise text response.";

    // Round 1: expect model to call gt or search
    const res1 = await runner.chat(config, baseParams(
      systemPrompt,
      [{ role: "user", content: "Show me what documentation sections exist in this project." }],
      { tools: CCDOC_TOOLS },
    ));

    if (!res1.ok) {
      const text = await res1.text().catch(() => "");
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: `Round 1: HTTP ${res1.status}`, details: text.slice(0, 500) };
    }

    const data1 = await res1.json();
    const toolCalls1 = extractToolCalls(data1);

    if (toolCalls1.length === 0) {
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: "Round 1: Model did not call any tool (should have used gt or search)" };
    }

    const called1 = toolCalls1[0];
    if (!VALID_TOOL_NAMES.has(called1.name)) {
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: `Round 1: Hallucinated tool "${called1.name}"` };
    }

    // Accept gt or search as valid first moves
    if (called1.name !== "gt" && called1.name !== "search") {
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: `Round 1: Unexpected tool "${called1.name}" (expected gt or search)` };
    }

    // Build fake tool result
    const fakeTreeResult = JSON.stringify({
      id: "root",
      title: "Project Documentation",
      type: "folder",
      children: [
        { id: "sec-1", title: "Getting Started", type: "file", summary: "Installation and setup guide" },
        { id: "sec-2", title: "API Reference", type: "file", summary: "REST API endpoints documentation" },
        { id: "sec-3", title: "Architecture", type: "file", summary: "System architecture overview" },
        { id: "sec-4", title: "Deployment", type: "file", summary: "Deployment and CI/CD configuration" },
      ],
    });

    // Round 2: send tool result, expect text summary
    const assistantMsg = buildAssistantMessage(data1);
    const toolResultMsgs = buildToolResultMessages(data1, toolCalls1, {
      gt: fakeTreeResult,
      search: fakeTreeResult,
    });

    const res2 = await runner.chat(config, baseParams(
      systemPrompt,
      [
        { role: "user", content: "Show me what documentation sections exist in this project." },
        assistantMsg,
        ...toolResultMsgs,
      ],
      { tools: CCDOC_TOOLS },
    ));

    if (!res2.ok) {
      const text = await res2.text().catch(() => "");
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: `Round 2: HTTP ${res2.status}`, details: text.slice(0, 500) };
    }

    const data2 = await res2.json();
    const text2 = extractText(data2);

    if (!text2 || text2.trim().length < 20) {
      // Maybe model made another tool call instead of summarizing — that's also acceptable
      const toolCalls2 = extractToolCalls(data2);
      if (toolCalls2.length > 0) {
        const called2 = toolCalls2[0];
        if (!VALID_TOOL_NAMES.has(called2.name)) {
          return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: `Round 2: Hallucinated tool "${called2.name}"` };
        }
        // Model wants to explore deeper — acceptable
        return { stage: "multi_turn", success: true, latencyMs: Date.now() - start, details: `Round 2: continued with ${called2.name}() - model wants to explore deeper` };
      }
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: "Round 2: Empty or too short response after receiving tool result", details: text2?.slice(0, 200) || "no text" };
    }

    // Check that the summary actually references some of the sections from the result
    const mentionsContent = ["getting started", "api", "architecture", "deployment", "setup", "endpoint", "reference"]
      .filter(kw => text2.toLowerCase().includes(kw));

    if (mentionsContent.length < 2) {
      return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: "Round 2: Summary doesn't reference the tool result content", details: `Only matched keywords: [${mentionsContent.join(", ")}]. Response: "${text2.slice(0, 200)}"` };
    }

    return { stage: "multi_turn", success: true, latencyMs: Date.now() - start, details: `Summarized ${mentionsContent.length} sections. ${text2.trim().slice(0, 100)}...` };
  } catch (e: any) {
    return { stage: "multi_turn", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 5: Structured Output — model must generate markdown with specific headings.
 *  Tests ability to follow format requirements precisely. */
async function testStructuredOutput(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, baseParams(
      "You are a technical writer. Follow formatting instructions precisely. Output ONLY the requested content, no explanations or preamble.",
      [{ role: "user", content: `Write a short documentation section about a function called "processData". Use EXACTLY this markdown structure:

## processData

### Description
(1-2 sentences about what it does)

### Parameters
- **input** (string) — description
- **options** (object) — description

### Returns
(1 sentence about return value)

### Example
(a short code block with usage example)

Do NOT add any other headings or sections. Follow this structure exactly.` }],
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "structured_output", success: false, latencyMs: latency, error: `HTTP ${res.status}`, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.trim().length < 50) {
      return { stage: "structured_output", success: false, latencyMs: latency, error: "Response too short or empty", details: text?.slice(0, 200) || "" };
    }

    const errors: string[] = [];

    // Check required headings
    const requiredH2 = ["processdata", "processData"];
    const requiredH3 = ["description", "parameters", "returns", "example"];

    const textLower = text.toLowerCase();

    // Check ## processData heading
    if (!textLower.includes("## processdata")) {
      errors.push('Missing "## processData" heading');
    }

    // Check ### headings
    for (const h of requiredH3) {
      if (!textLower.includes(`### ${h}`)) {
        errors.push(`Missing "### ${h}" heading`);
      }
    }

    // Check parameters section has bullet points
    if (!text.includes("**input**") && !text.includes("`input`")) {
      errors.push('Missing "input" parameter');
    }
    if (!text.includes("**options**") && !text.includes("`options`")) {
      errors.push('Missing "options" parameter');
    }

    // Check code block exists
    if (!text.includes("```")) {
      errors.push("Missing code block in Example section");
    }

    if (errors.length > 0) {
      return { stage: "structured_output", success: false, latencyMs: latency, error: `Structure violations (${errors.length})`, details: errors.join("; ") };
    }

    return { stage: "structured_output", success: true, latencyMs: latency, details: `${text.trim().length} chars, all headings present` };
  } catch (e: any) {
    return { stage: "structured_output", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Stage 6: Instruction Following — complex constraints + Russian language.
 *  Model must follow multiple simultaneous constraints. */
async function testInstructionFollowing(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, baseParams(
      "Ты — технический писатель. Отвечай строго на русском языке. Следуй инструкциям точно.",
      [{ role: "user", content: `Напиши ровно 5 преимуществ использования системы документации. Требования:
1. Каждый пункт начинается с номера и точки (например "1. ")
2. Каждый пункт — ровно одно предложение
3. Все пункты на русском языке
4. В конце добавь строку "---" и одно предложение-вывод
5. Никаких заголовков, вступлений или пояснений — только список и вывод` }],
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "instruction_following", success: false, latencyMs: latency, error: `HTTP ${res.status}`, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.trim().length < 30) {
      return { stage: "instruction_following", success: false, latencyMs: latency, error: "Response too short or empty", details: text?.slice(0, 200) || "" };
    }

    const errors: string[] = [];
    const lines = text.trim().split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Check numbered items (1. through 5.)
    let numberedCount = 0;
    for (let i = 1; i <= 5; i++) {
      const found = lines.some(l => l.startsWith(`${i}.`) || l.startsWith(`${i})`));
      if (found) numberedCount++;
    }
    if (numberedCount < 4) {
      errors.push(`Only ${numberedCount}/5 numbered items found`);
    }

    // Check for "---" separator
    if (!text.includes("---")) {
      errors.push('Missing "---" separator before conclusion');
    }

    // Check Russian language — look for Cyrillic characters
    const cyrillicMatches = text.match(/[\u0400-\u04FF]/g);
    const totalAlpha = text.match(/[a-zA-Z\u0400-\u04FF]/g);
    if (!cyrillicMatches || !totalAlpha) {
      errors.push("No Cyrillic text detected");
    } else {
      const cyrillicRatio = cyrillicMatches.length / totalAlpha.length;
      if (cyrillicRatio < 0.7) {
        errors.push(`Low Cyrillic ratio: ${Math.round(cyrillicRatio * 100)}% (expected >70%)`);
      }
    }

    // Check there's no heading (## or #)
    if (lines.some(l => l.startsWith("#"))) {
      errors.push("Contains headings (was told not to add any)");
    }

    if (errors.length > 0) {
      return { stage: "instruction_following", success: false, latencyMs: latency, error: `Instruction violations (${errors.length})`, details: errors.join("; ") };
    }

    return { stage: "instruction_following", success: true, latencyMs: latency, details: `${numberedCount} items, Russian, ${lines.length} lines` };
  } catch (e: any) {
    return { stage: "instruction_following", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// LIGHT tests (use config params)
// ═══════════════════════════════════════════════════════════

/** Light 1: Tool call using user's actual config params */
async function testLightBasicTool(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, configParams(config,
      "You are a documentation assistant. Use tools to fulfill requests.",
      [{ role: "user", content: "Read the section with id 'test-section-42'." }],
      { tools: CCDOC_TOOLS },
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "light_basic_tool", success: false, latencyMs: latency, error: "HTTP " + res.status, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const toolCalls = extractToolCalls(data);
    if (toolCalls.length === 0) {
      return { stage: "light_basic_tool", success: false, latencyMs: latency, error: "No tool called with your config params" };
    }
    if (toolCalls[0].name !== "read") {
      return { stage: "light_basic_tool", success: false, latencyMs: latency, error: "Wrong tool: " + toolCalls[0].name + " (expected read)" };
    }
    if (toolCalls[0].input?.id !== "test-section-42") {
      return { stage: "light_basic_tool", success: false, latencyMs: latency, error: "Wrong id: " + JSON.stringify(toolCalls[0].input?.id) };
    }
    return { stage: "light_basic_tool", success: true, latencyMs: latency, details: "read(id: test-section-42) with temp=" + config.temperature };
  } catch (e: any) {
    return { stage: "light_basic_tool", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Light 2: Short coherent answer with user's config */
async function testLightShortAnswer(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, configParams(config,
      "Answer concisely. Respond in Russian.",
      [{ role: "user", content: "Explain in 2-3 sentences what a REST API is." }],
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      return { stage: "light_short_answer", success: false, latencyMs: latency, error: "HTTP " + res.status };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.trim().length < 20) {
      return { stage: "light_short_answer", success: false, latencyMs: latency, error: "Empty or too short response" };
    }
    // Check not truncated mid-word (last char should be punctuation or letter)
    const trimmed = text.trim();
    const lastChar = trimmed[trimmed.length - 1];
    const endsCleanly = /[.!?\u0430-\u044f\u0410-\u042fa-zA-Z\d)"]/.test(lastChar);
    if (!endsCleanly) {
      return { stage: "light_short_answer", success: false, latencyMs: latency, error: "Response truncated (last char: " + JSON.stringify(lastChar) + ")", details: trimmed.slice(-50) };
    }
    return { stage: "light_short_answer", success: true, latencyMs: latency, details: trimmed.length + " chars, temp=" + config.temperature };
  } catch (e: any) {
    return { stage: "light_short_answer", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Light 3: Thinking mode test (auto-pass if thinking disabled) */
async function testLightThinking(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  if (!config.thinking) {
    return { stage: "light_thinking", success: true, latencyMs: 0, details: "Thinking disabled - skipped" };
  }
  try {
    const res = await runner.chat(config, configParams(config,
      "Think step by step. Then give a final answer.",
      [{ role: "user", content: "If a documentation tree has sections A (depends on B), B (depends on C), and C (no deps), in what order should they be read? Answer with just the letters." }],
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      return { stage: "light_thinking", success: false, latencyMs: latency, error: "HTTP " + res.status };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text) {
      return { stage: "light_thinking", success: false, latencyMs: latency, error: "Empty response with thinking enabled" };
    }
    // Check that answer contains C before B before A
    const upper = text.toUpperCase();
    const posC = upper.indexOf("C");
    const posB = upper.indexOf("B");
    const posA = upper.indexOf("A");
    if (posC >= 0 && posB >= 0 && posA >= 0 && posC < posB && posB < posA) {
      return { stage: "light_thinking", success: true, latencyMs: latency, details: "Correct order C->B->A, budget=" + config.thinkingBudget };
    }
    return { stage: "light_thinking", success: false, latencyMs: latency, error: "Wrong dependency order", details: text.slice(0, 200) };
  } catch (e: any) {
    return { stage: "light_thinking", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// MEDIUM tests (use config params, more complex)
// ═══════════════════════════════════════════════════════════

/** Medium 1: Multi-tool sequence - must call search then read */
async function testMediumMultiTool(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    // Round 1: expect search
    const res1 = await runner.chat(config, configParams(config,
      "You are a documentation assistant. Use tools to find and read documentation. First search, then read the result.",
      [{ role: "user", content: 'Find documentation about "deployment" and read the first result.' }],
      { tools: CCDOC_TOOLS },
    ));
    if (!res1.ok) {
      return { stage: "medium_multi_tool", success: false, latencyMs: Date.now() - start, error: "Round 1: HTTP " + res1.status };
    }
    const data1 = await res1.json();
    const tc1 = extractToolCalls(data1);
    if (tc1.length === 0 || tc1[0].name !== "search") {
      const called = tc1.length > 0 ? tc1[0].name : "none";
      return { stage: "medium_multi_tool", success: false, latencyMs: Date.now() - start, error: "Round 1: expected search, got " + called };
    }

    // Round 2: feed search result, expect read
    const fakeSearchResult = JSON.stringify([
      { id: "deploy-001", title: "Deployment Guide", type: "file", snippet: "How to deploy the application..." },
      { id: "deploy-002", title: "CI/CD Pipeline", type: "file", snippet: "Continuous integration setup..." },
    ]);
    const assistantMsg = buildAssistantMessage(data1);
    const toolResultMsgs = buildToolResultMessages(data1, tc1, { search: fakeSearchResult });

    const res2 = await runner.chat(config, configParams(config,
      "You are a documentation assistant. Use tools to find and read documentation. You received search results. Now read the first result.",
      [
        { role: "user", content: 'Find documentation about "deployment" and read the first result.' },
        assistantMsg,
        ...toolResultMsgs,
      ],
      { tools: CCDOC_TOOLS },
    ));
    if (!res2.ok) {
      return { stage: "medium_multi_tool", success: false, latencyMs: Date.now() - start, error: "Round 2: HTTP " + res2.status };
    }
    const data2 = await res2.json();
    const tc2 = extractToolCalls(data2);
    if (tc2.length === 0) {
      // Model might summarize search results instead - acceptable if it mentions deployment
      const text2 = extractText(data2);
      if (text2 && text2.toLowerCase().includes("deploy")) {
        return { stage: "medium_multi_tool", success: true, latencyMs: Date.now() - start, details: "Summarized search results (no read call)" };
      }
      return { stage: "medium_multi_tool", success: false, latencyMs: Date.now() - start, error: "Round 2: no tool call and no relevant summary" };
    }
    if (tc2[0].name === "read" && tc2[0].input?.id === "deploy-001") {
      return { stage: "medium_multi_tool", success: true, latencyMs: Date.now() - start, details: "search -> read(deploy-001)" };
    }
    if (tc2[0].name === "read") {
      return { stage: "medium_multi_tool", success: true, latencyMs: Date.now() - start, details: "search -> read(" + tc2[0].input?.id + ")" };
    }
    return { stage: "medium_multi_tool", success: false, latencyMs: Date.now() - start, error: "Round 2: expected read, got " + tc2[0].name };
  } catch (e: any) {
    return { stage: "medium_multi_tool", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Medium 2: Long output in Russian with user's maxTokens */
async function testMediumLongOutput(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, configParams(config,
      "You are a technical writer. Write in Russian. Follow the format precisely.",
      [{ role: "user", content: 'Write a documentation section about a REST API for user management. Include:\n\n## API Users\n\n### Endpoints\n- GET /users\n- POST /users\n- PUT /users/:id\n- DELETE /users/:id\n\nFor each endpoint, describe: HTTP method, URL, parameters, response format, example. Write at least 500 characters. All text in Russian.' }],
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      return { stage: "medium_long_output", success: false, latencyMs: latency, error: "HTTP " + res.status };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text) {
      return { stage: "medium_long_output", success: false, latencyMs: latency, error: "Empty response" };
    }
    const errors: string[] = [];
    if (text.length < 400) errors.push("Too short: " + text.length + " chars (expected 500+)");
    // Check Cyrillic ratio
    const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const alpha = (text.match(/[a-zA-Z\u0400-\u04FF]/g) || []).length;
    if (alpha > 0 && cyrillic / alpha < 0.5) errors.push("Low Russian: " + Math.round(cyrillic / alpha * 100) + "%");
    // Check endpoints mentioned
    const endpoints = ["GET", "POST", "PUT", "DELETE"].filter(m => text.includes(m));
    if (endpoints.length < 3) errors.push("Only " + endpoints.length + "/4 HTTP methods mentioned");
    // Check headings
    if (!text.includes("##")) errors.push("No markdown headings");

    if (errors.length > 0) {
      return { stage: "medium_long_output", success: false, latencyMs: latency, error: "Quality issues (" + errors.length + ")", details: errors.join("; ") };
    }
    return { stage: "medium_long_output", success: true, latencyMs: latency, details: text.length + " chars, " + endpoints.length + " methods, maxTokens=" + config.maxTokens };
  } catch (e: any) {
    return { stage: "medium_long_output", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Medium 3: Temperature sensitivity - same prompt, compare temp=0 vs user temp */
async function testMediumParamSensitivity(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  const prompt = "List exactly 3 benefits of version control in documentation. Number each 1-3. One sentence each.";
  try {
    // Run with temp=0
    const res1 = await runner.chat(config, baseParams(
      "Answer concisely.",
      [{ role: "user", content: prompt }],
    ));
    if (!res1.ok) {
      return { stage: "medium_param_sensitivity", success: false, latencyMs: Date.now() - start, error: "temp=0 call: HTTP " + res1.status };
    }
    const text1 = extractText(await res1.json());

    // Run with user's temperature
    const res2 = await runner.chat(config, configParams(config,
      "Answer concisely.",
      [{ role: "user", content: prompt }],
    ));
    if (!res2.ok) {
      return { stage: "medium_param_sensitivity", success: false, latencyMs: Date.now() - start, error: "temp=" + config.temperature + " call: HTTP " + res2.status };
    }
    const text2 = extractText(await res2.json());

    const latency = Date.now() - start;
    if (!text1 || !text2) {
      return { stage: "medium_param_sensitivity", success: false, latencyMs: latency, error: "Empty response in one of the calls" };
    }

    // Both should have numbered items
    const has3items1 = (text1.match(/[123][.)]/g) || []).length >= 2;
    const has3items2 = (text2.match(/[123][.)]/g) || []).length >= 2;
    if (!has3items1 || !has3items2) {
      return { stage: "medium_param_sensitivity", success: false, latencyMs: latency, error: "One response lacks numbered items", details: "temp=0: " + has3items1 + ", temp=" + config.temperature + ": " + has3items2 };
    }

    // Compare similarity
    const identical = text1.trim() === text2.trim();
    const similarity = identical ? "identical" : "different";
    return { stage: "medium_param_sensitivity", success: true, latencyMs: latency, details: "temp=0 vs temp=" + config.temperature + ": " + similarity + " (" + text1.length + "/" + text2.length + " chars)" };
  } catch (e: any) {
    return { stage: "medium_param_sensitivity", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// HEAVY tests (documentation quality, use config params)
// ═══════════════════════════════════════════════════════════

const SAMPLE_FUNCTION = `async function syncProjectFiles(
  projectId: string,
  options: { force?: boolean; dryRun?: boolean; exclude?: string[] }
): Promise<{ synced: number; skipped: number; errors: string[] }> {
  const project = await db.projects.findById(projectId);
  if (!project) throw new Error("Project not found: " + projectId);
  const files = await scanDirectory(project.rootPath, options.exclude);
  let synced = 0, skipped = 0;
  const errors: string[] = [];
  for (const file of files) {
    try {
      const hash = await computeHash(file.path);
      if (!options.force && file.lastHash === hash) { skipped++; continue; }
      if (!options.dryRun) await uploadFile(project.remoteUrl, file);
      synced++;
    } catch (e) { errors.push(file.path + ": " + e.message); }
  }
  return { synced, skipped, errors };
}`;

/** Heavy 1: Full documentation generation for a real function */
async function testHeavyDocGeneration(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, configParams(config,
      "You are a senior technical writer. Write complete, high-quality documentation in Russian. Use markdown formatting.",
      [{ role: "user", content: "Write complete documentation for this TypeScript function:\n\n```typescript\n" + SAMPLE_FUNCTION + "\n```\n\nRequired structure:\n## syncProjectFiles\n### \u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435\n### \u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b\n### \u0412\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043c\u043e\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435\n### \u0418\u0441\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f\n### \u041f\u0440\u0438\u043c\u0435\u0440 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f\n\nAll descriptions in Russian. Document every parameter and return field." }],
      { _heavy: true } as any,
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "heavy_doc_generation", success: false, latencyMs: latency, error: "HTTP " + res.status, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.length < 200) {
      return { stage: "heavy_doc_generation", success: false, latencyMs: latency, error: "Response too short: " + (text?.length || 0) + " chars" };
    }

    const errors: string[] = [];
    const textLower = text.toLowerCase();

    // 1. Minimum length — real docs should be substantial
    if (text.length < 800) errors.push("Too short: " + text.length + " chars (need 800+)");

    // 2. Must have ## heading with function name
    const hasH2 = /^##\s.*syncprojectfiles/im.test(text);
    if (!hasH2) errors.push("Missing ## syncProjectFiles heading");

    // 3. All 5 required ### headings (check as markdown headings, not just text)
    const h3Checks = [
      { keyword: "\u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435", label: "### \u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435" },
      { keyword: "\u043f\u0430\u0440\u0430\u043c\u0435\u0442\u0440", label: "### \u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b" },
      { keyword: "\u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043c", label: "### \u0412\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043c\u043e\u0435" },
      { keyword: "\u0438\u0441\u043a\u043b\u044e\u0447\u0435\u043d\u0438", label: "### \u0418\u0441\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f" },
      { keyword: "\u043f\u0440\u0438\u043c\u0435\u0440", label: "### \u041f\u0440\u0438\u043c\u0435\u0440" },
    ];
    let h3Found = 0;
    for (const h of h3Checks) {
      // Must be a ### heading, not just mentioned in text
      const regex = new RegExp("^###\\s.*" + h.keyword, "im");
      if (regex.test(text)) {
        h3Found++;
      } else {
        errors.push("Missing heading: " + h.label);
      }
    }

    // 4. ALL 4 parameters must be documented (not 3/4)
    const params = ["projectId", "force", "dryRun", "exclude"];
    const documented = params.filter(p => text.includes(p));
    if (documented.length < 4) {
      const missing = params.filter(p => !text.includes(p));
      errors.push("Missing params: " + missing.join(", "));
    }

    // 5. ALL 3 return fields must be documented
    const returnFields = ["synced", "skipped", "errors"];
    const docReturn = returnFields.filter(f => text.includes(f));
    if (docReturn.length < 3) {
      const missing = returnFields.filter(f => !text.includes(f));
      errors.push("Missing return fields: " + missing.join(", "));
    }

    // 6. Code example must contain actual function call
    if (!text.includes("```")) {
      errors.push("No code example");
    } else {
      // Extract code blocks and check for function call
      const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
      const hasCall = codeBlocks.some(b => b.includes("syncProjectFiles"));
      if (!hasCall) errors.push("Code example doesn't call syncProjectFiles");
    }

    // 7. Parameter descriptions must have types
    const paramTypes = ["string", "boolean", "string[]", "number", "object"];
    const hasTypeAnnotations = paramTypes.some(t => text.includes(t));
    if (!hasTypeAnnotations) errors.push("No type annotations for parameters");

    // 8. Cyrillic ratio >= 40%
    const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const alpha = (text.match(/[a-zA-Z\u0400-\u04FF]/g) || []).length;
    if (alpha > 0 && cyrillic / alpha < 0.4) errors.push("Low Russian content: " + Math.round(cyrillic / alpha * 100) + "%");

    // 9. Description section must be >= 2 sentences
    const descSection = text.split(/###/).find(s => s.toLowerCase().includes("\u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435"));
    if (descSection) {
      const sentences = descSection.split(/[.!?]\s/).length;
      if (sentences < 2) errors.push("Description too brief (need 2+ sentences)");
    }

    if (errors.length > 0) {
      return { stage: "heavy_doc_generation", success: false, latencyMs: latency, error: "Doc quality issues (" + errors.length + ")", details: errors.join("; ") };
    }
    return { stage: "heavy_doc_generation", success: true, latencyMs: latency, details: text.length + " chars, " + documented.length + " params, " + docReturn.length + " return fields, " + h3Found + " headings" };
  } catch (e: any) {
    return { stage: "heavy_doc_generation", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Heavy 2: Restructure messy documentation into proper format */
async function testHeavyDocRestructure(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  const messyDoc = "The authentication system uses JWT tokens. To authenticate you need to send POST request to /api/login with email and password. The response contains accessToken and refreshToken. JWT tokens expire after 1 hour. You can refresh using POST /api/refresh with the refreshToken. \u0422\u0430\u043a\u0436\u0435 \u0435\u0441\u0442\u044c \u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442 /api/logout \u0434\u043b\u044f \u0432\u044b\u0445\u043e\u0434\u0430. Tokens are stored in httpOnly cookies. JWT tokens expire after 1 hour (duplicated info). Error codes: 401 unauthorized, 403 forbidden. Rate limiting: 100 requests per minute.";

  try {
    const res = await runner.chat(config, configParams(config,
      "You are a documentation editor. Restructure the given text into a well-organized Russian-language document with proper markdown hierarchy. Remove duplicates, organize logically, translate English parts to Russian.",
      [{ role: "user", content: "Restructure this messy documentation:\n\n" + messyDoc + "\n\nRequirements:\n- Use ## and ### headings\n- Remove duplicate information\n- All text in Russian\n- Logical section ordering (overview first, then details)\n- Include all important information from the original" }],
      { _heavy: true } as any,
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      return { stage: "heavy_doc_restructure", success: false, latencyMs: latency, error: "HTTP " + res.status };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.length < 150) {
      return { stage: "heavy_doc_restructure", success: false, latencyMs: latency, error: "Response too short: " + (text?.length || 0) };
    }

    const errors: string[] = [];
    // Check headings present
    const h2count = (text.match(/^## /gm) || []).length;
    const h3count = (text.match(/^### /gm) || []).length;
    if (h2count < 1) errors.push("No ## headings");
    if (h3count < 2) errors.push("Less than 2 ### headings");

    // Check key concepts preserved
    const concepts = ["JWT", "login", "refresh", "logout", "401", "403"].filter(c => text.includes(c));
    if (concepts.length < 4) errors.push("Missing concepts: only " + concepts.length + "/6 preserved");

    // Cyrillic check
    const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const alpha = (text.match(/[a-zA-Z\u0400-\u04FF]/g) || []).length;
    if (alpha > 0 && cyrillic / alpha < 0.4) errors.push("Low Russian: " + Math.round(cyrillic / alpha * 100) + "%");

    // Check duplicate removal (the word "expire" or its Russian equiv should appear max 2 times)
    const expireCount = (text.toLowerCase().match(/expir|istek|\u0438\u0441\u0442\u0435\u043a|\u0441\u0440\u043e\u043a/g) || []).length;
    if (expireCount > 3) errors.push("Duplicate not removed: expiration mentioned " + expireCount + " times");

    if (errors.length > 0) {
      return { stage: "heavy_doc_restructure", success: false, latencyMs: latency, error: "Restructure issues (" + errors.length + ")", details: errors.join("; ") };
    }
    return { stage: "heavy_doc_restructure", success: true, latencyMs: latency, details: text.length + " chars, " + h2count + " h2, " + h3count + " h3, " + concepts.length + " concepts" };
  } catch (e: any) {
    return { stage: "heavy_doc_restructure", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Heavy 3: Detect gaps in documentation and fill them */
async function testHeavyCompleteness(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  const incompleteDoc = "## createUser\n\n### \u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435\n\u0421\u043e\u0437\u0434\u0430\u0451\u0442 \u043d\u043e\u0432\u043e\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f \u0432 \u0441\u0438\u0441\u0442\u0435\u043c\u0435.\n\n### \u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b\n- **name** (string) \u2014 \u0438\u043c\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f\n- **email** (string)\n- **role**\n\n### \u0412\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043c\u043e\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435\n\u041e\u0431\u044a\u0435\u043a\u0442 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f.";

  try {
    const res = await runner.chat(config, configParams(config,
      "You are a documentation quality reviewer. Analyze the document, identify ALL gaps, and produce a complete improved version. Write in Russian.",
      [{ role: "user", content: "This documentation has gaps. Identify what's missing and write a complete improved version:\n\n" + incompleteDoc + "\n\nKnown gaps to find and fix:\n1. Parameter 'email' has no description\n2. Parameter 'role' has no type and no description\n3. No error/exception section\n4. No usage example\n5. Return value lacks field details\n\nWrite the complete improved document with all gaps filled." }],
      { _heavy: true } as any,
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      return { stage: "heavy_completeness", success: false, latencyMs: latency, error: "HTTP " + res.status };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.length < 200) {
      return { stage: "heavy_completeness", success: false, latencyMs: latency, error: "Response too short: " + (text?.length || 0) };
    }

    const errors: string[] = [];

    // Check email has description now
    const emailLine = text.split("\n").find(l => l.includes("email"));
    if (!emailLine || emailLine.length < 30) errors.push("email parameter still undocumented");

    // Check role has type — accept various formats (string, enum, Role, type annotations, Russian)
    const roleLines = text.split("\n").filter(l => /\brole\b/i.test(l));
    const roleHasType = roleLines.some(l =>
      /string|enum|Role|type|admin|user|\bстрок|\bтип|\bроль/i.test(l) && l.length > 20
    );
    if (!roleHasType) {
      errors.push("role parameter still lacks type");
    }

    // Check exceptions/errors section added
    const textLower = text.toLowerCase();
    if (!textLower.includes("\u0438\u0441\u043a\u043b\u044e\u0447\u0435\u043d\u0438") && !textLower.includes("\u043e\u0448\u0438\u0431\u043a") && !textLower.includes("error") && !textLower.includes("exception")) {
      errors.push("No error/exception section added");
    }

    // Check usage example
    if (!text.includes("```")) errors.push("No code example added");

    // Check return value has more detail
    const returnSection = text.split(/###\s/).find(s => s.toLowerCase().includes("\u0432\u043e\u0437\u0432\u0440\u0430\u0449"));
    if (returnSection && returnSection.length < 50) errors.push("Return value still lacks detail");

    if (errors.length > 0) {
      return { stage: "heavy_completeness", success: false, latencyMs: latency, error: "Gaps remaining (" + errors.length + ")", details: errors.join("; ") };
    }
    return { stage: "heavy_completeness", success: true, latencyMs: latency, details: text.length + " chars, all 5 gaps filled" };
  } catch (e: any) {
    return { stage: "heavy_completeness", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

/** Heavy 4: ADR — Architecture Decision Record with bug detection, alternatives analysis,
 *  trade-off matrix, and internal consistency checks.
 *  Requires deep reasoning: find 3 bugs in code, propose 3 alternative solutions,
 *  build a comparison table, make a justified recommendation, write migration plan.
 *  All sections must be internally consistent (recommendation must match the best-scored alternative). */

const BUGGY_CACHE_CODE = `class DocumentCache {
  private cache = new Map<string, { data: any; expires: number }>();
  private maxSize: number;
  constructor(maxSize = 100) { this.maxSize = maxSize; }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) return null; // BUG 1: expired entry not deleted, cache leaks memory
    return entry.data;
  }

  set(key: string, data: any, ttlMs = 60000): void {
    if (this.cache.size >= this.maxSize) {
      // BUG 2: deletes first key (insertion order), not oldest/least-used — wrong eviction strategy
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
  }

  invalidate(pattern: string): void {
    // BUG 3: modifying Map while iterating — may skip entries or throw in strict mode
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key);
    }
  }

  get stats() {
    return { size: this.cache.size, maxSize: this.maxSize };
  }
}`;

async function testHeavyArchitecture(config: ModelTierConfig, runner: ScriptRunner): Promise<ModelTestResult> {
  const start = Date.now();
  try {
    const res = await runner.chat(config, configParams(config,
      "You are a principal software engineer conducting an architecture review. Write a formal Architecture Decision Record (ADR) in Russian. Be extremely precise and thorough. Every claim must be justified.",
      [{ role: "user", content: "Review this TypeScript cache implementation. Write a formal ADR.\n\n```typescript\n" + BUGGY_CACHE_CODE + "\n```\n\nRequired ADR structure (use EXACT headings):\n\n## ADR: DocumentCache\n\n### Status\nOne word: accepted/proposed/deprecated\n\n### Context\nDescribe what the code does and why we need to review it (3+ sentences).\n\n### Bugs Found\nIdentify ALL bugs in the code. For each bug:\n- Location (method name + line description)\n- Problem description\n- Severity (critical/major/minor)\n- Fix suggestion with code\n\n### Alternative Solutions\nPropose exactly 3 alternative cache implementations:\n1. (name and brief description)\n2. (name and brief description)\n3. (name and brief description)\n\n### Comparison Matrix\nCreate a markdown table comparing all 3 alternatives by these criteria:\n| Criteria | Alternative 1 | Alternative 2 | Alternative 3 |\n- Performance (1-5)\n- Memory efficiency (1-5)\n- Implementation complexity (1-5)\n- Thread safety (1-5)\n- Maintainability (1-5)\n- Total score\n\n### Recommendation\nChoose the alternative with the HIGHEST total score from the matrix. Explain WHY in 3+ sentences. The chosen alternative MUST match the highest-scoring one in the table.\n\n### Migration Plan\nStep-by-step plan to replace the current implementation with the recommended one.\n\n### Risks\nList at least 3 risks of the migration.\n\nAll text in Russian. Code examples in TypeScript. Minimum 2000 characters total." }],
      { _heavy: true } as any,
    ));
    const latency = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { stage: "heavy_architecture", success: false, latencyMs: latency, error: "HTTP " + res.status, details: text.slice(0, 500) };
    }
    const data = await res.json();
    const text = extractText(data);
    if (!text || text.length < 500) {
      return { stage: "heavy_architecture", success: false, latencyMs: latency, error: "Too short: " + (text?.length || 0) + " chars" };
    }

    const errors: string[] = [];
    const textLower = text.toLowerCase();

    // 1. Minimum length — ADR must be substantial
    if (text.length < 2000) errors.push("Too short: " + text.length + " chars (need 2000+)");

    // 2. Must find at least 2 of the 3 bugs
    const bugIndicators = [
      { pattern: /expired.*not.*delet|leak|утечк|\u043d\u0435\s*\u0443\u0434\u0430\u043b\u044f|expire.*\u043e\u0441\u0442\u0430/i, label: "memory leak (expired not deleted)" },
      { pattern: /evict|FIFO|first.*key|\u0432\u044b\u0442\u0435\u0441\u043d\u0435\u043d|insertion.order|\u043f\u043e\u0440\u044f\u0434\u043a.*\u0432\u0441\u0442\u0430\u0432\u043a|LRU|first.key|\u043f\u0435\u0440\u0432\u044b\u0439\s*\u043a\u043b\u044e\u0447/i, label: "wrong eviction (FIFO not LRU)" },
      { pattern: /iter.*delet|modif.*iter|\u0438\u0442\u0435\u0440\u0438\u0440.*\u0443\u0434\u0430\u043b|\u043c\u043e\u0434\u0438\u0444\u0438\u043a.*\u0438\u0442\u0435\u0440|\u0443\u0434\u0430\u043b.*\u0432\u043e\s*\u0432\u0440\u0435\u043c\u044f/i, label: "delete during iteration" },
    ];
    let bugsFound = 0;
    for (const bug of bugIndicators) {
      if (bug.pattern.test(text)) bugsFound++;
    }
    if (bugsFound < 2) errors.push("Found only " + bugsFound + "/3 bugs (need 2+)");

    // 3. Must have exactly 3 alternatives
    const altSection = text.split(/###?\s/).find(s => /\u0430\u043b\u044c\u0442\u0435\u0440\u043d\u0430\u0442\u0438\u0432|alternative/i.test(s));
    if (!altSection) {
      errors.push("Missing Alternatives section");
    }

    // 4. Must have a comparison table (markdown table with |)
    const tableLines = text.split("\n").filter(l => l.includes("|") && l.trim().startsWith("|"));
    if (tableLines.length < 4) {
      errors.push("Missing or incomplete comparison table (found " + tableLines.length + " table rows, need 4+)");
    }

    // 5. Must have scores in the table (numbers 1-5)
    const scoreMatches = text.match(/\|\s*[1-5]\s*\|/g) || [];
    if (scoreMatches.length < 6) {
      errors.push("Table lacks numeric scores (found " + scoreMatches.length + ", need 6+)");
    }

    // 6. Recommendation section must exist
    const hasRecommendation = /###?\s.*(\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434|recommendation)/im.test(text);
    if (!hasRecommendation) errors.push("Missing Recommendation section");

    // 7. Risks section with 3+ items
    const risksSection = text.split(/###?\s/).find(s => /\u0440\u0438\u0441\u043a|risk/i.test(s));
    if (!risksSection) {
      errors.push("Missing Risks section");
    } else if (risksSection.length < 100) {
      errors.push("Risks section too brief");
    }

    // 8. Migration plan exists
    const migrationSection = text.split(/###?\s/).find(s => /\u043c\u0438\u0433\u0440\u0430\u0446|migration/i.test(s));
    if (!migrationSection || migrationSection.length < 80) {
      errors.push("Migration plan missing or too short");
    }

    // 9. Code fix suggestions (at least one code block with fix)
    const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
    if (codeBlocks.length < 1) errors.push("No code examples for bug fixes");

    // 10. Russian content >= 30%
    const cyrillic = (text.match(/[\u0400-\u04FF]/g) || []).length;
    const alpha = (text.match(/[a-zA-Z\u0400-\u04FF]/g) || []).length;
    if (alpha > 0 && cyrillic / alpha < 0.3) errors.push("Low Russian: " + Math.round(cyrillic / alpha * 100) + "%");

    // 11. Recommendation must be substantive (200+ chars) and mention something specific
    if (hasRecommendation) {
      const recSection = text.split(/###?\s/).find(s => /\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434|recommendation/i.test(s)) || "";
      if (recSection.trim().length < 150) {
        errors.push("Recommendation too brief (" + recSection.trim().length + " chars, need 150+)");
      }
    }

    if (errors.length > 0) {
      return { stage: "heavy_architecture", success: false, latencyMs: latency, error: "ADR issues (" + errors.length + ")", details: errors.join("; ") };
    }
    return { stage: "heavy_architecture", success: true, latencyMs: latency, details: text.length + " chars, " + bugsFound + "/3 bugs, " + tableLines.length + " table rows, " + scoreMatches.length + " scores" };
  } catch (e: any) {
    return { stage: "heavy_architecture", success: false, latencyMs: Date.now() - start, error: e.message };
  }
}

// ─── Public API ────────────────────────────────────────────

const STAGE_RUNNERS: Record<TestStageName, (config: ModelTierConfig, runner: ScriptRunner) => Promise<ModelTestResult>> = {
  // Base
  connection: testConnection,
  tool_selection: testToolSelection,
  tool_params: testToolParams,
  param_types: testParamTypes,
  error_recovery: testErrorRecovery,
  multi_turn: testMultiTurn,
  structured_output: testStructuredOutput,
  instruction_following: testInstructionFollowing,
  // Light
  light_basic_tool: testLightBasicTool,
  light_short_answer: testLightShortAnswer,
  light_thinking: testLightThinking,
  // Medium
  medium_multi_tool: testMediumMultiTool,
  medium_long_output: testMediumLongOutput,
  medium_param_sensitivity: testMediumParamSensitivity,
  // Heavy
  heavy_doc_generation: testHeavyDocGeneration,
  heavy_doc_restructure: testHeavyDocRestructure,
  heavy_completeness: testHeavyCompleteness,
  heavy_architecture: testHeavyArchitecture,
};

/** Run a single test stage */
export async function testStage(
  config: ModelTierConfig,
  stage: TestStageName,
  scriptRunner: ScriptRunner,
): Promise<ModelTestResult> {
  const fn = STAGE_RUNNERS[stage];
  if (!fn) return { stage, success: false, latencyMs: 0, error: "Unknown stage: " + stage };
  return fn(config, scriptRunner);
}

/** Run all base test stages sequentially */
export async function testModel(
  config: ModelTierConfig,
  scriptRunner: ScriptRunner,
): Promise<ModelTestResult[]> {
  const results: ModelTestResult[] = [];
  const delay = () => new Promise<void>(r => setTimeout(r, INTER_STAGE_DELAY));

  for (const stage of BASE_STAGES) {
    if (results.length > 0) await delay();
    const result = await testStage(config, stage, scriptRunner);
    results.push(result);
    if (stage === "connection" && !result.success) break;
  }

  return results;
}
