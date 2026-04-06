/**
 * LLM chat engine -- orchestrates system prompt, tools, and the round loop.
 *
 * Sub-modules in ./llm/:
 *   system-prompt.ts    — buildSystemPrompt
 *   tool-definitions.ts — buildTools, TOOL_DESCRIPTIONS
 *   tool-executor.ts    — createToolExecutor
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
  shrinkToolResults,
  optimizeBetweenRounds,
  CONTEXT_LIMIT,
  COMPRESS_AT,
  HARD_STOP_AT,
  ABSOLUTE_MAX_ROUNDS,
  ROUNDS_WARNING_AT,
  TOOL_RESULT_LIMIT,
  READ_ONLY_TOOLS,
  PLAN_RESEARCH_MAX_ROUNDS,
  CHAT_SOFT_BUDGET,
  CHAT_HARD_BUDGET,
  estimateMessagesChars,
} from "../llm-utils.js";

import { ToolDedupTracker, type DedupResult } from "./llm/tool-dedup.js";

import { buildSystemPrompt } from "./llm/system-prompt.js";
import { buildTools, TOOL_DESCRIPTIONS } from "./llm/tool-definitions.js";
import { createToolExecutor } from "./llm/tool-executor.js";
import { createCompactMessages } from "./llm/compact-messages.js";
import { localizeApiError } from "../i18n.js";

// Re-export splitMarkdownIntoSections for any external consumer
export { splitMarkdownIntoSections } from "./llm/split-markdown.js";

type SetState = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type GetState = () => AppState;

/** Internal passport keys that should not be sent to the LLM */
const _INTERNAL_KEYS = new Set([
  "auto_commit_enabled", "fts_index_version", "fts_last_indexed_at",
  "semantic_last_indexed_at", "code_max_mtime", "indexing_auto_configured",
]);

function filterPassport(p: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!_INTERNAL_KEYS.has(k) && v?.trim()) out[k] = v;
  }
  return out;
}

