/**
 * Message compaction: summarizes middle conversation messages to reduce context size.
 */

import type { SetState, GetState } from "./types.js";
import { estimateInputTokens } from "../../llm-utils.js";

interface CompactParams {
  get: GetState;
  set: SetState;
  llmApiKey: string;
  model: string;
  llmTaskId: string;
  llmTaskTokens: { input: number; output: number };
}

/**
 * Creates a compactMessages function bound to the current session state.
 */
export function createCompactMessages(params: CompactParams) {
  const { get, set, llmApiKey, model, llmTaskId, llmTaskTokens } = params;

  return async function compactMessages(msgs: any[]): Promise<any[]> {
    if (msgs.length <= 4) return msgs; // nothing to compact
    const first = msgs[0]; // original user message
    const tail = msgs.slice(-2); // last assistant + user exchange
    const middle = msgs.slice(1, -2);
    if (middle.length === 0) return msgs;

    // Flatten middle messages to text for summarization
    const middleText = middle.map((m: any, i: number) => {
      const role = m.role;
      let text = "";
      if (typeof m.content === "string") {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = m.content.map((b: any) => {
          if (b.type === "text") return b.text;
          if (b.type === "tool_use") return `[tool: ${b.name}(${JSON.stringify(b.input).slice(0, 200)})]`;
          if (b.type === "tool_result") return `[result: ${typeof b.content === "string" ? b.content.slice(0, 300) : "..."}]`;
          return "";
        }).filter(Boolean).join("\n");
      }
      return `[${role} #${i}]: ${text.slice(0, 500)}`;
    }).join("\n\n");

    try {
      const compactSystem = "Summarize this AI assistant conversation concisely. Preserve: all section IDs created/modified, key decisions, current task progress, and any important data. Output a compact summary.";
      const compactMsgs = [{ role: "user", content: middleText.slice(0, 50000) }];
      const estCompact = estimateInputTokens(compactSystem, compactMsgs);
      get().updateBgTask(llmTaskId, { tokens: { input: llmTaskTokens.input + estCompact, output: llmTaskTokens.output } });
      const summaryData = await window.api.llmChat({
        apiKey: llmApiKey,
        system: compactSystem,
        messages: compactMsgs,
        model,
        maxTokens: 2048,
      });
      const summaryText = (summaryData.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n") || "Summary unavailable.";

      // Track tokens used for compaction
      if (summaryData.usage) {
        llmTaskTokens.input += summaryData.usage.input_tokens || 0;
        llmTaskTokens.output += summaryData.usage.output_tokens || 0;
        get().updateBgTask(llmTaskId, { tokens: { ...llmTaskTokens } });
        set(s => ({ llmTokensUsed: {
          input: s.llmTokensUsed.input + (summaryData.usage.input_tokens || 0),
          output: s.llmTokensUsed.output + (summaryData.usage.output_tokens || 0),
          cacheRead: s.llmTokensUsed.cacheRead + (summaryData.usage.cache_read_input_tokens || 0),
          cacheCreation: s.llmTokensUsed.cacheCreation + (summaryData.usage.cache_creation_input_tokens || 0),
        }}));
      }

      return [
        first,
        { role: "user", content: `[Conversation summary — previous ${middle.length} messages compressed]\n${summaryText}` },
        { role: "assistant", content: "Understood, continuing from the summary." },
        ...tail,
      ];
    } catch (e) {
      console.warn("[LLM] Compaction failed, continuing with full context:", e);
      return msgs;
    }
  };
}
