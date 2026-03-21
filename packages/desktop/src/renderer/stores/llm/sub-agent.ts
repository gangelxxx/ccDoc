/**
 * Sub-agent execution: runs a lightweight tool loop on a (potentially cheaper) model.
 *
 * Key optimizations (Claude Code-style architecture):
 * 1. Enriched system prompt with project tree → exceeds Haiku's 2048-token cache minimum
 * 2. messages[0] is cached (task description is stable across all rounds of one invocation)
 * 3. Reduced tool result limit (3000 vs 6000) → slower context growth
 * 4. Multi-tier context compaction → shrink tool results at 40%/60%/100% of context limit
 * 5. Cache metrics logging → verify caching works in logs
 */

import type { SetState, GetState, LlmConfig, SubAgentType, ToolDefinition } from "./types.js";
import {
  truncateToolResult,
  compressToolResult,
  estimateInputTokens,
  shrinkToolResults,
  optimizeBetweenRounds,
  formatCompactTree,
  READ_ONLY_TOOLS,
  WRITER_TOOLS,
  getSubAgentMaxRounds,
  SUB_AGENT_RESULT_LIMIT,
  SUB_AGENT_CONTEXT_LIMIT,
} from "../../llm-utils.js";

const SUB_AGENT_EMOJIS = ["🔍", "📝", "📋", "📐"];

export { SUB_AGENT_EMOJIS };

interface SubAgentParams {
  set: SetState;
  get: GetState;
  llmApiKey: string;
  token: string;
  language: string;
  llmResearchConfig: LlmConfig;
  llmWriterConfig: LlmConfig;
  llmCriticConfig: LlmConfig;
  llmPlannerConfig: LlmConfig;
  finalTools: ToolDefinition[];
  executeTool: (name: string, input: any) => Promise<string>;
  llmTaskTokens: { input: number; output: number };
}

/**
 * Creates a sub-agent executor bound to the current session state.
 */