/** Check if a message is too simple/short to warrant semantic pre-fetch. */
function isSimpleMessage(msg: string): boolean {
  const lower = msg.trim().toLowerCase();
  if (lower.length < 15 && !lower.includes("?") && !lower.includes("how") &&
      !lower.includes("what") && !lower.includes("where") && !lower.includes("why")) {
    return true;
  }
  const greetings = ["hi", "hello", "thanks", "ok", "bye", "yes", "no", "sure", "cool", "nice", "great", "fine"];
  return greetings.some(g => lower === g || lower.startsWith(g + " "));
}

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
  const { modelTiers, llmMessages, currentSection, currentProject, theme, language, editorSelectedText, webSearchProvider, webSearchApiKey, llmSessionContext, customAgents, devToolFeedback, llmTargetProjectToken } = get();
  const chatTierConfig = modelTiers[modelTiers.chatTier];
  const { modelId: model, maxTokens, temperature, thinking, thinkingBudget } = chatTierConfig;

  if (!get().hasLlmAccess() || (!text.trim() && (!attachments || attachments.length === 0))) return null;

  // Use linked project token if set (for linked doc gen sessions), otherwise current project
  const token = llmTargetProjectToken || currentProject?.token;
  const mainProjectToken = currentProject?.token; // always the sidebar project

  const webSearchEnabled = webSearchProvider !== "none" && !!webSearchApiKey;

  // --- Build system prompt ---
  const workspace = get().workspace;
  const linkedProjects = get().linkedProjects;

  const systemParts = buildSystemPrompt({
    planMode: !!planMode,
    language: language || "en",
    includeContext,
    includeSourceCode: !!includeSourceCode,
    webSearchEnabled,
    docUpdateMode: llmSessionContext?.mode === "doc-update",
    devToolFeedback,
    autoVerifyPlan: get().autoVerifyPlan,
    currentSection,
    currentProject,
    theme,
    customAgents,
    passport: filterPassport(get().passport),
    workspace: workspace ? {
      name: workspace.name,
      linkedProjects: linkedProjects.map(lp => ({
        name: lp.alias || lp.source_path.split(/[\\/]/).pop() || "unnamed",
        link_type: lp.link_type,
        doc_status: lp.doc_status,
      })),
    } : null,
  });

  // --- Build tools ---
  const finalTools = buildTools({
    includeSourceCode: !!includeSourceCode,
    planMode: !!planMode,
    webSearchEnabled,
    customAgents,
  });

  // --- Mutable state for tool execution ---
  const toolState = { mutated: false, lastCreatedId: null as string | null, createdSections: [] as Array<{ id: string; title: string; type: string }>, affectedSectionIds: [] as string[], treeStructureChanged: false };
  const dedupTracker = new ToolDedupTracker();
  const toolFeedbackLog: Array<{ round: number; raw: string }> = [];
  let sessionSummary = "";
  const startTime = Date.now();
  let llmTaskTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let softBudgetWarned = false;
  let hardBudgetWarned = false;
  const myGeneration = ++engineGeneration;
  /** Check if this engine instance is still the active one (not superseded by stop → new message). */
  const isStale = () => get().llmAborted || myGeneration !== engineGeneration;

  /**
   * Granular UI refresh after LLM tool mutations.
   * - Reloads tree only if structure changed (create/delete/move)
   * - Updates currentSection only if it was affected by tools AND not dirty in editor
   * - Increments fileSectionsVersion only if relevant sections were affected
   */
  async function refreshAfterToolExecution() {
    if (!toolState.mutated) return;
    const affected = new Set(toolState.affectedSectionIds);
    const structureChanged = toolState.treeStructureChanged;

    // Reset per-round tracking (keep cumulative: mutated, lastCreatedId, createdSections)
    toolState.affectedSectionIds = [];
    toolState.treeStructureChanged = false;

    // 1. Reload tree if structural changes happened (create/delete/move)
    if (structureChanged) {
      const refreshToken = mainProjectToken;
      if (refreshToken) {
        try {
          const { workspace: ws, linkedProjects: lps } = get();
          const tree = (ws && lps.length > 0)
            ? await window.api.getUnifiedTree(refreshToken, true)
            : await window.api.getTree(refreshToken);
          set({ tree });
        } catch { /* ignore */ }
      }
    }

    // 2. Update currentSection only if it was affected AND editor is not dirty
    const cur = get().currentSection;
    if (cur && mainProjectToken && affected.has(cur.id)) {
      const dirtyEditors = get().dirtyEditors;
      if (!dirtyEditors || !dirtyEditors.has(cur.id)) {
        try {
          const sectionRefreshToken = get().activeSectionToken || mainProjectToken;
          const updated = await window.api.getSection(sectionRefreshToken!, cur.id);
          set({ currentSection: updated });
        } catch {
          set({ currentSection: null });
        }
      } else {
        console.debug(`[LLM] Skipping DB refresh for dirty editor: ${cur.id}`);
      }
    }

    // 3. Increment fileSectionsVersion only if the current file's children were affected
    if (cur && affected.size > 0) {
      const fileId = cur.type === "file" ? cur.id : cur.parent_id;
      // Check if any affected section could be a child of the current file view,
      // or if structural changes happened (conservative — covers create/delete inside files)
      const fileChildrenAffected = fileId && (
        affected.has(fileId) ||
        structureChanged
      );
      if (fileChildrenAffected) {
        set(s => ({ fileSectionsVersion: s.fileSectionsVersion + 1 }));
      }
    }
  }

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
  // Show user message + loading spinner BEFORE heavy sync work (buildSlugMap)
  set({ llmMessages: newMessages, llmLoading: true, llmAborted: false });

  // Bump active session to top of history list
  const { llmCurrentSessionId, bumpSession } = get();
  if (llmCurrentSessionId) {
    bumpSession(llmCurrentSessionId);
  }

  const llmTaskId = get().startBgTask("LLM chat");

  // If targeting a linked project, pre-fetch its tree for resolveId
  let targetTree: any[] | undefined;
  if (llmTargetProjectToken && llmTargetProjectToken !== mainProjectToken) {
    try {
      targetTree = await window.api.getTree(llmTargetProjectToken);
    } catch { /* ignore — executor will work without slug map */ }
  }

  const executeTool = createToolExecutor(token!, get, set, toolState, "assistant", targetTree);

  try {
    let apiMessages = toApiMessages(newMessages);

    // Inject current section context + inline content into the latest user message for API only
    if (includeContext && currentSection && apiMessages.length > 0) {
      const last = apiMessages[apiMessages.length - 1];
      if (last.role === "user") {
        let ctx = `[Currently viewing: "${currentSection.title}" (id: ${currentSection.id}, type: ${currentSection.type})]`;

        // Inline section content so LLM doesn't waste rounds on read()
        if (token) {
          try {
            const raw = await window.api.getSectionContent(token, currentSection.id, "markdown");
            if (raw && typeof raw === "string" && raw.length > 0) {
              const MAX_INLINE = 12000;
              if (raw.length <= MAX_INLINE) {
                ctx += `\n\n--- Section content (${raw.length} chars) ---\n${raw}\n--- End of section ---`;
              } else {
                ctx += `\n\n--- Section content (first ${MAX_INLINE} of ${raw.length} chars) ---\n${raw.slice(0, MAX_INLINE)}\n--- End of section (truncated, use read(id: "${currentSection.id}", offset: ${MAX_INLINE}) for rest) ---`;
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
      get, set, llmTaskId, llmTaskTokens,
    });

    // --- Pre-fetch: project snapshot + semantic context ---
    let prefetchedContext = "";
    if (token && includeSourceCode) {
      try {
        // Project snapshot (cached, ~700 tokens)
        const snapshot = await window.api.semanticSnapshot(token);
        if (snapshot) {
          const parts: string[] = [];
          if (snapshot.codeTree) {
            parts.push(`## Project code structure\n<code_tree>\n${snapshot.codeTree}\n</code_tree>`);
          }
          if (snapshot.docTree) {
            parts.push(`## Documentation structure\n<doc_tree>\n${snapshot.docTree}\n</doc_tree>`);
          }
          if (parts.length > 0) {
            prefetchedContext += parts.join("\n\n") + "\n\n";
          }
        }

        // Semantic pre-fetch (auto-retrieve relevant chunks, ~2-3K tokens)
        if (text && text.length > 15 && !isSimpleMessage(text)) {
          const prefetch = await window.api.semanticPrefetch(token, text, 3000, 0.35);
          if (prefetch && prefetch.chunks.length > 0) {
            const header = "## Relevant context (auto-retrieved)\n\n" +
              "The following code and documentation sections are most relevant to the user's query. " +
              "Review them before using any tools — you likely already have what you need.\n\n";
            const body = prefetch.chunks.map((r: any, i: number) => {
              const chunk = r.chunk;
              if (chunk.kind === "code") {
                return `### [${i + 1}] ${chunk.filePath}::${chunk.symbolName || `L${chunk.startLine}-${chunk.endLine}`}\n` +
                  "```" + chunk.language + "\n" + chunk.content + "\n```";
              } else {
                return `### [${i + 1}] ${chunk.sectionPath}${chunk.heading ? " > " + chunk.heading : ""}\n` +
                  chunk.content;
              }
            }).join("\n\n");
            prefetchedContext += header + body + "\n\n";
            console.log(`[LLM] [Prefetch] ${prefetch.chunks.length} chunks, ${prefetch.totalTokens} tokens`);
          }
        }
      } catch (err) {
        console.warn("[LLM] [Prefetch] Failed:", err);
        // Non-fatal: continue without prefetch
      }
    }

    const systemPrompt = systemParts.join("\n") + (prefetchedContext ? "\n\n" + prefetchedContext : "");
    console.group("[LLM] New chat request");
    console.log("[LLM] System prompt:\n", systemPrompt);
    console.log("[LLM] Tools:", finalTools.map(t => t.name));
    console.log("[LLM] Messages:", apiMessages.length, "messages, ~" + Math.round(estimateMessagesChars(apiMessages) / 1024) + "KB");
    console.log("[LLM] Model:", model, "| maxTokens:", maxTokens, "| thinking:", thinking);
    console.groupEnd();

    let round = 0;
    let lastInputTokens = 0;
    let freePlanRounds = 0;
    let roundWarningIssued = false;
    let lastToolCallSig = "";
    let repeatCount = 0;
    const MAX_REPEAT_TOOL_CALLS = 3;

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
      }

      // Pre-send context estimation — compress before sending if needed
      const estimatedTokens = Math.ceil(
        (estimateMessagesChars(apiMessages) + systemPrompt.length) / 4
      );

      if (estimatedTokens > hardLimit) {
        console.warn(`[LLM] Pre-send estimate ${estimatedTokens} tokens > hard limit ${hardLimit}, compacting...`);
        set(s => ({
          llmMessages: [...s.llmMessages, {
            role: "assistant" as const,
            content: "🔄 Compressing context before continuing...",
          }],
        }));
        apiMessages = shrinkToolResults(apiMessages, 500);
        apiMessages = await compactMessages(apiMessages);

        const reEstimate = Math.ceil(estimateMessagesChars(apiMessages) / 4);
        if (reEstimate > hardLimit) {
          // Still too large after compaction — aggressive shrink
          apiMessages = shrinkToolResults(apiMessages, 200);
          const finalEstimate = Math.ceil(estimateMessagesChars(apiMessages) / 4);
          if (finalEstimate > hardLimit) {
            console.error(`[LLM] Context still ${finalEstimate} tokens after aggressive compaction, stopping`);
            const pct = Math.round((finalEstimate / CONTEXT_LIMIT) * 100);
            set(s => ({
              llmMessages: [...s.llmMessages, { role: "assistant" as const, content: `⚠️ Context exhausted (${pct}%), stopping.` }],
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

      const RETRY_DELAYS = [10_000, 20_000, 30_000]; // ms — backoff for transient errors
      let data: any;
      for (let attempt = 0; ; attempt++) {
        try {
          data = await callTierRaw("chatTier", {
            system: systemPrompt,
            messages: apiMessages,
            tools: roundTools,
            ...(thinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
            ...(!thinking ? { temperature } : {}),
          });
          break; // success
        } catch (err: any) {
          const status = err?.status || err?.statusCode || (typeof err?.message === "string" && err.message.match(/\[(\d{3})\]/)?.[1]);
          const isRetryable = status == 403 || status == 429 || status == 529 || status == 500 || status == 503;
          if (!isRetryable || attempt >= RETRY_DELAYS.length) throw err; // non-retryable or max retries
          if (isStale()) throw err; // user cancelled

          const delay = RETRY_DELAYS[attempt];
          console.warn(`[LLM] Retryable error (${status}), attempt ${attempt + 1}/${RETRY_DELAYS.length}, waiting ${delay / 1000}s...`, err.message);
          set((s) => ({
            llmMessages: [...s.llmMessages, {
              role: "assistant" as const,
              content: `🔄 API error (${status}), retrying in ${delay / 1000}s...`,
            }],
          }));
          await new Promise(resolve => setTimeout(resolve, delay));
          if (isStale()) throw err; // check abort after delay
        }
      }

      // Normalize OpenAI/Ollama response to Anthropic format
      data = normalizeToAnthropicFormat(data);

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

        // Loop detection: if model keeps making the same tool call, force stop
        if (toolBlocks.length > 0) {
          const sig = toolBlocks.map((b: any) => b.name + ":" + JSON.stringify(b.input)).join("|");
          if (sig === lastToolCallSig) {
            repeatCount++;
            if (repeatCount >= MAX_REPEAT_TOOL_CALLS) {
              console.error("[LLM] Loop detected: same tool call repeated " + repeatCount + " times, force stopping");
              set(s => ({
                llmMessages: [...s.llmMessages, {
                  role: "assistant" as const,
                  content: "⚠️ Обнаружено зацикливание: модель повторяет один и тот же вызов инструмента. Сессия остановлена.",
                }],
              }));
              break;
            }
          } else {
            lastToolCallSig = sig;
            repeatCount = 1;
          }
        }

        // Guard: stop_reason=tool_use but no actual tool_use blocks (e.g. only thinking)
        if (toolBlocks.length === 0) {
          console.warn("[LLM] stop_reason=tool_use but no tool_use blocks — treating as end_turn");
          const thinkingText = contentBlocks
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n")
            .trim();
          if (thinkingText) {
            const thinkingFb = extractToolFeedback(thinkingText, round, toolFeedbackLog);
            if (thinkingFb.sessionSummary) sessionSummary = thinkingFb.sessionSummary;
            const reply = applyPlanMarkers(thinkingFb.text, get, set);
            const thinkingMsg: LlmMessage = { role: "assistant", content: reply };
            if (toolState.createdSections.length > 0) {
              thinkingMsg.createdSections = [...toolState.createdSections];
            }
            set((s) => ({
              llmMessages: [
                ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄"))),
                thinkingMsg,
              ],
              llmLoading: false,
            }));
          }
          await refreshAfterToolExecution();
          get().saveLlmSession();
          get().finishBgTask(llmTaskId);
          console.groupEnd();
          return toolState.lastCreatedId;
        }

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
              ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄") && !m.content.startsWith("\uD83E\uDD16"))),
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

        // Extract any intermediate text the model wrote alongside tool calls
        let intermediateRaw = contentBlocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
        // Extract tool feedback (dev mode)
        const intermediateFb = extractToolFeedback(intermediateRaw, round, toolFeedbackLog);
        if (intermediateFb.sessionSummary) sessionSummary = intermediateFb.sessionSummary;
        const intermediateText = applyPlanMarkers(intermediateFb.text, get, set);

        // Show tool calls in UI (with preceding text if any)
        const descCounts = new Map<string, number>();
        for (const b of toolBlocks) {
          const d = TOOL_DESCRIPTIONS[b.name] || b.name;
          descCounts.set(d, (descCounts.get(d) || 0) + 1);
        }
        const descriptions = [...descCounts.entries()].map(([d, n]) => n > 1 ? `${d} (×${n})` : d);
        const pctLabel = pct > 30 ? ` · 📊 ${pct}%` : "";
        set((s) => ({
          llmMessages: [...s.llmMessages,
            ...(intermediateText ? [{ role: "assistant" as const, content: intermediateText }] : []),
            {
              role: "assistant",
              content: `🔧 ${descriptions.join(" · ")}${pctLabel}`,
            },
          ],
        }));

        // In planMode after budget, block read-only tool calls at executor level
        const budgetExceeded = planMode && round > PLAN_RESEARCH_MAX_ROUNDS;

        // Execute tools — parallel for read-only, sequential if any mutating
        const allReadOnly = toolBlocks.every((b: any) => READ_ONLY_TOOLS.has(b.name));
        const toolResults: any[] = [];

        if (allReadOnly) {
          const results = await Promise.all(
            toolBlocks.map(async (block: any) => {
              if (budgetExceeded && READ_ONLY_TOOLS.has(block.name)) {
                console.log(`[LLM] BLOCKED read-only tool after budget: ${block.name}`);
                return { type: "tool_result", tool_use_id: block.id, content: "ERROR: Research budget exceeded. You MUST now write the plan using create_section. Do NOT read more code or documentation — write the plan immediately with all information you already have.", is_error: true };
              }
              // Dedup check (search / read / allow)
              const dedup = checkDedup(dedupTracker, block.name, block.input || {}, round);
              if (dedup.action === "block") {
                console.log(`[LLM] [ToolDedup] BLOCKED: ${block.name}`, dedup.message);
                return { type: "tool_result", tool_use_id: block.id, content: dedup.message!, is_error: true };
              }
              // Apply merged read range if dedup suggests it
              const effectiveInput = dedup.mergedInput
                ? { ...block.input, startLine: dedup.mergedInput.startLine, endLine: dedup.mergedInput.endLine }
                : block.input;
              console.log(`[LLM] Executing tool (parallel): ${block.name}`, JSON.stringify(effectiveInput).slice(0, 300));
              const raw = await executeTool(block.name, effectiveInput);
              let result = truncateToolResult(compressToolResult(raw));
              if (dedup.action === "warn") {
                console.log(`[LLM] [ToolDedup] WARN: ${block.name}`, dedup.message);
                result = dedup.message + "\n\n" + result;
              }
              // Record after execution
              recordDedup(dedupTracker, block.name, effectiveInput, round);
              console.log(`[LLM] Tool result (${block.name}): ${raw.length} chars${raw.length > TOOL_RESULT_LIMIT ? " [truncated]" : ""}`, result.slice(0, 500));
              return { type: "tool_result", tool_use_id: block.id, content: result };
            })
          );
          toolResults.push(...results);
        } else {
          let hadMutation = false;
          for (const block of contentBlocks) {
            if (block.type === "tool_use") {
              if (budgetExceeded && READ_ONLY_TOOLS.has(block.name)) {
                console.log(`[LLM] BLOCKED read-only tool after budget: ${block.name}`);
                toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "ERROR: Research budget exceeded. You MUST now write the plan using create_section. Do NOT read more code or documentation — write the plan immediately with all information you already have.", is_error: true });
                continue;
              }
              // Dedup check (search / read / allow)
              const dedup = checkDedup(dedupTracker, block.name, block.input || {}, round);
              if (dedup.action === "block") {
                console.log(`[LLM] [ToolDedup] BLOCKED: ${block.name}`, dedup.message);
                toolResults.push({ type: "tool_result", tool_use_id: block.id, content: dedup.message!, is_error: true });
                continue;
              }
              // Apply merged read range if dedup suggests it
              const effectiveInput = dedup.mergedInput
                ? { ...block.input, startLine: dedup.mergedInput.startLine, endLine: dedup.mergedInput.endLine }
                : block.input;
              console.log(`[LLM] Executing tool: ${block.name}`, JSON.stringify(effectiveInput).slice(0, 300));
              const raw = await executeTool(block.name, effectiveInput);
              let result = truncateToolResult(compressToolResult(raw));
              if (dedup.action === "warn") {
                console.log(`[LLM] [ToolDedup] WARN: ${block.name}`, dedup.message);
                result = dedup.message + "\n\n" + result;
              }
              // Record after execution
              recordDedup(dedupTracker, block.name, effectiveInput, round);
              // Reset dedup after mutations (model may re-read changed data)
              if (!READ_ONLY_TOOLS.has(block.name)) hadMutation = true;
              console.log(`[LLM] Tool result (${block.name}): ${raw.length}→${result.length} chars`, result.slice(0, 500));
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
            }
          }
          if (hadMutation) {
            dedupTracker.onMutation();
            softBudgetWarned = false;
            hardBudgetWarned = false;
          }
        }

        // In planMode: warn model after last research round that next round is write-only
        if (planMode && round === PLAN_RESEARCH_MAX_ROUNDS) {
          toolResults.push({
            type: "text",
            text: `⚠️ RESEARCH BUDGET EXHAUSTED. This was your LAST research round. Your NEXT response MUST call create_section to write the plan — ALL read-only tools are now blocked.`,
          } as any);
        }

        // Don't count plan-only rounds against the limit (capped at 30 free rounds to prevent infinite loops)
        const isPlanOnlyRound = toolBlocks.every((b: any) => b.name === "update_plan" || b.name === "create_plan");
        if (isPlanOnlyRound && freePlanRounds < 30) {
          freePlanRounds++;
          round--;
        }

        // Skip API round-trip for update_plan-only rounds (saves ~75K cache read tokens per skip).
        // create_plan is NOT skipped — model needs to see "Plan created" confirmation.
        const isUpdatePlanOnly = isPlanOnlyRound
          && toolBlocks.some((b: any) => b.name === "update_plan")
          && !toolBlocks.some((b: any) => b.name === "create_plan");
        if (isUpdatePlanOnly && freePlanRounds <= 30) {
          apiMessages = [...apiMessages, { role: "user", content: toolResults }];
          console.log("[LLM] Plan-only round (update_plan) — skipping API round-trip, continuing loop");
          console.groupEnd();
          continue;
        }

        // Track read-only rounds for soft budget (ignore update_plan/create_plan — they're "neutral")
        const nonPlanBlocks = toolBlocks.filter((b: any) => b.name !== "update_plan" && b.name !== "create_plan");
        if (nonPlanBlocks.length > 0 && nonPlanBlocks.every((b: any) => READ_ONLY_TOOLS.has(b.name))) {
          dedupTracker.incrementReadOnlyRound();
        }

        // Soft budget warnings for regular chat
        if (!planMode) {
          const roRounds = dedupTracker.getReadOnlyRoundCount();
          if (roRounds >= CHAT_HARD_BUDGET && !hardBudgetWarned) {
            hardBudgetWarned = true;
            toolResults.push({ type: "text", text: "🛑 STOP RESEARCHING. You have used " + roRounds + " rounds of read-only tools. Provide your answer NOW with the information you already have." } as any);
          } else if (roRounds >= CHAT_SOFT_BUDGET && !softBudgetWarned) {
            softBudgetWarned = true;
            toolResults.push({ type: "text", text: "⚠️ EFFICIENCY: You've used " + roRounds + " research rounds. You likely have enough information — synthesize your findings and respond." } as any);
          }
        }

        // Warn model when approaching the round limit (fire only once)
        if (round >= ROUNDS_WARNING_AT && !roundWarningIssued) {
          roundWarningIssued = true;
          toolResults.push({
            type: "text",
            text: `⚠️ ROUND LIMIT WARNING: You have used ${round} of ${ABSOLUTE_MAX_ROUNDS} rounds. Only ${ABSOLUTE_MAX_ROUNDS - round} rounds remain. Prioritize the most important remaining work and wrap up. Call commit_version when done.`,
          } as any);
        }

        apiMessages = [...apiMessages, { role: "user", content: toolResults }];

        // Check abort after tool execution
        if (isStale()) {
          console.log("[LLM] Aborted after tool execution");
          await refreshAfterToolExecution();
          get().finishBgTask(llmTaskId);
          console.groupEnd();
          return toolState.lastCreatedId;
        }

        // Silently refresh UI after mutating tool calls (no navigation, no spinner)
        await refreshAfterToolExecution();

        console.groupEnd();

        // Context management: compress or stop if too large
        if (lastInputTokens > hardLimit) {
          console.warn(`[LLM] Context at ${pct}% — hard limit reached, stopping`);
          set((s) => ({
            llmMessages: [...s.llmMessages, { role: "assistant", content: `⚠️ Context exhausted (${pct}%), stopping.` }],
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
              content: "🔄 Compressing context to continue...",
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
            ? "⚠️ Response truncated by token limit — incomplete tool calls skipped. Increase maxTokens (effort: high) or break the task into parts."
            : "⚠️ Response truncated by token limit. Increase maxTokens in LLM settings or break the task into parts.";
          set((s) => ({
            llmMessages: [
              ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄") && !m.content.startsWith("\uD83E\uDD16"))),
              { role: "assistant", content: warning },
            ],
            llmLoading: false,
          }));
          console.warn("[LLM] stop=max_tokens", hadToolCalls ? "(had incomplete tool calls)" : "");
          get().saveLlmSession();
          get().finishBgTask(llmTaskId);
          return toolState.lastCreatedId;
        }

        // Final text response — extract text blocks, strip feedback, apply plan markers
        const rawReply = contentBlocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || "";
        const finalFb = extractToolFeedback(rawReply, round, toolFeedbackLog);
        if (finalFb.sessionSummary) sessionSummary = finalFb.sessionSummary;
        const reply = applyPlanMarkers(finalFb.text, get, set);
        console.log("[LLM] Final reply:", reply.slice(0, 300));
        console.groupEnd();

        // Silently refresh UI after mutations (no navigation, no spinner)
        await refreshAfterToolExecution();

        // Save tool feedback log (dev mode)
        if (toolFeedbackLog.length > 0 || sessionSummary) {
          try {
            const feedbackData = JSON.stringify({
              session: new Date().toISOString(),
              task: text.slice(0, 200),
              rounds: round,
              tokens: { ...llmTaskTokens },
              duration_sec: Math.round((Date.now() - startTime) / 1000),
              tool_feedback: toolFeedbackLog,
              session_summary: sessionSummary,
            }, null, 2);
            window.api.saveFeedbackLog?.(feedbackData);
            console.log(`[LLM] Tool feedback: ${toolFeedbackLog.length} entries saved`);
          } catch { /* non-fatal */ }
        }

        // Remove tool-status messages and add final reply
        const finalMsg: LlmMessage = { role: "assistant", content: reply };
        if (toolState.createdSections.length > 0) {
          finalMsg.createdSections = [...toolState.createdSections];
        }
        set((s) => ({
          llmMessages: [
            ...s.llmMessages.filter((m) => typeof m.content !== "string" || (!m.content.startsWith("🔧") && !m.content.startsWith("🔄") && !m.content.startsWith("\uD83E\uDD16"))),
            finalMsg,
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
    // If tools had already mutated data before the error, refresh to show created sections
    if (toolState.mutated) {
      try { await refreshAfterToolExecution(); } catch { /* ignore */ }
    }
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

/**
 * Single-shot LLM call using a ModelTierConfig (multi-provider).
 * Returns the raw text response from the model.
 */
export async function callLlmOnceTier(
  prompt: string,
  tierConfig: import("./types.js").ModelTierConfig,
  system: string = "You are a helpful assistant. Respond only with the requested JSON.",
): Promise<string> {
  const data = await window.api.llmTierChat({
    tierConfig,
    system,
    messages: [{ role: "user", content: prompt }],
    skipMessageCache: true,
  });

  return extractResponseText(data) || "";
}

/**
 * Get the ModelTierConfig for a given tier assignment key.
 * Usage: getTierConfig("passportTier") → the full config for the tier assigned to passport.
 */
export function getTierConfig(
  assignment: "chatTier" | "passportTier" | "summaryTier",
): import("./types.js").ModelTierConfig {
  const { modelTiers } = (await_store as any)();
  const tierName = modelTiers[assignment]; // "strong" | "medium" | "weak"
  return modelTiers[tierName];
}

// Lazy store getter to avoid circular imports
let await_store: () => any;
export function _setStoreGetter(fn: () => any) { await_store = fn; }

/**
 * Single-shot LLM call via tier — returns full API response (data object).
 * Extracts text from both Anthropic and OpenAI response formats.
 */
export async function callTierRaw(
  assignment: "chatTier" | "passportTier" | "summaryTier",
  params: {
    system: string;
    messages: any[];
    tools?: any[];
    thinking?: { type: string; budget_tokens: number };
    temperature?: number;
    skipMessageCache?: boolean;
    toolChoice?: { type: string };
  },
): Promise<any> {
  const store = await_store();
  const tierName = store.modelTiers[assignment];
  const tierConfig = store.modelTiers[tierName];
  const data = await window.api.llmTierChat({ tierConfig, ...params });
  return normalizeToAnthropicFormat(data);
}

/**
 * Normalize OpenAI/Ollama response to Anthropic format so the chat engine
 * can process it uniformly (stop_reason, content blocks, usage).
 */
export function normalizeToAnthropicFormat(data: any): any {
  // Already Anthropic format
  if (data.stop_reason !== undefined || (Array.isArray(data.content) && data.content[0]?.type)) {
    return data;
  }

  // OpenAI format: { choices: [{ message, finish_reason }], usage }
  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const choice = data.choices[0];
    const msg = choice.message || {};
    const content: any[] = [];

    // Text
    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }

    // Tool calls → Anthropic tool_use blocks
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.function) {
          let args: any = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          content.push({
            type: "tool_use",
            id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
            name: tc.function.name,
            input: args,
          });
        }
      }
    }

    // Handle empty response (content: null, no tool_calls) — model refused or returned nothing
    if (content.length === 0 && choice.finish_reason === "stop") {
      content.push({ type: "text", text: "[Model returned empty response]" });
    }

    // Map finish_reason
    const finishMap: Record<string, string> = {
      stop: "end_turn",
      tool_calls: "tool_use",
      length: "max_tokens",
      content_filter: "end_turn",
    };

    // Map usage (preserve cache fields from both Anthropic and OpenAI/OpenRouter formats)
    const rawUsage = data.usage;
    const cachedTokens = rawUsage?.prompt_tokens_details?.cached_tokens || 0;
    const cacheWriteTokens = rawUsage?.prompt_tokens_details?.cache_write_tokens || 0;
    const usage = rawUsage ? {
      input_tokens: rawUsage.prompt_tokens || 0,
      output_tokens: rawUsage.completion_tokens || 0,
      cache_read_input_tokens: rawUsage.cache_read_input_tokens || cachedTokens,
      cache_creation_input_tokens: rawUsage.cache_creation_input_tokens || cacheWriteTokens,
    } : undefined;

    return {
      ...data,
      stop_reason: finishMap[choice.finish_reason] || "end_turn",
      content,
      model: data.model,
      usage,
    };
  }

  // Ollama format: { message: { role, content }, done }
  if (data.message?.content !== undefined) {
    return {
      ...data,
      stop_reason: "end_turn",
      content: [{ type: "text", text: data.message.content }],
      usage: data.eval_count ? {
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0,
      } : undefined,
    };
  }

  return data;
}

/**
 * Extract text from either Anthropic or OpenAI response format.
 */
export function extractResponseText(data: any): string | null {
  // Anthropic: { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(data.content)) {
    const block = data.content.find((b: any) => b.type === "text");
    if (block?.text) return block.text;
  }
  // OpenAI: { choices: [{ message: { content: "..." } }] }
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  // Ollama: { message: { content: "..." } }
  if (data.message?.content) return data.message.content;
  return null;
}

// -- Dedup helpers ----------------------------------------------------------

const DEDUP_SEARCH_TOOLS = new Set([
  "search_project_files", "find_symbols", "search", "semantic_search",
]);

const DEDUP_READ_TOOLS = new Set(["read_project_file"]);

/** Route a tool call to the appropriate dedup check (search / read / pass-through). */
function checkDedup(
  tracker: ToolDedupTracker,
  toolName: string,
  input: Record<string, any>,
  round: number,
): DedupResult {
  if (DEDUP_SEARCH_TOOLS.has(toolName)) {
    return tracker.checkSearch(toolName, input, round);
  }
  if (DEDUP_READ_TOOLS.has(toolName)) {
    return tracker.checkRead(input, round);
  }
  return { action: "allow" };
}

/** Record a completed tool call in the dedup tracker. */
function recordDedup(
  tracker: ToolDedupTracker,
  toolName: string,
  input: Record<string, any>,
  round: number,
): void {
  if (DEDUP_SEARCH_TOOLS.has(toolName)) {
    tracker.recordSearch(toolName, input, round);
  } else if (DEDUP_READ_TOOLS.has(toolName)) {
    tracker.recordRead(input, round);
  }
}

// -- Plan marker parsing ----------------------------------------------------

const PLAN_MARKER_RE = /\[PLAN:\s*([^\]]+)\]/g;

/**
 * Parse [PLAN: 0=done, 1=done, 2=in_progress] markers from text,
 * apply plan updates, and return text with markers stripped.
 */
function applyPlanMarkers(text: string, get: () => any, set: (fn: any) => void): string {
  if (!text.includes("[PLAN:")) return text;

  const plan = get().llmCurrentPlan;
  if (!plan) return text.replace(PLAN_MARKER_RE, "").trim();

  let updated = false;
  const newSteps = plan.steps.map((s: any) => ({ ...s }));

  for (const match of text.matchAll(PLAN_MARKER_RE)) {
    const entries = match[1].split(",").map((e: string) => e.trim());
    for (const entry of entries) {
      const [idxStr, status] = entry.split("=").map((s: string) => s.trim());
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx) || idx < 0 || idx >= newSteps.length) continue;
      if (status !== "done" && status !== "in_progress") continue;
      newSteps[idx].status = status;
      updated = true;
      // Auto-advance
      if (status === "done" && idx + 1 < newSteps.length && newSteps[idx + 1].status === "pending") {
        newSteps[idx + 1].status = "in_progress";
      }
    }
  }

  if (updated) {
    const updatedPlan = { steps: newSteps };
    const snapshot = { steps: newSteps.map((s: any) => ({ ...s })) };
    const allDone = newSteps.every((s: any) => s.status === "done");

    set((s: any) => ({
      llmCurrentPlan: allDone ? null : updatedPlan,
      llmMessages: [
        ...s.llmMessages.map((m: any) => m.plan ? { ...m, plan: snapshot } : m),
        { role: "assistant" as const, content: "", plan: { ...snapshot, steps: [...snapshot.steps] } },
      ],
    }));
    console.log("[LLM] Auto-applied plan markers:", newSteps.map((s: any, i: number) => `${i}=${s.status}`).join(", "));
  }

  return text.replace(PLAN_MARKER_RE, "").trim();
}

/** Extract and strip <tool_feedback> and <session_summary> tags from model text. */
function extractToolFeedback(
  text: string,
  round: number,
  feedbackLog: Array<{ round: number; raw: string }>,
): { text: string; sessionSummary: string } {
  let sessionSummary = "";
  const feedbackRegex = /<tool_feedback>([\s\S]*?)<\/tool_feedback>/g;
  let match;
  while ((match = feedbackRegex.exec(text)) !== null) {
    feedbackLog.push({ round, raw: match[1].trim() });
  }
  const summaryMatch = text.match(/<session_summary>([\s\S]*?)<\/session_summary>/);
  if (summaryMatch) sessionSummary = summaryMatch[1].trim();

  const cleaned = text
    .replace(/<tool_feedback>[\s\S]*?<\/tool_feedback>/g, "")
    .replace(/<session_summary>[\s\S]*?<\/session_summary>/g, "")
    .trim();
  return { text: cleaned, sessionSummary };
}
