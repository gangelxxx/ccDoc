/**
 * LLM chat engine -- orchestrates system prompt, tools, sub-agents, and the round loop.
 *
 * Sub-modules in ./llm/:
 *   system-prompt.ts    — buildSystemPrompt
 *   tool-definitions.ts — buildTools, TOOL_DESCRIPTIONS
 *   tool-executor.ts    — createToolExecutor
 *   sub-agent.ts        — createSubAgentExecutor
 *   compact-messages.ts — createCompactMessages
 *   split-markdown.ts   — splitMarkdownIntoSections
 *   types.ts            — shared types
 *
 * Receives Zustand's set/get as parameters to interact with the store.
 */

import type { AppState, LlmAttachment, LlmConfig, LlmMessage } from "./types.js";
import {
  estimateInputTokens,
  truncateToolResult,
  compressToolResult,
  compressDelegateReport,
  shrinkToolResults,
  shrinkConsumedDelegates,
  optimizeBetweenRounds,
  CONTEXT_LIMIT,
  COMPRESS_AT,
  HARD_STOP_AT,
  ABSOLUTE_MAX_ROUNDS,
  TOOL_RESULT_LIMIT,
  READ_ONLY_TOOLS,
  PLAN_RESEARCH_MAX_ROUNDS,
  ORCHESTRATOR_COMPRESS_AT,
} from "../llm-utils.js";

import { buildSystemPrompt } from "./llm/system-prompt.js";
import { buildTools, TOOL_DESCRIPTIONS } from "./llm/tool-definitions.js";
import { createToolExecutor } from "./llm/tool-executor.js";
import { createSubAgentExecutor, SUB_AGENT_EMOJIS } from "./llm/sub-agent.js";
import { createCompactMessages } from "./llm/compact-messages.js";
import { localizeApiError } from "../i18n.js";

// Re-export splitMarkdownIntoSections for any external consumer
export { splitMarkdownIntoSections } from "./llm/split-markdown.js";

type SetState = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type GetState = () => AppState;

/** Monotonic counter to detect stale engine instances after stop → new message. */
let engineGeneration = 0;