export function createSubAgentExecutor(params: SubAgentParams) {
  const {
    set, get, llmApiKey, token, language,
    llmResearchConfig, llmWriterConfig, llmCriticConfig, llmPlannerConfig,
    finalTools, executeTool, llmTaskTokens,
  } = params;

  return async function executeSubAgent(agentType: SubAgentType, task: string, context?: string): Promise<string> {
    const configMap: Record<SubAgentType, LlmConfig> = {
      research: llmResearchConfig, writer: llmWriterConfig, critic: llmCriticConfig, planner: llmPlannerConfig,
    };
    const { model: agentModel, maxTokens: agentMaxTokens, temperature: agentTemp } = configMap[agentType];

    const langHint = language === "ru" ? "Write your report in Russian." : "Write your report in English.";

    // --- Build enriched system prompt with project context for cache efficiency ---
    // Haiku requires ≥2048 tokens in the cacheable prefix. By embedding the project
    // tree into the system prompt we guarantee the prefix is large enough AND stable
    // across rounds, so cache_control: ephemeral works on rounds 2+.
    const tree = get().tree || [];
    // Depth 3 ensures system prompt is large enough for Haiku cache minimum.
    // Depth 2 was too small (4537 chars → cache not created on rounds 1-2).
    const treeOverview = formatCompactTree(tree, 0, false, 3);
    const projectContext = treeOverview
      ? `\n\nProject documentation tree:\n${treeOverview}`
      : "";

    // Tool access sets and progress labels — declared early so enrichedPrompt can reference `allowed`
    const allowedToolSets: Record<SubAgentType, Set<string>> = {
      research: READ_ONLY_TOOLS, writer: WRITER_TOOLS, critic: READ_ONLY_TOOLS, planner: READ_ONLY_TOOLS,
    };
    const allowed = allowedToolSets[agentType];
    const progressInfo: Record<SubAgentType, { emoji: string; label: string }> = {
      research: { emoji: "🔍", label: language === "ru" ? "Исследую" : "Researching" },
      writer:   { emoji: "📝", label: language === "ru" ? "Пишу" : "Writing" },
      critic:   { emoji: "📋", label: language === "ru" ? "Анализирую" : "Reviewing" },
      planner:  { emoji: "📐", label: language === "ru" ? "Планирую" : "Planning" },
    };

    const basePrompts: Record<SubAgentType, string> = {
      research: [
        "You are a research sub-agent for CCDoc (a documentation tool).",
        "Your job: find and compile information from the project's documentation AND source code.",
        `STRATEGY — maximize efficiency, minimize rounds:
  1. Round 1: Batch ALL initial reads. Use get_sections_batch for multiple doc sections + get_file_outlines for multiple source files + find_symbols for key concepts — ALL IN PARALLEL.
  2. Round 2: Targeted reads — read_project_file with startLine/endLine for specific code sections identified in Round 1.
  3. Round 3: Write your report. Do NOT do more research after round 2.
  SOURCE CODE TOOLS (use them!):
  - find_symbols: locate functions/classes/types by name — ultra compact output. USE FIRST.
  - get_file_outlines: see function signatures for up to 20 files at once. USE for overview.
  - read_project_file: read specific code with startLine/endLine. ALWAYS use startLine/endLine to read only what you need.
  - search_project_files: grep-like search across source files. USE for patterns.
  - get_project_tree: file tree of the project. USE if you need to find files.
  IMPORTANT: Do NOT use 'search' (doc search) to find source code info — it only searches documentation text, not actual code files. Use the source code tools above instead.
  IMPORTANT: ALWAYS use startLine/endLine when calling read_project_file. NEVER read entire large files.
  TIP: get_section supports offset/limit. ALWAYS use limit=10000 to minimize rounds. If content is truncated, pass offset from the response to continue — do NOT try different tools or search to work around truncation.
  REPORT: Be concise. Only include FACTS you verified from actual code or docs. Do NOT guess or hallucinate code structure.
  CRITICAL: Include SPECIFIC DATA the orchestrator needs to act — function names, parameter lists, type definitions, tool names, method signatures. Do NOT write vague descriptions like "needs update" or "contains 7 functions". Instead: LIST the 7 functions by name. The orchestrator cannot read source code — it relies entirely on YOUR report for concrete facts.
  REPORT FORMAT:
  ## Summary
  5-7 bullet points with KEY findings. Include concrete data: names, counts, versions, parameters.
  BAD: "MCP Server has read tools that need documenting"
  GOOD: "MCP read tools: list_projects, overview, find, read, get_tree, search, get_latest_idea (7 total)"
  ## Findings
  One finding per line. MUST include the concrete data needed for the fix:
  - SECTION: <id> | ISSUE: <what's wrong> | DATA: <exact values from code> | ACTION: <specific change>
  BAD: "- SECTION: ba6afe27 | ISSUE: read tools missing | ACTION: add full list"
  GOOD: "- SECTION: ba6afe27 | ISSUE: read tools missing | DATA: list_projects, overview, find, read, get_tree, search, get_latest_idea | ACTION: add these 7 tools to table"
  Max 2500 tokens total.
  ANALYSIS PRIORITY: If the task already contains section content — analyze it first, then supplement with targeted reads. Do NOT call get_section for content already in the task.`,
      ].join("\n"),
      writer: [
        "You are a writer sub-agent for CCDoc (a documentation tool).",
        "Your job: create or update documentation content as instructed.",
        `RULES:
  1) If context includes 'CURRENT CONTENT of' block — this is the AUTHORITATIVE source from the database. Use it directly, do NOT call get_section for this section. For content transformations (translation, reformatting), also use provided content directly.
  2) Write detailed, substantive content in Markdown. Set emoji icons with update_icon.
  3) For large sections, use get_section with offset/limit to read in chunks. If truncated, use the offset from the response — do NOT try different tools.
  4) After update_section, compare 'chars sent' and 'chars written' in the response. If they match — content is complete. If 'chars written' < 'chars sent' — re-read to check for truncation.
  5) VERIFY: After writing, call get_section on the updated section to confirm key facts are present. This catches errors BEFORE review and costs nothing (cached). Check: are the main points from your task reflected in the content?
  6) Report what you created/updated with section titles.
  6) When the task says 'add to the end' or 'append': read ONLY the last 3000 chars of the section (use offset = totalLen - 3000) to understand the structure, then update. Do NOT read the entire section from the beginning.`,
      ].join("\n"),
      critic: [
        "You are a documentation reviewer sub-agent for CCDoc (a documentation tool).",
        "Your job: analyze documentation quality, find problems and propose fixes.",
        `CRITICAL WORKFLOW:
Round 1: Analyze the text provided in the task description. The task CONTAINS the full content to review — read it carefully. Identify ALL issues from the text alone: logical errors, missing edge cases, incorrect assumptions, inconsistencies, unclear language.
Round 2: If the text references specific code (functions, files, APIs) that you need to verify — use source code tools (find_symbols, read_project_file). If not — skip to writing the report.
Round 3: Write your comprehensive report.

RULES:
- Do NOT call get_section for content already in the task — it wastes a round.
- Do NOT call get_tree or get_project_tree unless you need specific information not in the task.
- Prioritize TEXT ANALYSIS over code verification. Most documentation issues are visible from the text alone.
- Report format: summary → critical issues → major issues → minor issues. Each with: problem, why it matters, fix.
- Reference sections by title, never by ID. Be specific and actionable.`,
      ].join("\n"),
      planner: [
        "You are a planning sub-agent for CCDoc (a documentation tool).",
        "Your job: analyze current documentation structure and propose improvements.",
        "RULES: 1) Explore tree and read sections. 2) You can ONLY READ. 3) Suggest: new sections needed, reorganization, content gaps, naming improvements. 4) Provide a structured plan with priorities.",
      ].join("\n"),
    };

    // Assemble system prompt. Haiku requires ≥2048 tokens in the cacheable prefix
    // (system + tools). If the project tree is small/empty, pad with a short
    // tool-usage reminder so that the combined prefix exceeds the threshold.
    const TOOL_USAGE_SHORT = `\nTool tips: batch reads with get_sections_batch/get_file_outlines, use find_symbols before broad search, always specify startLine/endLine in read_project_file. When reading large sections, use offset/limit pagination — follow [Use offset: N] hints in responses. Never re-read content you already have. Plan your reads: estimate section size from metadata, then read in 1-2 calls maximum.`;

    let enrichedPrompt = [
      basePrompts[agentType],
      projectContext,
      `\nProject token: ${token}`,
      langHint,
    ].join("\n");

    // Tell model which tools are available (others will return errors at executor level)
    enrichedPrompt += `\nAvailable tools: ${[...allowed].join(", ")}. Other tools will return errors — do not call them.`;

    const { emoji, label } = progressInfo[agentType];
    // Filter tools to only include those allowed for this sub-agent type.
    const subTools = finalTools.filter(t => allowed.has(t.name));

    // Ensure prefix (system + tools) exceeds Haiku cache minimum.
    // Observed: 6377 chars system prompt → cache works; 4537 chars → cache fails.
    // Haiku needs system block ≥ ~5500 chars for reliable cache creation.
    const MIN_SYSTEM_CHARS = 5500;
    if (enrichedPrompt.length < MIN_SYSTEM_CHARS) {
      enrichedPrompt += TOOL_USAGE_SHORT;
    }
    // If still too short after padding, repeat tool usage tips
    while (enrichedPrompt.length < MIN_SYSTEM_CHARS) {
      enrichedPrompt += `\nReminder: batch reads, use find_symbols first, always use startLine/endLine.`;
    }

    const subSystemPrompt = enrichedPrompt;
    const prefixChars = subSystemPrompt.length + JSON.stringify(subTools).length;
    const prefixEstimate = Math.round(prefixChars / 3.5);
    if (prefixEstimate < 4000) {
      console.warn(`[SubAgent:${agentType}] Cache risk: prefix ~${prefixEstimate} tokens (${prefixChars} chars), may be below cache threshold.`);
    }

    let maxRounds = getSubAgentMaxRounds(agentModel);
    // Writer with injected content needs fewer rounds (write + verify + report = 3)
    const hasInjectedContent = context?.includes("CURRENT CONTENT of");
    if (agentType === "writer" && hasInjectedContent && maxRounds > 3) {
      maxRounds = 3;
    }
    const userMessage = context ? `Task: ${task}\n\nAdditional context: ${context}` : `Task: ${task}`;
    let subMessages: any[] = [{ role: "user", content: userMessage }];
    let subRound = 0;

    console.log(`[SubAgent:${agentType}] model=${agentModel}, maxRounds=${maxRounds}`);

    while (subRound < maxRounds) {
      if (get().llmAborted) return `[${label} aborted by user]`;
      subRound++;

      const isLastRound = subRound === maxRounds;

      set(s => ({
        llmMessages: [
          ...s.llmMessages.filter(m => typeof m.content !== "string" || !SUB_AGENT_EMOJIS.some(e => (m.content as string).startsWith(e))),
          { role: "assistant" as const, content: `${emoji} ${label}: ${task.slice(0, 60)}${task.length > 60 ? "..." : ""} (${subRound}/${maxRounds})` },
        ],
      }));

      // Between-round optimization: deduplicate repeated content + compress source code.
      // This runs BEFORE context threshold checks, removing ~44% of duplicate content
      // (observed: round 5 had 54% duplication, round 6 had 76%).
      if (subRound > 1) {
        const beforeLen = JSON.stringify(subMessages).length;
        subMessages = optimizeBetweenRounds(subMessages);
        const afterLen = JSON.stringify(subMessages).length;
        if (beforeLen !== afterLen) {
          console.log(`[SubAgent:${agentType}] Round ${subRound}: optimizeBetweenRounds ${beforeLen} → ${afterLen} chars (${Math.round((1 - afterLen / beforeLen) * 100)}% saved)`);
        }
      }

      // Multi-tier context compaction: shrink old tool results proportionally to context fill
      const estTokens = estimateInputTokens(subSystemPrompt, subMessages);
      if (estTokens > SUB_AGENT_CONTEXT_LIMIT) {                        // >40k → агрессивно
        console.log(`[SubAgent:${agentType}] Round ${subRound}: context ~${estTokens} tokens > ${SUB_AGENT_CONTEXT_LIMIT}, shrinking to 300`);
        subMessages = shrinkToolResults(subMessages, 300);
      } else if (estTokens > SUB_AGENT_CONTEXT_LIMIT * 0.6) {           // >24k → умеренно
        console.log(`[SubAgent:${agentType}] Round ${subRound}: context ~${estTokens} tokens > ${SUB_AGENT_CONTEXT_LIMIT * 0.6}, shrinking to 800`);
        subMessages = shrinkToolResults(subMessages, 800);
      } else if (estTokens > SUB_AGENT_CONTEXT_LIMIT * 0.4) {           // >16k → мягко
        console.log(`[SubAgent:${agentType}] Round ${subRound}: context ~${estTokens} tokens > ${SUB_AGENT_CONTEXT_LIMIT * 0.4}, shrinking to 1500`);
        subMessages = shrinkToolResults(subMessages, 1500);
      }

      // On the last round: use tool_choice: none to prevent tool calls while keeping
      // tools array unchanged — this preserves the cache key (system+tools+messages[0])
      // so prompt caching continues to work on the final round.

      // If this is the last round, inject a "write report now" instruction
      // as a user message so the model knows what to do without tools.
      if (isLastRound && subMessages.length > 0) {
        const reportInstruction = agentType === "research"
          ? "IMPORTANT: Your research is complete. Write your report NOW. Include SPECIFIC DATA (function names, tool lists, type fields, method signatures) — the orchestrator CANNOT read code and relies on your report for concrete facts. Start with '## Summary' (5-7 bullets with concrete data). Then '## Findings' — one per line: '- SECTION: <id> | ISSUE: <what> | DATA: <exact values> | ACTION: <specific change>'. NO code quotes. Max 2500 tokens."
          : agentType === "writer"
          ? "IMPORTANT: Your writing task is complete. Start with '## Summary' listing what you created/updated. Then '## Details' with section titles and descriptions."
          : "IMPORTANT: Your analysis is complete. Start with '## Summary' (key findings). Then '## Details' with specifics. Max 1500 tokens.";
        subMessages = [...subMessages, { role: "user", content: reportInstruction }];
      }

      const subData = await window.api.llmChat({
        apiKey: llmApiKey, system: subSystemPrompt, messages: subMessages,
        model: agentModel, maxTokens: agentMaxTokens,
        tools: subTools.length ? subTools : undefined,
        ...(isLastRound ? { toolChoice: { type: "none" } } : {}),
        temperature: agentTemp,
      });

      // Log cache metrics for debugging
      if (subData.usage) {
        const u = subData.usage;
        console.log(`[SubAgent:${agentType}] Round ${subRound}/${maxRounds}: input=${u.input_tokens || 0}, cache_creation=${u.cache_creation_input_tokens || 0}, cache_read=${u.cache_read_input_tokens || 0}, output=${u.output_tokens || 0}${isLastRound ? " [FINAL — tool_choice:none]" : ""}`);
        llmTaskTokens.input += u.input_tokens || 0;
        llmTaskTokens.output += u.output_tokens || 0;
        set(s => ({
          llmTokensUsed: {
            input: s.llmTokensUsed.input + (u.input_tokens || 0),
            output: s.llmTokensUsed.output + (u.output_tokens || 0),
            cacheRead: s.llmTokensUsed.cacheRead + (u.cache_read_input_tokens || 0),
            cacheCreation: s.llmTokensUsed.cacheCreation + (u.cache_creation_input_tokens || 0),
          },
        }));
      }

      if (subData.stop_reason === "tool_use") {
        subMessages = [...subMessages, { role: "assistant", content: subData.content }];
        const subToolBlocks = (subData.content || []).filter((b: any) => b.type === "tool_use");
        const subToolResults = await Promise.all(
          subToolBlocks.map(async (block: any) => {
            if (!allowed.has(block.name)) {
              return { type: "tool_result", tool_use_id: block.id, content: `Error: tool '${block.name}' not allowed for ${agentType} sub-agent` };
            }
            // Sub-agents: default to MAX_CONTENT_LIMIT (10000) for get_section reads
            const toolInput = (block.name === "get_section" && block.input.limit == null)
              ? { ...block.input, limit: 10000 }
              : block.input;
            const raw = await executeTool(block.name, toolInput);
            const compressed = compressToolResult(raw);
            return { type: "tool_result", tool_use_id: block.id, content: truncateToolResult(compressed, SUB_AGENT_RESULT_LIMIT) };
          })
        );
        // On the penultimate round, warn the model that next round is the last
        if (subRound === maxRounds - 1) {
          subToolResults.push({
            type: "text",
            text: `⚠️ ATTENTION: You have ONE round left. In your NEXT response, you MUST write your complete ${agentType === "research" ? "research report" : "summary"}. Do NOT call more tools — summarize everything you have gathered so far.`,
          } as any);
        }

        subMessages = [...subMessages, { role: "user", content: subToolResults }];
      } else {
        return (subData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || "[No findings]";
      }
    }

    // Should not reach here — the last round sends no tools, forcing end_turn.
    // But as a safety net, extract any text from the last assistant message.
    const lastAssistant = subMessages.filter((m: any) => m.role === "assistant").pop();
    if (lastAssistant?.content) {
      const texts = (Array.isArray(lastAssistant.content) ? lastAssistant.content : [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text);
      if (texts.length) return texts.join("\n");
    }
    return `[${agentType} sub-agent reached max rounds without completing]`;
  };
}
