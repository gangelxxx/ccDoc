/** Context passed to Provider Scripts */
export interface ProviderContext {
  apiKey: string;
  baseUrl: string;
  model: string;
  homedir: string;

  // Safe utilities (sandbox)
  fetch(url: string, init: RequestInit): Promise<Response>;
  readFile(...pathParts: string[]): string | null;
  log(level: "info" | "warn" | "error", msg: string): void;

  // Optional (enabled in security settings)
  env?(varName: string): string | undefined;
  exec?(cmd: string, timeout?: number): Promise<string>;
}

/** Chat request parameters */
export interface ChatParams {
  messages: any[];
  system: string;
  tools?: any[];
  maxTokens: number;
  temperature: number;
  thinking: boolean;
  thinkingBudget: number;
  stream: boolean;
  signal?: AbortSignal;
  skipMessageCache?: boolean;
  toolChoice?: { type: string };
}

/** Script metadata */
export interface ProviderScriptMeta {
  id: string;
  name: string;
  description: string;
}

/** Model info returned by listModels */
export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  maxOutput?: number;
  supportsThinking?: boolean;
  supportsToolUse?: boolean;
  supportedParams?: string[];
}

/** Exports from a Provider Script */
export interface ProviderScriptExports {
  meta: ProviderScriptMeta;
  chat(ctx: ProviderContext, params: ChatParams): Promise<Response>;
  listModels?(ctx: ProviderContext): Promise<ModelInfo[]>;
}