export async function sendLlmMessageImpl(
  set: SetState,
  get: GetState,
  text: string,
  includeContext: boolean,
  attachments?: LlmAttachment[],
  includeSourceCode?: boolean,
  displayText?: string,
  planMode?: boolean,
): Promise<string | null> {
  const { llmApiKey, llmChatConfig, llmResearchConfig, llmWriterConfig, llmCriticConfig, llmPlannerConfig, llmMessages, currentSection, currentProject, theme, useSubAgents, language, editorSelectedText, webSearchProvider, webSearchApiKey, llmSessionMode } = get();
  const { model, maxTokens, temperature, thinking, thinkingBudget } = llmChatConfig;

  // Resolve inherited sub-agent configs: when inheritFromParent is set, use the main chat config
  const resolveConfig = (cfg: LlmConfig): LlmConfig =>
    cfg.inheritFromParent ? llmChatConfig : cfg;
  const effectiveResearchConfig = resolveConfig(llmResearchConfig);
  const effectiveWriterConfig = resolveConfig(llmWriterConfig);
  const effectiveCriticConfig = resolveConfig(llmCriticConfig);
  const effectivePlannerConfig = resolveConfig(llmPlannerConfig);
  if (!llmApiKey || (!text.trim() && (!attachments || attachments.length === 0))) return null;

  const token = currentProject?.token;

  const webSearchEnabled = webSearchProvider !== "none" && !!webSearchApiKey;

  // --- Build system prompt ---
  const systemParts = buildSystemPrompt({
    planMode: !!planMode,
    useSubAgents,
    includeContext,
    includeSourceCode: !!includeSourceCode,
    webSearchEnabled,
    docUpdateMode: llmSessionMode === "doc-update",
    currentSection,
    currentProject,
    theme,
  });

  // --- Build tools ---
  const finalTools = buildTools({
    includeSourceCode: !!includeSourceCode,
    useSubAgents,
    planMode: !!planMode,
    webSearchEnabled,
  });

  // Sub-agents always get source code tools (they do the actual research/writing,
  // even when the main orchestrator model doesn't need them directly).
  const subAgentTools = useSubAgents
    ? buildTools({ includeSourceCode: true, useSubAgents: false, planMode: false, webSearchEnabled })
    : finalTools;

  // --- Mutable state for tool execution ---
  const toolState = { mutated: false, lastCreatedId: null as string | null };
  let llmTaskTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const myGeneration = ++engineGeneration;
  /** Check if this engine instance is still the active one (not superseded by stop → new message). */
  const isStale = () => get().llmAborted || myGeneration !== engineGeneration;

  /** Silently refresh tree & current section after LLM mutations (no navigation, no spinner, no banner) */
  async function silentRefreshUI() {
    if (!toolState.mutated) return;
    try {
      const tree = await window.api.getTree(token!);
      set({ tree });
    } catch { /* ignore */ }
    const cur = get().currentSection;
    if (cur) {
      try {
        const updated = await window.api.getSection(token!, cur.id);
        set({ currentSection: updated });
      } catch {
        set({ currentSection: null });
      }
    }
    // Signal FileView to reload child sections after LLM mutations
    set(s => ({ fileSectionsVersion: s.fileSectionsVersion + 1 }));
  }

  // --- Create sub-agent executor (needs executeTool, which needs executeSubAgent — resolve via closure) ---
  let executeTool: (name: string, input: any) => Promise<string>;

  const executeSubAgent = createSubAgentExecutor({
    set, get, llmApiKey: llmApiKey!, token: token!, language,
    llmResearchConfig: effectiveResearchConfig,
    llmWriterConfig: effectiveWriterConfig,
    llmCriticConfig: effectiveCriticConfig,
    llmPlannerConfig: effectivePlannerConfig,
    finalTools: subAgentTools,
    executeTool: (name, input) => executeTool(name, input),
    llmTaskTokens,
  });

  executeTool = createToolExecutor(token!, get, toolState, executeSubAgent);

  // --- Build API messages ---
  const toApiMessages = (msgs: LlmMessage[]) =>
    msgs.map((m) => ({ role: m.role, content: m.content }));

  let userContent: any = text;
  if (attachments && attachments.length > 0) {
    const blocks: any[] = [];
    for (const att of attachments) {
      if (att.type === "image") {
        blocks.push({ type: "image", source: { type: "base64", media_type: att.mediaType, data: att.data } });
      }
    }
    if (text.trim()) blocks.push({ type: "text", text });
    userContent = blocks;
  }

  const newMessages: LlmMessage[] = [
    ...llmMessages,
    { role: "user", content: userContent, ...(displayText ? { displayContent: displayText } : {}), attachments },
  ];
  set({ llmMessages: newMessages, llmLoading: true, llmAborted: false });
  const llmTaskId = get().startBgTask(get().language === "ru" ? "LLM чат" : "LLM chat");

  try {
    let apiMessages = toApiMessages(newMessages);

    // Inject current section context + inline content into the latest user message for API only
    if (includeContext && currentSection && apiMessages.length > 0) {
      const last = apiMessages[apiMessages.length - 1];
      if (last.role === "user") {
        let ctx = `[Currently viewing: "${currentSection.title}" (id: ${currentSection.id}, type: ${currentSection.type})]`;

        // Inline section content so LLM doesn't waste rounds on get_section
        if (token) {
          try {
            const raw = await window.api.getSectionContent(token, currentSection.id, "markdown");
            if (raw && typeof raw === "string" && raw.length > 0) {
              const MAX_INLINE = 12000;
              if (raw.length <= MAX_INLINE) {
                ctx += `\n\n--- Section content (${raw.length} chars) ---\n${raw}\n--- End of section ---`;
              } else {
                ctx += `\n\n--- Section content (first ${MAX_INLINE} of ${raw.length} chars) ---\n${raw.slice(0, MAX_INLINE)}\n--- End of section (truncated, use get_section with offset=${MAX_INLINE} for rest) ---`;
              }
            }
          } catch { /* folder or empty section — skip */ }
        }

        if (editorSelectedText) {
          ctx += `\n[Selected text: "${editorSelectedText}"]`;
        }
        if (typeof last.content === "string") {
          apiMessages = [...apiMessages.slice(0, -1), { ...last, content: `${ctx}\n${last.content}` }];
        } else if (Array.isArray(last.content)) {
          apiMessages = [...apiMessages.slice(0, -1), { ...last, content: [{ type: "text", text: ctx }, ...last.content] }];
        }
      }
    }

    const compressThreshold = CONTEXT_LIMIT * COMPRESS_AT;
    const hardLimit = CONTEXT_LIMIT * HARD_STOP_AT;

    const compactMessages = createCompactMessages({
      get, set, llmApiKey: llmApiKey!, model, llmTaskId, llmTaskTokens,
    });

    const systemPrompt = systemParts.join("\n");
    console.group("[LLM] New chat request");
    console.log("[LLM] System prompt:\n", systemPrompt);
    console.log("[LLM] Tools:", finalTools.map(t => t.name));
    console.log("[LLM] Messages:", JSON.stringify(apiMessages, null, 2));
    console.log("[LLM] Model:", model, "| maxTokens:", maxTokens, "| thinking:", thinking);
    console.groupEnd();

    let round = 0;
    let lastInputTokens = 0;

    while (round < ABSOLUTE_MAX_ROUNDS) {
      // Check if user cancelled or a new engine superseded this one
      if (isStale()) {
        console.log("[LLM] Aborted by user or superseded");
        get().finishBgTask(llmTaskId);
        return toolState.lastCreatedId;
      }

      round++;
      console.group(`[LLM] Round ${round}`);

      // Between-round optimization: deduplicate repeated content + compress source code
      if (round > 1) {
        apiMessages = optimizeBetweenRounds(apiMessages);

        // Orchestrator: compress old delegate results that have been consumed
        if (useSubAgents) {
          const est = estimateInputTokens(systemPrompt, apiMessages);
          if (est > ORCHESTRATOR_COMPRESS_AT) {
            console.log(`[LLM] Orchestrator context ${est} > ${ORCHESTRATOR_COMPRESS_AT}, compressing consumed delegates`);
            apiMessages = shrinkConsumedDelegates(apiMessages, 2);
          }
        }
      }

      // Pre-send context estimation — compress before sending if needed
      const estimatedTokens = Math.ceil(
        (JSON.stringify(apiMessages).length + systemPrompt.length) / 4
      );

      if (estimatedTokens > hardLimit) {
        console.warn(`[LLM] Pre-send estimate ${estimatedTokens} tokens > hard limit ${hardLimit}, compacting...`);
        set(s => ({
          llmMessages: [...s.llmMessages, {
            role: "assistant" as const,
            content: "🔄 Сжимаю контекст перед продолжением...",
          }],
        }));
        apiMessages = shrinkToolResults(apiMessages, 500);
        apiMessages = await compactMessages(apiMessages);

        const reEstimate = Math.ceil(JSON.stringify(apiMessages).length / 4);
        if (reEstimate > hardLimit) {
          // Still too large after compaction — aggressive shrink
          apiMessages = shrinkToolResults(apiMessages, 200);
          const finalEstimate = Math.ceil(JSON.stringify(apiMessages).length / 4);
          if (finalEstimate > hardLimit) {
            console.error(`[LLM] Context still ${finalEstimate} tokens after aggressive compaction, stopping`);
            const pct = Math.round((finalEstimate / CONTEXT_LIMIT) * 100);
            set(s => ({
              llmMessages: [...s.llmMessages, { role: "assistant" as const, content: `⚠️ Контекст исчерпан (${pct}%), останавливаюсь.` }],
              llmLoading: false,
            }));
            get().saveLlmSession();
            get().finishBgTask(llmTaskId);
            console.groupEnd();
            return toolState.lastCreatedId;
          }
        }
      } else if (estimatedTokens > compressThreshold) {
        console.log(`[LLM] Pre-send estimate ${estimatedTokens} tokens > compress threshold, compacting...`);
        apiMessages = shrinkToolResults(apiMessages, 1000);
        apiMessages = await compactMessages(apiMessages);
      }

      // In planMode after research budget: keep the SAME tools array (preserves cache key)
      // but block read-only tools at executor level (budgetExceeded check below).
      // Previously we filtered tools here, which changed the cache key and cost ~9K tokens
      // in cache_creation on every phase transition.
      const roundTools = finalTools;

      console.log("[LLM] Sending", apiMessages.length, "messages to API");

      // Show estimated input tokens before request
      const estInputChat = estimateInputTokens(systemPrompt, apiMessages);
      get().updateBgTask(llmTaskId, { tokens: { input: llmTaskTokens.input + estInputChat, output: llmTaskTokens.output } });

      const data = await window.api.llmChat({
        apiKey: llmApiKey,
        system: systemPrompt,
        messages: apiMessages,
        model,
        maxTokens: thinking ? maxTokens + thinkingBudget : maxTokens,
        tools: roundTools,
        ...(thinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
        ...(!thinking ? { temperature } : {}),
      });

      // Check abort immediately after API call returns (main latency point)
      if (isStale()) {
        console.log("[LLM] Aborted after API call");
        get().finishBgTask(llmTaskId);
        console.groupEnd();
        return toolState.lastCreatedId;
      }

      const stopReason = data.stop_reason;
      const contentBlocks = data.content || [];
      lastInputTokens = data.usage?.input_tokens || 0;
      const pct = Math.round((lastInputTokens / CONTEXT_LIMIT) * 100);

      console.log("[LLM] Response stop_reason:", stopReason);
      console.log("[LLM] Response content blocks:", contentBlocks.map((b: any) => ({ type: b.type, ...(b.type === "text" ? { text: b.text?.slice(0, 200) } : {}), ...(b.type === "tool_use" ? { name: b.name, input: b.input } : {}) })));
      if (data.usage) console.log("[LLM] Usage:", data.usage, `(${pct}% context)`);

      // Track cumulative token usage
      if (data.usage) {
        llmTaskTokens.input += data.usage.input_tokens || 0;
        llmTaskTokens.output += data.usage.output_tokens || 0;
        llmTaskTokens.cacheRead += data.usage.cache_read_input_tokens || 0;
        llmTaskTokens.cacheCreation += data.usage.cache_creation_input_tokens || 0;
        get().updateBgTask(llmTaskId, { tokens: { ...llmTaskTokens } });
        set(s => ({ llmTokensUsed: {
          input: s.llmTokensUsed.input + (data.usage.input_tokens || 0),
          output: s.llmTokensUsed.output + (data.usage.output_tokens || 0),
          cacheRead: s.llmTokensUsed.cacheRead + (data.usage.cache_read_input_tokens || 0),
          cacheCreation: s.llmTokensUsed.cacheCreation + (data.usage.cache_creation_input_tokens || 0),
        }}));
      }

      if (stopReason === "tool_use") {
        // Add assistant message with tool_use blocks
        apiMessages = [...apiMessages, { role: "assistant", content: contentBlocks }];

        const toolBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");

        // --- ask_user handling: if present, execute only ask_user, cancel the rest ---
        const askUserBlock = toolBlocks.find((b: any) => b.name === "ask_user");
        if (askUserBlock) {
          const question: string = String(askUserBlock.input?.question || "");
          // Normalize options: Haiku may send stringified JSON arrays
          let options: string[] | null = null;
          const rawOptions = askUserBlock.input?.options;
          if (Array.isArray(rawOptions)) {
            options = rawOptions.map(String);
          } else if (typeof rawOptions === "string" && rawOptions.startsWith("[")) {
            try { const parsed = JSON.parse(rawOptions); if (Array.isArray(parsed)) options = parsed.map(String); } catch { /* ignore */ }
          }

          // Extract any text blocks the model sent alongside ask_user
          const textParts = contentBlocks
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n");

          // Show text (if any) + question as assistant messages in UI
          set((s) => ({
            llmMessages: [
              ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄") && !SUB_AGENT_EMOJIS.some(e => (m.content as string).startsWith(e)))),
              ...(textParts ? [{ role: "assistant" as const, content: textParts }] : []),
              { role: "assistant" as const, content: `❓ ${question}`, isQuestion: true },
            ],
          }));

          // Pause: wait for user answer via promise
          const userAnswer = await new Promise<string>((resolve) => {
            get().setWaitingForUser(question, options, resolve);
          });

          // Check if aborted while waiting — stopLlmChat already cleaned up UI
          if (userAnswer === "__ABORTED__" || isStale()) {
            console.log("[LLM] Aborted while waiting for user answer");
            get().finishBgTask(llmTaskId);
            console.groupEnd();
            return toolState.lastCreatedId;
          }

          // Show user's answer in UI
          set((s) => ({
            llmMessages: [...s.llmMessages, { role: "user" as const, content: userAnswer }],
          }));

          // Build tool_results: ask_user gets the answer, others get cancelled
          const toolResults: any[] = [];
          for (const block of toolBlocks) {
            if (block.id === askUserBlock.id) {
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: userAnswer });
            } else {
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Cancelled — waiting for user input. Re-call this tool if still needed.", is_error: true });
            }
          }
          apiMessages = [...apiMessages, { role: "user", content: toolResults }];
          console.log("[LLM] ask_user answered:", userAnswer.slice(0, 200));
          console.groupEnd();
          continue;
        }

        // Show tool calls in UI
        const descCounts = new Map<string, number>();
        for (const b of toolBlocks) {
          const d = TOOL_DESCRIPTIONS[b.name] || b.name;
          descCounts.set(d, (descCounts.get(d) || 0) + 1);
        }
        const descriptions = [...descCounts.entries()].map(([d, n]) => n > 1 ? `${d} (×${n})` : d);
        const pctLabel = pct > 30 ? ` · 📊 ${pct}%` : "";
        set((s) => ({
          llmMessages: [...s.llmMessages, {
            role: "assistant",
            content: `🔧 ${descriptions.join(" · ")}${pctLabel}`,
          }],
        }));

        // In planMode after budget, block read-only tool calls at executor level
        const budgetExceeded = planMode && round > PLAN_RESEARCH_MAX_ROUNDS;

        // Execute tools — parallel for read-only, sequential if any mutating
        const allReadOnly = toolBlocks.every((b: any) => READ_ONLY_TOOLS.has(b.name));
        const toolResults: any[] = [];

        // No special truncation for delegate results — let them arrive in full so the
        // orchestrator makes informed decisions without redundant re-delegation.
        // Context growth is handled adaptively by shrinkToolResults (at 60%/85% thresholds)
        // which compresses ALL old tool_results proportionally when context gets large.

        if (allReadOnly) {
          const results = await Promise.all(
            toolBlocks.map(async (block: any) => {
              if (budgetExceeded && READ_ONLY_TOOLS.has(block.name)) {
                console.log(`[LLM] BLOCKED read-only tool after budget: ${block.name}`);
                return { type: "tool_result", tool_use_id: block.id, content: "ERROR: Research budget exceeded. You MUST now write the plan using create_section. Do NOT read more code or documentation — write the plan immediately with all information you already have.", is_error: true };
              }
              console.log(`[LLM] Executing tool (parallel): ${block.name}`, JSON.stringify(block.input).slice(0, 300));
              const raw = await executeTool(block.name, block.input);
              const result = truncateToolResult(compressToolResult(raw));
              console.log(`[LLM] Tool result (${block.name}): ${raw.length} chars${raw.length > TOOL_RESULT_LIMIT ? " [truncated]" : ""}`, result.slice(0, 500));
              return { type: "tool_result", tool_use_id: block.id, content: result };
            })
          );
          toolResults.push(...results);
        } else {
          for (const block of contentBlocks) {
            if (block.type === "tool_use") {
              if (budgetExceeded && READ_ONLY_TOOLS.has(block.name)) {
                console.log(`[LLM] BLOCKED read-only tool after budget: ${block.name}`);
                toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "ERROR: Research budget exceeded. You MUST now write the plan using create_section. Do NOT read more code or documentation — write the plan immediately with all information you already have.", is_error: true });
                continue;
              }
              console.log(`[LLM] Executing tool: ${block.name}`, JSON.stringify(block.input).slice(0, 300));
              const raw = await executeTool(block.name, block.input);
              // Delegate results: smart compression preserving Summary; other tools: standard truncation
              const isDelegate = block.name.startsWith("delegate_");
              const result = isDelegate
                ? compressDelegateReport(raw)
                : truncateToolResult(compressToolResult(raw));
              console.log(`[LLM] Tool result (${block.name}): ${raw.length}→${result.length} chars`, result.slice(0, 500));
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
            }
          }
        }

        // In planMode: warn model after last research round that next round is write-only
        if (planMode && round === PLAN_RESEARCH_MAX_ROUNDS) {
          toolResults.push({
            type: "text",
            text: `⚠️ RESEARCH BUDGET EXHAUSTED. This was your LAST research round. Your NEXT response MUST call create_section to write the plan — ALL read-only tools are now blocked.`,
          } as any);
        }

        apiMessages = [...apiMessages, { role: "user", content: toolResults }];

        // Check abort after tool execution
        if (isStale()) {
          console.log("[LLM] Aborted after tool execution");
          await silentRefreshUI();
          get().finishBgTask(llmTaskId);
          console.groupEnd();
          return toolState.lastCreatedId;
        }

        // Silently refresh UI after mutating tool calls (no navigation, no spinner)
        await silentRefreshUI();

        console.groupEnd();

        // Context management: compress or stop if too large
        if (lastInputTokens > hardLimit) {
          console.warn(`[LLM] Context at ${pct}% — hard limit reached, stopping`);
          set((s) => ({
            llmMessages: [...s.llmMessages, { role: "assistant", content: `⚠️ Контекст исчерпан (${pct}%), останавливаюсь.` }],
            llmLoading: false,
          }));
          get().saveLlmSession();
          get().finishBgTask(llmTaskId);
          return toolState.lastCreatedId;
        }

        if (lastInputTokens > compressThreshold) {
          console.log(`[LLM] Context at ${pct}% — compressing...`);
          set((s) => ({
            llmMessages: [...s.llmMessages, {
              role: "assistant",
              content: "🔄 Сжимаю контекст для продолжения работы...",
            }],
          }));
          apiMessages = await compactMessages(apiMessages);
          console.log("[LLM] After compaction:", apiMessages.length, "messages");
        }

      } else {
        // Stale engine must not touch store — a new engine may already be running
        if (isStale()) {
          console.log("[LLM] Stale engine, discarding response");
          get().finishBgTask(llmTaskId);
          console.groupEnd();
          return toolState.lastCreatedId;
        }

        if (stopReason === "max_tokens") {
          const hadToolCalls = contentBlocks.some((b: any) => b.type === "tool_use");
          const warning = hadToolCalls
            ? "⚠️ Ответ обрезан лимитом токенов — незавершённые вызовы инструментов пропущены. Увеличьте maxTokens (effort: high) или разбейте задачу на части."
            : "⚠️ Ответ обрезан лимитом токенов. Увеличьте maxTokens в настройках LLM или разбейте задачу на части.";
          set((s) => ({
            llmMessages: [
              ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄") && !SUB_AGENT_EMOJIS.some(e => (m.content as string).startsWith(e)))),
              { role: "assistant", content: warning },
            ],
            llmLoading: false,
          }));
          console.warn("[LLM] stop=max_tokens", hadToolCalls ? "(had incomplete tool calls)" : "");
          get().saveLlmSession();
          get().finishBgTask(llmTaskId);
          return toolState.lastCreatedId;
        }

        // Final text response — extract text blocks
        const textParts = contentBlocks
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text);
        const reply = textParts.join("\n") || "";
        console.log("[LLM] Final reply:", reply.slice(0, 300));
        console.groupEnd();

        // Silently refresh UI after mutations (no navigation, no spinner)
        await silentRefreshUI();

        // Remove tool-status messages and add final reply
        set((s) => ({
          llmMessages: [
            ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄") && !SUB_AGENT_EMOJIS.some(e => (m.content as string).startsWith(e)))),
            { role: "assistant", content: reply },
          ],
          llmLoading: false,
        }));
        get().saveLlmSession();
        get().finishBgTask(llmTaskId);
        return toolState.lastCreatedId;
      }
    }

    // Absolute max rounds exceeded (emergency safeguard)
    if (!isStale()) {
      set((s) => ({
        llmMessages: [...s.llmMessages, { role: "assistant", content: "⚠️ Too many tool calls, stopping." }],
        llmLoading: false,
      }));
      get().saveLlmSession();
    }
    get().finishBgTask(llmTaskId);
    return toolState.lastCreatedId;
  } catch (e: any) {
    if (!isStale()) {
      const errMsg = localizeApiError(get().language, e?.message || String(e));
      set((s) => ({
        llmMessages: [
          ...s.llmMessages,
          { role: "assistant", content: `⚠️ ${errMsg}` },
        ],
        llmLoading: false,
      }));
      get().saveLlmSession();
    }
    get().finishBgTask(llmTaskId);
    return null;
  }
}
