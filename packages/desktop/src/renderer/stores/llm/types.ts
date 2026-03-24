/**
 * Shared types for LLM engine sub-modules.
 */

import type { AppState, LlmConfig, LlmMessage } from "../types.js";

export type SetState = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type GetState = () => AppState;

export interface SplitSection {
  title: string;
  content: string;
  children: SplitSection[];
}

export type { AppState, LlmConfig, LlmAttachment, LlmMessage } from "../types.js";

export interface LlmPlanStep {
  text: string;
  status: "pending" | "in_progress" | "done";
}

export interface LlmPlan {
  steps: LlmPlanStep[];
}

/** Tool definition shape used throughout the LLM engine. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: any;
}

/** Session buffer entry — shared knowledge between assistant and agents. */
export interface SessionBufferEntry {
  key: string;
  content: string;
  summary: string;
  author: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  charCount: number;
}

/** Session buffer — key-value store persisted per session. */
export interface SessionBuffer {
  entries: Record<string, SessionBufferEntry>;
  totalChars: number;
}

/** Custom agent configuration. */
export interface CustomAgent {
  id: string;           // uuid
  name: string;         // e.g. "Habr Writer"
  description: string;  // short description for the assistant
  systemPrompt: string; // agent's system prompt
  prompt: string;       // agent's base prompt (prepended to task)
  tools: string[];      // ["get_tree", "get_section", "create_section", ...]
  model: string;        // "claude-opus-4-6"
  thinking: boolean;
  effort: "low" | "medium" | "high";
  rating: number;       // 0-10, default 10 (set by assistant via rate_agent)
  ratingLog: string[];  // last problems reported by assistant
}
