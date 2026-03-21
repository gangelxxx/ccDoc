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

export type SubAgentType = "research" | "writer" | "critic" | "planner";

/** Tool definition shape used throughout the LLM engine. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: any;
}
